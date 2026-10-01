const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'add-on.js'), 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function findButton(w, label) { const item = [...w.document.querySelectorAll('button')].find((node) => node.textContent === label); assert.ok(item, `missing ${label}`); return item; }
function boot({ api = () => {}, config = {}, sessionStorage, webCrypto = require('node:crypto').webcrypto } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://sandbox.scisure.test/', runScripts: 'outside-only' });
  const w = dom.window; const actions = {}; const opened = [];
  if (sessionStorage) Object.defineProperty(w, 'sessionStorage', { value: sessionStorage });
  Object.defineProperty(w, 'crypto', { value: webCrypto, configurable: true });
  w.open = (url, target, features) => { const popup = { closed: false, sent: [], postMessage(message, origin) { this.sent.push({ message, origin }); } }; opened.push({ url, target, features, popup }); return popup; };
  w.navigator.clipboard = { writeText: async () => {} };
  w.eLabSDK = { ready: (cb) => cb(), GUI: { Button: function Button(o) { return o; } }, Page: {
    Experiment: function Experiment(o) { this.getExperimentID = () => 7; this.getExperimentData = () => ({ headerinfo: { experimentName: 'Run' }, data: [{ sectionType: 'TEXT', sectionHeader: 'Reaction', expJournalID: 55, text: '<table><tr><td>H<sub>2</sub>O</td><td>µL</td></tr></table>' }] }); this.addButtonToExperimentTopToolbar = (b) => { actions[b.actionID] = b.action; }; o.onReady.call(this); },
    Protocol: function Protocol(o) { this.addButtonToProtocolTopToolBar = (b) => { actions[b.actionID] = b.action; }; this.addButtonToListView = () => {}; o.onReady.call(this); }
  }, API: { call: api } };
  w.eval(source); w.greenchemistry_ai.init(config);
  return { w, actions, opened };
}

async function openReviewedExperiment(x) {
  x.actions['greenchemistry-ai-experiment']();
  x.w.document.querySelector('input[type=checkbox]').checked = true;
}
function receive(x, data, origin = 'https://greenchemistry.ai', sender) {
  x.w.dispatchEvent(new x.w.MessageEvent('message', { origin, source: sender || x.opened.at(-1).popup, data }));
}
function bootstrap(x, bridgeSessionId = 'session-1') {
  receive(x, { version: 1, type: 'gcai.scisure.loaded' });
  const hello = x.opened.at(-1).popup.sent.at(-1);
  assert.equal(hello.origin, 'https://greenchemistry.ai');
  assert.equal(hello.message.type, 'scisure.gcai.hello');
  assert.match(hello.message.nonce, /^[a-f0-9]{64}$/);
  receive(x, { version: 1, type: 'gcai.scisure.ready', nonce: hello.message.nonce, bridgeSessionId });
  return hello.message.nonce;
}

test('bridge is disabled by default and never opens a popup or looks up an identity', async () => {
  let authCalls = 0; const x = boot({ api: (r) => { if (r.path === 'auth/user') authCalls += 1; } });
  await openReviewedExperiment(x); findButton(x.w, 'Connect reviewed source to GCai').click(); await tick();
  assert.equal(x.opened.length, 0); assert.equal(authCalls, 0); assert.match(x.w.document.body.textContent, /disabled/);
});

test('bridge gives the popup its nonce only through a public loaded then hello bootstrap before accepting ready', async () => {
  const x = boot({ config: { gcaiBridge: { enabled: true, origin: 'https://greenchemistry.ai', path: '/integrations/scisure/connect' } } });
  await openReviewedExperiment(x); findButton(x.w, 'Connect reviewed source to GCai').click();
  assert.equal(x.opened.length, 1);
  receive(x, { version: 1, type: 'gcai.scisure.ready', nonce: 'a'.repeat(64), bridgeSessionId: 'session-1' });
  assert.match(x.w.document.body.textContent, /rejected/);
  assert.equal(x.opened[0].popup.sent.length, 0);
  receive(x, { version: 1, type: 'gcai.scisure.loaded' }, 'https://evil.test');
  assert.equal(x.opened[0].popup.sent.length, 0);
  receive(x, { version: 1, type: 'gcai.scisure.loaded' }, 'https://greenchemistry.ai', {});
  assert.equal(x.opened[0].popup.sent.length, 0);
  const nonce = bootstrap(x);
  assert.match(x.w.document.body.textContent, /bridge is ready/);
  assert.equal(nonce.length, 64);
  findButton(x.w, 'Close').click();
});

