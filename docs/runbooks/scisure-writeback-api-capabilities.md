# SciSure v2 writeback API capabilities

## Scope and evidence level

Research for add-on 0.4.0, 2026-10-01. Public official documentation and local mocked SDK/browser tests only. No credential files, tenant APIs, live databases, live records, deployments, or production were accessed. This is a staging integration candidate, not proof of successful live writes. Cached `elabdocs` was a read-only reference; current official Markdown was fetched directly.

Discovery: https://developerdocs.elabnext.com/llms.txt
SDK: https://developerdocs.elabnext.com/docs/elabsdkapi.md

SDK exact quotes:

> Make a REST API call to the eLab Journal API.

> This is the core method for making HTTP requests to the eLab API.

The SDK table documents `method`, relative `path`, `body`, `params`, and success/error callbacks receiving `(xhr, status, response/error)`. SDK handles authentication; this add-on never reads or forwards an API token. Paths below omit the SDK-managed `/api/v1/` prefix.

## Protocol create: documented import, not guessed PUT/POST

https://developerdocs.elabnext.com/reference/protocols_createprotocol.md

Exact excerpt:

> the resulting protocol has a single initial version.

OpenAPI path: `POST /api/v1/protocols/import`. Request `ImportProtocolDto`: `name`, `categoryID`, `steps`; each `ImportProtocolStepDto` has `header` and `contents`. Response: HTTP 200 JSON int32, the new protocol ID. No `order`, step `name`, `description`, `isPublic`, or version-CAS fields are in the import DTO. The former `POST protocols` / `PUT protocols/{id}` replacement flow is removed.

Implemented: one escaped HTML step for the reviewed selected draft, one escaped HTML step for private evidence/provenance. New title explicitly says “selected-content copy”; a protocol-step produces a new protocol containing only reviewed selected content, not the rest of the protocol. No variable substitution, original-source modification, publish, sign, archive, share, or notification-suppression promise.

https://developerdocs.elabnext.com/reference/protocols_getcategories.md

Exact excerpt:

> Returns the protocol categories visible to the caller.

Documented `GET protocols/categories` returns an ARRAY, not a paged envelope. Query `public` / `archived`. `ProtocolCategory`: `protCategoryID`, `groupID`, `archived`, `name`, `userID`, `protCount`. The import DTO calls the corresponding destination field `categoryID`, not `protCategoryID`.

Only categories explicitly in the current user's nonzero group and explicitly unarchived are admitted. Reuse the source's documented `categoryID` only when the current category list proves that destination. Otherwise visibly ask for a category from that verified list; no guessed ID or public category. Public/group-sharing defaults are not editable via undocumented fields. Exact readback must prove `isPublic:false`, `groupShareCount:0`, matching current `userID`/`groupID`, category, name, ordered step headers and exact escaped contents. If the installation omits/normalizes these required readback fields, retain the new ID and return uncertain; never publish to make readback work.

## Experiment create: documented study + empty PARAGRAPH sections

https://developerdocs.elabnext.com/reference/experiment_createexperiment.md

Exact quotes:

> When templateID (optional) is 0, < 0, or left out, the experiment will be created without a template. Default is 0.

> Status (optional) can be PENDING, PROGRESS, COMPLETED. Default is PENDING.

OpenAPI: `POST /api/v1/experiments`; `ExperimentNew` REQUIRED `studyID`, `name`; optional `status`, `templateID`, `autoCollaborate`. Response: HTTP 200 JSON int32.

Implemented: visibly request the required destination study ID after the popup's create-new confirmation. No project/study ID is guessed from URL/page data. Explicit body `{studyID,name,status:'PENDING',templateID:0,autoCollaborate:false}`. Experiment stays experiment. No claim that this is a full copy: only reviewed selected text is transferred, no excluded files/sections/template/collaborators. Native ELN study/group permissions still apply; `autoCollaborate:false` is NOT a guarantee that a study's existing authorized members cannot view the record. This is never a public GCai share link.

https://developerdocs.elabnext.com/reference/experiment_getexperimentbyid.md

Exact excerpt:

> Returns a single experiment by ID, including its core metadata (status, owner, study/project, dates).

`GET experiments/{experimentID}`: `ExperimentLarge` documents `experimentID`, `name`, `studyID`, `userID`, `groupID`, `experimentStatus.status`. Require exact returned ID and intended title/study/owner/group/PENDING state before adding sections. A metadata mismatch after create is uncertain, with the created ID retained.

https://developerdocs.elabnext.com/reference/experimentsection_createsection.md

Exact quote:

> Use the `order` property to specify the position of the new section within the experiment. This is a 0-based integer where 0 is the top position within the experiment.

`POST experiments/{experimentID}/sections`: required `sectionType`, `sectionHeader`; optional `order`, `sectionDate`. The enum includes `PARAGRAPH` and `PROCEDURE`, NOT `TEXT`. Response: int32 `expJournalID`. Create two NEW `PARAGRAPH` sections (draft and appendix), with explicit order 0/1; do not create a `PROCEDURE` falsely bound to an existing native protocol version.

