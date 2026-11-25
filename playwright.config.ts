import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.E2E_URL ?? 'http://127.0.0.1:8799',
    locale: 'fr-FR',
    timezoneId: 'Africa/Tunis',
    screenshot: 'only-on-failure',
  },
});
