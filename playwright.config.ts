import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/playgama',
  timeout: 90000,
  expect: { timeout: 20000 },
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/playgama-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:4178', headless: true, screenshot: 'only-on-failure', trace: 'retain-on-failure', launchOptions: { args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } },
  webServer: { command: 'node scripts/serve-release.mjs', url: 'http://127.0.0.1:4178/iframe.html', reuseExistingServer: false, timeout: 15000 },
});
