const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(path.join(__dirname, '..', 'add-on.js'), 'utf8');

function boot({ sdk = {}, config = {} } = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://sandbox.scisure.com/', runScripts: 'outside-only' });
  const { window } = dom;
  window.eLabSDK = sdk;
  let clipboard = '';
  window.navigator.clipboard = { writeText: async (text) => { clipboard = text; } };
  window.opened = [];
  window.open = (url, target, features) => { window.opened.push({ url, target, features }); return null; };
  window.eval(source);
  window.greenchemistry_ai.init(config);
  return { window, getClipboard: () => clipboard };
}

function button(label) {
  return [...this.querySelectorAll('button')].find((item) => item.textContent === label);
}

test('init exposes the required global without external runtime dependencies', () => {
  const { window } = boot();
  assert.equal(typeof window.greenchemistry_ai.init, 'function');
  assert.equal(window.greenchemistry_ai.version, '0.3.0');
});

test('experiment handoff only copies a user-selected text section and never opens GCai automatically', async () => {
  let toolbar;
  const { window, getClipboard } = boot({ sdk: {
    ready: (callback) => callback(),
    Page: { Experiment: function Experiment(opts) { this.getExperimentID = () => 7; this.getExperimentData = () => ({ headerinfo: { experimentName: 'Run 7' }, data: [{ header: 'Reaction', sectionType: 'TEXT', text: 'Use ethanol.' }, { header: 'Meta', sectionType: 'TABLE', rows: ['hidden'] }] }); opts.onReady.call(this); } },
    GUI: { Button: function Button(options) { if (options.actionID === 'greenchemistry-ai-experiment' || options.actionID === 'greenchemistry-ai-protocol') toolbar = options; return options; } }
  }});
  await toolbar.action();
  assert.match(window.document.body.textContent, /Reaction/);
  assert.doesNotMatch(window.document.body.textContent, /hidden/);
  const reviewed = window.document.querySelector('input[type="checkbox"]');
  reviewed.checked = true;
  button.call(window.document, 'Copy reviewed text').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(getClipboard(), /Experiment: Run 7/);
  assert.match(getClipboard(), /Use ethanol/);
  assert.equal(window.opened.length, 0);
});

test('opening GCai from experiment review is a separate explicit clipboard action', async () => {
  let toolbar;
  const { window, getClipboard } = boot({ sdk: {
    ready: (callback) => callback(),
    Page: { Experiment: function Experiment(opts) { this.getExperimentID = () => 8; this.getExperimentData = () => ({ headerinfo: { experimentName: 'Run 8' }, data: [{ header: 'Reaction', sectionType: 'TEXT', text: 'Reviewed text.' }] }); opts.onReady.call(this); } },
    GUI: { Button: function Button(options) { if (options.actionID === 'greenchemistry-ai-experiment' || options.actionID === 'greenchemistry-ai-protocol') toolbar = options; return options; } }
  }});
  await toolbar.action();
  window.document.querySelector('input[type="checkbox"]').checked = true;
  button.call(window.document, 'Copy and open GCai').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(getClipboard(), /Reviewed text/);
  assert.equal(window.opened[0].url, 'https://greenchemistry.ai/analyze?new=1');
});

test('protocol selection requires a manually entered numeric ID and fetches before copying a sorted step', async () => {
  let toolbar;
  const calls = [];
  const { window, getClipboard } = boot({ sdk: {
    ready: (callback) => callback(),
    Page: { Protocol: function Protocol(opts) { opts.onReady.call(this); } },
    GUI: { Button: function Button(options) { if (options.actionID === 'greenchemistry-ai-experiment' || options.actionID === 'greenchemistry-ai-protocol') toolbar = options; return options; } },
    API: { call: (request) => { calls.push(request); request.onSuccess(null, 200, { protID: 12, protVersionID: 4, name: 'Workup', steps: [{ protStepID: 2, name: 'Second', contents: 'Second body', order: 2 }, { protStepID: 1, name: 'First', contents: 'First body', order: 1 }] }); } }
  }});
  await toolbar.action();
  const input = window.document.querySelector('input');
  input.value = 'not-a-number';
  button.call(window.document, 'Fetch protocol').click();
  assert.match(window.document.body.textContent, /positive numeric/);
  input.value = '12';
  button.call(window.document, 'Fetch protocol').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls[0].path, 'protocols/12');
  assert.match(window.document.body.textContent, /Workup/);
  const select = window.document.querySelector('select');
  select.value = 'step:1';
  button.call(window.document, 'Copy reviewed protocol').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(getClipboard(), /First body/);
  assert.doesNotMatch(getClipboard(), /Second body/);
});

