import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../config/supabase.service';

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

    // Lazy import so NestJS starts even if playwright isn't installed yet
    let playwright: typeof import('playwright');
    try {
      playwright = await import('playwright');
    } catch {
      return {
        rawStatus: 'Playwright not installed',
        details: '',
        screenshotPath: null,
        result: 'error',
        errorMessage: 'Run: npm install playwright && npx playwright install firefox',
      };
    }

    // Small random delay variance to make timing less mechanical
    const jitter = (base: number) => base + Math.floor(Math.random() * 350);

    // Human-like click: move mouse to element then click
    const humanClick = async (page: import('playwright').Page, selector: string) => {
      const el = await page.waitForSelector(selector, { timeout: 15000 });
      if (!el) throw new Error(`Element not found: ${selector}`);
      await el.scrollIntoViewIfNeeded();
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
      this.logger.log('Launching Firefox...');
      browser = await playwright.firefox.launch({ headless: this.isHeadless });

      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
        colorScheme: 'light',
        // Optional residential proxy — set PLAYWRIGHT_PROXY_URL env var if Railway IP gets flagged
        ...(this.proxyUrl ? { proxy: { server: this.proxyUrl } } : {}),
      });

      // Hide the webdriver flag — the #1 signal bot detectors check
      await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });

      const page = await context.newPage();

      // ── Step 1: Navigate ──────────────────────────────────────────────────
      this.logger.log(`[${clientName}] Step 1/5 — Navigating to IRS WMR...`);
      await page.goto('https://sa.www4.irs.gov/wmr/', { timeout: 30000 });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(jitter(2000));

      // ── Step 2: SSN ───────────────────────────────────────────────────────
      this.logger.log(`[${clientName}] Step 2/5 — Filling SSN...`);
      await page.waitForSelector('input[name="ssnInput"]', { timeout: 15000 });
      await humanClick(page, 'input[name="ssnInput"]');
      await page.keyboard.type(ssn, { delay: jitter(60) });
      await page.waitForTimeout(jitter(700));
      this.logger.log(`[${clientName}] Step 2/5 — SSN filled ✓`);

      // ── Step 3: Tax Year ──────────────────────────────────────────────────
      this.logger.log(`[${clientName}] Step 3/5 — Selecting tax year ${taxYear}...`);
      const yearLabel = `label[for="${taxYear}"]`;
      await page.waitForSelector(yearLabel, { timeout: 10000 });
      await humanClick(page, yearLabel);
      await page.waitForTimeout(jitter(700));
      // Verify the radio is actually checked
      const yearChecked = await page.$eval(
        `input[id="${taxYear}"]`,
        (el) => (el as HTMLInputElement).checked,
      ).catch(() => false);
      if (!yearChecked) throw new Error(`Tax year ${taxYear} radio not selected — label[for="${taxYear}"] may not match IRS page`);
      this.logger.log(`[${clientName}] Step 3/5 — Tax year ${taxYear} selected ✓`);

      // ── Step 4: Filing Status ─────────────────────────────────────────────
      this.logger.log(`[${clientName}] Step 4/5 — Selecting filing status: ${filingStatus}...`);
      const filingSelector = this.FILING_STATUS_SELECTOR[filingStatus] ?? 'label[for="Single"]';
      // The radio id is the value inside the for="" attribute
      const filingRadioId = filingSelector.match(/\[for="(.+?)"\]/)?.[1] ?? 'Single';
      await page.waitForSelector(filingSelector, { timeout: 10000 });
      await humanClick(page, filingSelector);
      await page.waitForTimeout(jitter(700));
      // Verify the radio is actually checked
      const filingChecked = await page.$eval(
        `input[id="${filingRadioId}"]`,
        (el) => (el as HTMLInputElement).checked,
      ).catch(() => false);
      if (!filingChecked) throw new Error(`Filing status radio "${filingRadioId}" not selected — IRS page selector may have changed`);
      this.logger.log(`[${clientName}] Step 4/5 — Filing status ${filingStatus} (${filingRadioId}) selected ✓`);

      // ── Step 5: Refund Amount ─────────────────────────────────────────────
      this.logger.log(`[${clientName}] Step 5/5 — Filling refund amount: $${refundAmount}...`);
      const refundLocator = page.getByLabel(/refund amount/i).first();
      await refundLocator.waitFor({ state: 'visible', timeout: 10000 });
      const refundBox = await refundLocator.boundingBox();
      if (refundBox) {
        const x = refundBox.x + refundBox.width * (0.3 + Math.random() * 0.4);
        const y = refundBox.y + refundBox.height * (0.3 + Math.random() * 0.4);
        await page.mouse.move(x, y, { steps: 8 });
        await page.waitForTimeout(jitter(120));
        await page.mouse.click(x, y);
      } else {
        await refundLocator.click();
      }
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await page.keyboard.type(String(refundAmount), { delay: jitter(70) });
      await page.waitForTimeout(jitter(700));
      // Verify the value was entered
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
      this.logger.log(`[${clientName}] Submitting form...`);
      await page.waitForSelector('a#anchor-ui-0', { timeout: 10000 });
      await humanClick(page, 'a#anchor-ui-0');
      this.logger.log(`[${clientName}] Form submitted — waiting for IRS result...`);

      // Wait for result: IRS WMR is a SPA — URL won't change, so wait for the
      // result heading to appear in the DOM (up to 15s) then read it
      let rawStatus = '';
      let details = '';
      try {
        await page.waitForFunction(
          () => {
            const el = document.querySelector('main h1, main h2, main h3');
            return el && (el.textContent ?? '').trim().length > 5;
          },
          { timeout: 15000 },
        );
        rawStatus = (await page.textContent('main h1, main h2, main h3')) ?? '';
        details = (await page.textContent('main')) ?? '';
      } catch {
        // Heading never appeared — fall back to network-idle then grab whatever is there
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        rawStatus = (await page.textContent('main h1, main h2, main h3').catch(() => '')) ?? '';
        details = (await page.textContent('main').catch(() => '')) ?? '';
        if (!rawStatus) rawStatus = 'Could not extract status from page';
      }

      const lowerDetails = details.toLowerCase();
      let result: IrsScrapeResult['result'] = 'success';
      if (
        !rawStatus ||
        lowerDetails.includes('cannot provide any information') ||
        lowerDetails.includes('no information available')
      ) {
        result = 'not_found';
      }

      // Capture screenshot of the result page and upload to Supabase Storage
      let screenshotPath: string | null = null;
      try {
        const buffer = await page.screenshot({ type: 'png', fullPage: false });
        const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const time = new Date().toISOString().slice(11, 19).replace(/:/g, '-'); // HH-MM-SS
        const clientSlug = clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        const storagePath = `checks/${date}/${clientSlug}/${time}.png`;
        await this.supabase.uploadFile(
          this.SCREENSHOT_BUCKET,
          storagePath,
          Buffer.from(buffer),
          'image/png',
        );
        screenshotPath = storagePath;
        this.logger.log(`Screenshot saved: ${storagePath}`);
      } catch (err) {
        this.logger.warn(`Screenshot upload failed (non-fatal): ${(err as Error).message}`);
      }

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
}
