import { defineConfig, devices } from '@playwright/test';

// ponytail: single chromium project + auto-started dev server. Add more browsers/CI sharding when a test actually needs them.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  use: { baseURL: 'http://localhost:4200', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm start',
    url: 'http://localhost:4200',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
