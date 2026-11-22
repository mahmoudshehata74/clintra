import { defineConfig, devices } from '../web/node_modules/@playwright/test/index.mjs';
import { fileURLToPath } from 'node:url';
import { browserArtifacts } from '../web/e2e/browserArtifacts';
const artifacts = browserArtifacts('admin');
const cwd = fileURLToPath(new URL('.', import.meta.url));
const server = (port: number, allowlist = '', proxies = '') => ({
  command: `php artisan serve --host=127.0.0.1 --port=${port}`, cwd,
  url: `http://127.0.0.1:${port}/panel/sign-in`, reuseExistingServer: false,
  env: { APP_ENV: 'local', APP_DEBUG: 'false', DB_DATABASE: 'clintra_test', ADMIN_IP_ALLOWLIST: allowlist, ADMIN_TRUSTED_PROXIES: proxies },
  timeout: 60000,
});
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  failOnFlakyTests: true, timeout: 60000, expect: { timeout: 10000 },
  outputDir: artifacts.outputDir, reporter: [['list'], artifacts.reporter],
  use: { baseURL: 'http://127.0.0.1:8001', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: false } },
  ],
  webServer: [server(8001, '', '127.0.0.1'), server(8002, '192.0.2.0/24'), server(8003, '127.0.0.0/8')],
});