https://developerdocs.elabnext.com/reference/experimentsection_getexperimentsection.md

Exact quote:

> Returns a single experiment section by its `expJournalID`, including its general properties (header, type, position) and section-type-specific metadata.

`GET experiments/sections/{expJournalID}`: verify exact section ID and exact created experiment ID, PARAGRAPH type, header and order before writing content. Never write content to an unrelated section if the create/readback response is wrong.

https://developerdocs.elabnext.com/reference/experimentsection_putsectioncontent.md

Exact quote:

> You can add meta data to this call. In case of PROCEDURE sections you have to add the protocol's version ID and the values of its variables as meta data.

Documented `PUT experiments/sections/{expJournalID}/content`, body `contents`, `meta`; `meta` items use `name`, `val`. The ONLY PUT performed by this add-on fills a just-created PARAGRAPH section on the just-created experiment after membership verification, never an original section. Explicit body `{contents:escapedHTML,meta:[]}`.

https://developerdocs.elabnext.com/reference/experimentsection_getsectioncontent.md

Exact quote:

> Returns the section's content together with its meta data. A PROCEDURE section's meta contains the protocol's version ID and its variable values.

Read `GET experiments/sections/{expJournalID}/content` for EACH new section, requiring exact contents including escaped private evidence. Missing evidence or mismatching draft content means uncertain, not saved; preserve the record ID and do not retry or delete the partial record automatically.

## Native history/versioning/CAS: update remains unsupported

https://developerdocs.elabnext.com/reference/protocols_getprotocolbyid.md

Exact quote:

> Returns a single protocol by its `protID`, including the latest version's content. Use `GET /protocols/version/{protVersionID}` to fetch a specific historical version instead of the latest.

https://developerdocs.elabnext.com/reference/protocols_getprotocolbyprotocolversionid.md

Exact excerpt:

> the IDs from the protocol's version history.

Documented `GET protocols/version/{protVersionID}` is a historical READ. `ProtocolEntry` exposes `protID`, `protVersionID`, `latestVersionId`, `version`, `latestVersion`, `draft`, and ordered step content. A historical read is NOT a version-conditional mutation contract.

https://developerdocs.elabnext.com/reference/protocollog_getprotocollogs.md

Exact excerpt:

> version creations, updates, signs, archive operations.

`GET protocols/{protID}/logs` is an audit READ with paged `ProtocolLog` entries including `protID`, `protVersionID`, `changed`, `field`, `log`, `userID`. Audit-log availability does not prove that a particular replacement preserves history atomically.

https://developerdocs.elabnext.com/reference/protocols_publishprotocol.md

Exact quote:

> Group members are notified that the protocol was updated.

`POST protocols/{protID}/publish` finalizes an existing draft; documented 409 means “The protocol has no draft version to publish.” No documented expected source revision, ETag, If-Match, or atomic compare-and-swap argument appears in this operation. It does NOT create a scientist-reviewed new version safely. This add-on never calls it.

The official protocol index and SDK Protocol documentation provide history reads/import/category preferences but no verified atomic audit-preserving content-version update contract. Section content PUT likewise has no documented expected-version/CAS field. Generic 409 Conflict documentation is not evidence of concurrency control. Research did NOT prove that such a capability can never exist in a vendor-specific future installation; it proved insufficient documentation to enable it here.

Valid v2 `mode:'update'` returns `unsupported` BEFORE any SDK read or mutation. No fallback overwrite. To enable future update: obtain exact vendor endpoint/DTO/header contract proving new native revision + atomic expected-version rejection, exercise a concurrent writer, verify untouched prior history and exact new target readback, then independently review the change. A GET-then-PUT check alone has a TOCTOU gap and is unacceptable.

Create-new re-reads the original protocol ID/version/selected step content or experiment ID/section membership/selected content before mutation, and again after any destination prompt. These are conflict guards for the SOURCE of a new copy, NOT an atomic-update claim.

## Ownership, bundle validation and lock

https://developerdocs.elabnext.com/reference/user_getcurrentuserid.md

Exact excerpt:

> Returns the current user's profile information together with their group/subgroup memberships.

Documented path is `GET users/getCurrentUserInfo`, direct `UserInfo`, fields `userID`, `groupId` (lowercase d), `isBlocked`; NOT an invented nested auth/user group field. Writeback uses this live SDK principal, compares any admitted SDK user ID, rechecks before mutation, and verifies destination `userID`/`groupID`. The existing `GET auth/user` admission prefill remains v1 compatible and never proves GCai identity or guest eligibility.

