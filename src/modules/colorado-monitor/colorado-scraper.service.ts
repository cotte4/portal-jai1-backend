import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../config/supabase.service';
import OpenAI from 'openai';

export interface ColoradoScrapeResult {
  rawStatus: string;
  details: string;
  screenshotPath: string | null;
  result: 'success' | 'not_found' | 'error' | 'timeout';
  errorMessage?: string;
}

@Injectable()
export class ColoradoScraperService {
  private readonly logger = new Logger(ColoradoScraperService.name);
  private readonly isHeadless: boolean;

  private readonly SCREENSHOT_BUCKET = 'colorado-screenshots';
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

  async checkRefundStatus(params: {
    ssn: string;
    stateRefundAmount: number;
    taxCaseId: string;
    clientName: string;
  }): Promise<ColoradoScrapeResult> {
    const { ssn, stateRefundAmount, taxCaseId, clientName } = params;

    // Format SSN with dashes for Colorado portal: 123-45-6789
    const formattedSsn = ssn.replace(/(\d{3})(\d{2})(\d{4})/, '$1-$2-$3');

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

    const jitter = (base: number) => base + Math.floor(Math.random() * 350);

    const humanClick = async (page: import('playwright').Page, selector: string) => {
      const el = await page.waitForSelector(selector, { timeout: 15000 });
      if (!el) throw new Error(`Element not found: ${selector}`);
      await el.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const box = await el.boundingBox();
      if (box) {
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
        timezoneId: 'America/Denver',
        colorScheme: 'light',
        ...(this.proxyUrl ? { proxy: { server: this.proxyUrl } } : {}),
      });

      if (!usingStealth) {
        await context.addInitScript(() => {
          Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        });
      }

      const page = await context.newPage();

      // ── Step 1: Navigate to Colorado Revenue Online ─────────────────────
      this.logger.log(`[${clientName}] Step 1/4 — Navigating to Colorado Revenue Online...`);
      await page.goto('https://www.colorado.gov/revenueonline/_/', { timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(jitter(2000));

      // Light warm-up (state portal, less aggressive anti-bot than IRS)
      for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
        await page.mouse.move(
          200 + Math.random() * 900,
          150 + Math.random() * 400,
          { steps: 8 + Math.floor(Math.random() * 10) },
        );
        await page.waitForTimeout(300 + Math.floor(Math.random() * 400));
      }
      await page.mouse.wheel(0, 80 + Math.floor(Math.random() * 120));
      await page.waitForTimeout(jitter(1000));

      // ── Step 2: Click "Where's My Refund for Individuals" ───────────────
      this.logger.log(`[${clientName}] Step 2/4 — Clicking "Where's My Refund"...`);
      await humanClick(page, '#Dg-3-1_c');
      await page.waitForTimeout(jitter(1500));

      // Wait for the form to load
      await page.waitForSelector('#Dd-d', { timeout: 15000 });
      this.logger.log(`[${clientName}] Step 2/4 — Refund form loaded ✓`);

      // ── Step 3: Fill SSN ────────────────────────────────────────────────
      this.logger.log(`[${clientName}] Step 3/4 — Filling SSN...`);
      await humanClick(page, '#Dd-d');
      await page.keyboard.type(formattedSsn, { delay: jitter(60) });
      await page.waitForTimeout(jitter(700));
      this.logger.log(`[${clientName}] Step 3/4 — SSN filled ✓`);

      // ── Step 4: Fill state refund amount ────────────────────────────────
      this.logger.log(`[${clientName}] Step 4/4 — Filling state refund amount: $${stateRefundAmount}...`);
      await humanClick(page, '#Dd-e');
      await page.keyboard.type(String(stateRefundAmount), { delay: jitter(50) });
      await page.waitForTimeout(jitter(700));
      this.logger.log(`[${clientName}] Step 4/4 — Refund amount $${stateRefundAmount} filled ✓`);

      // ── Pre-submit gate — verify both fields ───────────────────────────
      this.logger.log(`[${clientName}] Pre-submit gate — verifying fields...`);

      const ssnValue = await page.$eval(
        '#Dd-d',
        (el) => (el as HTMLInputElement).value,
      ).catch(() => '');
      if (!ssnValue || ssnValue.length < 11) {
        throw new Error(`Pre-submit gate FAILED: SSN field is empty or too short (got "${ssnValue}")`);
      }

      const amountValue = await page.$eval(
        '#Dd-e',
        (el) => (el as HTMLInputElement).value,
      ).catch(() => '');
      if (amountValue !== String(stateRefundAmount)) {
        throw new Error(`Pre-submit gate FAILED: Refund amount is "${amountValue}", expected "${stateRefundAmount}"`);
      }

      this.logger.log(`[${clientName}] Pre-submit gate PASSED — SSN ✓ Amount $${stateRefundAmount} ✓`);

      // ── Submit ──────────────────────────────────────────────────────────
      await page.mouse.move(
        400 + Math.random() * 500,
        500 + Math.random() * 100,
        { steps: 10 },
      );
      await page.waitForTimeout(jitter(600));

      this.logger.log(`[${clientName}] Submitting form...`);
      await humanClick(page, '#Dd-i');
      this.logger.log(`[${clientName}] Form submitted — waiting for Colorado result...`);

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
      let result: ColoradoScrapeResult['result'] = 'success';

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
  ): Promise<{ rawStatus: string; details: string; result: ColoradoScrapeResult['result'] }> {
    const base64 = screenshotBuffer.toString('base64');

    const response = await this.getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 300,
      messages: [
        {
          role: 'system',
          content: `You read screenshots of the Colorado Department of Revenue "Where's My Refund" page and extract the refund status.
Return ONLY valid JSON with these fields:
- "status": the main status shown (e.g. "Return Not Received", "Return Received & Being Processed", "Refund Reviewed", "Refund Issued", "Direct Deposit Redeemed", "Paper Check Redeemed", "Request Unavailable", or "Error")
- "details": a short human-readable summary of any additional info shown on the page (dates, amounts, instructions). If the page shows an error or is unavailable, describe that briefly.
- "found": true if a refund status was found, false if the return was not found, the page errored, or the service was unavailable.`,
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Extract the Colorado refund status from this screenshot for client ${clientName}.` },
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

    let result: ColoradoScrapeResult['result'] = 'success';
    const lower = parsed.status.toLowerCase();
    if (!parsed.found || lower.includes('unavailable') || lower.includes('error')) {
      result = lower.includes('not received') || lower.includes('not found') ? 'not_found' : 'error';
    } else if (lower.includes('not received') || lower.includes('not yet processed')) {
      result = 'not_found';
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
  ): Promise<{ rawStatus: string; details: string; result: ColoradoScrapeResult['result'] }> {
    const bodyText = await page.evaluate(() => document.body.textContent ?? '');
    const lower = bodyText.toLowerCase();

    // Detect error pages
    if (/request unavailable|unable to process|try again later|service unavailable/i.test(bodyText)) {
      return { rawStatus: 'Request Unavailable', details: 'Portal no disponible.', result: 'error' };
    }

    // Determine status from page text
    let rawStatus = '';
    if (/refund (issued|approved and sent)/i.test(bodyText)) rawStatus = 'Refund Issued';
    else if (/refund reviewed/i.test(bodyText) && !/not yet processed/i.test(bodyText)) rawStatus = 'Refund Reviewed';
    else if (/return received|being processed/i.test(bodyText)) rawStatus = 'Return Received & Being Processed';
    else if (/return not received|not yet processed/i.test(bodyText)) rawStatus = 'Return Not Received';
    else if (/direct deposit.*redeemed|redeemed.*direct deposit/i.test(bodyText)) rawStatus = 'Direct Deposit Redeemed';
    else if (/paper check.*redeemed|redeemed.*paper check/i.test(bodyText)) rawStatus = 'Paper Check Redeemed';

    if (!rawStatus) {
      for (const sel of ['main h1', 'main h2', 'h1', 'h2']) {
        const text = await page.textContent(sel).catch(() => null);
        if (text && text.trim().length > 3 && !/where|refund status/i.test(text)) {
          rawStatus = text.trim();
          break;
        }
      }
    }

    if (!rawStatus) rawStatus = 'Could not extract status';

    let result: ColoradoScrapeResult['result'] = 'success';
    if (lower.includes('return not received') || lower.includes('not yet processed')) {
      result = 'not_found';
    }

    return { rawStatus, details: '', result };
  }
}
