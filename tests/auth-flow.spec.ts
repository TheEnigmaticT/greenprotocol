import { test, expect } from '@playwright/test';

test('signup flow verification', async ({ page }) => {
  // 1. Visit Login Page
  await page.goto('/login');
  await expect(page.locator('h1')).toContainText('GreenChemistry.ai');

  // 2. Click Signup (if separate) or verify email input
  // Since we use Supabase Auth, we look for the email input
  const emailInput = page.locator('input[type="email"]');
  const passwordInput = page.locator('input[type="password"]');
  
  await expect(emailInput).toBeVisible();
  await expect(passwordInput).toBeVisible();

  // Verify the primary button says "Sign In" initially
  const submitBtn = page.locator('button[type="submit"]');
  await expect(submitBtn).toHaveText('Sign In');
});

test('middleware protection', async ({ page }) => {
  // Verify /analyze is protected
  await page.goto('/analyze');
  await expect(page).toHaveURL(/.*login.*/);
});
