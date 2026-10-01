/* Local Chromium smoke test. SDK/API/bridge values are mocked fixtures, not live SciSure or GCai responses. */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
  await context.route('https://sandbox.scisure.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"></head><body><h1>Local add-on fixture — not a live SciSure session</h1><div id="toolbar"></div></body></html>' }));
  await context.route('https://greenchemistry.ai/integrations/scisure/connect', (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Mock GCai bridge</title><body>Mock GCai bridge fixture</body>' }));
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('https://sandbox.scisure.test/');
  await page.evaluate(() => {
    window.testCalls = []; window.testCopied = ''; window.testBridgeMessages = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text) => { window.testCopied = text; } } });

    const insert = (button) => { const node = document.createElement('button'); node.textContent = button.label; node.dataset.actionid = button.actionID; node.onclick = button.action; document.querySelector('#toolbar').append(node); };
    window.eLabSDK = { ready: (cb) => cb(), GUI: { Button: function Button(o) { return o; } }, Page: {
      Experiment: function Experiment(o) { this.getExperimentID = () => 7; this.getExperimentData = () => ({ headerinfo: { experimentName: 'Fixture synthesis' }, data: [{ expJournalID: 55, sectionType: 'PARAGRAPH', sectionHeader: 'Reaction', contents: '<p>Dissolve substrate in H<sub>2</sub>O and stir for 30 minutes.</p>' }] }); this.addButtonToExperimentTopToolbar = insert; o.onReady.call(this); },
      Protocol: function Protocol(o) { this.addButtonToProtocolTopToolBar = insert; this.addButtonToListView = () => {}; o.onReady.call(this); }
    }, API: { call: (r) => {
      window.testCalls.push({ method: r.method, path: r.path, body: r.body, params: r.params });
      if (r.path === 'auth/user') r.onSuccess(null, 200, { user: { userID: 22, email: 'fixture.scientist@example.test' } });
      else if (r.path === 'protocols/5') r.onSuccess(null, 200, { protID: 5, protVersionID: 10, name: 'Fixture workup', steps: [{ protStepID: 2, name: 'Dry', contents: '<p>Dry the isolated product.</p>', order: 2 }, { protStepID: 1, name: 'Wash', contents: '<p>Wash with ethanol.</p>', order: 1 }] });
      else if (r.path === 'supplies/catalogitems') r.onSuccess(null, 200, { data: [{ catalogItemID: 9, name: 'Ethyl acetate — TEST FIXTURE', catalogNumber: 'TEST-SKU', supplierID: 2, amount: 500, quantityType: 'mL' }] });
      else if (r.method === 'POST') r.onSuccess(null, 200, 44);
      else if (r.path === 'supplies/orders') r.onSuccess(null, 200, { data: [{ shoppingItemID: 44, sampleID: 3, catalogItemID: 9, amount: 2, status: 'PENDING' }], hasNextPage: false });
      else r.onError(null, 404, 'Unknown fixture');
    } } };
  });
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '..', 'add-on.js'), 'utf8') });
  await page.evaluate(() => greenchemistry_ai.init({ enableSuppliesOrders: true, gcaiBridge: { enabled: true, origin: 'https://greenchemistry.ai', path: '/integrations/scisure/connect' } }));

  await page.locator('[data-actionid="greenchemistry-ai-experiment"]').click(); await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Copy reviewed text', exact: true }).click();
  assert.match(await page.evaluate(() => testCopied), /H₂O/); await page.getByRole('button', { name: 'Close', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'detached' });

  await page.locator('[data-actionid="greenchemistry-ai-protocol"]').first().click(); await page.getByLabel('Protocol ID', { exact: true }).fill('5'); await page.getByRole('button', { name: 'Fetch protocol', exact: true }).click(); await page.getByLabel('Protocol content to copy').waitFor(); await page.getByLabel('Protocol content to copy').selectOption('step:1');
  assert.match(await page.getByLabel('Reviewed protocol text').inputValue(), /Wash with ethanol/); await page.getByRole('button', { name: 'Copy reviewed protocol', exact: true }).click(); assert.doesNotMatch(await page.evaluate(() => testCopied), /Dry the/); await page.keyboard.press('Escape');

  await page.locator('[data-actionid="greenchemistry-ai-experiment"]').click(); await page.getByRole('checkbox').check(); const popupPromise = page.waitForEvent('popup'); await page.getByRole('button', { name: 'Connect reviewed source to GCai', exact: true }).click(); const popup = await popupPromise; await popup.waitForLoadState();
  await page.getByLabel('Email delivery address').waitFor(); assert.equal(await page.getByLabel('Email delivery address').inputValue(), 'fixture.scientist@example.test');
  await popup.evaluate(() => { window.received = []; window.addEventListener('message', (event) => window.received.push({ data: event.data, origin: event.origin })); window.opener.postMessage({ version: 1, type: 'gcai.scisure.loaded' }, 'https://sandbox.scisure.test'); });
  await popup.waitForFunction(() => received.length === 1); const bridge = await popup.evaluate(() => ({ nonce: received[0].data.nonce, hello: received[0] }));
  assert.equal(bridge.hello.origin, 'https://sandbox.scisure.test'); assert.equal(bridge.hello.data.type, 'scisure.gcai.hello'); assert.match(bridge.nonce, /^[a-f0-9]{64}$/);
  await popup.evaluate(({ nonce }) => window.opener.postMessage({ version: 1, type: 'gcai.scisure.ready', nonce, bridgeSessionId: 'fixture-session-1' }, 'https://sandbox.scisure.test'), bridge);
  await page.getByRole('button', { name: 'Send reviewed source', exact: true }).click();
  await popup.waitForFunction(() => received.length === 2); assert.equal(await popup.evaluate(() => received.length), 2);
  await popup.evaluate(({ nonce }) => window.opener.postMessage({ version: 1, type: 'gcai.scisure.result', nonce, bridgeSessionId: 'fixture-session-1', snapshot: { externalId: '7', externalVersionId: null, selectionIds: ['55'] }, sourceHash: 'a'.repeat(64), runId: 'fixture-run-1', revisionNumber: null, recommendations: [{ recommendationId: 'fixture-rec-1', sourceStepId: null, originalChemical: 'Old solvent', alternativeChemical: 'Ethyl acetate', kind: 'chemical-substitution', decision: 'accepted', confidence: 'medium', caveats: 'Fixture only; scientist confirmation required.', requiresScientistReview: true }] }, 'https://sandbox.scisure.test'), bridge);
  await page.getByText('Ethyl acetate', { exact: true }).waitFor(); const out = path.join(__dirname, '..', 'verification'); fs.mkdirSync(out, { recursive: true }); await page.screenshot({ path: path.join(out, 'bridge-local-fixture.png') });

  await page.getByRole('button', { name: 'Prefill Supplies chemical', exact: true }).click(); assert.equal(await page.getByLabel('Recommendation chemical name').inputValue(), 'Ethyl acetate'); await page.getByLabel('Sample ID', { exact: true }).fill('3'); await page.getByLabel('Packages', { exact: true }).fill('2'); await page.getByRole('button', { name: 'Search catalog', exact: true }).click(); await page.getByRole('button', { name: 'Select', exact: true }).click(); await page.getByRole('button', { name: 'Place pending order', exact: true }).click();
  assert.equal(await page.evaluate(() => testCalls.filter((call) => call.method === 'POST').length), 0); await page.getByRole('button', { name: 'Confirm order', exact: true }).click(); await page.getByRole('status').filter({ hasText: 'Order 44 verified' }).waitFor(); await page.screenshot({ path: path.join(out, 'supplies-local-fixture.png') });

  assert.deepEqual(errors, []);
  const report = { environment: 'local headless Chromium with mocked SciSure SDK/API and GCai bridge fixtures', experimentCopy: 'PASS', protocolStepCopy: 'PASS', bridgeAdmissionAndStrictResult: 'PASS', recommendationToSuppliesPrefill: 'PASS', orderConfirmationAndExactReadback: 'PASS', pageErrors: errors };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2)); await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