test('bridge rejects a nonce-correct ready until it has sent hello', async () => {
  const knownNonce = '2a'.repeat(32);
  const x = boot({ webCrypto: { getRandomValues(values) { values.fill(0x2a); return values; } }, config: { gcaiBridge: { enabled: true } } });
  await openReviewedExperiment(x); findButton(x.w, 'Connect reviewed source to GCai').click();
  receive(x, { version: 1, type: 'gcai.scisure.ready', nonce: knownNonce, bridgeSessionId: 'session-before-hello' });
  assert.doesNotMatch(x.w.document.body.textContent, /bridge is ready/);
  assert.equal(x.opened[0].popup.sent.length, 0);
  findButton(x.w, 'Close').click();
});

test('explicit connection sends reviewed admission only after genuine bootstrap and a purpose consent', async () => {
  let authCalls = 0; const x = boot({ config: { gcaiBridge: { enabled: true, origin: 'https://greenchemistry.ai', path: '/integrations/scisure/connect' } }, api: (r) => {
    if (r.path === 'auth/user') { authCalls += 1; r.onSuccess(null, 200, { user: { userID: 22, email: 'scientist@example.test' } }); }
  } });
  await openReviewedExperiment(x); findButton(x.w, 'Connect reviewed source to GCai').click();
  assert.equal(x.opened.length, 1); assert.equal(authCalls, 1); assert.equal(x.opened[0].url, 'https://greenchemistry.ai/integrations/scisure/connect');
  await tick();
  const email = x.w.document.querySelector('input[type=email]'); assert.equal(email.value, 'scientist@example.test');
  assert.equal(x.w.document.querySelector('input[aria-label="Marketing consent"]').checked, false);
  assert.match(x.w.document.body.textContent, /retained for up to 90 days/);
  bootstrap(x);
  findButton(x.w, 'Send reviewed source').click();
  const sent = x.opened[0].popup.sent.at(-1); assert.equal(sent.origin, 'https://greenchemistry.ai');
  assert.equal(sent.message.type, 'scisure.gcai.admission'); assert.equal(sent.message.source.selection[0].sectionId, '55');
  assert.match(sent.message.source.selection[0].normalizedText, /H₂O\tµL/);
  assert.equal(sent.message.email.deliveryConsent, false); assert.equal(sent.message.email.marketingConsent, false);
  assert.equal(sent.message.email.address, undefined); assert.equal(sent.message.userClaim.email, undefined); assert.equal(sent.message.userClaim.userID, '22');
  findButton(x.w, 'Close').click();
});

test('email is sent only with delivery or marketing purpose consent and validates its format', async () => {
  const x = boot({ config: { gcaiBridge: { enabled: true } }, api: (r) => r.onSuccess(null, 200, { user: { userID: 22, email: 'scientist@example.test' } }) });
  await openReviewedExperiment(x); findButton(x.w, 'Connect reviewed source to GCai').click(); await tick(); bootstrap(x);
  const email = x.w.document.querySelector('input[type=email]'); const marketing = x.w.document.querySelector('input[aria-label="Marketing consent"]');
  email.value = 'not-an-email'; marketing.checked = true; findButton(x.w, 'Send reviewed source').click();
  assert.match(x.w.document.body.textContent, /valid email/i); assert.equal(x.opened[0].popup.sent.filter((item) => item.message.type === 'scisure.gcai.admission').length, 0);
  email.value = 'marketing@example.test'; findButton(x.w, 'Send reviewed source').click();
  const admission = x.opened[0].popup.sent.at(-1).message;
  assert.equal(admission.email.address, 'marketing@example.test'); assert.equal(admission.email.deliveryConsent, false); assert.equal(admission.email.marketingConsent, true);
  findButton(x.w, 'Close').click();
});

