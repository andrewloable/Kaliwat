/**
 * E2E: Compare two people → kinship term + relationship trace dialog.
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

async function addRelative(page: Page, of: string, kind: '+ Parent' | '+ Child', given: string) {
  await row(page, of).click();
  await page.getByRole('button', { name: kind }).click();
  await expect(page.getByRole('heading', { name: /^Add (parent|child) of / })).toBeVisible();
  await page.locator('input[name="given"]').fill(given);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); // back on the start person: close it
  await expect(row(page, given)).toBeVisible();
}

async function choose(page: Page, label: string, name: string) {
  await page.getByRole('searchbox', { name: label }).fill(name);
  await page.locator('.results button').filter({ hasText: name }).click();
}

test('compare shows the kinship term and a trace through the common ancestor', async ({ page }) => {
  await page.goto('/');
  await clearDb(page);
  await page.reload();
  // Me ← Dad ← Grandpa → Uncle → Cousin
  await page.getByRole('button', { name: 'Start with yourself' }).click();
  await page.locator('input[name="given"]').fill('Me');
  await page.getByRole('button', { name: 'Save' }).click();
  await addRelative(page, 'Me', '+ Parent', 'Dad');
  await addRelative(page, 'Dad', '+ Parent', 'Grandpa');
  await addRelative(page, 'Grandpa', '+ Child', 'Uncle');
  await addRelative(page, 'Uncle', '+ Child', 'Cousin');

  await page.getByRole('button', { name: 'Compare' }).click();
  await choose(page, 'First person', 'Me');
  await choose(page, 'Second person', 'Cousin');

  const dialog = page.getByRole('dialog', { name: 'How are they related?' });
  await expect(dialog.getByRole('status')).toHaveText(/Cousin is Me's 1st cousin\./);
  await expect(dialog.locator('.card')).toHaveCount(5);
  await expect(dialog.locator('.card').filter({ hasText: 'common ancestor' })).toHaveText(/Grandpa/);
});