test('protocol review provides an explicit copy-and-open action', async () => {
  let toolbar;
  const { window } = boot({ sdk: {
    ready: (callback) => callback(),
    Page: { Protocol: function Protocol(opts) { opts.onReady.call(this); } },
    GUI: { Button: function Button(options) { if (options.actionID === 'greenchemistry-ai-experiment' || options.actionID === 'greenchemistry-ai-protocol') toolbar = options; return options; } },
    API: { call: (request) => request.onSuccess(null, 200, { protID: 5, protVersionID: 1, name: 'Protocol', steps: [{ protStepID: 1, name: 'Only', contents: 'Body', order: 1 }] }) }
  }});
  await toolbar.action();
  window.document.querySelector('input').value = '5';
  button.call(window.document, 'Fetch protocol').click();
  await new Promise((resolve) => setImmediate(resolve));
  button.call(window.document, 'Copy and open GCai').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(window.opened[0].url, 'https://greenchemistry.ai/analyze?new=1');
});

test('GCai handoff opens only the configured fixed HTTPS origin after clipboard copy', async () => {
  const { window, getClipboard } = boot({ config: { gcaiBaseUrl: 'https://greenchemistry.ai' } });
  window.greenchemistry_ai.openGCaiAfterCopy('Reviewed text');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(getClipboard(), 'Reviewed text');
  assert.equal(window.opened[0].url, 'https://greenchemistry.ai/analyze?new=1');
  assert.throws(() => window.greenchemistry_ai.init({ gcaiBaseUrl: 'https://greenchemistry.ai/path?x=1' }), /fixed HTTPS origin/);
});

test('supply ordering remains disabled unless configured and requires confirmation, post, and exact readback', async () => {
  const calls = [];
  const { window } = boot({ config: { enableSuppliesOrders: true }, sdk: {
    API: { call: (request) => {
      calls.push(request);
      if (request.method === 'GET' && request.path === 'supplies/catalogitems') request.onSuccess(null, 200, { data: [{ catalogItemID: 9, name: 'Ethanol', amount: 500, quantityType: 'mL' }] });
      else if (request.method === 'POST') request.onSuccess(null, 201, 44);
      else if (request.method === 'GET' && request.path === 'supplies/orders') request.onSuccess(null, 200, { data: [{ shoppingItemID: 44, sampleID: 3, catalogItemID: 9, amount: 2, status: 'PENDING' }], hasNextPage: false });
    } }
  }});
  await window.greenchemistry_ai.openSupplyOrder();
  const inputs = window.document.querySelectorAll('input');
  inputs[0].value = 'Ethanol';
  inputs[1].value = '3';
  inputs[2].value = '2';
  button.call(window.document, 'Search catalog').click();
  await new Promise((resolve) => setImmediate(resolve));
  button.call(window.document, 'Select').click();
  button.call(window.document, 'Place pending order').click();
  assert.match(window.document.body.textContent, /Confirm pending order/);
  button.call(window.document, 'Confirm order').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.filter((call) => call.method === 'POST').length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls.find((call) => call.method === 'POST').body)), { catalogItemID: 9, amount: 2, status: 'PENDING', notifyUser: false });
  assert.match(window.document.body.textContent, /verified/);
});

test('an uncertain supply POST is locked, retained, and never retried automatically', async () => {
  let postCalls = 0;
  const { window } = boot({ config: { enableSuppliesOrders: true }, sdk: { API: { call: (request) => {
    if (request.method === 'GET' && request.path === 'supplies/catalogitems') request.onSuccess(null, 200, { data: [{ catalogItemID: 9, name: 'Ethanol' }] });
    else if (request.method === 'POST') { postCalls += 1; request.onError(null, 0, 'network uncertain'); }
  } } } });
  await window.greenchemistry_ai.openSupplyOrder();
  const inputs = window.document.querySelectorAll('input'); inputs[0].value = 'Ethanol'; inputs[1].value = '3'; inputs[2].value = '1';
  button.call(window.document, 'Search catalog').click();
  await new Promise((resolve) => setImmediate(resolve));
  button.call(window.document, 'Select').click(); button.call(window.document, 'Place pending order').click(); button.call(window.document, 'Confirm order').click();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(postCalls, 1);
  assert.match(window.document.body.textContent, /uncertain/);
  assert.equal(button.call(window.document, 'Confirm order').disabled, true);
});
