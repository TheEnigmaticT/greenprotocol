import { expect, test } from '@playwright/test'

test('SciSure partner page makes pilot status clear and submits an optional contact form', async ({ page }) => {
  let submitted: Record<string, unknown> | null = null
  await page.route('**/api/partners/scisure/contact', async (route) => {
    submitted = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ inquiryId: 'fixture-inquiry', notification: 'queued' }) })
  })
  await page.goto('/partners/scisure')
  await expect(page.getByRole('heading', { name: 'Make greener choices visible where work already happens.' })).toBeVisible()
  await expect(page.getByText(/not a SciSure endorsement, Marketplace certification/i)).toBeVisible()
  await expect(page.getByText(/Free accounts include 10 analyses/i)).toBeVisible()
  await page.getByLabel('Name').fill('Avery Chen')
  await page.getByLabel('Work email').fill('avery@example.test')
  await page.getByLabel('What would make a pilot useful?').fill('We want to test review points for a limited pilot.')
  await page.getByLabel(/I understand this form/).check()
  await page.getByRole('button', { name: 'Contact the pilot team' }).click()
  await expect(page.getByText('Thanks. Your inquiry is saved and queued for the partnership team.')).toBeVisible()
  expect(submitted).toMatchObject({ email: 'avery@example.test', privacyAcknowledged: true, marketingConsent: false })
  await page.screenshot({ path: 'test-results/scisure-partner-page.png', fullPage: true })
})
