import { defineConfig, devices } from '@playwright/test';

const deployedBaseUrl = process.env.PLAYWRIGHT_BASE_URL;
const protectionBypass = process.env.VERCEL_PROTECTION_BYPASS_SECRET;

export default defineConfig({
  testDir: './tests',
  use: {
    baseURL: deployedBaseUrl || 'http://localhost:3000',
    trace: 'on-first-retry',
    extraHTTPHeaders: protectionBypass
      ? {
          'x-vercel-protection-bypass': protectionBypass,
          'x-vercel-set-bypass-cookie': 'true',
        }
      : undefined,
  },
  webServer: deployedBaseUrl
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        stderr: 'pipe',
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
