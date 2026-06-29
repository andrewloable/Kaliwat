import { test, expect } from '@playwright/test';
import * as path from 'path';

const SAMPLE_GED = path.resolve(__dirname, '../test/fixtures/sample.ged');

test.describe('Zero-egress privacy', () => {
  test('no requests to external origins during load + import + view', async ({ page }) => {
    const externalRequests: string[] = [];

    page.on('request', (req) => {
      const url = new URL(req.url());
      // Allow same-origin and local addresses
      if (
        url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.protocol === 'blob:' ||
        url.protocol === 'data:'
      ) return;
      externalRequests.push(req.url());
    });

    await page.goto('/');
    await expect(page.locator('.wordmark')).toBeVisible();

    // Import a .ged file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(SAMPLE_GED);

    // Wait for list to populate
    await expect(page.locator('.list-row').first()).toBeVisible({ timeout: 10_000 });

    // No external requests should have fired
    expect(
      externalRequests,
      `External requests detected: ${externalRequests.join(', ')}`,
    ).toHaveLength(0);
  });
});
