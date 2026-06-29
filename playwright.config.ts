import { defineConfig, devices } from '@playwright/test';

// ponytail: single chromium project + production build server. The e2e suite
// tests what ships (ng build), not the dev server. CI sets PLAYWRIGHT_BUILD=1
// to force a fresh build; locally it reuses an existing dist if present.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env['CI'] ? 2 : 0,
  use: { baseURL: 'http://localhost:4173', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx serve dist/kaliwat/browser -l 4173 -s',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
