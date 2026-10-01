# SciSure → GreenChemistry.ai JavaScript add-on

Version **0.2.0** — sandbox candidate. The original `Downloads/add-on.js` template remains unchanged. This package is frontend-only: it does **not** deploy or assume a GCai receiver, authentication credential, SciSure tenant authorization, or live endpoint.

## What works locally

- **Reviewed source selection:** experiment text/procedure sections, whole protocols, or one protocol step. The immutable snapshot preserves source kind, experiment/protocol ID, protocol version and section/step IDs when the SDK response supplies them. It stores both original inert content and normalized review text.
- **Chemistry-preserving review text:** cell boundaries become tabs, rows/blocks become lines, `sub`/`sup` digits become Unicode subscripts/superscripts, and existing chemistry Unicode (for example `µ`, `μ`, `°`, charges) remains text. Active/non-text markup is removed in an inert document. Formatting/active-content loss is flagged. Files and uploads are not accepted.
- **Bounds:** a reviewed bridge snapshot is limited to 100 selections and 64 KiB serialized UTF-8 JSON. Oversized/partial content fails closed.
- **Clipboard fallback:** `Copy reviewed text` and `Copy and open GCai` remain available. They do not submit chemistry automatically.
- **Proposed bridge, disabled by default:** `Connect reviewed source to GCai` opens a top-level popup synchronously, performs a nonce bootstrap only after a validated public popup-loaded message, then looks up the current SciSure user through SDK `GET auth/user`. It pre-fills an editable optional delivery address, leaves delivery and marketing consent independently unchecked, shows the 90-day retention notice, and offers the free-signup/10-generations CTA. The SciSure email is never sent without delivery or marketing purpose consent and is never placed in `userClaim`.
- **Results/Supplies:** only a strict, source/session-bound recommendation projection is shown. Returned values are rendered as text, never HTML. An eligible accepted chemical-substitution can only prefill the existing Supplies chemical field with provenance; the scientist still validates catalog identity/package/suitability and separately confirms a `PENDING` order.
- **Supplies safety:** ordering remains a literal `enableSuppliesOrders: true` opt-in. Before any POST, the add-on writes a credential-free reconciliation lock to `sessionStorage`; if persistence fails, it does not POST. Uncertain POST/readback states remain locked across reloads in that browser session and are never automatically retried.

## Configuration

Start with `config.example.json` exactly as shown. `gcaiBridge.enabled` must remain `false` until the proposed GCai receiver is implemented and approved.

```json
{
  "gcaiBaseUrl": "https://greenchemistry.ai",
  "enableSuppliesOrders": false,
  "gcaiBridge": {
    "enabled": false,
    "origin": "https://greenchemistry.ai",
    "path": "/integrations/scisure/connect",
    "deadlineMs": 300000
  }
}
```

`gcaiBaseUrl` and `gcaiBridge.origin` must be HTTPS origins without paths, credentials, query, or fragments. The bridge path must be a relative path. No GCai credential is placed in config, storage, URLs, messages, or logs.

## Proposed bridge contract — not a deployed API

The add-on implements a browser transport candidate only. The receiver and server endpoints below are a **versioned proposed contract**, not current GreenChemistry.ai functionality.

### Transport lifecycle

1. The scientist reviews selections and clicks **Connect reviewed source to GCai**.
2. The add-on opens `https://greenchemistry.ai/integrations/scisure/connect` synchronously from that click, retaining the opener only for this transport. A blocked popup is an explicit error; no fallback submission occurs.
3. The add-on generates a 256-bit Web Crypto nonce, registers one message listener, polls popup closure, and imposes the configured deadline (default five minutes).
4. GCai first sends this bounded public loaded message. It contains no source, identity, nonce, or session data:

```json
{
  "version": 1,
  "type": "gcai.scisure.loaded"
}
```

The add-on requires the exact configured origin and exact popup `WindowProxy`, then replies only to that window and origin with:

```json
{
  "version": 1,
  "type": "scisure.gcai.hello",
  "nonce": "hex-256-bit-nonce"
}
```

5. GCai may then send this nonce-bound ready message:

```json
{
  "version": 1,
  "type": "gcai.scisure.ready",
  "nonce": "hex-256-bit-nonce",
  "bridgeSessionId": "opaque-single-use-session"
}
```

The add-on requires the exact configured origin, the exact popup `WindowProxy`, `version: 1`, its nonce, and a syntactically bounded session ID. Ready before hello or a duplicate ready message is rejected.

6. After ready and explicit scientist action, the add-on sends:

