/** E2E: quick-add form for + Parent / + Spouse / + Sibling / + Child (bundled sample tree). */
import { test, expect, Page } from '@playwright/test';

const panel = (page: Page) => page.getByRole('dialog');
const save = (page: Page) => page.getByRole('button', { name: 'Save', exact: true });
async function add(page: Page, kind: string) {
  await page.getByRole('button', { name: `+ ${kind}` }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`^Add ${kind.toLowerCase()} of `) })).toBeVisible();
}
async function expandAll(page: Page) {
  await expect(panel(page).locator('details').first()).toBeAttached();
  await panel(page).locator('details').evaluateAll((ds) => ds.forEach((d) => ((d as HTMLDetailsElement).open = true)));
}
const cancel = (page: Page) => page.getByRole('button', { name: 'Cancel', exact: true });

async function start(page: Page, name: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'try a sample tree' }).click();
  await expect(page.locator('.list-row').first()).toBeVisible({ timeout: 30_000 });
  await open(page, name);
}
const open = (page: Page, name: string) =>
  page.locator('.list-row .row-name').filter({ hasText: new RegExp(`^${name}$`) }).click();

async function pngBuffer(page: Page) {
  const base64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 600; c.height = 600;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#2980b9'; ctx.fillRect(0, 0, 600, 600);
    return c.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(base64, 'base64');
}

test('Cancel creates nobody', async ({ page }) => {
  await start(page, 'Jose Reyes');
  await add(page, 'Child');
  await cancel(page).click();
  await expect(page.locator('input[name="given"]')).toHaveValue('Jose');
  await cancel(page).click();
  await expect(page.locator('.list-row')).toHaveCount(4);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('child gets father surname, Facebook and photo in one form', async ({ page }) => {
    await start(page, 'Jose Reyes');
    await add(page, 'Child');
    await expect(page.getByRole('heading', { name: 'Add child of Jose Reyes' })).toBeVisible();
    await expect(page.locator('input[name="surname"]')).toHaveValue('Reyes');
    await expect(page.getByRole('radio', { name: 'Unknown' })).toBeChecked();
    for (const loc of [page.locator('input[name="given"]'), page.locator('input[name="facebook"]'),
      page.locator('.photo-pick'), save(page)]) {
      const b = (await loc.boundingBox())!;
      expect(b.y + b.height).toBeLessThanOrEqual(844);
    }

    await page.locator('input[name="given"]').fill('Pedro');
    await page.getByRole('radio', { name: 'Male', exact: true }).check();
    await page.locator('input[name="facebook"]').fill('facebook.com/pedro.reyes');
    await page.locator('.photo-pick input[type=file]').setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: await pngBuffer(page) });
    await page.getByRole('dialog', { name: 'Adjust photo' }).getByRole('button', { name: 'Use photo' }).click();
    await save(page).click();

    await expect(page.locator('input[name="given"]')).toHaveValue('Jose');
    expect(await page.locator('.edit-panel').evaluate((e) => e.scrollTop)).toBe(0);
    await cancel(page).click();
    await expect(panel(page)).toBeHidden();
    await open(page, 'Pedro Reyes');
    await expect(panel(page).locator('input[name="facebook"]')).toHaveValue('https://facebook.com/pedro.reyes');
    await expect(panel(page).locator('.photo-thumb')).toBeVisible();
    await expect(panel(page).getByRole('radio', { name: 'Male', exact: true })).toBeChecked();
  });
});

test('spouse sex is inferred', async ({ page }) => {
  await start(page, 'Ana Reyes');
  await add(page, 'Spouse');
  await expect(page.getByRole('radio', { name: 'Male', exact: true })).toBeChecked();
  await expect(page.locator('input[name="surname"]')).toHaveValue('');
});

test('parent sex is the missing one', async ({ page }) => {
  await start(page, 'Jose Reyes');
  await add(page, 'Parent');
  await expect(page.getByRole('radio', { name: 'Unknown' })).toBeChecked();
  await page.locator('input[name="given"]').fill('Dad');
  await page.getByRole('radio', { name: 'Male', exact: true }).check();
  await save(page).click();
  await add(page, 'Parent');
  await expect(page.getByRole('radio', { name: 'Female' })).toBeChecked();
});

test('Save & add another keeps the form open', async ({ page }) => {
  await start(page, 'Jose Reyes');
  await add(page, 'Child');
  await page.locator('input[name="given"]').fill('A1');
  await page.getByRole('button', { name: 'Save & add another' }).click();
  await expect(page.getByRole('status')).toHaveText('Added A1 Reyes.');
  await expect(page.getByRole('heading', { name: 'Add child of Jose Reyes' })).toBeVisible();
  await expect(page.locator('input[name="given"]')).toBeEmpty();
  await expect(page.locator('input[name="given"]')).toBeFocused();
  await page.locator('input[name="given"]').fill('A2');
  await save(page).click();
  await expect(page.locator('input[name="facebook"]')).toBeVisible();
  await expandAll(page);
  await expect(panel(page).getByText('A1 Reyes')).toBeVisible();
  await expect(panel(page).getByText('A2 Reyes')).toBeVisible();
});

test('the other parent is required with two spouses', async ({ page }) => {
  await start(page, 'Jose Reyes');
  await add(page, 'Spouse');
  await page.locator('input[name="given"]').fill('Second');
  await page.getByRole('radio', { name: 'Female' }).check();
  await save(page).click();
  await add(page, 'Child');
  await expect(page.getByLabel('Other parent')).toBeVisible();
  await page.locator('input[name="given"]').fill('Kid');
  await save(page).click();
  await expect(page.getByRole('alert')).toHaveText('Choose the other parent.');
  await page.getByLabel('Other parent').selectOption({ label: 'Second' });
  await save(page).click();
  await cancel(page).click();
  await expect(panel(page)).toBeHidden();
  await open(page, 'Kid Reyes');
  await expandAll(page);
  await expect(panel(page).getByText('Jose Reyes & Second')).toBeVisible();
});

test('an invalid Facebook link blocks Save and creates nobody', async ({ page }) => {
  await start(page, 'Jose Reyes');
  await add(page, 'Child');
  await page.locator('input[name="given"]').fill('X');
  await page.locator('input[name="facebook"]').fill('instagram.com/x');
  await save(page).click();
  await expect(page.getByRole('alert')).toContainText('Facebook link');
  await cancel(page).click();
  await cancel(page).click();
  await expect(page.locator('.list-row')).toHaveCount(4);
});

test('unsaved edits to the start person survive', async ({ page }) => {
  await start(page, 'Jose Reyes');
  await page.locator('input[name="given"]').fill('Joseph');
  await add(page, 'Child');
  await cancel(page).click();
  await expect(page.locator('input[name="given"]')).toHaveValue('Joseph');
});
