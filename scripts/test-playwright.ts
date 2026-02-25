/**
 * Smoke test: verify Firefox launches and IRS WMR form fields are reachable.
 * Does NOT submit any SSN — just checks selectors exist.
 * Run: npx ts-node scripts/test-playwright.ts
 */
import { firefox } from 'playwright';

async function main() {
  console.log('Launching Firefox...');
  const browser = await firefox.launch({
    headless: process.env.PLAYWRIGHT_HEADLESS === 'true',
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  });
  const page = await context.newPage();

  try {
    console.log('Navigating to IRS WMR...');
    await page.goto('https://sa.www4.irs.gov/wmr/', { timeout: 30000 });
    await page.waitForTimeout(3000);

    // SSN field
    const ssnInput = await page.$('input[name="ssnInput"]');
    console.log(`SSN input found: ${!!ssnInput}`);

    // Tax year labels
    const yearLabel = await page.$('label[for="2024"]');
    console.log(`Tax year 2024 label found: ${!!yearLabel}`);

    // Filing status
    const singleLabel = await page.$('label[for="Single"]');
    console.log(`Filing status Single label found: ${!!singleLabel}`);

    // Refund amount — try all known selectors
    const refundSelectors = [
      'input[aria-label="Refund Amount, Required"]',
      'input[name="refundAmountInput"]',
      'input#undefinedplaceholder',
    ];
    let refundFound = false;
    for (const sel of refundSelectors) {
      if (await page.$(sel)) {
        console.log(`Refund input found: ${sel}`);
        refundFound = true;
        break;
      }
    }
    if (!refundFound) console.log('⚠️  Refund input NOT found with any known selector');

    // Submit button
    const submitBtn = await page.$('a#anchor-ui-0');
    console.log(`Submit button found: ${!!submitBtn}`);

    const allGood = !!ssnInput && !!yearLabel && !!singleLabel && !!submitBtn;
    console.log(allGood ? '\n✅ All selectors OK — scraper should work' : '\n⚠️  Some selectors missing — check IRS WMR HTML');
    process.exit(allGood ? 0 : 1);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Smoke test failed:', err.message);
  process.exit(1);
});