test('bridge rejects wrong origin, wrong source, nonce replay, and malformed recommendation without displaying it', async () => {
  const x = boot({ config: { gcaiBridge: { enabled: true } }, api: (r) => r.onSuccess(null, 200, { user: { email: 'a@test' } }) });
  await openReviewedExperiment(x); findButton(x.w, 'Connect reviewed source to GCai').click(); await tick();
  receive(x, { version: 1, type: 'gcai.scisure.loaded' }, 'https://evil.test');
  assert.equal(x.opened[0].popup.sent.length, 0);
  receive(x, { version: 1, type: 'gcai.scisure.loaded' }, 'https://greenchemistry.ai', {});
  assert.equal(x.opened[0].popup.sent.length, 0);
  const nonce = bootstrap(x);
  receive(x, { version: 1, type: 'gcai.scisure.result', nonce, bridgeSessionId: 'session-1', snapshot: { externalId: '7', selectionIds: ['55'] }, recommendations: [{ recommendationId: 'bad', alternativeChemical: '<img src=x>', kind: 'chemical-substitution', decision: 'accepted', requiresScientistReview: true }] });
  assert.doesNotMatch(x.w.document.body.textContent, /img src/);
  assert.match(x.w.document.body.textContent, /rejected/);
  findButton(x.w, 'Close').click();
});

test('bridge rejects results before source admission and accepts eligible results only after sent', async () => {
  const x = boot({ config: { gcaiBridge: { enabled: true }, enableSuppliesOrders: true }, api: (r) => r.onSuccess(null, 200, { user: { email: 'a@test' } }) });
  await openReviewedExperiment(x); findButton(x.w, 'Connect reviewed source to GCai').click(); await tick();
  const nonce = bootstrap(x);
  const result = { version: 1, type: 'gcai.scisure.result', nonce, bridgeSessionId: 'session-1', snapshot: { externalId: '7', externalVersionId: null, selectionIds: ['55'] }, sourceHash: 'a'.repeat(64), runId: 'run-1', revisionNumber: null, recommendations: [{ recommendationId: 'r-1', sourceStepId: null, originalChemical: 'Old', alternativeChemical: 'Ethyl acetate', kind: 'chemical-substitution', decision: 'accepted', confidence: 'medium', caveats: 'Confirm suitability', requiresScientistReview: true }] };
  receive(x, result);
  assert.doesNotMatch(x.w.document.body.textContent, /Ethyl acetate/); assert.match(x.w.document.body.textContent, /rejected/);
  findButton(x.w, 'Send reviewed source').click(); receive(x, result);
  assert.match(x.w.document.body.textContent, /Ethyl acetate/); findButton(x.w, 'Prefill Supplies chemical').click();
  assert.equal(x.w.document.querySelector('input[aria-label="Recommendation chemical name"]').value, 'Ethyl acetate');
  assert.match(x.w.document.body.textContent, /GCai recommendation r-1/); assert.match(x.w.document.body.textContent, /does not authorize purchasing/);
});

