import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../config/supabase.service';
import OpenAI from 'openai';

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
  private stealthApplied = false;
  private openai: OpenAI | null = null;

  constructor(
    private config: ConfigService,
    private supabase: SupabaseService,
  ) {
    this.isHeadless = this.config.get<string>('PLAYWRIGHT_HEADLESS', 'false') === 'true';
    this.proxyUrl = this.config.get<string>('PLAYWRIGHT_PROXY_URL') || undefined;
    if (this.proxyUrl) this.logger.log(`Proxy configured: ${this.proxyUrl.replace(/:\/\/.*@/, '://***@')}`);
  }

  // Maps JAI1 FilingStatus enum values to IRS WMR label[for] selectors
  private readonly FILING_STATUS_SELECTOR: Record<string, string> = {
    single:            'label[for="Single"]',
    married_joint:     'label[for="MFJ"]',
    married_separate:  'label[for="MFS"]',
    head_of_household: 'label[for="HOH"]',
  };

  async checkRefundStatus(params: {
    ssn: string;
    refundAmount: number;
    taxYear: number;
    taxCaseId: string;
    filingStatus: string;
    clientName: string;
  }): Promise<IrsScrapeResult> {
    const { ssn, refundAmount, taxYear, taxCaseId, filingStatus, clientName } = params;

    // Use require() instead of import() — NestJS runs CommonJS and dynamic
    // import() can silently fail for these packages, falling back to Firefox
    let usingStealth = false;
    let browserLauncher: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { chromium } = require('playwright-extra');
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const StealthPlugin = require('puppeteer-extra-plugin-stealth');
      if (!this.stealthApplied) {
        chromium.use(StealthPlugin());
        this.stealthApplied = true;
        this.logger.log('Stealth plugin applied to Chromium');
      }
      browserLauncher = chromium;
      usingStealth = true;
    } catch (err) {
      this.logger.warn(`Stealth not available: ${(err as Error).message} — falling back to Firefox`);
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pw = require('playwright');
        browserLauncher = pw.firefox;
      } catch {
        return {
          rawStatus: 'Browser not available',
          details: '',
          screenshotPath: null,
          result: 'error',
          errorMessage:
            'Run: npm install playwright playwright-extra puppeteer-extra-plugin-stealth && npx playwright install chromium',
        };
      }
    }

    // Small random delay variance to make timing less mechanical
    const jitter = (base: number) => base + Math.floor(Math.random() * 350);

    // Human-like click: move mouse to element then click
    const humanClick = async (page: import('playwright').Page, selector: string) => {
      const el = await page.waitForSelector(selector, { timeout: 15000 });
      if (!el) throw new Error(`Element not found: ${selector}`);
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300); // let scroll animation settle before reading coordinates
      const box = await el.boundingBox();
      if (box) {
        // Move to a random point inside the element, not the exact center
        const x = box.x + box.width * (0.3 + Math.random() * 0.4);
        const y = box.y + box.height * (0.3 + Math.random() * 0.4);
        await page.mouse.move(x, y, { steps: 8 });
        await page.waitForTimeout(jitter(120));
        await page.mouse.click(x, y);
      } else {
        await el.click();
      }
    };

    let browser: import('playwright').Browser | null = null;

    try {
      this.logger.log(`Launching ${usingStealth ? 'Chromium + stealth' : 'Firefox'}...`);
      browser = await browserLauncher.launch({ headless: this.isHeadless });

      const context = await browser!.newContext({
        userAgent: usingStealth
          ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
          : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
        colorScheme: 'light',
        ...(this.proxyUrl ? { proxy: { server: this.proxyUrl } } : {}),
      });

      // Stealth plugin handles webdriver + dozens of other signals;
      // only apply manual override for plain Firefox fallback
      if (!usingStealth) {
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
      }

      const page = await context.newPage();

      // ── Step 1: Navigate ──────────────────────────────────────────────────
      this.logger.log(`[${clientName}] Step 1/5 — Navigating to IRS WMR...`);
      await page.goto('https://sa.www4.irs.gov/wmr/', { timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(jitter(2000));

      // Warm-up: random mouse movements and scroll so Akamai's behavioral
      // sensor collects enough data to consider this a real user session
      for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
        await page.mouse.move(
          200 + Math.random() * 900,
          150 + Math.random() * 400,
          { steps: 10 + Math.floor(Math.random() * 15) },
        );
        await page.waitForTimeout(300 + Math.floor(Math.random() * 500));
      }
      await page.mouse.wheel(0, 80 + Math.floor(Math.random() * 120));
      await page.waitForTimeout(jitter(1500));
      await page.mouse.wheel(0, -(60 + Math.floor(Math.random() * 80)));
      await page.waitForTimeout(jitter(1000));

      // ── Step 2: SSN ───────────────────────────────────────────────────────
      this.logger.log(`[${clientName}] Step 2/5 — Filling SSN...`);
      await page.waitForSelector('input[name="ssnInput"]', { timeout: 15000 });
      await humanClick(page, 'input[name="ssnInput"]');
      await page.keyboard.type(ssn, { delay: jitter(60) });
      await page.waitForTimeout(jitter(700));
      this.logger.log(`[${clientName}] Step 2/5 — SSN filled ✓`);

      // ── Step 3: Tax Year ──────────────────────────────────────────────────
      // Use humanClick on the label — locator.check() uses Playwright internals
      // that skip real DOM events, which Akamai's sensor can detect
      this.logger.log(`[${clientName}] Step 3/5 — Selecting tax year ${taxYear}...`);
      await page.waitForSelector(`label[for="${taxYear}"]`, { timeout: 10000 });
      await humanClick(page, `label[for="${taxYear}"]`);
      await page.waitForTimeout(jitter(500));
      const yearChecked = await page.$eval(
        `input[id="${taxYear}"]`,
        (el) => (el as HTMLInputElement).checked,
      ).catch(() => false);
      if (!yearChecked) throw new Error(`Tax year ${taxYear} radio not selected`);
      this.logger.log(`[${clientName}] Step 3/5 — Tax year ${taxYear} selected ✓`);

      // ── Step 4: Filing Status ─────────────────────────────────────────────
      this.logger.log(`[${clientName}] Step 4/5 — Selecting filing status: ${filingStatus}...`);
      const filingSelector = this.FILING_STATUS_SELECTOR[filingStatus] ?? 'label[for="Single"]';
      const filingRadioId = filingSelector.match(/\[for="(.+?)"\]/)?.[1] ?? 'Single';
      await page.waitForSelector(filingSelector, { timeout: 10000 });
      await humanClick(page, filingSelector);
      await page.waitForTimeout(jitter(500));
      const filingChecked = await page.$eval(
        `input[id="${filingRadioId}"]`,
        (el) => (el as HTMLInputElement).checked,
      ).catch(() => false);
      if (!filingChecked) throw new Error(`Filing status radio "${filingRadioId}" not selected`);
      this.logger.log(`[${clientName}] Step 4/5 — Filing status ${filingStatus} (${filingRadioId}) selected ✓`);

      // ── Step 5: Refund Amount ─────────────────────────────────────────────
      this.logger.log(`[${clientName}] Step 5/5 — Filling refund amount: $${refundAmount}...`);

      // Locate the refund input — try direct CSS selectors first since
      // getByLabel can resolve to a label/container rather than the <input>
      const directRefundInput = page.locator(
        'input[name*="refund" i], input[id*="refund" i], ' +
        'input[aria-label*="refund" i], input[placeholder*="refund" i]',
      ).first();
      const isDirectVisible = await directRefundInput.isVisible().catch(() => false);
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
        throw new Error(`Refund amount mismatch — expected "${refundAmount}", field contains "${filledAmount}"`);
      }
      this.logger.log(`[${clientName}] Step 5/5 — Refund amount $${refundAmount} filled ✓`);

      // ── Pre-submit gate — re-read all 4 fields from DOM ──────────────────
      // Never submit if any field is missing or wrong. Each check throws with
      // a specific message so Railway logs show exactly what failed.
      this.logger.log(`[${clientName}] Pre-submit gate — verifying all fields...`);

      const ssnValue = await page.$eval(
        'input[name="ssnInput"]',
        (el) => (el as HTMLInputElement).value,
      ).catch(() => '');
      if (!ssnValue || ssnValue.length < 9) {
        throw new Error(`Pre-submit gate FAILED: SSN field is empty or too short (got "${ssnValue}")`);
      }

      const yearOk = await page.$eval(
        `input[id="${taxYear}"]`,
        (el) => (el as HTMLInputElement).checked,
      ).catch(() => false);
      if (!yearOk) {
        throw new Error(`Pre-submit gate FAILED: Tax year ${taxYear} is not selected`);
      }

      const filingOk = await page.$eval(
        `input[id="${filingRadioId}"]`,
        (el) => (el as HTMLInputElement).checked,
      ).catch(() => false);
      if (!filingOk) {
        throw new Error(`Pre-submit gate FAILED: Filing status "${filingRadioId}" is not selected`);
      }

      const amountValue = await refundLocator.inputValue().catch(() => '');
      if (amountValue !== String(refundAmount)) {
        throw new Error(`Pre-submit gate FAILED: Refund amount is "${amountValue}", expected "${refundAmount}"`);
      }

      this.logger.log(`[${clientName}] Pre-submit gate PASSED — SSN ✓ Year ${taxYear} ✓ Filing ${filingRadioId} ✓ Amount $${refundAmount} ✓`);

      // ── Submit ────────────────────────────────────────────────────────────
      // Brief pause with mouse movement before submit — gives Akamai's sensor
      // time to finalize behavioral data from the form-filling session
      await page.mouse.move(
        400 + Math.random() * 500,
        500 + Math.random() * 100,
        { steps: 12 },
      );
      await page.waitForTimeout(jitter(800));

      this.logger.log(`[${clientName}] Submitting form...`);
      await page.waitForSelector('a#anchor-ui-0', { timeout: 10000 });
      await humanClick(page, 'a#anchor-ui-0');
      this.logger.log(`[${clientName}] Form submitted — waiting for IRS result...`);

      // Wait for page to settle after submit
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(jitter(2000));

      // ── Capture screenshot FIRST ─────────────────────────────────
      let screenshotPath: string | null = null;
      let screenshotBuffer: Buffer | null = null;
      try {
        const buffer = await page.screenshot({ type: 'png', fullPage: false });
        screenshotBuffer = Buffer.from(buffer);
        const date = new Date().toISOString().slice(0, 10);
        const time = new Date().toISOString().slice(11, 19).replace(/:/g, '-');
        const clientSlug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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
        this.logger.warn(`Screenshot upload failed (non-fatal): ${(err as Error).message}`);
      }

      // ── Extract status via GPT-4o-mini vision (primary) ──────────
      let rawStatus = '';
      let details = '';
      let result: IrsScrapeResult['result'] = 'success';

      if (screenshotBuffer) {
        try {
          const visionResult = await this.extractWithVision(screenshotBuffer, clientName);
          rawStatus = visionResult.rawStatus;
          details = visionResult.details;
          result = visionResult.result;
          this.logger.log(`[${clientName}] Vision extraction: "${rawStatus}" | "${details.slice(0, 100)}"`);
        } catch (err) {
          this.logger.warn(`[${clientName}] Vision extraction failed, falling back to text: ${(err as Error).message}`);
        }
      }

      // ── Fallback: text-based extraction if vision failed ─────────
      if (!rawStatus) {
        this.logger.log(`[${clientName}] Using text-based fallback extraction...`);
        const fallback = await this.extractWithText(page);
        rawStatus = fallback.rawStatus;
        details = fallback.details;
        result = fallback.result;
      }

      this.logger.log(`[${clientName}] Final status: "${rawStatus}"`);
      this.logger.log(`[${clientName}] Final details: "${details.slice(0, 200)}"`);

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
      return {
        rawStatus: 'Error',
        details: '',
        screenshotPath: null,
        result: isTimeout ? 'timeout' : 'error',
        errorMessage: (error as Error).message,
      };
    } finally {
      if (browser) await browser.close().catch(() => {});
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
  ): Promise<{ rawStatus: string; details: string; result: IrsScrapeResult['result'] }> {
    const base64 = screenshotBuffer.toString('base64');

    const response = await this.getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [
        {
          role: 'system',
          content: `You read screenshots of the IRS "Where's My Refund?" (WMR) tool and extract the refund status.
Return ONLY valid JSON with these fields:
- "status": the main status shown. Must be one of: "Return Received", "Refund Approved", "Refund Sent", "Action Required", "Under Review", "Cannot Provide Information", "Error", or "Not Available".
- "details": a short human-readable summary of any additional info (dates, expected deposit info, instructions to the taxpayer, any specific messages shown). Keep it under 2 sentences.
- "found": true if a refund status was successfully displayed, false if the IRS could not find the return, the page errored, showed a CAPTCHA, or the service was unavailable.`,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Extract the IRS refund status from this screenshot for client ${clientName}.` },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${base64}`, detail: 'low' } },
          ],
        },
      ],
    });

    const content = response.choices[0]?.message?.content ?? '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Vision returned non-JSON: ${content.slice(0, 200)}`);

    const parsed = JSON.parse(jsonMatch[0]) as {
      status: string;
      details: string;
      found: boolean;
    };

    let result: IrsScrapeResult['result'] = 'success';
    const lower = parsed.status.toLowerCase();
    if (!parsed.found || lower.includes('error') || lower.includes('not available')) {
      result = lower.includes('cannot') || lower.includes('not available') ? 'not_found' : 'error';
    }

    return {
      rawStatus: parsed.status,
      details: parsed.details,
      result,
    };
  }

  // ── Text-based fallback extraction ─────────────────────────────────────────

  private async extractWithText(
    page: import('playwright').Page,
  ): Promise<{ rawStatus: string; details: string; result: IrsScrapeResult['result'] }> {
    const bodyText = await page.evaluate(() => document.body.textContent ?? '');
    const lower = bodyText.toLowerCase();

    let rawStatus = '';
    if (/still being processed|refund date will be provided/i.test(bodyText)) rawStatus = 'Return Received';
    else if (/refund was sent to your bank|sent to your bank/i.test(bodyText)) rawStatus = 'Refund Sent';
    else if (/check was mailed|mailed your refund/i.test(bodyText)) rawStatus = 'Refund Sent';
    else if (/refund has been approved|approved your refund/i.test(bodyText)) rawStatus = 'Refund Approved';
    else if (/we received your tax return|return has been received/i.test(bodyText)) rawStatus = 'Return Received';
    else if (/cannot provide any information/i.test(bodyText)) rawStatus = 'Cannot Provide Information';
    else if (/take action|action required|we need more information/i.test(bodyText)) rawStatus = 'Action Required';
    else if (/identity|verification|under review/i.test(bodyText)) rawStatus = 'Under Review';

    if (!rawStatus) {
      for (const sel of ['main h1', 'main h2', 'h1', 'h2']) {
        const text = await page.textContent(sel).catch(() => null);
        if (text && text.trim().length > 3 && !/refund status results/i.test(text)) {
          rawStatus = text.trim();
          break;
        }
      }
    }

    if (!rawStatus) rawStatus = 'Could not extract status';

    let result: IrsScrapeResult['result'] = 'success';
    if (lower.includes('cannot provide any information') || lower.includes('no information available')) {
      result = 'not_found';
    }

    return { rawStatus, details: '', result };
  }
}
