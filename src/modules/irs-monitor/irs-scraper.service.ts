import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../config/supabase.service';
import OpenAI from 'openai';
import * as path from 'path';
import * as fs from 'fs';

export interface IrsScrapeResult {
  rawStatus: string;
  details: string;
  screenshotPath: string | null;
  result: 'success' | 'not_found' | 'error' | 'timeout';
  errorMessage?: string;
}

@Injectable()
export class IrsScraperService {
  private readonly logger = new Logger(IrsScraperService.name);
  private readonly isHeadless: boolean;

  private readonly SCREENSHOT_BUCKET = 'irs-screenshots';
  private readonly proxyUrl: string | undefined;
  private openai: OpenAI | null = null;

  constructor(
    private config: ConfigService,
    private supabase: SupabaseService,
  ) {
    this.isHeadless =
      this.config.get<string>('PLAYWRIGHT_HEADLESS', 'false') === 'true';
    this.proxyUrl =
      this.config.get<string>('PLAYWRIGHT_PROXY_URL') || undefined;
    if (this.proxyUrl)
      this.logger.log(
        `Proxy configured: ${this.proxyUrl.replace(/:\/\/.*@/, '://***@')}`,
      );
  }

  // Maps JAI1 FilingStatus enum values to IRS WMR label[for] selectors
  private readonly FILING_STATUS_SELECTOR: Record<string, string> = {
    single: 'label[for="Single"]',
    married_joint: 'label[for="MFJ"]',
    married_separate: 'label[for="MFS"]',
    head_of_household: 'label[for="HOH"]',
  };

