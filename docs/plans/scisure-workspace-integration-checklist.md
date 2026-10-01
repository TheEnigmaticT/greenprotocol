# Integration verification checklist

Parent-owned gates for the private review workspace. Do not publish a partial UI or substitute fabricated provider/API outcomes.

## Scientific and source integrity

- The saved result fixture with three warnings and one noneligible hypothesis must produce four visible findings.
- Acknowledge/accepting a warning or noneligible hypothesis never silently rewrites the source.
- Accept-one/reject-one must not reuse the pipeline's preassembled `revisedProtocol` containing all originally eligible changes. The existing `buildFinalizedProtocol` fast path can reuse that full revision for an accepted subset; the workspace wrapper must neutralize that path or otherwise prove only durable accepted changes are represented, without modifying scoring science.
- Draft creation must preserve the reviewed original text and clearly disclose any mapping/formatting losses. A source-section ID is not a parsed pipeline step ID; do not infer a safe edit solely from equal ordinal numbers.
- Evidence snapshot must state applicability, confidence, source identity/revision, run, decisions and citations. It must not contain bridge credentials or public links to the confidential analysis.

## Identity and lifecycle

- Workspace reads/writes prove connection owner and actual signed-in owner; wrong principal and revoked/expired credentials fail closed.
- Signed-in persisted analysis, cards, chat and Atlas remain private and accessible through owned account routes after the popup closes. A persisted-but-inaccessible table is not usable recovery; add an owner-authenticated recovery/read route or reflect durable decisions in the private saved analysis UI if needed.
- An expired bridge must never automatically re-run the provider to resume.
- SMTP-dependent unregistered-mailbox issuance/claim remains disabled. Do not use email equality as proof or enable broad anonymous Auth.
- New workspace records and raw chats/evidence have an explicit retention/purge path; source90days remains unchanged.
- Timeout values agree in popup/backend/add-on runtime/schema/defaults.

## Writeback

- Final explicit choice/confirmation belongs in popup, not duplicated in the ELN modal.
- Source experiment -> new experiment; protocol/protocol-step -> new protocol with selected-content label.
- Update requires verified native audit/history and atomic version conflict semantics. Unsupported update must not issue a mutation.
- New record and evidence must be read back by exact returned ID. Partial failure retains ID and reports uncertain; retries blocked durably.
- Private evidence is embedded in the destination record, not only a public URL or a link that grants unauthorized viewers the original analysis.
- Stored client receipt metadata never counts as independent server verification of a third-party write.

## Delivery

- Consolidate contributor SHAs into the canonical user-visible dev checkout before live tests.
- Run full tests, lint, typecheck, build, isolated SQL and browser fixtures; classify fixture evidence explicitly.
- Independently review the consolidated candidate using a provider that is actually available.
- Apply only explicitly targeted staging SQL, read back ACL/schema/function invariants; root CLI is production-linked.
- Reviewed PR to main and exact Vercel staging SHA readback; no production release or alias mutation.
- Build individual add-on files and ZIP, version/config upgrade instructions, verified file handles. Live sandbox writes require a scientist's explicit confirmation; if tenant access is blocked, mark the exact acceptance outstanding rather than claim native API writeback was live-tested.