test('bridge keeps the channel alive after admission and accepts only a terminal result bound to hash and run revision', async () => {
  const x = boot({ config: { gcaiBridge: { enabled: true } }, api: (r) => r.onSuccess(null, 200, { user: { email: 'a@test' } }) });
  await openReviewedExperiment(x); findButton(x.w, 'Connect reviewed source to GCai').click(); await tick();
  const nonce = bootstrap(x); findButton(x.w, 'Send reviewed source').click();
  receive(x, { version: 1, type: 'gcai.scisure.result', nonce, bridgeSessionId: 'session-1', snapshot: { externalId: '7', externalVersionId: null, selectionIds: ['55'] }, status: 'queued', sourceHash: 'a'.repeat(64), runId: 'run-1', revisionNumber: null, recommendations: [] });
  assert.match(x.w.document.body.textContent, /rejected/);
  assert.ok(x.w.greenchemistry_ai.debug().bridge);
  receive(x, { version: 1, type: 'gcai.scisure.result', nonce, bridgeSessionId: 'session-1', snapshot: { externalId: '7', externalVersionId: null, selectionIds: ['55'] }, sourceHash: 'a'.repeat(64), runId: 'run-1', revisionNumber: null, recommendations: [{ recommendationId: 'safe-1', sourceStepId: null, originalChemical: 'DMF', alternativeChemical: 'Ethyl acetate', kind: 'chemical-substitution', decision: 'accepted', confidence: 'medium', caveats: 'Confirm suitability', requiresScientistReview: true }] });
  assert.match(x.w.document.body.textContent, /Ethyl acetate/);
});

