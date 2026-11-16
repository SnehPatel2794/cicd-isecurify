import { defineConfig, devices } from '@playwright/test'; import { API_ENV, PORT_API, PORT_WEB } from './env';
const env = { ...process.env, ...API_ENV, EVIDENCE_DIR: `${__dirname}/.run/evidence` } as Record<string, string>;
export default defineConfig({
  testDir: '.', testMatch: /.*\.spec\.ts/, fullyParallel: false, workers: 1, retries: process.env.CI ? 1 : 0, timeout: 90_000, expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]], globalSetup: './global-setup.ts',
  use: { baseURL: `http://127.0.0.1:${PORT_WEB}`, trace: 'retain-on-failure', screenshot: 'only-on-failure', ...devices['Desktop Chrome'] },
  webServer: [
    { command: `cd ../api && npx tsx scripts/e2e-prepare.ts && npx tsx src/server.ts`, url: `http://127.0.0.1:${PORT_API}/health`, env, timeout: 120_000, reuseExistingServer: false, stdout: 'pipe', stderr: 'pipe' },
    { command: `cd ../web && npx vite --host 127.0.0.1 --port ${PORT_WEB} --strictPort`, url: `http://127.0.0.1:${PORT_WEB}/login`, env: { ...env, VITE_API_PORT: String(PORT_API) }, timeout: 120_000, reuseExistingServer: false },
  ],
});
