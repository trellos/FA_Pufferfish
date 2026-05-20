import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 390, height: 844 }, // iPhone 14 (portrait)
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile',   use: { ...devices['iPhone 14']      } },
  ],
  webServer: {
    command: 'npm run dev',
    url:     'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
  },
});
