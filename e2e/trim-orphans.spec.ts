/**
 * E2E: trim a branch from the person editor, and delete only the orphan groups
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

async function nameAndSave(page: Page, given: string) {
  await page.locator('input[name="given"]').fill(given);
  await page.getByRole('button', { name: 'Save' }).click();
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
    await nameAndSave(page, 'Dad');
    await row(page, 'Dad').click();
    await page.getByRole('button', { name: '+ Parent' }).click();
    await nameAndSave(page, 'Grandpa');
  });

  test('trimming the parents side deletes everything beyond the cut', async ({ page }) => {
    await row(page, 'Dad').click();
    await page.getByRole('button', { name: /Parents' side \(Grandpa\)/ }).click();
    await expect(page.getByText(/delete 1 person permanently/)).toBeVisible();
    await page.getByRole('button', { name: 'Trim', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(row(page, 'Grandpa')).toHaveCount(0);
    await expect(row(page, 'Dad')).toBeVisible();
    await expect(row(page, 'Me')).toBeVisible();
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
});
