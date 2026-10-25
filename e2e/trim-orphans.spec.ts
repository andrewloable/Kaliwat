/**
 * E2E: trim a person's ancestors or descendants from the person editor, and delete only the orphan groups
 * the user ticks in the "not connected to the main tree" review.
 */
import { test, expect, Page } from '@playwright/test';

async function clearDb(page: Page) {
  await page.evaluate(async () => {
    const openReq = indexedDB.open('kaliwat');
    const db = await new Promise<IDBDatabase | null>((resolve) => {
      openReq.onsuccess = () => resolve(openReq.result);
      openReq.onerror = () => resolve(null);
    });
    if (!db) return;
    const stores = ['individuals', 'unions', 'mediaMeta', 'mediaBlobs', 'rawAst', 'trees'];
    const tx = db.transaction(stores.filter(s => [...db.objectStoreNames].includes(s)), 'readwrite');
    await Promise.all(
      [...tx.objectStoreNames].map(s => new Promise<void>(res => { tx.objectStore(s).clear().onsuccess = () => res(); }))
    );
    db.close();
  });
}

const row = (page: Page, name: string) => page.locator('.list-row .row-name').filter({ hasText: new RegExp(`^${name}$`) });

async function nameAndSave(page: Page, given: string, quickAdd = false) {
  await page.locator('input[name="given"]').fill(given);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  if (quickAdd) await page.getByRole('button', { name: 'Cancel', exact: true }).click(); // back on the start person: close it
  await expect(row(page, given)).toBeVisible();
}

async function addLoner(page: Page, given: string) {
  await page.getByRole('button', { name: 'Add person' }).click();
  await nameAndSave(page, given);
}

test.describe('Trim branch + orphan cleanup', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await clearDb(page);
    await page.reload();
    // Me ← Dad ← Grandpa
    await page.getByRole('button', { name: 'Start with yourself' }).click();
    await nameAndSave(page, 'Me');
    await row(page, 'Me').click();
    await page.getByRole('button', { name: '+ Parent' }).click();
    await expect(page.getByRole('heading', { name: /^Add parent of / })).toBeVisible();
    await nameAndSave(page, 'Dad', true);
    await row(page, 'Dad').click();
    await page.getByRole('button', { name: '+ Parent' }).click();
    await expect(page.getByRole('heading', { name: /^Add parent of / })).toBeVisible();
    await nameAndSave(page, 'Grandpa', true);
  });

  async function trimFromDad(page: Page, side: 'ancestors' | 'descendants') {
    await row(page, 'Dad').click();
    await expect(page.getByRole('dialog')).toBeVisible(); // open the sections only once the editor is drawn
    await page.locator('details').evaluateAll((ds) => ds.forEach((d) => ((d as HTMLDetailsElement).open = true)));
    await page.getByRole('button', { name: new RegExp(`^Trim ${side}`) }).click();
    await expect(page.getByText(`Trim ${side}: delete 1 person permanently?`)).toBeVisible();
    await page.getByRole('button', { name: 'Trim', exact: true }).click();
    await expect(page.getByText(`Trim ${side}: delete`)).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel' }).click();
  }

  test('trimming ancestors deletes the parents side only', async ({ page }) => {
    await trimFromDad(page, 'ancestors');
    await expect(row(page, 'Grandpa')).toHaveCount(0);
    await expect(row(page, 'Dad')).toBeVisible();
    await expect(row(page, 'Me')).toBeVisible();
  });

  test('trimming descendants deletes the children side only', async ({ page }) => {
    await trimFromDad(page, 'descendants');
    await expect(row(page, 'Me')).toHaveCount(0);
    await expect(row(page, 'Dad')).toBeVisible();
    await expect(row(page, 'Grandpa')).toBeVisible();
  });

  test('both trim buttons always show; a side with nobody on it is disabled', async ({ page }) => {
    await row(page, 'Me').click(); // Me has parents (Dad) but no children
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.locator('details').evaluateAll((ds) => ds.forEach((d) => ((d as HTMLDetailsElement).open = true)));
    await expect(page.getByRole('button', { name: /^Trim ancestors/ })).toBeEnabled();
    const desc = page.getByRole('button', { name: /^Trim descendants/ });
    await expect(desc).toBeVisible();
    await expect(desc).toBeDisabled();
    await expect(desc).toContainText('no children recorded');
  });

  test('orphan review deletes only the ticked groups', async ({ page }) => {
    await addLoner(page, 'Stray1');
    await addLoner(page, 'Stray2');
    await expect(page.getByText('2 people are not connected to the main tree.')).toBeVisible();

    await page.getByRole('button', { name: 'Review' }).click();
    await page.getByRole('checkbox', { name: /Stray1/ }).check();
    await page.getByRole('button', { name: 'Delete 1 person' }).click();

    await expect(row(page, 'Stray1')).toHaveCount(0);
    await expect(row(page, 'Stray2')).toBeVisible();
    await expect(page.getByText('1 person is not connected to the main tree.')).toBeVisible();
    await expect(row(page, 'Grandpa')).toBeVisible();
  });

  test('the footer shows unconnected people on every view and opens the review', async ({ page }) => {
    await addLoner(page, 'Stray1');
    const footerLink = page.locator('footer').getByRole('button', { name: '1 not connected' });
    await expect(footerLink).toBeVisible();
    await page.getByRole('tab', { name: 'Tree' }).click();
    await expect(footerLink).toBeVisible();
    await footerLink.click();
    await expect(page.getByRole('dialog', { name: 'Not connected to the main tree' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Dismiss hides the banner until the number of unconnected people changes', async ({ page }) => {
    await addLoner(page, 'Stray1');
    await expect(page.getByText('1 person is not connected to the main tree.')).toBeVisible();
    await page.locator('.orphan-banner').getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('.orphan-banner')).toHaveCount(0);
    await addLoner(page, 'Stray2');
    await expect(page.getByText('2 people are not connected to the main tree.')).toBeVisible();
  });

  test('after a trim the footer still offers the check, and the review says everyone is connected', async ({ page }) => {
    await trimFromDad(page, 'ancestors');
    const check = page.locator('footer').getByRole('button', { name: 'All connected' });
    await expect(check).toBeVisible();
    await check.click();
    const review = page.getByRole('dialog', { name: 'Everyone is connected' });
    await expect(review).toContainText('Every person is linked to the main tree.');
    await review.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
