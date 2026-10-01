# SciSure add-on backlog

## Version 0.2.0 delivered locally

- [x] Reviewed experiment/protocol/single-step snapshots with source IDs/version/step IDs where returned, immutable structured selection, 64 KiB/100-selection limits, conversion-loss notices, and retained manual clipboard fallback.
- [x] Disabled-by-default proposed top-level GCai transport with fixed HTTPS origin, Web Crypto nonce, exact origin/window/version/nonce/session checks, explicit auth/user lookup on admission opening, consent UI, popup deadline/close/replay controls, and strict untrusted result rendering.
- [x] Eligible structured chemical-substitution return can prefill Supplies with provenance; it cannot authorize purchasing. Supplies remains literal opt-in, explicit-confirmation, exact-readback only, with sessionStorage uncertain-order reconciliation lock.

## Live validation

- [ ] Validate installation and SDK insertion points in the configured sandbox [added::2026-10-01] [done-when::The developer add-on loads at sandbox.elabjournal.com; experiment and protocol buttons appear once; source/step review matches live data; no console errors] [needs-ui::true] [priority::high]
- [ ] Validate `GET auth/user` field/permission behavior and consent wording in a live sandbox [added::2026-10-01] [done-when::The tested SDK response shape is recorded; a missing/denied user response remains an explicit optional-email state; email delivery and marketing consent are independently auditable] [needs-ui::true] [priority::high]
- [ ] Validate Supplies permissions and response shapes [added::2026-10-01] [done-when::An explicitly approved sandbox PENDING order for an existing sample/catalog item is created once; paged GET supplies/orders verifies returned shoppingItemID, sampleID, catalogItemID, amount and status; tenant notification behavior is recorded] [priority::high]
- [ ] Verify popup/opener policy on the target SciSure browser [added::2026-10-01] [done-when::A sandbox browser confirms whether the exact-window postMessage channel remains viable through GCai login; blocked opener/COOP/sandbox cases take a server-paired fallback rather than weakening origin checks] [needs-ui::true] [priority::high]

## Receiver/server work — not implemented

- [ ] Implement authenticated GCai bridge receiver and immutable snapshot service [added::2026-10-01] [done-when::A server-issued single-use session binds approved GCai user/install/actor scope; admission stores a canonical-hashed immutable snapshot with 90-day cleanup; size/schema/owner/quota controls and e2e tests pass; no browser provider credential exists] [priority::high]
- [ ] Implement result projection and version-bound order intent [added::2026-10-01] [done-when::The server validates canonical recommendation identity/evidence/revision/source hash, returns only safe structured eligible chemical substitutions, and persists reported-vs-verified order outcome separately] [needs-ui::true] [priority::high]
- [ ] Durable uncertain-order reconciliation [added::2026-10-01] [done-when::A supported server-side receipt/idempotency or authoritative SciSure reconciliation path survives browser-session loss; until then the add-on continues to fail closed and requires manual reconciliation] [priority::high]
- [ ] Confirm protocol detail ID acquisition with SciSure [added::2026-10-01] [done-when::SciSure confirms a supported current-protocol ID hook or documented URL contract; replace manual ID entry only with an SDK/API-grounded method and tests] [needs-ui::true]