  private async tryBrowserUseAgent(params: {
    ssn: string;
    refundAmount: number;
    taxYear: number;
    taxCaseId: string;
    filingStatus: string;
    clientName: string;
  }): Promise<IrsScrapeResult | null> {
    const agentUrl = this.config.get<string>(
      'IRS_AGENT_URL',
      'http://127.0.0.1:8001',
    );
    try {
      const res = await fetch(`${agentUrl}/check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ssn: params.ssn,
          refund_amount: params.refundAmount,
          tax_year: params.taxYear,
          filing_status: params.filingStatus,
          client_name: params.clientName,
          tax_case_id: params.taxCaseId,
        }),
        signal: AbortSignal.timeout(360_000), // 6 min max
      });

      if (!res.ok) {
        this.logger.warn(`browser-use agent returned ${res.status}`);
        return null;
      }

      const data = (await res.json()) as {
        raw_status: string;
        details: string;
        result: IrsScrapeResult['result'];
        screenshot_base64?: string;
        error_message?: string;
      };

      let screenshotPath: string | null = null;
      if (data.result === 'success' && data.screenshot_base64) {
        try {
          const buf = Buffer.from(data.screenshot_base64, 'base64');
          const date = new Date().toISOString().slice(0, 10);
          const time = new Date()
            .toISOString()
            .slice(11, 19)
            .replace(/:/g, '-');
          const slug = params.clientName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          const storagePath = `checks/${date}/${slug}/${time}.png`;
          await this.supabase.uploadFile(
            this.SCREENSHOT_BUCKET,
            storagePath,
            buf,
            'image/png',
          );
          screenshotPath = storagePath;
        } catch (err) {
          this.logger.warn(
            `browser-use screenshot upload failed: ${(err as Error).message}`,
          );
        }
      }

      this.logger.log(
        `[${params.clientName}] browser-use result: ${data.result} — "${data.raw_status}"`,
      );
      if (data.error_message) {
        this.logger.error(
          `[${params.clientName}] browser-use error_message: ${data.error_message}`,
        );
      }

      const screenshotBytes = data.screenshot_base64
        ? Math.round(Buffer.byteLength(data.screenshot_base64, 'base64') / 1024)
        : null;
      this.logCheck({
        clientName: params.clientName,
        result: data.result,
        rawStatus: data.raw_status,
        attempts: 1,
        akamaiBlocked: false,
        durationMs: 0,
        screenshotBytes: screenshotBytes ? screenshotBytes * 1024 : null,
        source: 'browser-use',
      });

      return {
        rawStatus: data.raw_status,
        details: data.details,
        screenshotPath,
        result: data.result,
        errorMessage: data.error_message,
      };
    } catch (err) {
      // Agent not running or unreachable — fall back to Patchright
      this.logger.warn(
        `browser-use agent unavailable (${(err as Error).message}) — falling back to Patchright`,
      );
      return null;
    }
  }

  async checkRefundStatus(params: {
    ssn: string;
    refundAmount: number;
    taxYear: number;
    taxCaseId: string;
    filingStatus: string;
    clientName: string;
  }): Promise<IrsScrapeResult> {
    if (this.config.get<string>('IRS_SCRAPER_ENABLED') !== 'true') {
      this.logger.warn(
        'IRS scraper is disabled on this environment (IRS_SCRAPER_ENABLED not set). ' +
          'The scraper runs locally only — set IRS_SCRAPER_ENABLED=true in local .env.',
      );
      return {
        rawStatus: 'Scraper no disponible',
        details:
          'El monitor IRS corre localmente. Triggear desde la máquina local con el backend PM2.',
        screenshotPath: null,
        result: 'error',
        errorMessage:
          'IRS_SCRAPER_ENABLED not set — scraper is local-only, cannot run in this environment',
      };
    }

    // Try browser-use Python agent first (85% Akamai bypass rate).
    // Falls back to Patchright if the agent isn't running OR if it errored —
    // an error result from the agent means the browser crashed, not that the
    // IRS returned a real answer. Patchright handles it more reliably.
    const agentResult = await this.tryBrowserUseAgent(params);
    if (agentResult && agentResult.result !== 'error') return agentResult;

    this.logger.log(`[${params.clientName}] Running Patchright fallback...`);

    const { ssn, refundAmount, taxYear, taxCaseId, filingStatus, clientName } =
      params;

    // Mutable state captured during the check for the summary log at the end
    const logState = {
      startTs: Date.now(),
      attempts: 0,
      screenshotBytes: null as number | null,
      akamaiBlocked: false,
    };

    // Patchright patches Playwright's CDP protocol at the source level —
    // eliminates automation signals (Runtime.enable leak, automation flags,
    // navigator.webdriver, etc.) that Akamai's behavioral sensor checks.
    // Only used via launchPersistentContext + channel:'chrome' — per
    // Patchright docs, any of these break the stealth: custom userAgent,
    // custom sec-ch-ua headers, custom launch args, viewport overrides,
    // headless mode, or plain Chromium instead of real Chrome.
    let patchrightChromium: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { chromium } = require('patchright');
      patchrightChromium = chromium;
      this.logger.log('Using Patchright with channel=chrome');
    } catch (err) {
      this.logger.error(`Patchright not available: ${(err as Error).message}`);
      return {
        rawStatus: 'Browser not available',
        details: '',
        screenshotPath: null,
        result: 'error',
        errorMessage:
          'Patchright not installed. Run: bun add patchright && npx patchright install chrome',
      };
    }

    // Jitter with higher floor + wider variance (was 0-350ms, now 200-1000ms).
    // Human form-filling is slower and more variable than the previous setting.
    const jitter = (base: number) =>
      base + 200 + Math.floor(Math.random() * 800);

    // Ghost-cursor generates Bezier-curve mouse paths with human-like
    // acceleration/deceleration — replaces Playwright's linear page.mouse.move
    // which Akamai's behavioral sensor can flag as automated.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createCursor } = require('ghost-cursor-playwright') as {
      createCursor: (page: import('playwright').Page) => Promise<any>;
    };

    let context: import('playwright').BrowserContext | null = null;

    try {
      // Per Patchright docs: launchPersistentContext + channel:'chrome',
      // headless:false, viewport:null, no userAgent, no extraHTTPHeaders,
      // no custom args. A persistent profile also looks less "fresh" to Akamai.
      const userDataDir = path.join(process.cwd(), '.patchright-user-data');
      if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
      }
      if (this.isHeadless) {
        this.logger.warn(
          'PLAYWRIGHT_HEADLESS=true ignored — Patchright requires headful mode for Akamai bypass',
        );
      }

      this.logger.log(
        `Launching Patchright (channel=chrome, userDataDir=${userDataDir})...`,
      );

      context = await patchrightChromium.launchPersistentContext(userDataDir, {
        channel: 'chrome',
        headless: false,
        viewport: null,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        ...(this.proxyUrl ? { proxy: { server: this.proxyUrl } } : {}),
      });

      const page = context!.pages()[0] ?? (await context!.newPage());

      // viewport:null in the context means "use window size" — but a fresh
      // persistent profile opens a tiny default window, producing <10KB
      // screenshots. Set viewport on the page (doesn't affect Patchright's
      // stealth, which only cares about context-level overrides).
      await page.setViewportSize({ width: 1280, height: 900 });

      // Attach ghost-cursor. All clicks route through cursor.actions.click so
      // Bezier paths + acceleration replace linear page.mouse.move.
      const cursor = await createCursor(page);
      const humanClick = async (
        _page: import('playwright').Page,
        selector: string,
      ) => {
        await cursor.actions.click({
          target: selector,
          waitBeforeClick: [150, 500],
        });
      };

      // ── Warm-up: land on irs.gov first so the session has a real referrer
      // chain. Navigating straight to the deep /wmr/ URL is one of Akamai's
      // strongest bot signals. Only done on first entry to the context.
      this.logger.log(`[${clientName}] Warm-up — navigating to irs.gov...`);
      await page
        .goto('https://www.irs.gov/', { timeout: 30000 })
        .catch(() => {});
      await page
        .waitForLoadState('domcontentloaded', { timeout: 10000 })
        .catch(() => {});
      // Idle on irs.gov with organic mouse/scroll activity (Bezier curves)
      for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
        await cursor.actions.move(await cursor.getRandomPointOnViewport());
        await page.waitForTimeout(800 + Math.floor(Math.random() * 1500));
      }
      await page.mouse.wheel(0, 250 + Math.floor(Math.random() * 300));
      await page.waitForTimeout(jitter(2000));
      await page.mouse.wheel(0, -(100 + Math.floor(Math.random() * 150)));
      await page.waitForTimeout(jitter(1500));

      // Inner retry: up to 2 attempts in the same context (same IP, cookies,
      // session). Cheaper than relaunching a fresh browser and looks less
      // suspicious to Akamai (one user retrying ≠ two fresh sessions).
      let akamaiBlocked = false;
      for (let attempt = 1; attempt <= 2; attempt++) {
        logState.attempts = attempt;
        // ── Step 1: Navigate ──────────────────────────────────────────────────
        this.logger.log(`[${clientName}] Step 1/5 — Navigating to IRS WMR...`);
        await page.goto('https://sa.www4.irs.gov/wmr/', { timeout: 30000 });
        await page
          .waitForLoadState('networkidle', { timeout: 15000 })
          .catch(() => {});
        await page.waitForTimeout(jitter(2000));

        // Warm-up with ghost-cursor: Bezier-curve mouse movements so
        // Akamai's behavioral sensor sees organic acceleration patterns.
        for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
          await cursor.actions.move(await cursor.getRandomPointOnViewport());
          await page.waitForTimeout(600 + Math.floor(Math.random() * 1200));
        }
        await page.mouse.wheel(0, 80 + Math.floor(Math.random() * 120));
        await page.waitForTimeout(jitter(1800));
        await page.mouse.wheel(0, -(60 + Math.floor(Math.random() * 80)));
        await page.waitForTimeout(jitter(1500));

        // ── Step 2: SSN ───────────────────────────────────────────────────────
        this.logger.log(`[${clientName}] Step 2/5 — Filling SSN...`);
        await page.waitForSelector('input[name="ssnInput"]', {
          timeout: 15000,
        });
        await humanClick(page, 'input[name="ssnInput"]');
        await page.keyboard.type(ssn, { delay: jitter(60) });
        await page.waitForTimeout(jitter(700));
        this.logger.log(`[${clientName}] Step 2/5 — SSN filled ✓`);

        // Human pause between sections (reading, thinking, finding the next field)
        await page.waitForTimeout(1800 + Math.floor(Math.random() * 2500));

        // ── Step 3: Tax Year ──────────────────────────────────────────────────
        // Use humanClick on the label — locator.check() uses Playwright internals
        // that skip real DOM events, which Akamai's sensor can detect
        this.logger.log(
          `[${clientName}] Step 3/5 — Selecting tax year ${taxYear}...`,
        );
        await page.waitForSelector(`label[for="${taxYear}"]`, {
          timeout: 10000,
        });
        await humanClick(page, `label[for="${taxYear}"]`);
        await page.waitForTimeout(jitter(500));
        const yearChecked = await page
          .$eval(
            `input[id="${taxYear}"]`,
            (el) => (el as HTMLInputElement).checked,
          )
          .catch(() => false);
        if (!yearChecked)
          throw new Error(`Tax year ${taxYear} radio not selected`);
        this.logger.log(
          `[${clientName}] Step 3/5 — Tax year ${taxYear} selected ✓`,
        );

        // Human pause between sections
        await page.waitForTimeout(1500 + Math.floor(Math.random() * 2500));

        // ── Step 4: Filing Status ─────────────────────────────────────────────
        this.logger.log(
          `[${clientName}] Step 4/5 — Selecting filing status: ${filingStatus}...`,
        );
        const filingSelector =
          this.FILING_STATUS_SELECTOR[filingStatus] ?? 'label[for="Single"]';
        const filingRadioId =
          filingSelector.match(/\[for="(.+?)"\]/)?.[1] ?? 'Single';
        await page.waitForSelector(filingSelector, { timeout: 10000 });
        await humanClick(page, filingSelector);
        await page.waitForTimeout(jitter(500));
        const filingChecked = await page
          .$eval(
            `input[id="${filingRadioId}"]`,
            (el) => (el as HTMLInputElement).checked,
          )
          .catch(() => false);
        if (!filingChecked)
          throw new Error(
            `Filing status radio "${filingRadioId}" not selected`,
          );
        this.logger.log(
          `[${clientName}] Step 4/5 — Filing status ${filingStatus} (${filingRadioId}) selected ✓`,
        );

        // Human pause between sections
        await page.waitForTimeout(1500 + Math.floor(Math.random() * 2500));

        // ── Step 5: Refund Amount ─────────────────────────────────────────────
        this.logger.log(
          `[${clientName}] Step 5/5 — Filling refund amount: $${refundAmount}...`,
        );

        // Locate the refund input — try direct CSS selectors first since
        // getByLabel can resolve to a label/container rather than the <input>
        const directRefundInput = page
          .locator(
            'input[name*="refund" i], input[id*="refund" i], ' +
              'input[aria-label*="refund" i], input[placeholder*="refund" i]',
          )
          .first();
        const isDirectVisible = await directRefundInput
          .isVisible()
          .catch(() => false);
        const refundSelector = isDirectVisible
          ? 'input[name*="refund" i], input[id*="refund" i], input[aria-label*="refund" i], input[placeholder*="refund" i]'
          : null;

        if (refundSelector) {
          await humanClick(page, refundSelector);
        } else {
          const refundLabel = page.getByLabel(/refund amount/i).first();
          await refundLabel.waitFor({ state: 'visible', timeout: 10000 });
          await refundLabel.click();
        }

        // Type with keyboard (not fill()) so Akamai sees real keydown/input/keyup events
        await page.keyboard.type(String(refundAmount), { delay: jitter(50) });
        await page.waitForTimeout(jitter(700));

        // Verify the value was entered
        const refundLocator = isDirectVisible
          ? directRefundInput
          : page.getByLabel(/refund amount/i).first();
        const filledAmount = await refundLocator.inputValue().catch(() => '');
        if (filledAmount !== String(refundAmount)) {
          throw new Error(
            `Refund amount mismatch — expected "${refundAmount}", field contains "${filledAmount}"`,
          );
        }
        this.logger.log(
          `[${clientName}] Step 5/5 — Refund amount $${refundAmount} filled ✓`,
        );

        // ── Pre-submit gate — re-read all 4 fields from DOM ──────────────────
        // Never submit if any field is missing or wrong. Each check throws with
        // a specific message so Railway logs show exactly what failed.
        this.logger.log(
          `[${clientName}] Pre-submit gate — verifying all fields...`,
        );

        const ssnValue = await page
          .$eval(
            'input[name="ssnInput"]',
            (el) => (el as HTMLInputElement).value,
          )
          .catch(() => '');
        if (!ssnValue || ssnValue.length < 9) {
          throw new Error(
            `Pre-submit gate FAILED: SSN field is empty or too short (got "${ssnValue}")`,
          );
        }

        const yearOk = await page
          .$eval(
            `input[id="${taxYear}"]`,
            (el) => (el as HTMLInputElement).checked,
          )
          .catch(() => false);
        if (!yearOk) {
          throw new Error(
            `Pre-submit gate FAILED: Tax year ${taxYear} is not selected`,
          );
        }

        const filingOk = await page
          .$eval(
            `input[id="${filingRadioId}"]`,
            (el) => (el as HTMLInputElement).checked,
          )
          .catch(() => false);
        if (!filingOk) {
          throw new Error(
            `Pre-submit gate FAILED: Filing status "${filingRadioId}" is not selected`,
          );
        }

        const amountValue = await refundLocator.inputValue().catch(() => '');
        if (amountValue !== String(refundAmount)) {
          throw new Error(
            `Pre-submit gate FAILED: Refund amount is "${amountValue}", expected "${refundAmount}"`,
          );
        }

        this.logger.log(
          `[${clientName}] Pre-submit gate PASSED — SSN ✓ Year ${taxYear} ✓ Filing ${filingRadioId} ✓ Amount $${refundAmount} ✓`,
        );

        // ── Submit ────────────────────────────────────────────────────────────
        // Bezier-curve movement before submit, then longer pause so Akamai's
        // sensor sees a "reviewing my form before submitting" beat.
        await cursor.actions.move(await cursor.getRandomPointOnViewport());
        await page.waitForTimeout(jitter(2000));

        this.logger.log(`[${clientName}] Submitting form...`);
        await page.waitForSelector('a#anchor-ui-0', { timeout: 10000 });
        await humanClick(page, 'a#anchor-ui-0');
        this.logger.log(
          `[${clientName}] Form submitted — waiting for IRS result...`,
        );

        // Wait for the actual result to render. networkidle alone is unreliable
        // because IRS beacons/analytics keep the network busy. Poll body text
        // (not <main> — the result page doesn't always have that element).
        const resultReady = await page
          .waitForFunction(
            () => {
              const text = document.body?.textContent ?? '';
              return /return received|refund approved|refund sent|we cannot provide|still being processed|take action|identity|verification|more information|unavailable|we are sorry/i.test(
                text,
              );
            },
            { timeout: 25000 },
          )
          .then(() => true)
          .catch(() => false);

        if (!resultReady) {
          this.logger.warn(
            `[${clientName}] Result content not detected after 25s — checking page state`,
          );
        }

        // Detect Akamai block — "We are sorry...currently unavailable...try
        // again later". If blocked and attempts remain, retry in same context.
        const pageText = await page
          .evaluate(() => document.body.innerText ?? '')
          .catch(() => '');
        akamaiBlocked =
          /we are sorry|currently unavailable|try again later/i.test(pageText);

        if (akamaiBlocked && attempt < 2) {
          this.logger.warn(
            `[${clientName}] Akamai block on attempt ${attempt}/2 — retrying in same session in ~12s`,
          );
          await page.waitForTimeout(10000 + Math.floor(Math.random() * 5000));
          // Small mouse jiggle so the retry doesn't look like an instant replay
          await page.mouse.move(
            300 + Math.random() * 700,
            200 + Math.random() * 400,
            { steps: 20 },
          );
          continue;
        }
        break;
      } // end inner retry loop
      logState.akamaiBlocked = akamaiBlocked;

      // Extra settle time so any animations/spinners finish before capture
      await page.waitForTimeout(jitter(1500));

      // ── Capture screenshot for vision analysis (buffer only) ────
      let screenshotPath: string | null = null;
      let screenshotBuffer: Buffer | null = null;
      try {
        const buffer = await page.screenshot({ type: 'png', fullPage: true });
        screenshotBuffer = Buffer.from(buffer);
        logState.screenshotBytes = screenshotBuffer.length;
      } catch (err) {
        this.logger.warn(
          `Screenshot capture failed (non-fatal): ${(err as Error).message}`,
        );
      }

      // ── Extract status via GPT-4o-mini vision (primary) ──────────
      let rawStatus = '';
      let details = '';
      let result: IrsScrapeResult['result'] = 'success';

      if (screenshotBuffer) {
        try {
          const visionResult = await this.extractWithVision(
            screenshotBuffer,
            clientName,
          );
          rawStatus = visionResult.rawStatus;
          details = visionResult.details;
          result = visionResult.result;
          this.logger.log(
            `[${clientName}] Vision extraction: "${rawStatus}" | "${details.slice(0, 100)}"`,
          );
        } catch (err) {
          this.logger.warn(
            `[${clientName}] Vision extraction failed, falling back to text: ${(err as Error).message}`,
          );
        }
      }

      // ── Fallback: text-based extraction if vision failed ─────────
      if (!rawStatus) {
        this.logger.log(
          `[${clientName}] Using text-based fallback extraction...`,
        );
        const fallback = await this.extractWithText(page);
        rawStatus = fallback.rawStatus;
        details = fallback.details;
        result = fallback.result;
      }

      this.logger.log(`[${clientName}] Final status: "${rawStatus}"`);
      this.logger.log(
        `[${clientName}] Final details: "${details.slice(0, 200)}"`,
      );

      // ── Upload screenshot only on successful extractions ─────────
      // Bot failures (not_found, error, timeout) don't produce useful
      // screenshots — skipping upload keeps storage clean and lets us
      // compute success rate as: checks with screenshotPath / total checks.
      if (result === 'success' && screenshotBuffer) {
        try {
          const date = new Date().toISOString().slice(0, 10);
          const time = new Date()
            .toISOString()
            .slice(11, 19)
            .replace(/:/g, '-');
          const clientSlug = clientName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
          const storagePath = `checks/${date}/${clientSlug}/${time}.png`;
          await this.supabase.uploadFile(
            this.SCREENSHOT_BUCKET,
            storagePath,
            screenshotBuffer,
            'image/png',
          );
          screenshotPath = storagePath;
          this.logger.log(`[${clientName}] Screenshot saved: ${storagePath}`);
        } catch (err) {
          this.logger.warn(
            `Screenshot upload failed (non-fatal): ${(err as Error).message}`,
          );
        }
      } else if (result !== 'success') {
        this.logger.warn(
          `[${clientName}] Bot failure (${result}: "${rawStatus}") — screenshot discarded, not stored`,
        );
      }

      this.logCheck({
        clientName,
        result,
        rawStatus: rawStatus.trim(),
        attempts: logState.attempts,
        akamaiBlocked: logState.akamaiBlocked,
        durationMs: Date.now() - logState.startTs,
        screenshotBytes: logState.screenshotBytes,
        source: 'patchright',
      });

      return {
        rawStatus: rawStatus.trim(),
        details: details.trim(),
        screenshotPath,
        result,
      };
    } catch (error) {
      const isTimeout =
        (error as Error).message?.includes('timeout') ||
        (error as Error).message?.includes('Timeout');

      this.logger.error(`Scraper error: ${(error as Error).message}`);

      this.logCheck({
        clientName,
        result: isTimeout ? 'timeout' : 'error',
        rawStatus: `Error: ${(error as Error).message}`.slice(0, 120),
        attempts: logState.attempts,
        akamaiBlocked: logState.akamaiBlocked,
        durationMs: Date.now() - logState.startTs,
        screenshotBytes: logState.screenshotBytes,
        source: 'patchright',
      });

      return {
        rawStatus: 'Error',
        details: '',
        screenshotPath: null,
        result: isTimeout ? 'timeout' : 'error',
        errorMessage: (error as Error).message,
      };
    } finally {
      if (context) await context.close().catch(() => {});
    }
  }

  // ── Vision-based extraction (GPT-4o-mini) ──────────────────────────────────

  private getOpenAI(): OpenAI {
    if (!this.openai) {
      const apiKey = this.config.get<string>('OPENAI_API_KEY');
      if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
      this.openai = new OpenAI({ apiKey });
    }
    return this.openai;
  }

  private async extractWithVision(
    screenshotBuffer: Buffer,
    clientName: string,
  ): Promise<{
    rawStatus: string;
    details: string;
    result: IrsScrapeResult['result'];
  }> {
    const base64 = screenshotBuffer.toString('base64');

    const response = await this.getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [
        {
          role: 'system',
          content: [
            'You extract refund status from screenshots of the IRS "Where\'s My Refund?" (WMR) tool.',
            "Report only what is visible on the screen — never infer or fabricate dates, amounts, or details that aren't shown.",
            '',
            'Respond with a single JSON object (no markdown fencing, no commentary) using these fields:',
            '',
            '{ "status": string, "details": string, "found": boolean }',
            '',
            'status — use exactly one of these values:',
            '  "Return Received"',
            '  "Refund Approved"',
            '  "Refund Sent"',
            '  "Action Required"',
            '  "Under Review"',
            '  "Cannot Provide Information"',
            '  "Error"',
            '  "Not Available"',
            '',
            'The IRS WMR page typically shows a 3-step progress bar (Return Received → Refund Approved → Refund Sent).',
            'Match the highlighted step. If the page instead shows a warning, notice, or request for action, use "Action Required" or "Under Review" as appropriate.',
            'If the page displays a CAPTCHA, maintenance notice, or unrelated content, use "Error".',
            '',
            'details — a 1–2 sentence summary of any supplementary info visible on the page: expected deposit dates, payment method, dollar amounts, taxpayer instructions, or specific IRS messages. Use "None" if there is nothing beyond the status itself.',
            '',
            "found — true when a refund status is successfully displayed for a taxpayer. false when the IRS could not find the return, the page shows an error or CAPTCHA, the service is unavailable, or the screenshot doesn't contain refund status information.",
            '',
            'Before responding, scan the full screenshot carefully. Look for the progress bar and which step is highlighted, any dates or amounts shown below it, and any alert banners or messages at the top of the page.',
          ].join('\n'),
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Extract the IRS refund status from this screenshot for client ${clientName}.`,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${base64}`,
                detail: 'low',
              },
            },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content ?? '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch)
      throw new Error(`Vision returned non-JSON: ${content.slice(0, 200)}`);

    const parsed = JSON.parse(jsonMatch[0]) as {
      status: string;
      details: string;
      found: boolean;
    };

    let result: IrsScrapeResult['result'] = 'success';
    const lower = parsed.status.toLowerCase();
    if (
      !parsed.found ||
      lower.includes('error') ||
      lower.includes('not available')
    ) {
      result =
        lower.includes('cannot') || lower.includes('not available')
          ? 'not_found'
          : 'error';
    }

    return {
      rawStatus: parsed.status,
      details: parsed.details,
      result,
    };
  }

  // ── Text-based fallback extraction ─────────────────────────────────────────

  private async extractWithText(page: import('playwright').Page): Promise<{
    rawStatus: string;
    details: string;
    result: IrsScrapeResult['result'];
  }> {
    const bodyText = await page.evaluate(() => document.body.textContent ?? '');
    const lower = bodyText.toLowerCase();

    let rawStatus = '';
    if (/still being processed|refund date will be provided/i.test(bodyText))
      rawStatus = 'Return Received';
    else if (/refund was sent to your bank|sent to your bank/i.test(bodyText))
      rawStatus = 'Refund Sent';
    else if (/check was mailed|mailed your refund/i.test(bodyText))
      rawStatus = 'Refund Sent';
    else if (/refund has been approved|approved your refund/i.test(bodyText))
      rawStatus = 'Refund Approved';
    else if (
      /we received your tax return|return has been received/i.test(bodyText)
    )
      rawStatus = 'Return Received';
    else if (/cannot provide any information/i.test(bodyText))
      rawStatus = 'Cannot Provide Information';
    else if (
      /take action|action required|we need more information/i.test(bodyText)
    )
      rawStatus = 'Action Required';
    else if (/identity|verification|under review/i.test(bodyText))
      rawStatus = 'Under Review';

    if (!rawStatus) {
      for (const sel of ['main h1', 'main h2', 'h1', 'h2']) {
        const text = await page.textContent(sel).catch(() => null);
        if (
          text &&
          text.trim().length > 3 &&
          !/refund status results/i.test(text)
        ) {
          rawStatus = text.trim();
          break;
        }
      }
    }

    if (!rawStatus) rawStatus = 'Could not extract status';

    let result: IrsScrapeResult['result'] = 'success';
    if (
      lower.includes('cannot provide any information') ||
      lower.includes('no information available')
    ) {
      result = 'not_found';
    }

    return { rawStatus, details: '', result };
  }

  // ── Per-check summary log ──────────────────────────────────────────────────
  // Appends one human-readable line per check to logs/irs-checks.log. The
  // NestJS logger has the step-by-step; this file is for at-a-glance review.

  private logCheck(entry: {
    clientName: string;
    result: 'success' | 'not_found' | 'error' | 'timeout';
    rawStatus: string;
    attempts: number;
    akamaiBlocked: boolean;
    durationMs: number;
    screenshotBytes: number | null;
    source?: 'browser-use' | 'patchright';
  }): void {
    try {
      const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
      const source = entry.source ?? 'patchright';
      const duration =
        source === 'browser-use'
          ? '?s   '
          : `${Math.round(entry.durationMs / 1000)}s`.padEnd(5);
      const screenshot =
        entry.screenshotBytes != null
          ? `${Math.round(entry.screenshotBytes / 1024)}KB`
          : 'none';
      const line = [
        ts,
        entry.clientName.padEnd(25).slice(0, 25),
        `source=${source.padEnd(11)}`,
        `duration=${duration}`,
        `attempts=${entry.attempts}`,
        `akamai=${entry.akamaiBlocked ? 'yes' : 'no '}`,
        `result=${entry.result.padEnd(9)}`,
        `status="${entry.rawStatus}"`,
        `screenshot=${screenshot}`,
      ].join(' | ');

      const logsDir = path.join(process.cwd(), 'logs');
      if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
      fs.appendFileSync(
        path.join(logsDir, 'irs-checks.log'),
        line + '\n',
        'utf8',
      );
    } catch (err) {
      this.logger.warn(`logCheck failed: ${(err as Error).message}`);
    }
  }
}
