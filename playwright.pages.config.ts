import { defineConfig } from '@playwright/test';
import production from './playwright.production.config';

export default defineConfig({
  ...production,
  webServer: {
    command: 'wrangler pages dev dist --port 5181',
    url: 'http://127.0.0.1:5181',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