```json
{
  "version": 1,
  "type": "scisure.gcai.admission",
  "nonce": "hex-256-bit-nonce",
  "bridgeSessionId": "opaque-single-use-session",
  "source": {
    "version": 1,
    "kind": "experiment | protocol | protocol-step",
    "externalId": "declared SciSure source ID",
    "externalVersionId": "when available",
    "title": "reviewed title",
    "retrievedAt": "ISO-8601",
    "selection": [{
      "sectionId": "when available",
      "stepId": "when available",
      "order": 1,
      "title": "reviewed selection title",
      "originalContent": "inert source string",
      "normalizedText": "reviewed plain text",
      "warnings": ["conversion warning"]
    }],
    "protocolText": "derived reviewed text",
    "importWarnings": []
  },
  "email": {
    "address": "present only when delivery or marketing is opted in",
    "deliveryConsent": false,
    "marketingConsent": false
  },
  "userClaim": {
    "userID": "optional SciSure-reported numeric identifier"
  }
}
```

The `auth/user` email is used only to prefill the editable field. It is sent only when the scientist selects delivery or marketing purpose consent and provides a valid email format; it is not placed in `userClaim`. Neither a browser-reported email nor user ID is signed identity, mailbox proof, account matching authority, tenant entitlement, or marketing consent. The prospective receiver must authenticate its own GCai principal, bind `bridgeSessionId` server-side to an approved connection/install/actor scope, persist an immutable snapshot, recompute a canonical hash, apply quota/retention policy, and expose no reusable provider credential to JavaScript.

7. A proposed result is accepted only after an admission has been sent, and only if exact origin/window/version/nonce/session and source identity all match:

```json
{
  "version": 1,
  "type": "gcai.scisure.result",
  "nonce": "hex-256-bit-nonce",
  "bridgeSessionId": "same session",
  "snapshot": {
    "externalId": "same source ID",
    "externalVersionId": "same version or null",
    "selectionIds": ["same source section/step IDs in order"]
  },
  "recommendations": [{
    "recommendationId": "stable bounded ID",
    "sourceStepId": "optional selected step ID",
    "originalChemical": "optional text",
    "alternativeChemical": "plain chemical name",
    "kind": "chemical-substitution | process-change | warning",
    "decision": "accepted | rejected | unreviewed",
    "confidence": "optional text",
    "caveats": "optional text",
    "requiresScientistReview": true
  }]
}
```

Malformed, replayed, wrong-origin, wrong-window, wrong-source, pre-admission, or invalid recommendation messages are rejected. No retry is issued after timeout or popup close. The current code has no receiver and therefore does not perform an actual GCai import, admission, generation, result retrieval, or authentication.

## Supplies behavior

- `POST supplies/orders/{sampleID}` remains `{catalogItemID, amount, status:"PENDING", notifyUser:false}`.
- The add-on reads paged `GET supplies/orders` and requires exact `shoppingItemID`, sample, catalog item, amount, and `PENDING` status.
- It never calls an invented GET-one-order route and never retries an uncertain POST.
- The session lock stores only operation state and numeric sample/catalog/amount/order identifiers—never source chemistry, email, credentials, or recommendation text. Manual SciSure reconciliation is required if the lock remains.

## Verification

```sh
npm ci
npm test
npm run check
node scripts/browser-smoke.cjs
```

The test suite has 28 tests, including bridge bootstrap, purpose-bound email, cleanup, persistence, and bounds coverage. Chromium verification uses mocked SDK/API/bridge fixtures only; it is not live SciSure or GCai evidence. The browser harness obtains the nonce only through the popup `loaded` → opener `hello` messages, never by reading add-on internal state. Screenshots and `verification/report.json` are generated from those local fixtures.

## Live limitations / release gates

- No live SciSure install, permission test, source export, or Supplies write was performed.
- No GCai bridge receiver, server contract, authenticated connection, immutable snapshot persistence, 90-day cleanup, quota reservation, or external identity verification exists in this candidate.
- Do not enable `gcaiBridge` merely because the frontend test passes. First implement the receiver/server controls described in `docs/plans/2026-09-30-scisure-gcai-connection-design.md` and `docs/plans/2026-09-30-scisure-guest-access-and-security.md`, then perform two-user/two-role sandbox validation.

## Official SciSure references used

- `developer.elabnext.com/docs/elabsdkpageexperiment`
- `developer.elabnext.com/docs/elabsdkpageprotocol`
- `developer.elabnext.com/docs/elabsdkapi`
- `developer.elabnext.com/reference/authentication_userinfo`
- `developer.elabnext.com/reference/experimentsection_getexperimentsections`
- `developer.elabnext.com/reference/experimentsection_getsectioncontent`
- `developer.elabnext.com/reference/protocols_getprotocolbyid`
- `developer.elabnext.com/reference/catalogitem_getcatalogitems`
- `developer.elabnext.com/reference/order_createorder`
- `developer.elabnext.com/reference/order_getorders`
