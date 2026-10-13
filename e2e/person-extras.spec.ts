/**
 * E2E: person editor — crop a profile photo, add facts (email, Facebook), add life events.
 */
import { test, expect, Page } from '@playwright/test';

async function openFirstPerson(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'try a sample tree' }).click();
  await expect(page.locator('.list-row').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('.list-row').first().click();
  await expect(page.getByRole('dialog', { name: 'Edit person' })).toBeVisible();
}

test('crop and save a profile photo as a 400×400 image', async ({ page }) => {
  await openFirstPerson(page);

  // A 1200×800 test image made in the page
  const base64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 800;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 1200, 800);
    g.addColorStop(0, '#c0392b'); g.addColorStop(1, '#2980b9');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 1200, 800);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('.photo-pick input[type=file]').setInputFiles({
    name: 'face.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64'),
  });

  const dialog = page.getByRole('dialog', { name: 'Adjust photo' });
  await expect(dialog).toBeVisible();
  const img = dialog.locator('.crop-view img');
  await expect(img).toBeVisible();
  const before = await img.boundingBox();

  // drag moves the picture, the slider zooms it in
  const view = dialog.locator('.crop-view');
  const box = (await view.boundingBox())!;
  await page.mouse.move(box.x + 140, box.y + 140);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 140, { steps: 5 });
  await page.mouse.up();
  const moved = await img.boundingBox();
  expect(moved!.x).toBeLessThan(before!.x); // panned left
  const w0 = moved!.width;
  await dialog.getByRole('slider', { name: 'Zoom' }).fill('2');
  expect((await img.boundingBox())!.width).toBeGreaterThan(w0 * 1.9);

  await dialog.getByRole('button', { name: 'Use photo' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.photo-thumb')).toBeVisible({ timeout: 15_000 });

  // what is stored is the cropped square, not the original
  const size = await page.evaluate(() => new Promise<{ w: number; h: number; type: string }>((resolve) => {
    const q = indexedDB.open('kaliwat');
    q.onsuccess = () => {
      const all = q.result.transaction('mediaBlobs').objectStore('mediaBlobs').getAll();
      all.onsuccess = async () => {
        const r = all.result[all.result.length - 1];
        const bmp = await createImageBitmap(r.blob);
        resolve({ w: bmp.width, h: bmp.height, type: r.blob.type });
      };
    };
  }));
  expect(size.w).toBe(400);
  expect(size.h).toBe(400);
  expect(size.type).toMatch(/^image\/(webp|jpeg)$/);
});

test('cancelling the photo editor saves nothing', async ({ page }) => {
  await openFirstPerson(page);
  await page.locator('.photo-pick input[type=file]').setInputFiles({
    name: 'x.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  });
  const dialog = page.getByRole('dialog', { name: 'Adjust photo' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.photo-thumb')).toHaveCount(0);
});

test('add an email and a Facebook link, then remove one', async ({ page }) => {
  await openFirstPerson(page);
  const panel = page.getByRole('dialog', { name: 'Edit person' });

  await panel.getByLabel('Fact value').fill('ana@example.com');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(panel.getByRole('link', { name: 'ana@example.com' })).toBeVisible();

  await panel.getByLabel('Kind of fact').selectOption('facebook');
  await panel.getByLabel('Fact value').fill('facebook.com/ana');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(panel.getByRole('link', { name: 'https://facebook.com/ana' })).toBeVisible();

  // a bad value shows an error
  await panel.getByLabel('Kind of fact').selectOption('email');
  await panel.getByLabel('Fact value').fill('nope');
  await panel.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('valid email');

  await panel.getByRole('button', { name: /Remove Email ana@example.com/ }).click();
  await expect(panel.getByRole('link', { name: 'ana@example.com' })).toHaveCount(0);
});

test('add and remove a life event', async ({ page }) => {
  await openFirstPerson(page);
  const panel = page.getByRole('dialog', { name: 'Edit person' });

  await panel.getByLabel('Kind of event').selectOption('OCCU');
  await panel.getByLabel('Event date').fill('1995');
  await panel.getByLabel('Event place').fill('Manila');
  await panel.getByLabel('Event description').fill('Teacher');
  await panel.getByRole('button', { name: 'Add event' }).click();
  await expect(panel.getByText('1995 · Manila · Teacher')).toBeVisible();

  await panel.getByRole('button', { name: 'Remove Occupation' }).click();
  await expect(panel.getByText('1995 · Manila · Teacher')).toHaveCount(0);
});

test('the saved photo is the part you framed, not the whole image', async ({ page }) => {
  await openFirstPerson(page);
  // left half red, right half blue
  const base64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1200; c.height = 800;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 600, 800);
    ctx.fillStyle = '#0000ff'; ctx.fillRect(600, 0, 600, 800);
    return c.toDataURL('image/png').split(',')[1];
  });
  await page.locator('.photo-pick input[type=file]').setInputFiles({
    name: 'halves.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64'),
  });
  const dialog = page.getByRole('dialog', { name: 'Adjust photo' });
  await expect(dialog.locator('.crop-view img')).toBeVisible();

  // pan right as far as it goes: the view now shows source x 400…1200
  const box = (await dialog.locator('.crop-view').boundingBox())!;
  await page.mouse.move(box.x + 200, box.y + 140);
  await page.mouse.down();
  await page.mouse.move(box.x - 100, box.y + 140, { steps: 8 });
  await page.mouse.up();
  await dialog.getByRole('button', { name: 'Use photo' }).click();
  await expect(page.locator('.photo-thumb')).toBeVisible({ timeout: 15_000 });

  const px = await page.evaluate(() => new Promise<number[]>((resolve) => {
    const q = indexedDB.open('kaliwat');
    q.onsuccess = () => {
      const all = q.result.transaction('mediaBlobs').objectStore('mediaBlobs').getAll();
      all.onsuccess = async () => {
        const bmp = await createImageBitmap(all.result[all.result.length - 1].blob);
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(bmp, 0, 0);
        // output x=150 of 400 is source x≈700 after panning right (it would be ≈500 centred)
        resolve([...ctx.getImageData(150, 200, 1, 1).data]);
      };
    };
  }));
  expect(px[2]).toBeGreaterThan(200); // blue
  expect(px[0]).toBeLessThan(60);     // not red
});
