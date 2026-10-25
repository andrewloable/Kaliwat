/** E2E: person editor layout at phone width. */
import { test, expect, Page } from '@playwright/test';

async function openFirstPerson(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'try a sample tree' }).click();
  await expect(page.locator('.list-row').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.list-row').first().click();
  await expect(page.getByRole('dialog', { name: 'Edit person' })).toBeVisible();
}

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('editor fits a 390px phone without sideways scroll', async ({ page }) => {
    await openFirstPerson(page);
    const { sw, cw } = await page.locator('.edit-panel').evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth }));
    expect(sw).toBeLessThanOrEqual(cw);
    for (const sel of ['input[name="surname"]', 'input[name="birthPlace"]', '.fact-row .rel-btn']) {
      const b = (await page.locator(sel).first().boundingBox())!;
      expect(b.x + b.width).toBeLessThanOrEqual(390);
    }
  });
});

const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });
const bottom = async (loc: ReturnType<Page['locator']>) => { const b = (await loc.first().boundingBox())!; return b.y + b.height; };

for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  test(`essentials fit the first screen at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await openFirstPerson(page);
    for (const loc of [page.locator('input[name="given"]'), page.locator('input[name="surname"]'),
      page.locator('input[name="facebook"]'), page.locator('.photo-pick'),
      page.getByRole('button', { name: '+ Child' }), save(page)]) {
      expect(await bottom(loc)).toBeLessThanOrEqual(size.height);
    }
  });
}

test('Save stays visible while scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFirstPerson(page);
  await page.locator('details').evaluateAll((ds) => ds.forEach((d) => ((d as HTMLDetailsElement).open = true)));
  await page.locator('.edit-panel').evaluate((e) => { e.scrollTop = e.scrollHeight / 2; });
  expect(await bottom(save(page))).toBeLessThanOrEqual(844);
  expect((await save(page).boundingBox())!.y).toBeGreaterThanOrEqual(0);
});

test('Facebook field saves, replaces and clears', async ({ page }) => {
  await openFirstPerson(page);
  const fb = page.locator('input[name="facebook"]');
  const reopen = async () => { await page.locator('.list-row').first().click(); await expect(fb).toBeVisible(); };
  await fb.fill('facebook.com/ana.reyes');
  await save(page).click();
  await reopen();
  await expect(fb).toHaveValue('https://facebook.com/ana.reyes');
  await fb.fill('facebook.com/ana2');
  await save(page).click();
  await reopen();
  await expect(fb).toHaveValue('https://facebook.com/ana2');
  await page.locator('details', { hasText: 'Contacts & facts' }).locator('summary').click();
  await expect(page.locator('.detail-label', { hasText: 'Facebook' })).toHaveCount(0); // only one Facebook fact exists
  await fb.fill('');
  await save(page).click();
  await reopen();
  await expect(fb).toHaveValue('');
});

test('an invalid Facebook link blocks Save, with the error in view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFirstPerson(page);
  await page.locator('input[name="facebook"]').fill('instagram.com/x');
  await save(page).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Facebook link');
  expect(await bottom(alert)).toBeLessThanOrEqual(844);
  await expect(page.getByRole('dialog', { name: 'Edit person' })).toBeVisible();
});

test('a photo error is visible without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFirstPerson(page);
  await page.locator('.photo-pick input[type=file]').setInputFiles({ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  const alert = page.getByRole('alert');
  await expect(alert).toHaveText('Please choose an image file.');
  expect(await bottom(alert)).toBeLessThanOrEqual(844);
});

test('collapsed summaries show the data', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'try a sample tree' }).click();
  await expect(page.locator('.list-row').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.list-row .row-name').filter({ hasText: /^Maria Santos$/ }).click();
  const summary = page.locator('summary', { hasText: 'Birth & death' });
  await expect(summary).toContainText('12 JUN 1945');
  await expect(summary).toContainText('3 MAR 2018');
});
