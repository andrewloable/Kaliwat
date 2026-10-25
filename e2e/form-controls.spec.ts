/**
 * E2E: form controls use the design system's UI font and are at least 16px (smaller text fields make
 * iOS Safari zoom the page on focus); radios and checkboxes use the accent colour.
 */
import { test, expect, Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

async function openEditor(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'try a sample tree' }).click();
  await page.locator('.list-row').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('[role=dialog] details').evaluateAll((ds) => ds.forEach((d) => ((d as HTMLDetailsElement).open = true)));
}

const textControls = (page: Page, scope: string) =>
  page.evaluate((scope) => [...document.querySelectorAll(`${scope} input, ${scope} select, ${scope} textarea`)]
    .filter((e) => !['radio', 'checkbox', 'file', 'hidden'].includes((e as HTMLInputElement).type) && e.getBoundingClientRect().width > 0)
    .map((e) => ({ name: (e as HTMLInputElement).name || e.getAttribute('aria-label') || e.tagName, size: parseFloat(getComputedStyle(e).fontSize), font: getComputedStyle(e).fontFamily })), scope);

test('editor text fields are at least 16px and use the UI font', async ({ page }) => {
  await openEditor(page);
  const fields = await textControls(page, '[role=dialog]');
  expect(fields.length).toBeGreaterThan(5);
  for (const f of fields) {
    expect(f.size, f.name).toBeGreaterThanOrEqual(16);
    expect(f.font, f.name).toContain('Avenir Next');
  }
});

test('the top-bar search and the Compare search are at least 16px', async ({ page }) => {
  await openEditor(page);
  await page.keyboard.press('Escape');
  await page.locator('.search-toggle').click(); // phones open the search field over the bar first
  await expect(page.getByRole('searchbox', { name: 'Search people' })).toBeVisible();
  const search = await textControls(page, 'header');
  expect(search.length).toBeGreaterThan(0);
  for (const f of search) expect(f.size, f.name).toBeGreaterThanOrEqual(16);
  await page.keyboard.press('Escape'); // close the phone search so the bar's buttons are reachable
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  for (const f of await textControls(page, '[role=dialog]')) expect(f.size, f.name).toBeGreaterThanOrEqual(16);
});

test('buttons use the UI font', async ({ page }) => {
  await openEditor(page);
  const font = await page.getByRole('button', { name: '+ Parent' }).evaluate((b) => getComputedStyle(b).fontFamily);
  expect(font).toContain('Avenir Next');
});

test('radios and checkboxes use the accent colour', async ({ page }) => {
  await page.goto('/');
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).accentColor);
  expect(accent).not.toBe('auto');
});

test('editor sections show a chevron that turns when the section opens', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'try a sample tree' }).click();
  await page.locator('.list-row').first().click();
  const summary = page.locator('[role=dialog] details.section > summary').filter({ hasText: /^Birth & death/ });
  const chevron = () => summary.evaluate((s) => { const c = getComputedStyle(s, '::after'); return { content: c.content, border: c.borderRightStyle, transform: c.transform }; });
  const closed = await chevron();
  expect(closed.content).not.toBe('none');
  expect(closed.border).toBe('solid');
  await summary.click();
  await expect.poll(async () => (await chevron()).transform).not.toBe(closed.transform);
});
