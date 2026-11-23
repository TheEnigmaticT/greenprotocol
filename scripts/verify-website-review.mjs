import { chromium } from '@playwright/test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const base = process.env.WEBSITE_REVIEW_URL || 'http://localhost:3127'
const output = process.env.WEBSITE_REVIEW_OUTPUT || '/Users/ct-mac-mini/.hermes/cache/scratch/elle-website-review'
await fs.mkdir(output, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
const results = []
try {
  for (const width of [320, 375, 412, 768, 901, 1024, 1100, 1280, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } })
    await page.goto(base)
    await page.getByRole('link', { name: 'WORK WITH US', exact: true }).waitFor()
    const text = await page.locator('body').innerText()
    assert(text.includes('Scored against 11 of 12 Principles of Green Chemistry.'))
    assert(!text.includes('Principlesof'))
    assert(!/Scored Against 12 Principles|across all 12|(?<!of )12 principles scored,/.test(text))
    assert.equal(await page.locator('.principles-grid > div').count(), 11)
    assert(!await page.locator('.principles-grid').innerText().then(t => /\bP4\b/.test(t)))
    await page.getByRole('button', { name: 'Scorecard', exact: true }).click()
    assert(!await page.locator('#showcase').innerText().then(t => /\bP4\b/.test(t)))
    const chip = page.locator('.stack-energy-chip')
    await chip.scrollIntoViewIfNeeded()
    const containment = await chip.evaluate(el => {
      const outer = el.getBoundingClientRect()
      return [...el.querySelectorAll('*')].every(child => {
        const box = child.getBoundingClientRect()
        return box.left >= outer.left - 1 && box.right <= outer.right + 1
          && box.top >= outer.top - 1 && box.bottom <= outer.bottom + 1
      })
    })
    assert(containment, `Energy content escaped panel at ${width}px`)
    await chip.screenshot({ path: `${output}/energy-${width}.png` })
    const navFits = await page.locator('nav').evaluate(el => el.scrollWidth <= el.clientWidth)
    assert(navFits, `Navigation overflow at ${width}px`)
    results.push({ width, principles: 11, energyContained: containment, navFits })
    await page.close()
  }
  const page = await browser.newPage()
  await page.goto(base)
  await page.goto(new URL('/careers', base).href)
  assert((await page.title()).includes('Work with us'))
  await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ passed: results.length, results, output }, null, 2))
} finally {
  await browser.close()
}
