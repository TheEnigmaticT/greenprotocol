/* SciSure sandbox add-on: reviewed clipboard and proposed GCai bridge. */
var greenchemistry_ai = (function () {
  'use strict';
  var DEFAULT_ORIGIN = 'https://greenchemistry.ai';
  var ORDER_LOCK_KEY = 'greenchemistry-ai.scisure.pending-order.v1';
  var state = { config: {}, supplyLocked: false, uncertainOrder: null, activeModal: null, bridge: null };

  function element(tag, text) {
    var node = document.createElement(tag);
    if (tag === 'button') node.style.cssText = 'padding:8px 12px;margin:8px 8px 8px 0;border:1px solid #a6b9ac;border-radius:5px;background:#edf4ef;color:#183923;cursor:pointer';
    if (tag === 'input' || tag === 'select' || tag === 'textarea') node.style.cssText = 'padding:8px;margin:6px 8px 6px 0;max-width:100%;border:1px solid #a6b9ac;border-radius:4px;color:#16251c;background:#fff';
    if (tag === 'pre') node.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;padding:12px;background:#f3f6f4;color:#16251c;max-height:240px;overflow:auto';
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(label, handler) { var node = element('button', label); node.type = 'button'; node.addEventListener('click', handler); return node; }
  function positiveInt(value) { return Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= 2147483647; }
  function status(parent, message, error) { var node = element('p', message); node.setAttribute('role', error ? 'alert' : 'status'); parent.append(node); return node; }
  function fixedOrigin(value) {
    var parsed; try { parsed = new URL(value || DEFAULT_ORIGIN); } catch (_) { throw new Error('gcaiBaseUrl must be a fixed HTTPS origin.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('gcaiBaseUrl must be a fixed HTTPS origin.');
    return parsed.origin;
  }
  function bridgePath(value) {
    var path = value || '/integrations/scisure/connect';
    if (typeof path !== 'string' || !/^\/[A-Za-z0-9._~\/-]*$/.test(path) || path.indexOf('//') === 0) throw new Error('gcaiBridge.path must be a relative HTTPS-origin path.');
    return path;
  }
  function addSdkButton(options) { return window.eLabSDK && window.eLabSDK.GUI && window.eLabSDK.GUI.Button ? new window.eLabSDK.GUI.Button(options) : options; }
  function apiCall(request) {
    return new Promise(function (resolve, reject) {
      if (!window.eLabSDK || !window.eLabSDK.API || typeof window.eLabSDK.API.call !== 'function') { reject(new Error('SciSure SDK API is unavailable.')); return; }
      request.onSuccess = function (_xhr, _status, response) { resolve(response); };
      request.onError = function (_xhr, code, response) { reject(new Error(typeof response === 'string' ? response : ('SDK request failed (' + code + ')'))); };
      try { window.eLabSDK.API.call(request); } catch (error) { reject(error); }
    });
  }
  function openModal(title) {
    if (state.activeModal) state.activeModal.cleanup();
    var prior = document.activeElement, overlay = element('div'), dialog = element('section'), heading = element('h2', title), id = 'gcai-title-' + Date.now();
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:20px';
    dialog.style.cssText = 'width:760px;max-width:100%;max-height:85vh;overflow:auto;background:#fff;color:#16251c;padding:24px;border-radius:8px;box-shadow:0 12px 50px #0005;text-align:left;font:14px/1.5 system-ui,sans-serif';
    heading.id = id; dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', id);
    var close = button('Close', cleanup); dialog.append(heading, close); overlay.append(dialog); document.body.append(overlay);
    function keydown(event) {
      if (event.key === 'Escape') { event.preventDefault(); cleanup(); return; }
      if (event.key === 'Tab') { var nodes = Array.from(dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')); var first = nodes[0], last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    }
    function cleanup() { if (state.bridge && state.bridge.modal && state.bridge.modal.dialog === dialog) cleanupBridge(); document.removeEventListener('keydown', keydown); overlay.remove(); if (state.activeModal && state.activeModal.dialog === dialog) state.activeModal = null; if (prior && typeof prior.focus === 'function') prior.focus(); }
    document.addEventListener('keydown', keydown); close.focus(); state.activeModal = { dialog: dialog, close: close, cleanup: cleanup }; return state.activeModal;
  }
  function copyText(text) { if (!text) return Promise.reject(new Error('Nothing selected to copy.')); if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') return Promise.reject(new Error('Clipboard access is unavailable. Select and copy the reviewed text manually.')); return navigator.clipboard.writeText(text); }

  var subMap = { '0':'₀','1':'₁','2':'₂','3':'₃','4':'₄','5':'₅','6':'₆','7':'₇','8':'₈','9':'₉','+':'₊','-':'₋','=':'₌','(':'₍',')':'₎' };
  var supMap = { '0':'⁰','1':'¹','2':'²','3':'³','4':'⁴','5':'⁵','6':'⁶','7':'⁷','8':'⁸','9':'⁹','+':'⁺','-':'⁻','=':'⁼','(':'⁽',')':'⁾' };
  function mapped(value, map) { return value.replace(/[0-9+\-=()]/g, function (c) { return map[c] || c; }); }
  function normalizeHtml(value) {
    if (typeof value !== 'string') return { text: '', warnings: ['Missing text content.'] };
    var parsed = new DOMParser().parseFromString(value, 'text/html'), warnings = [];
    if (/<(?:script|style|iframe|object|embed|svg|math|img|video|audio|canvas)\b/i.test(value)) warnings.push('Active or non-text markup was removed from the reviewed text.');
    if (/<\/(?:b|strong|i|em|span|font|a)\b|<(?:b|strong|i|em|span|font|a)\b/i.test(value)) warnings.push('Rich formatting or links were converted to text.');
    function walk(node) {
      if (node.nodeType === 3) return node.nodeValue;
      if (node.nodeType !== 1) return '';
      var tag = node.tagName.toLowerCase(); if (/^(script|style|iframe|object|embed|svg|math|img|video|audio|canvas)$/.test(tag)) return '';
      if (tag === 'br') return '\n';
      var text = Array.from(node.childNodes).map(walk).join('');
      if (tag === 'sub') return mapped(text, subMap); if (tag === 'sup') return mapped(text, supMap);
      if (tag === 'td' || tag === 'th') return text + '\t'; if (tag === 'tr') return text.replace(/\t$/, '') + '\n';
      if (/^(p|div|li|h[1-6]|section|article|blockquote)$/.test(tag)) return '\n' + text + '\n';
      return text;
    }
    var text = walk(parsed.body).replace(/\r\n?/g, '\n').replace(/[ \f\v]+\n/g, '\n').replace(/\n[ \f\v]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    return { text: text, warnings: warnings };
  }
  function plainText(value) { return normalizeHtml(value).text; }
  function freeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.keys(value).forEach(function (k) { freeze(value[k]); }); Object.freeze(value); } return value; }
  function bytes(value) { var text = JSON.stringify(value); if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length; return unescape(encodeURIComponent(text)).length; }
  function buildSnapshot(raw) {
    if (!raw || !/^(experiment|protocol|protocol-step)$/.test(raw.kind) || !raw.externalId || !Array.isArray(raw.selection) || !raw.selection.length) throw new Error('A reviewed source with at least one selection is required.');
    if (raw.selection.length > 100) throw new Error('A reviewed source may contain at most 100 selected sections or steps.');
    var selections = raw.selection.map(function (item, index) {
      if (!item || typeof item.originalContent !== 'string' || typeof item.normalizedText !== 'string') throw new Error('Selected source text is missing.');
      return { sectionId: item.sectionId ? String(item.sectionId) : undefined, stepId: item.stepId ? String(item.stepId) : undefined, order: Number.isFinite(item.order) ? item.order : index + 1, title: typeof item.title === 'string' ? item.title : '', originalContent: item.originalContent, normalizedText: item.normalizedText, warnings: Array.isArray(item.warnings) ? item.warnings.slice() : [] };
    });
    var snapshot = { version: 1, kind: raw.kind, externalId: String(raw.externalId), externalVersionId: raw.externalVersionId === undefined || raw.externalVersionId === null ? undefined : String(raw.externalVersionId), title: String(raw.title || 'Untitled source'), retrievedAt: new Date().toISOString(), selection: selections, importWarnings: [].concat.apply([], selections.map(function (s) { return s.warnings; })) };
    snapshot.protocolText = selections.map(function (s) { return '## ' + (s.title || 'Untitled selection') + '\n' + s.normalizedText; }).join('\n\n');
    if (bytes(snapshot) > 65536) throw new Error('Reviewed source exceeds the 64 KiB bridge payload limit.');
    return freeze(snapshot);
  }
  function snapshotCopy(snapshot) { return (snapshot.kind === 'experiment' ? 'Experiment' : 'Protocol') + ': ' + snapshot.title + ' (ID ' + snapshot.externalId + (snapshot.externalVersionId ? ', version ' + snapshot.externalVersionId : '') + ')\n\n' + snapshot.protocolText; }

  function nonce() { var values = new Uint8Array(32); if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') throw new Error('Secure Web Crypto nonce generation is unavailable.'); window.crypto.getRandomValues(values); return Array.from(values).map(function (v) { return v.toString(16).padStart(2, '0'); }).join(''); }
  function validEmail(value) { return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
  function sourceIdentity(snapshot) { return { externalId: snapshot.externalId, externalVersionId: snapshot.externalVersionId || null, selectionIds: snapshot.selection.map(function (s) { return s.sectionId || s.stepId || ('#' + s.order); }) }; }
  function exactSource(got, snapshot) { var expected = sourceIdentity(snapshot); return got && typeof got === 'object' && got.externalId === expected.externalId && (got.externalVersionId || null) === expected.externalVersionId && Array.isArray(got.selectionIds) && got.selectionIds.length === expected.selectionIds.length && got.selectionIds.every(function (id, i) { return id === expected.selectionIds[i]; }); }
  function validRecommendation(item, snapshot) {
    if (!item || typeof item !== 'object' || typeof item.recommendationId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(item.recommendationId) || typeof item.alternativeChemical !== 'string' || !item.alternativeChemical.trim() || item.alternativeChemical.length > 512 || /[<>\u0000]/.test(item.alternativeChemical) || ['chemical-substitution','process-change','warning'].indexOf(item.kind) === -1 || ['accepted','rejected','unreviewed'].indexOf(item.decision) === -1 || item.requiresScientistReview !== true) return false;
    if (item.sourceStepId !== null && item.sourceStepId !== undefined && !snapshot.selection.some(function (s) { return s.stepId === String(item.sourceStepId); })) return false;
    return true;
  }
  function cleanupBridge(message, error) { var bridge = state.bridge; if (!bridge) return; clearTimeout(bridge.deadlineTimer); clearInterval(bridge.closeTimer); window.removeEventListener('message', bridge.listener); if (message && bridge.modal && bridge.modal.dialog.isConnected) status(bridge.modal.dialog, message, error); state.bridge = null; }
  function showResults(bridge, recommendations) {
    var holder = element('section'); holder.append(element('h3', 'GCai returned recommendations — review required'));
    recommendations.forEach(function (rec) {
      var row = element('div'); row.style.cssText = 'border-top:1px solid #ccd8cf;padding:8px 0';
      row.append(element('p', rec.alternativeChemical));
      row.append(element('p', 'Untrusted returned text. ' + (typeof rec.caveats === 'string' ? rec.caveats : 'Scientist review is required.')));
      if (rec.kind === 'chemical-substitution' && rec.decision === 'accepted' && rec.requiresScientistReview === true) row.append(button('Prefill Supplies chemical', function () { openSupplyOrder({ chemical: rec.alternativeChemical, provenance: 'GCai recommendation ' + rec.recommendationId + ' for source ' + bridge.snapshot.externalId }); }));
      holder.append(row);
    });
    bridge.modal.dialog.append(holder);
  }
  function startBridge(snapshot) {
    var config = state.config.gcaiBridge;
    if (config.enabled !== true) { var disabled = openModal('GCai connection unavailable'); status(disabled.dialog, 'Secure GCai connection is disabled. Use reviewed clipboard handoff instead; no identity lookup or popup was started.', true); return; }
    var popup = window.open(config.origin + config.path, '_blank', 'popup=yes,width=980,height=800');
    if (!popup) { var blocked = openModal('GCai connection unavailable'); status(blocked.dialog, 'The connection popup was blocked. Allow popups and try again, or use reviewed clipboard handoff.', true); return; }
    var modal = openModal('Review GCai admission');
    modal.dialog.append(element('p', 'This proposed bridge sends only the reviewed selection after you approve it. Source text is retained for up to 90 days by GreenChemistry.ai. No files are uploaded.'));
    var email = element('input'); email.type = 'email'; email.setAttribute('aria-label', 'Email delivery address'); email.placeholder = 'Optional email address';
    var delivery = element('input'); delivery.type = 'checkbox'; delivery.setAttribute('aria-label', 'Email delivery consent');
    var marketing = element('input'); marketing.type = 'checkbox'; marketing.setAttribute('aria-label', 'Marketing consent');
    var emailLabel = element('label'); emailLabel.append(delivery, document.createTextNode(' Email me my analysis and a reminder before it expires'), email);
    var marketingLabel = element('label'); marketingLabel.append(marketing, document.createTextNode(' Send me GreenChemistry.ai tips and product updates (optional)'));
    modal.dialog.append(emailLabel, element('br'), marketingLabel, element('p', 'A signed-in GreenChemistry.ai account is required for this connection. Guest admission is unavailable until a verified server-side gate is configured.'));
    var connectState = { popup: popup, modal: modal, snapshot: snapshot, nonce: nonce(), helloSent: false, ready: false, sent: false, deadlineTimer: null, closeTimer: null, listener: null, userClaim: {} };
    state.bridge = connectState;
    modal.close.addEventListener('click', function () { if (state.bridge === connectState) cleanupBridge(); });
    function reject(message) { status(modal.dialog, 'GCai message rejected: ' + message, true); }
    connectState.listener = function (event) {
      var data = event.data;
      if (!state.bridge || state.bridge !== connectState || event.origin !== config.origin || event.source !== popup || !data || data.version !== 1 || typeof data.type !== 'string') { reject('origin, window, or version did not match.'); return; }
      if (data.type === 'gcai.scisure.loaded') { if (connectState.ready || connectState.sent || Object.keys(data).length !== 2) { reject('loaded replay or unsupported public bootstrap fields.'); return; } connectState.helloSent = true; popup.postMessage({ version: 1, type: 'scisure.gcai.hello', nonce: connectState.nonce }, config.origin); status(modal.dialog, 'GCai bridge acknowledged loading. Waiting for its nonce-bound ready message.'); return; }
      if (data.nonce !== connectState.nonce) { reject('nonce did not match.'); return; }
      if (data.type === 'gcai.scisure.login-required') { if (connectState.ready || typeof data.loginUrl !== 'string' || !/^\/login\?next=%2Fintegrations%2Fscisure%2Fconnect$/.test(data.loginUrl)) { reject('invalid login return request.'); return; } status(modal.dialog, 'Sign in is required in the GCai popup. After sign-in, the connection will repeat its nonce-bound handshake.'); try { popup.location.href = config.origin + data.loginUrl; } catch (_) {} return; }
      if (data.type === 'gcai.scisure.failure') { if (!connectState.ready || data.bridgeSessionId !== connectState.bridgeSessionId || typeof data.reason !== 'string' || data.reason.length > 512) { reject('invalid terminal failure.'); return; } cleanupBridge('GCai did not return a completed reviewed result: ' + data.reason, true); return; }
      if (data.type === 'gcai.scisure.ready') { if (!connectState.helloSent || connectState.ready || !/^[A-Za-z0-9._:-]{1,160}$/.test(data.bridgeSessionId || '')) { reject('ready before hello, replay, or invalid session.'); return; } connectState.ready = true; connectState.bridgeSessionId = data.bridgeSessionId; status(modal.dialog, 'GCai bridge is ready. Review consent and send the immutable source snapshot.'); return; }
      if (data.type === 'gcai.scisure.result') {
        if (!connectState.ready || !connectState.sent) { reject('result arrived before a nonce-bound reviewed source admission.'); return; }
        if (data.status !== undefined) { reject('result was not terminal; waiting for the completed reviewed result.'); return; }
        if (typeof data.sourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(data.sourceHash) || typeof data.runId !== 'string' || !/^[A-Za-z0-9._:-]{1,160}$/.test(data.runId) || (data.revisionNumber !== null && (!Number.isSafeInteger(data.revisionNumber) || data.revisionNumber < 0)) || data.bridgeSessionId !== connectState.bridgeSessionId || !exactSource(data.snapshot, snapshot) || !Array.isArray(data.recommendations) || data.recommendations.some(function (r) { return !validRecommendation(r, snapshot); })) { reject('result failed strict schema, provenance, session, or source validation.'); cleanupBridge(); return; }
        showResults(connectState, data.recommendations); cleanupBridge(); return;
      }
      reject('unsupported message type.');
    };
    window.addEventListener('message', connectState.listener);
    connectState.deadlineTimer = setTimeout(function () { cleanupBridge('GCai connection timed out. No retry was sent; reopen only after reviewing the source again.', true); }, config.deadlineMs);
    connectState.closeTimer = setInterval(function () { if (popup.closed) cleanupBridge(connectState.sent ? 'GCai connection popup was closed after the reviewed source was submitted.' : 'GCai connection popup was closed. No source was submitted.', true); }, 500);
    apiCall({ method: 'GET', path: 'auth/user' }).then(function (response) { var user = response && response.user; if (user && typeof user.email === 'string') email.value = user.email; if (user && (typeof user.userID === 'string' || positiveInt(user.userID))) connectState.userClaim = { userID: String(user.userID) }; }).catch(function (error) { status(modal.dialog, 'Could not retrieve the current SciSure user: ' + error.message + '. You may continue without email delivery.', true); });
    modal.dialog.append(button('Send reviewed source', function () {
      if (!state.bridge || state.bridge !== connectState || !connectState.ready || connectState.sent) { status(modal.dialog, 'GCai is not ready or this reviewed source was already sent. Reopen to start a new admission.', true); return; }
      var deliveryConsent = delivery.checked === true, marketingConsent = marketing.checked === true, emailAddress = email.value.trim(), hasEmailPurpose = deliveryConsent || marketingConsent;
      if (hasEmailPurpose && !validEmail(emailAddress)) { status(modal.dialog, 'Enter a valid email address for the selected email purpose.', true); return; }
      var payload = { version: 1, type: 'scisure.gcai.admission', nonce: connectState.nonce, bridgeSessionId: connectState.bridgeSessionId, requestId: connectState.nonce, source: snapshot, email: { address: hasEmailPurpose ? emailAddress : undefined, deliveryConsent: deliveryConsent, marketingConsent: marketingConsent }, userClaim: connectState.userClaim };
      connectState.sent = true; popup.postMessage(payload, config.origin); status(modal.dialog, 'Reviewed source sent to the proposed GCai bridge. Wait for a validated result or close this dialog.');
    }));
  }

  function sectionText(section) { var d = section && section.data ? section.data : section; if (!d || ['TEXT','PARAGRAPH','PROCEDURE'].indexOf(String(d.sectionType || '').toUpperCase()) === -1) return null; var original = typeof d.text === 'string' ? d.text : (typeof d.contents === 'string' ? d.contents : null); if (!original) return null; var normalized = normalizeHtml(original); return { sectionId: d.expJournalID || d.sectionID || d.id, order: Number(d.order || d.position || 0), title: d.sectionHeader || d.header || 'Untitled text section', originalContent: original, normalizedText: normalized.text, warnings: normalized.warnings }; }
  function reviewControls(modal, rawSnapshot) {
    var snapshot; try { snapshot = buildSnapshot(rawSnapshot); } catch (error) { status(modal.dialog, error.message, true); return; }
    modal.dialog.append(button('Copy reviewed text', function () { copyText(snapshotCopy(snapshot)).then(function () { status(modal.dialog, 'Copied reviewed text. Paste it manually into GreenChemistry.ai.'); }).catch(function (e) { status(modal.dialog, e.message, true); }); }));
    modal.dialog.append(button('Copy and open GCai', function () { openGCaiAfterCopy(snapshotCopy(snapshot)).then(function () { status(modal.dialog, 'Copied and opened GreenChemistry.ai. Paste the reviewed text manually.'); }).catch(function (e) { status(modal.dialog, e.message, true); }); }));
    modal.dialog.append(button('Connect reviewed source to GCai', function () { startBridge(snapshot); }));
  }
  function experimentHandoff(page) {
    var modal = openModal('Review experiment text'), experiment = page.getExperimentData(), title = experiment && experiment.headerinfo && typeof experiment.headerinfo.experimentName === 'string' ? experiment.headerinfo.experimentName : 'Unnamed experiment', id = typeof page.getExperimentID === 'function' ? page.getExperimentID() : null, raw = experiment && Array.isArray(experiment.data) ? experiment.data : [], sections = raw.map(sectionText).filter(Boolean), choices = [];
    modal.dialog.append(element('p', 'Read-only review. Select source text before copying or using the disabled-by-default proposed connection. Variables are not resolved.'));
    function render(list) {
      list.forEach(function (section) { var label = element('label'), check = element('input'); check.type = 'checkbox'; label.append(check, document.createTextNode(' ' + section.title)); modal.dialog.append(label, element('pre', section.normalizedText)); if (section.warnings.length) status(modal.dialog, section.warnings.join(' ')); choices.push({ check: check, section: section }); });
      function currentSnapshot() { return buildSnapshot({ kind: 'experiment', externalId: id || 'unknown', title: title, selection: choices.filter(function (c) { return c.check.checked; }).map(function (c) { return c.section; }) }); }
      modal.dialog.append(button('Copy reviewed text', function () { var snap; try { snap = currentSnapshot(); } catch (e) { status(modal.dialog, e.message, true); return; } copyText(snapshotCopy(snap)).then(function () { status(modal.dialog, 'Copied reviewed text. Paste it manually into GreenChemistry.ai.'); }).catch(function (e2) { status(modal.dialog, e2.message, true); }); }));
      modal.dialog.append(button('Copy and open GCai', function () { var snap; try { snap = currentSnapshot(); } catch (e) { status(modal.dialog, e.message, true); return; } openGCaiAfterCopy(snapshotCopy(snap)).then(function () { status(modal.dialog, 'Copied and opened GreenChemistry.ai. Paste the reviewed text manually.'); }).catch(function (e2) { status(modal.dialog, e2.message, true); }); }));
      modal.dialog.append(button('Connect reviewed source to GCai', function () { var snap; try { snap = currentSnapshot(); } catch (e) { status(modal.dialog, e.message, true); return; } startBridge(snap); }));
    }
    if (sections.length) { if (raw.length > sections.length) status(modal.dialog, (raw.length - sections.length) + ' non-text sections excluded.'); render(sections); }
    else if (positiveInt(id)) { status(modal.dialog, 'Loading supported section contents through the SciSure API. Files are excluded.'); apiCall({ method:'GET', path:'experiments/' + id + '/sections', params:{'$page':0,'$records':1000} }).then(function (response) { if (!response || !Array.isArray(response.data) || response.hasNextPage) throw new Error('Section list unavailable or too large. No partial experiment is copied.'); var supported = response.data.filter(function (s) { return ['TEXT','PARAGRAPH','PROCEDURE'].indexOf(s.sectionType) !== -1; }); if (supported.length > 100) throw new Error('More than 100 text sections; select a smaller experiment manually.'); return Promise.all(supported.map(function (s) { return apiCall({method:'GET',path:'experiments/sections/' + s.expJournalID + '/content'}).then(function (content) { var norm = normalizeHtml(content && content.contents); return {sectionId:s.expJournalID,order:Number(s.order || s.position || 0),title:s.sectionHeader || ('Text section ' + s.expJournalID),originalContent:content.contents,normalizedText:norm.text,warnings:norm.warnings}; }); })); }).then(render).catch(function (e) { status(modal.dialog, 'Could not load experiment: ' + e.message, true); }); }
    else status(modal.dialog, 'Current experiment ID unavailable. Review and paste procedure text manually.', true);
  }
  function protocolHandoff() {
    var modal = openModal('Fetch protocol for review'), input = element('input'), content = element('div'); input.type = 'text'; input.inputMode = 'numeric'; input.setAttribute('aria-label','Protocol ID'); modal.dialog.append(element('p','Enter a protocol ID manually. This add-on does not use an undocumented current-protocol ID getter.'), input, content);
    modal.dialog.append(button('Fetch protocol', function () { content.replaceChildren(); if (!/^\d+$/.test(input.value.trim()) || Number(input.value) < 1) { status(content,'Enter a positive numeric protocol ID.',true); return; } apiCall({method:'GET',path:'protocols/' + input.value.trim()}).then(function (protocol) { if (!protocol || typeof protocol.name !== 'string' || !Array.isArray(protocol.steps)) throw new Error('Protocol response is missing supported fields.'); var steps = protocol.steps.slice().sort(function (a,b) { return Number(a.order) - Number(b.order); }), select = element('select'), all = element('option','Whole protocol'), preview = element('textarea'); all.value='all'; select.setAttribute('aria-label','Protocol content to copy'); select.append(all); steps.forEach(function (step) { var opt=element('option',step.name || ('Step '+step.protStepID)); opt.value='step:'+step.protStepID; select.append(opt); }); preview.readOnly=true; preview.rows=12; preview.style.width='100%'; preview.setAttribute('aria-label','Reviewed protocol text'); content.append(element('p','Fetched protocol: '+protocol.name+' (ID '+protocol.protID+', version '+protocol.protVersionID+')'),select,preview);
      function selected() { return select.value === 'all' ? steps : steps.filter(function (step) { return 'step:' + step.protStepID === select.value; }); }
      function snapshot() { var pick=selected(); if (!pick.length || pick.some(function (s) { return typeof s.contents !== 'string'; })) throw new Error('The selected protocol content is unsupported.'); return buildSnapshot({kind:select.value==='all'?'protocol':'protocol-step',externalId:protocol.protID,externalVersionId:protocol.protVersionID,title:protocol.name,selection:pick.map(function (s) { var norm=normalizeHtml(s.contents); return {stepId:s.protStepID,order:Number(s.order),title:s.name || ('Step '+s.protStepID),originalContent:s.contents,normalizedText:norm.text,warnings:norm.warnings}; })}); }
      function refresh() { try { preview.value=snapshot().protocolText; } catch (_) { preview.value=''; } } select.addEventListener('change',refresh); refresh();
      [['Copy reviewed protocol',function (snap) { return copyText(snapshotCopy(snap)); }],['Copy and open GCai',function (snap) { return openGCaiAfterCopy(snapshotCopy(snap)); }],['Connect reviewed source to GCai',function (snap) { startBridge(snap); return Promise.resolve(); }]].forEach(function (item) { content.append(button(item[0],function () { var snap; try { snap=snapshot(); } catch(e) { status(content,e.message,true); return; } item[1](snap).then(function () { if (item[0] !== 'Connect reviewed source to GCai') status(content,'Copied reviewed protocol text.'); }).catch(function(e2) { status(content,e2.message,true); }); })); });
    }).catch(function(e) { status(content,'Could not fetch protocol: '+e.message,true); }); }));
  }
  function openGCaiAfterCopy(text) { return copyText(text).then(function () { window.open(state.config.gcaiBaseUrl + '/analyze?new=1','_blank','noopener,noreferrer'); }); }

  function loadOrderLock() { try { var raw = window.sessionStorage.getItem(ORDER_LOCK_KEY); if (!raw) return; var parsed = JSON.parse(raw); if (!parsed || parsed.version !== 1 || !positiveInt(parsed.sampleID) || !positiveInt(parsed.catalogItemID) || !positiveInt(parsed.amount)) throw new Error('bad'); state.supplyLocked=true; state.uncertainOrder=parsed; } catch (_) { state.supplyLocked=true; state.uncertainOrder={ persistenceError:true }; } }
  function persistOrderLock(lock) { try { window.sessionStorage.setItem(ORDER_LOCK_KEY, JSON.stringify(lock)); state.uncertainOrder=lock; state.supplyLocked=true; return true; } catch (_) { state.supplyLocked=true; state.uncertainOrder={ persistenceError:true }; return false; } }
  function clearOrderLock() { try { window.sessionStorage.removeItem(ORDER_LOCK_KEY); state.supplyLocked=false; state.uncertainOrder=null; return true; } catch (_) { state.supplyLocked=true; state.uncertainOrder={ persistenceError:true }; return false; } }
  function openSupplyOrder(prefill) {
    var modal=openModal('Create pending supplies order'); if (state.config.enableSuppliesOrders !== true) { status(modal.dialog,'Supply ordering is disabled. Set enableSuppliesOrders to the literal boolean true only after manual approval.',true); return Promise.resolve(); } if (state.supplyLocked) { status(modal.dialog,'Ordering is locked'+(state.uncertainOrder && state.uncertainOrder.orderID ? ' (created ID '+state.uncertainOrder.orderID+')' : '')+'. Reconcile Supplies manually before another attempt.',true); return Promise.resolve(); }
    modal.dialog.append(element('p',(prefill ? prefill.provenance + '. ' : '') + 'A scientist must confirm identity, grade, package, and suitability. GCai advice does not authorize purchasing.'));
    var chemical=element('input'),sample=element('input'),amount=element('input'),results=element('div'); chemical.placeholder='Recommendation chemical name'; chemical.setAttribute('aria-label','Recommendation chemical name'); chemical.value=prefill && prefill.chemical || ''; sample.placeholder='Sample ID'; sample.inputMode='numeric'; sample.setAttribute('aria-label','Sample ID'); amount.placeholder='Packages'; amount.inputMode='numeric'; amount.setAttribute('aria-label','Packages'); [['Replacement chemical (manual entry)',chemical],['Existing sample ID',sample],['Number of packages',amount]].forEach(function(pair){var label=element('label',pair[0]);label.style.cssText='display:inline-flex;flex-direction:column;margin-right:8px';label.append(pair[1]);modal.dialog.append(label);}); modal.dialog.append(results);
    function describe(item) { return (item.name || 'Unnamed item')+' — catalog item '+item.catalogItemID+'; product '+(item.catalogNumber || 'unavailable')+'; supplier '+(item.supplierID || 'unavailable')+'; package '+(item.amount===undefined?'unavailable':item.amount+' '+(item.quantityType || 'unit unspecified'))+'; price '+(item.price===undefined?'unavailable':item.price+' '+(item.currency || '')); }
    modal.dialog.append(button('Search catalog',function(){results.replaceChildren();var name=chemical.value.trim();if(!name){status(results,'Enter a recommendation chemical name.',true);return;}apiCall({method:'GET',path:'supplies/catalogitems',params:{name:name,'$page':0,'$records':1000}}).then(function(response){var items=response&&Array.isArray(response.data)?response.data:[];if(!items.length){status(results,'No catalog items found. Do not infer a substitute.',true);return;}items.forEach(function(item){var row=element('div');row.append(element('p',describe(item)),button('Select',function(){selectItem(item);}));results.append(row);});}).catch(function(e){status(results,'Catalog search failed: '+e.message,true);});}));
    function selectItem(item) { var submitted=false; results.replaceChildren();status(results,'Selected: '+describe(item)+'. Confirm product identity, concentration, grade, package size and suitability; GCai advice does not authorize purchasing.');results.append(button('Place pending order',function(){var sampleID=Number(sample.value),packages=Number(amount.value);if(!positiveInt(sampleID)||!positiveInt(packages)||!positiveInt(item.catalogItemID)){status(results,'Sample ID, catalog item, and packages must be positive integers.',true);return;}var confirm=button('Confirm order',function(){if(submitted||confirm.disabled||state.supplyLocked)return;submitted=true;var lock={version:1,state:'submitting',sampleID:sampleID,catalogItemID:Number(item.catalogItemID),amount:packages};if(!persistOrderLock(lock)){confirm.disabled=true;status(results,'Order was not sent because reconciliation lock persistence failed. Reconcile Supplies manually.',true);return;}confirm.disabled=true;placeOrder(lock,confirm,results);});results.append(element('p','Confirm pending order: catalog item '+item.catalogItemID+', sample '+sampleID+', packages '+packages+'.'),confirm);})); }
    return Promise.resolve();
  }
  function placeOrder(lock, confirm, results) { var body={catalogItemID:lock.catalogItemID,amount:lock.amount,status:'PENDING',notifyUser:false}; apiCall({method:'POST',path:'supplies/orders/'+lock.sampleID,body:body}).then(function(orderID){if(!positiveInt(orderID))throw new Error('Invalid order ID returned.');lock.orderID=Number(orderID);if(!persistOrderLock(lock))throw new Error('Reconciliation lock persistence failed after order creation.');function page(number){if(number>20)throw new Error('Order readback exceeded its page limit.');return apiCall({method:'GET',path:'supplies/orders',params:{sampleID:lock.sampleID,catalogItemID:lock.catalogItemID,'$page':number,'$records':1000}}).then(function(response){if(!response||!Array.isArray(response.data))throw new Error('Malformed order readback.');var found=response.data.find(function(record){return Number(record.shoppingItemID)===lock.orderID;});if(found)return found;if(response.hasNextPage===true)return page(number+1);throw new Error('Created order not found by exact shoppingItemID.');});}return page(0);}).then(function(record){if(Number(record.shoppingItemID)!==lock.orderID||Number(record.sampleID)!==lock.sampleID||Number(record.catalogItemID)!==lock.catalogItemID||Number(record.amount)!==lock.amount||record.status!=='PENDING')throw new Error('Order readback does not exactly match the requested pending order.');if(!clearOrderLock())throw new Error('Verified order, but lock clearance failed; reconcile Supplies manually.');status(results,'Order '+record.shoppingItemID+' verified by exact readback as PENDING.');}).catch(function(e){status(results,'Order state is uncertain'+(state.uncertainOrder&&state.uncertainOrder.orderID?' (created ID '+state.uncertainOrder.orderID+')':'')+': '+e.message+' Retained state is locked; do not retry automatically.',true);}); }
  function init(config) { var origin=fixedOrigin(config&&config.gcaiBaseUrl), bridge=config&&config.gcaiBridge||{}; state.config={gcaiBaseUrl:origin,enableSuppliesOrders:!!config&&config.enableSuppliesOrders===true,gcaiBridge:{enabled:bridge.enabled===true,origin:fixedOrigin(bridge.origin||origin),path:bridgePath(bridge.path),deadlineMs:positiveInt(bridge.deadlineMs)&&Number(bridge.deadlineMs)<=600000?Number(bridge.deadlineMs):300000}}; state.supplyLocked=false;state.uncertainOrder=null;loadOrderLock(); if(!window.eLabSDK||typeof window.eLabSDK.ready!=='function')return greenchemistry_ai;window.eLabSDK.ready(function(){if(window.eLabSDK.Page&&window.eLabSDK.Page.Experiment)new window.eLabSDK.Page.Experiment({onReady:function(){var page=this,review=addSdkButton({actionID:'greenchemistry-ai-experiment',label:'Review for GCai',icon:'fa-leaf',action:function(){experimentHandoff(page);}}),supplies=addSdkButton({actionID:'greenchemistry-ai-supplies-experiment',label:'GCai Supplies',icon:'fa-shopping-cart',action:openSupplyOrder});if(typeof page.addButtonToExperimentTopToolbar==='function'){page.addButtonToExperimentTopToolbar(review);page.addButtonToExperimentTopToolbar(supplies);}}});if(window.eLabSDK.Page&&window.eLabSDK.Page.Protocol)new window.eLabSDK.Page.Protocol({onReady:function(){var page=this,btn=addSdkButton({actionID:'greenchemistry-ai-protocol',label:'Review for GCai',icon:'fa-leaf',action:protocolHandoff}),supplies=addSdkButton({actionID:'greenchemistry-ai-supplies-protocol',label:'GCai Supplies',icon:'fa-shopping-cart',action:openSupplyOrder});if(typeof page.addButtonToProtocolTopToolBar==='function'){page.addButtonToProtocolTopToolBar(btn);page.addButtonToProtocolTopToolBar(supplies);}if(typeof page.addButtonToListView==='function')page.addButtonToListView(btn);}});});return greenchemistry_ai; }
  return {version:'0.3.0',init:init,openGCaiAfterCopy:openGCaiAfterCopy,openSupplyOrder:openSupplyOrder,debug:function(){return {bridge:state.bridge,normalizeHtml:normalizeHtml,buildSnapshot:buildSnapshot};}};
}());
