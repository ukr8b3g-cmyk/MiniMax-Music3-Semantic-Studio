import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  timeout: 20_000,
  fullyParallel: true,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'python -m http.server 4173 --bind 127.0.0.1 --directory .',
    url: 'http://127.0.0.1:4173/tests/ui/fixture.html',
    reuseExistingServer: true,
    timeout: 10_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
