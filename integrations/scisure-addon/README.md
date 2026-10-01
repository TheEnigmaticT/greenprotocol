# SciSure → GreenChemistry.ai private review add-on

Version **0.4.0**, standalone staging candidate. Root variable `greenchemistry_ai`, required `init(config)` unchanged. No external runtime library. No live writes, deployment, production changes, credential files or live databases were used to verify this candidate.

## Behavior

- Preserve read-only experiment/protocol/protocol-step source selection, chemical Unicode normalization, original version/section/step IDs, conversion-loss notices, immutable <=64 KiB source snapshots and manual clipboard fallback.
- Preserve v1 loaded→hello→ready→admission handshake, purpose-bound optional email and terminal received ACK. All messages require configured exact origin/window/nonce/session; v2 also requires source-submitted state.
- The GCai popup owns normal scientific findings, Ask, private evidence, draft preview and final create/update choice. The SciSure results dialog is informational only: no duplicate final actions.
- Supplies/catalog/order feature, settings, toolbar buttons and prefill flow are removed. No order APIs. Old configuration knobs cannot revive them.
- A frozen `gcai.scisure.writeback` v2 message carries the Prepared bundle. Strict allowlists, identity/content/revision/hash checks and byte bounds fail closed. Raw procedure/model/evidence text is untrusted and HTML-escaped, never inserted into the active DOM.
- Create-new preserves source TYPE: experiment→experiment; protocol/protocol-step→new protocol. Only selected reviewed content is copied. Record title/evidence explicitly say selected-content copy, not a full clone. Scientific warnings/unsupported accepted findings stay acknowledged-only in the appendix; the add-on never rewrites the original procedure or computes its own swaps.
- Protocol create uses documented `POST protocols/import` fields `name`, `categoryID`, `steps[].header/contents`. Reuse source category only if verified private/current-group; otherwise visibly ask for a verified category. Never invent a write path, field, category ID, protocol version or publish fallback.
- Experiment create asks visibly for required destination study ID. Explicit no-template/PENDING/no-auto-collaborators body; add two just-created PARAGRAPH sections for reviewed draft/private evidence and read both back exactly. Native study/group permissions still apply; this is not an owner-only ELN access-control promise.
- Verify every new target ID, metadata/ownership and exact draft/evidence content before saved. Partial create/evidence/readback failure is uncertain and retains the known record ID; no automatic retry/deletion/overwrite.
- Update-existing ALWAYS returns unsupported without any SDK calls. Native historical reads/audit logs are documented, but an audit-preserving atomic version-CAS mutation is not proven. The unsafe blanket protocol PUT is gone.
- Durable sessionStorage lock contains only operation state, a full-bundle fingerprint and optional native target ID/kind. No chemistry, model text, email, nonce or bridge credentials. Pending/uncertain never retry. One writeback fence per SciSure tab session; manual reconciliation is required before any different new attempt. Browser-session loss/new tabs are not server-side idempotency.

Exact API URLs, DTOs, quotes, history/CAS research, capabilities and limitations:
`../../docs/runbooks/scisure-writeback-api-capabilities.md`.

## Configuration and one-hour review

Use `defaultConfiguration.json` / `config.example.json` files directly, not JSON copied out of annotated chat output. Bridge defaults disabled. `gcaiBaseUrl` and `gcaiBridge.origin` are fixed HTTPS origins without credentials/path/query/fragment; the connect path is relative.

For parent-approved staging validation set BOTH origins to `https://staging.greenchemistry.ai` and enable the bridge only on the approved sandbox install. The runtime accepts that explicit fixed origin; do not enable a production receiver as a shortcut.

Runtime, schema, example and default listener timeout are exactly **3,900,000 ms / 65 minutes**. Old shorter configuration values cannot shorten it. Parent must align backend credential lifetime >=67 minutes and popup analysis polling <=13 minutes. After expiry/close, no chemistry rerun or automatic external retry. Saved analysis/decisions remain subject to existing private recovery/retention policy (90 days); no invented public/share token.

Signed-in GCai authorization remains mandatory. SMTP delivery and unverified-mailbox/guest recovery are expressly deferred. Optional email format/purpose consent does not verify ownership or grant quota/guest access. Do not enable a guest gate on a matching email string.

## Upgrade — individual upload (sandbox only)

Parent must first independently review/integrate these commits and synchronize the real dev folder. The worker changed only its dedicated worktree; do not treat another dev folder's older add-on as this version.

1. Select the existing sandbox add-on installation in the developer hub. Use **Upgrade → individual upload** for that installation, NOT an all-installations/bulk upgrade or production publish.
2. Upload the single `add-on.js` file from the parent-synchronized `integrations/scisure-addon/` directory. Keep rootVar `greenchemistry_ai`; version metadata must say `0.4.0`. Do not upload node_modules, test fixtures or verification reports as the script.
3. Separately update the hub's pasted configuration schema with the exact `configurationSchema.json` file. Re-uploading JavaScript does not replace the hub's existing pasted schema. Replace the old per-instance config using the JSON files; remove old Supplies settings, set the approved staging origins explicitly, and retain disabled bridge until the approval gate is met.
4. Save and hard-refresh the SciSure sandbox tab so old listeners/toolbar buttons are unloaded. Confirm only “Review for GCai” experiment/protocol buttons appear, version is 0.4.0, and the configuration shows 65-minute timeout and no Supplies option.
5. Only after scientist approval, exercise a disposable sandbox record; retain exact IDs/readback evidence and two-user/role checks. Do not click through an uncertain write to retry. Existing pending/uncertain locks are reconciliation data, not obsolete settings to erase.

Hub wording may vary by installation; no live hub upload was performed here. Official alternative for sandbox development is SDK Dev Tools → Side Loading with a local HTTPS script URL and Add-on RootVar; no publish/deploy was executed. Sources:
https://developerdocs.elabnext.com/docs/side-loading.md
https://developerdocs.elabnext.com/docs/testing-your-add-on.md
https://developerdocs.elabnext.com/docs/version-compatibility-for-your-add-on.md

## Verification

From this directory:

    npm ci
    npm test
    npm run check
    npm run test:browser

Node unit/JS tests use local mocked SDK fixtures. Chromium tests use actual popup postMessage and mocked API responses; hashes are derived from the actual admission, not add-on debug state. Browser scenarios: experiment saved, selected protocol saved, readback mismatch uncertain, duplicates no mutation, update unsupported, no order calls, escaped DOM and zero page errors. Generated `verification/report.json` is local fixture evidence only and is gitignored.

Parent integration requirements: retain frozen workspace/source contracts, server-owned authorized draft/revision/decision preparation, scientific safety distinctions, quota audit and private ownership. `bundleHash` shape/provenance is preserved; no hash algorithm/signature is invented from that field. Add-on recomputes canonical source SHA-256 and uses its own full-bundle fingerprint to suppress local duplicates. Parent owns canonical prepared-bundle integrity/authorization and private recovery. No backend/popup/SQL or scientific engine code was edited here.

Live source import and create/readback behavior, private-category/tenant permissions, normalization by the real API and installation upgrade remain unverified. Strict readback mismatch must stay uncertain; never weaken it or publish a protocol to manufacture success.
