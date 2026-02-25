/**
 * Dumps all inputs, labels, buttons, and radio elements from IRS WMR.
 * Run: npx ts-node scripts/inspect-irs-page.ts
 */
import { firefox } from 'playwright';

async function main() {
  const browser = await firefox.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  });
  const page = await context.newPage();

  console.log('Navigating...');
  await page.goto('https://sa.www4.irs.gov/wmr/', { timeout: 30000 });
  await page.waitForTimeout(4000);

  const result = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input')).map((el) => ({
      id: el.id,
      name: el.name,
      type: el.type,
      placeholder: el.placeholder,
      ariaLabel: el.getAttribute('aria-label'),
      className: el.className,
    }));

    const labels = Array.from(document.querySelectorAll('label')).map((el) => ({
      htmlFor: el.htmlFor,
      text: el.textContent?.trim().slice(0, 60),
    }));

    const buttons = Array.from(document.querySelectorAll('button, a[id]')).map((el) => ({
      tag: el.tagName,
      id: el.id,
      text: el.textContent?.trim().slice(0, 60),
      className: el.className,
    }));

    return { inputs, labels, buttons };
  });

  console.log('\n=== INPUTS ===');
  result.inputs.forEach((i) => console.log(JSON.stringify(i)));

  console.log('\n=== LABELS ===');
  result.labels.forEach((l) => console.log(JSON.stringify(l)));

  console.log('\n=== BUTTONS / ANCHORS WITH ID ===');
  result.buttons.forEach((b) => console.log(JSON.stringify(b)));

  await browser.close();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
