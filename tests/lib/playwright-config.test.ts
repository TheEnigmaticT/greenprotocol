import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig(protectionBypass?: string) {
  vi.resetModules();

  if (protectionBypass) {
    process.env.VERCEL_PROTECTION_BYPASS_SECRET = protectionBypass;
  } else {
    delete process.env.VERCEL_PROTECTION_BYPASS_SECRET;
  }

  return (await import('../../playwright.config')).default;
}

afterEach(() => {
  delete process.env.VERCEL_PROTECTION_BYPASS_SECRET;
  vi.resetModules();
});

describe('deployed Playwright configuration', () => {
  it('sends the Vercel protection-bypass headers when a CI secret is supplied', async () => {
    const config = await loadConfig('staging-only-test-secret');

    expect(config.use?.extraHTTPHeaders).toEqual({
      'x-vercel-protection-bypass': 'staging-only-test-secret',
      'x-vercel-set-bypass-cookie': 'true',
    });
  });

  it('does not send a bypass header for ordinary local runs', async () => {
    const config = await loadConfig();

    expect(config.use?.extraHTTPHeaders).toBeUndefined();
  });
});