test('bridge cleanup runs on Escape and replacement modal, and close-after-send does not claim no source was submitted', async () => {
  const x = boot({ config: { gcaiBridge: { enabled: true } } });
  await openReviewedExperiment(x); findButton(x.w, 'Connect reviewed source to GCai').click(); bootstrap(x); x.w.document.dispatchEvent(new x.w.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(x.w.greenchemistry_ai.debug().bridge, null);
  await openReviewedExperiment(x); findButton(x.w, 'Connect reviewed source to GCai').click(); bootstrap(x); findButton(x.w, 'Send reviewed source').click();
  x.opened[1].popup.closed = true; await new Promise((resolve) => setTimeout(resolve, 550));
  assert.doesNotMatch(x.w.document.body.textContent, /No source was submitted/);
  assert.match(x.w.document.body.textContent, /was closed after the reviewed source was submitted/);
  await openReviewedExperiment(x);
  assert.equal(x.w.greenchemistry_ai.debug().bridge, null);
});

test('uncertain order locks session storage without credentials or chemistry and fails closed when persistence is unavailable', async () => {
  const storage = { setItem(k, v) { this.value = v; }, getItem() { return this.value || null; }, removeItem() { this.value = null; } };
  const x = boot({ sessionStorage: storage, config: { enableSuppliesOrders: true }, api: (r) => { if (r.path === 'supplies/catalogitems') r.onSuccess(null, 200, { data: [{ catalogItemID: 9, name: 'Ethanol' }] }); else if (r.method === 'POST') r.onError(null, 0, 'uncertain'); } });
  await x.w.greenchemistry_ai.openSupplyOrder(); const inputs = x.w.document.querySelectorAll('input'); inputs[0].value = 'Ethanol'; inputs[1].value = '3'; inputs[2].value = '2'; findButton(x.w, 'Search catalog').click(); await tick(); findButton(x.w, 'Select').click(); findButton(x.w, 'Place pending order').click(); findButton(x.w, 'Confirm order').click(); await tick();
  assert.match(storage.value, /"sampleID":3/); assert.doesNotMatch(storage.value, /Ethanol|credential|source/i);
  const failing = { setItem() { throw new Error('blocked'); }, getItem() { return null; }, removeItem() {} };
  const y = boot({ sessionStorage: failing, config: { enableSuppliesOrders: true }, api: () => { throw new Error('POST must not occur'); } });
  await y.w.greenchemistry_ai.openSupplyOrder(); const fi = y.w.document.querySelectorAll('input'); fi[0].value = 'Ethanol'; fi[1].value = '3'; fi[2].value = '2'; findButton(y.w, 'Search catalog').click(); await tick();
  assert.match(y.w.document.body.textContent, /Catalog search failed|persistence/i);
});

test('bridge bounds reviewed snapshot to 100 selections and 64 KiB and flags lossy HTML conversion', () => {
  const x = boot();
  assert.throws(() => x.w.greenchemistry_ai.debug().buildSnapshot({ kind: 'experiment', externalId: '1', title: 'x', selection: Array.from({ length: 101 }, (_, i) => ({ sectionId: String(i), originalContent: 'x', normalizedText: 'x' })) }), /100/);
  assert.throws(() => x.w.greenchemistry_ai.debug().buildSnapshot({ kind: 'experiment', externalId: '1', title: 'x', selection: [{ sectionId: '1', originalContent: 'x', normalizedText: 'a'.repeat(65536) }] }), /64 KiB/);
  const normalized = x.w.greenchemistry_ai.debug().normalizeHtml('<p>H<sub>2</sub>O</p><img src=x><table><tr><td>A</td><td>B</td></tr></table>');
  assert.equal(normalized.text, 'H₂O\nA\tB'); assert.ok(normalized.warnings.length);
});

test('bridge sends a scisure.gcai.received acknowledgement to the popup after a valid terminal result, with the recommendation count, but never after a rejected one', async () => {
  const x = boot({ config: { gcaiBridge: { enabled: true } }, api: (r) => r.onSuccess(null, 200, { user: { email: 'a@test' } }) });
  await openReviewedExperiment(x); findButton(x.w, 'Connect reviewed source to GCai').click(); await tick();
  const nonce = bootstrap(x); findButton(x.w, 'Send reviewed source').click();
  const valid = { version: 1, type: 'gcai.scisure.result', nonce, bridgeSessionId: 'session-1', snapshot: { externalId: '7', externalVersionId: null, selectionIds: ['55'] }, sourceHash: 'a'.repeat(64), runId: 'run-1', revisionNumber: null, recommendations: [{ recommendationId: 'r-1', sourceStepId: null, originalChemical: 'DMF', alternativeChemical: 'Ethyl acetate', kind: 'chemical-substitution', decision: 'accepted', confidence: 'medium', caveats: 'Confirm suitability', requiresScientistReview: true }, { recommendationId: 'r-2', sourceStepId: null, originalChemical: 'DCM', alternativeChemical: 'Acetone', kind: 'chemical-substitution', decision: 'rejected', confidence: 'high', caveats: 'Keep current', requiresScientistReview: true }] };
  const before = x.opened[0].popup.sent.length;
  receive(x, valid);
  const acks = x.opened[0].popup.sent.slice(before).filter((entry) => entry.message && entry.message.type === 'scisure.gcai.received');
  assert.equal(acks.length, 1, 'one ack was sent');
  assert.equal(acks[0].origin, 'https://greenchemistry.ai');
  assert.equal(acks[0].message.nonce, nonce);
  assert.equal(acks[0].message.bridgeSessionId, 'session-1');
  assert.equal(acks[0].message.count, 2);
  findButton(x.w, 'Close').click();
  const y = boot({ config: { gcaiBridge: { enabled: true } }, api: (r) => r.onSuccess(null, 200, { user: { email: 'a@test' } }) });
  await openReviewedExperiment(y); findButton(y.w, 'Connect reviewed source to GCai').click(); await tick();
  bootstrap(y); findButton(y.w, 'Send reviewed source').click();
  const before2 = y.opened[0].popup.sent.length;
  receive(y, { version: 1, type: 'gcai.scisure.result', nonce: 'a'.repeat(64), bridgeSessionId: 'session-bad', snapshot: { externalId: '7', externalVersionId: null, selectionIds: ['55'] }, recommendations: [{ recommendationId: 'bad', alternativeChemical: '<img src=x>', kind: 'chemical-substitution', decision: 'accepted', requiresScientistReview: true }] });
  const acks2 = y.opened[0].popup.sent.slice(before2).filter((entry) => entry.message && entry.message.type === 'scisure.gcai.received');
  assert.equal(acks2.length, 0, 'no ack for a rejected result');
  findButton(y.w, 'Close').click();
});
