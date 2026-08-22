import { defineConfig, devices } from '@playwright/test';

/**
 * The e2e suite runs against a production build served by vite preview, so the
 * service worker and the real mount point are exercised rather than mocked.
 * The build is relative, so preview serves it at the root — the same mount the
 * deploy uses. Specs navigate relatively and work either way.
 */
/**
 * Some sandboxes ship a Chromium that does not match this Playwright build.
 * Point PLAYWRIGHT_CHROMIUM_EXECUTABLE at it rather than downloading another.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173/',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath },
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['iPhone 14'],
        // Chromium, not WebKit: this is the browser installed in CI. Real iOS
        // behaviour (lock-screen audio in particular) needs a real device.
        defaultBrowserType: 'chromium',
        browserName: 'chromium',
        isMobile: true,
        hasTouch: true,
      },
    },
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
