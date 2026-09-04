import { test, expect, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import os from 'os';

/**
 * Mobile laboratory workflow smoke (375 / 430).
 *
 * CI-safe: skips unless VISUAL_EMAIL is available via env or `.env.visual-pass`
 * (local visual-pass). Never prints secrets.
 *
 * Covers document-level horizontal overflow + critical control visibility on
 * Decisions analysis and Evidence Atlas for a known analysis id.
 */

const VIEWPORTS = [
  { name: '375', width: 375, height: 812 },
  { name: '430', width: 430, height: 932 },
] as const;

const KNOWN_ANALYSIS_ID =
  process.env.VISUAL_ANALYSIS_ID || '251b04d4-d561-40e9-851f-8a6fd074416a';

function loadVisualCreds(): { email: string; password: string } | null {
  // Prefer file when present so shell-exported values cannot silently diverge.
  const envPath = path.join(process.cwd(), '.env.visual-pass');
  if (fs.existsSync(envPath)) {
    const parsed = Object.fromEntries(
      fs
        .readFileSync(envPath, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => {
          const i = l.indexOf('=');
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()] as const;
        }),
    );
    const email = parsed.VISUAL_EMAIL?.trim();
    const password = parsed.VISUAL_PASSWORD?.trim();
    if (email && password) return { email, password };
  }

  const email = process.env.VISUAL_EMAIL?.trim();
  const password = process.env.VISUAL_PASSWORD?.trim();
  if (email && password) return { email, password };
  return null;
}

const creds = loadVisualCreds();

async function login(page: Page, email: string, password: string) {
  // networkidle + short settle avoids pre-hydration native form GET races
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 60_000 });
}

async function assertNoDocumentOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const scrollW = Math.max(doc.scrollWidth, body?.scrollWidth ?? 0);
    const clientW = doc.clientWidth;
    return { scrollW, clientW, overflowPx: scrollW - clientW };
  });
  expect(
    overflow.overflowPx,
    `document horizontal overflow ${overflow.overflowPx}px (scroll=${overflow.scrollW}, client=${overflow.clientW})`,
  ).toBeLessThanOrEqual(1);
}

test.describe('mobile viewport smoke (375/430)', () => {
  test.skip(!creds, 'VISUAL_EMAIL not set — skip authenticated mobile smoke in CI');

  let storageStatePath = '';

  test.beforeAll(async ({ browser }) => {
    storageStatePath = path.join(
      os.tmpdir(),
      `gc-visual-auth-${process.pid}.json`,
    );
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, creds!.email, creds!.password);
    await context.storageState({ path: storageStatePath });
    await context.close();
  });

  test.afterAll(async () => {
    if (storageStatePath && fs.existsSync(storageStatePath)) {
      fs.unlinkSync(storageStatePath);
    }
  });

  for (const vp of VIEWPORTS) {
    test(`Decisions + Atlas @ ${vp.name}px: no overflow + critical controls`, async ({
      browser,
    }) => {
      test.setTimeout(90_000);
      const context = await browser.newContext({
        storageState: storageStatePath,
        viewport: { width: vp.width, height: vp.height },
      });
      const page = await context.newPage();

      const decisionsPath = `/analyze/${KNOWN_ANALYSIS_ID}`;
      await page.goto(decisionsPath, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);

      // Critical Decisions controls (Accept / Ask / Atlas CTA)
      const accept = page.getByRole('button', { name: /Accept/i }).first();
      const ask = page.getByRole('button', { name: /^Ask$/i }).first();
      const atlasCta = page
        .locator('a[aria-label*="Evidence Atlas"]')
        .or(page.getByRole('link', { name: /VIEW/i }))
        .first();

      await expect(accept).toBeVisible({ timeout: 20_000 });
      if (await ask.count()) {
        await ask.scrollIntoViewIfNeeded();
        await expect(ask).toBeVisible();
      }
      await atlasCta.scrollIntoViewIfNeeded();
      await expect(atlasCta).toBeVisible();
      await assertNoDocumentOverflow(page);

      await page.goto(`${decisionsPath}/evidence`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(800);

      const chemicals = page.getByRole('tab', { name: /Chemicals/i });
      const principles = page.getByRole('tab', { name: /Principles/i });
      await expect(chemicals).toBeVisible({ timeout: 20_000 });
      await expect(principles).toBeVisible();
      await principles.click();
      await expect(principles).toHaveAttribute('aria-selected', 'true');
      await chemicals.click();
      await expect(chemicals).toHaveAttribute('aria-selected', 'true');
      await assertNoDocumentOverflow(page);

      await context.close();
    });
  }
});
