/**
 * E2E: Editing + build-first onboarding (start-with-yourself).
 * Tests: create person via onboarding, edit existing person, persist across reload.
 */
import { test, expect } from '@playwright/test';

async function clearDb(page: Parameters<typeof test>[1]) {
  // Clear object store contents rather than deleting the DB to avoid
  // blocking on Dexie's open connection.
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

test.describe('Editing + onboarding', () => {
  test.setTimeout(60_000);

  test('start-with-yourself creates first person visible in list', async ({ page }) => {
    await page.goto('/');
    await clearDb(page);
    await page.reload();

    // Empty state must show the "Start with yourself" button
    await expect(page.getByRole('button', { name: 'Start with yourself' })).toBeVisible();

    await page.getByRole('button', { name: 'Start with yourself' }).click();

    // Edit panel opens
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Add person')).toBeVisible();

    // Fill in the form
    await page.locator('input[name="given"]').fill('María');
    await page.locator('input[name="surname"]').fill('García');
    await page.locator('select[name="sex"]').selectOption('F');
    await page.locator('input[name="birthDate"]').fill('15 JUN 1985');

    await page.getByRole('button', { name: 'Save' }).click();

    // Panel closes and list shows new person
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('.list-row .row-name').filter({ hasText: 'María García' })).toBeVisible();
  });

  test('edit existing person updates the list immediately', async ({ page }) => {
    await page.goto('/');
    await clearDb(page);
    await page.reload();

    // Create first person via onboarding
    await page.getByRole('button', { name: 'Start with yourself' }).click();
    await page.locator('input[name="given"]').fill('Ana');
    await page.locator('input[name="surname"]').fill('López');
    await page.getByRole('button', { name: 'Save' }).click();
    // Wait for panel to close and list to show the new person
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('.row-name').filter({ hasText: 'Ana López' })).toBeVisible();

    // Click on the person row to open edit panel
    await page.locator('.list-row').filter({ hasText: 'Ana López' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText('Edit person')).toBeVisible();

    // Change name
    await page.locator('input[name="given"]').fill('Anna');
    await page.locator('input[name="surname"]').fill('Fernández');
    await page.getByRole('button', { name: 'Save' }).click();

    // Updated name shows in list
    await expect(page.locator('.row-name').filter({ hasText: 'Anna Fernández' })).toBeVisible();
    await expect(page.locator('.row-name').filter({ hasText: 'Ana López' })).not.toBeVisible();
  });

  test('changes survive page reload (persisted to IndexedDB)', async ({ page }) => {
    await page.goto('/');
    await clearDb(page);
    await page.reload();

    // Create person
    await page.getByRole('button', { name: 'Start with yourself' }).click();
    await page.locator('input[name="given"]').fill('Pedro');
    await page.locator('input[name="surname"]').fill('Martínez');
    await page.locator('input[name="birthDate"]').fill('1 JAN 1960');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.row-name').filter({ hasText: 'Pedro Martínez' })).toBeVisible();

    // Wait for debounced IndexedDB write (300ms + buffer)
    await page.waitForTimeout(600);

    // Reload the page
    await page.reload();

    // Person should still be there (loaded from IndexedDB)
    await expect(page.locator('.list-row').filter({ hasText: 'Pedro Martínez' })).toBeVisible({ timeout: 5_000 });
  });

  test('add-person FAB works after initial import', async ({ page }) => {
    await page.goto('/');
    await clearDb(page);
    await page.reload();

    // Create first person via onboarding
    await page.getByRole('button', { name: 'Start with yourself' }).click();
    await page.locator('input[name="given"]').fill('Root');
    await page.locator('input[name="surname"]').fill('Person');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('.list-row')).toHaveCount(1);

    // Use the FAB to add a second person
    await page.locator('.add-person-btn').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.locator('input[name="given"]').fill('Second');
    await page.locator('input[name="surname"]').fill('Person');
    await page.getByRole('button', { name: 'Save' }).click();

    // Two rows now
    await expect(page.locator('.list-row')).toHaveCount(2);
  });

  test('save requires at least a name; shows error if blank', async ({ page }) => {
    await page.goto('/');
    await clearDb(page);
    await page.reload();

    await page.getByRole('button', { name: 'Start with yourself' }).click();
    // Leave form blank
    await page.getByRole('button', { name: 'Save' }).click();

    // Error message appears, panel stays open
    await expect(page.locator('.edit-error')).toBeVisible();
    await expect(page.getByRole('dialog')).toBeVisible();
  });
});