Only configured exact HTTPS origin + original popup WindowProxy + nonce + ready/session + submitted state can send v2. Strict allowlisted envelope/Prepared/source shapes; entire message <=256 KiB UTF-8; original source <=64 KiB, 1–100 selections; title <=256 chars; draft <=128 Ki chars; appendix <=64 Ki chars; each finding/limitation list <=100 entries. Escaped destination draft+appendix JSON also <=256 KiB. Unknown credential fields, public/nonrelative paths, malformed identity/source, changed selected contents and invalid revisions fail closed. Only optional `/analyze/{id}` and `/analyze/{id}/evidence` private paths are admitted, and the add-on does not create links from them.

Recompute `sourceHash` using the existing backend canonical source-provenance SHA-256 algorithm. When an optional v1 terminal result was received, source hash/run/revision must match it. V2 alone is admitted after source submission: parent popup/server owns persisted analysis revision/decision authorization. Do not invent a workspace-ready message or require old swap-only projection for v2.

The frozen contract specifies a `bundleHash` string but no cryptographic algorithm/signature. Validate its 64-hex shape and preserve it in evidence; do NOT claim it authenticates model output. The add-on computes its OWN canonical SHA-256 fingerprint over the full validated bundle for local duplicate protection. Parent must enforce server-owned source/revision/decisions when preparing it. No inference or accepted unsupported finding is applied by the add-on; it transfers the server-prepared, popup-reviewed draft only and records acknowledged-only findings/limitations separately in evidence.

Before mutation, persist sessionStorage key `greenchemistry-ai.scisure.writeback.v2` with only `{version,state,fingerprint,targetId?,targetKind?}`. No nonce, session credential, email, source, draft, appendix, or model text. Pending is already a no-retry lock. Saved same-bundle replays return the previously verified ID without another mutation; all other locked states return uncertain. A corrupt/unavailable store fails closed. After any create/append/readback failure, retain uncertain plus every known created ID. There are no automatic POST/PUT retries. Timeout is 30 seconds per SDK operation; a late callback cannot unlock/retry an uncertain mutation.

Conservative limitation: one active writeback lock per SciSure tab session. Even a different bundle remains locked until manual reconciliation. It survives popup reload and same-tab reload, not browser-session loss, a new tab, user clearing sessionStorage, or hostile code in the same ELN origin. It is a duplicate fence, not an authenticated server receipt. Do not promise cross-device reconciliation. Do not clear uncertain locks to “try again”; inspect the exact retained record manually first. If storage fails after create, the reply retains the known ID in memory, but persistence of that ID cannot be guaranteed.

## Parent integration/release requirements

- Integrate only this worktree's owned add-on/runbook changes. No backend, SQL, scientific engine, popup, production, or other worktree was edited here.
- Parent synchronizes the user-visible dev folder later; this worker did not touch it.
- Popup owns review, Ask, private evidence, draft preview and explicit create/update final choice. It sends the frozen v2 envelope and waits for `scisure.gcai.writeback-result` matched by nonce/session/request ID. A queued analysis/admission or v1 received ACK is NOT a saved writeback.
- Maintain the backend's private owner authorization, scientific applicability distinctions, source/revision CAS and quota audit. Fresh connection/recovery must not rerun chemistry or allocate new quota.
- Add-on runtime/schema/example/default are fixed at 3,900,000 ms (65 min); parent backend credentials must last at least 67 min; popup polling <=13 min. Verified guest expiry may shorten actual access. Guest and SMTP/unverified-email recovery gates remain closed.
- Configure staging origin explicitly, keep bridge disabled until independently approved staging integration, and validate two roles/users. No production promotion or real record mutation without scientist confirmation.
- Live sandbox approval must cover documented DTO behavior, user/category/ownership shapes, private category semantics, experiment study permissions, preserved Unicode, strict escaped-content readback and partial-write reconciliation. Fixture “saved” is not live evidence. Never weaken readback or publish an imported protocol just to satisfy a fixture.

## Local acceptance evidence

Tests were written and executed RED before implementation. Initial writeback run: 16 expected feature failures (missing v2 receipts/create/conflict/lock/removal), 13 preexisting fail-closed checks passed. Subsequent RED cycles caught uncaught malformed-message errors, wrong ownership response shape, private path/category prompt gaps, source drift during destination selection, escaped-body size expansion, and corrupt saved locks. Final GREEN acceptance: `npm test` returned 64 passed / 0 failed / 0 skipped; `npm run check` passed `node --check add-on.js`; `npm run test:browser` passed all three local Chromium scenarios with zero page errors. All ran from `integrations/scisure-addon`. Additional RED cycles caught create-ID aliasing of the original experiment and JavaScript regex coercion of malformed bundle-hash/private-path types before their fixes.

Mocked Chromium drives actual loaded→hello→ready→admission→v2 postMessage with fixture source hashes derived from the real admission, not debug state. It covers experiment create, selected protocol create, exact readback mismatch→uncertain, duplicate suppression, unsupported update, escaped DOM/content, no order calls, credential-free locks and page-error capture. Unit fixtures cover all three source kinds, malformed/oversize/spoofed messages, run/revision/source drift, missing evidence, exact destination ID/ownership/content, durable reload locks and storage failure. These are local tests only.
