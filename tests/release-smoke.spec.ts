import { expect, test } from '@playwright/test';

test('public release surface loads without a server error', async ({ page }) => {
  const response = await page.goto('/', { waitUntil: 'domcontentloaded' });

  expect(response?.status()).toBeLessThan(500);
  await expect(
    page.getByRole('heading', { name: /every reaction has a greener equivalent/i }),
  ).toBeVisible();
});
