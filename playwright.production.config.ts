import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: 'http://127.0.0.1:5181' },
  webServer: {
    command: 'node scripts/serve-production.mjs',
    url: 'http://127.0.0.1:5181',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
