# Isolated stage substrate — implementation in progress

Scope: only `stages.ts`, its tests, and this report. No chemistry workers, corpus, model calls, credentials, network, production imports, installs or spending changes. Explicit no-network delegation overrides workspace fetch rule; inspected cached branch/upstream (0/0), main/origin-main (0/8); no branch changes. Referenced dev protocol was absent.

Read existing source/graph, principle/decision contracts, provider and append-only ledger exports, and sprint-1 T6/T7 before design. Provider `createProvider()` remains LIVE_NOT_APPROVED; existing principle contracts remain `contract-implemented-job-not-implemented`.

Design: fixed deterministic serial DAG; injected reviewed exact role/model identities and approved jobs; durable immutable start/result journal behind an exclusive private adapter. Identity binds source, evidence, contract, model, role and transport versions plus dependency results. No automatic retries, no spending authority, no replay after an uncertain start. Job outputs are substrate candidates, never chemistry certification or READY. Absent implementation and failed dependencies remain explicit.

## Interface for reporting (frozen scope)

Exports `STAGES`, `StageID`, `StageStatus`, `StageResult`, `StageBinding`, `StageRunResult`, `StageJob`, `StageStore`, `StageOptions`, `runStages(options)`.

Exact ordered stage IDs: `extraction`, `coverage`, `claim-audit`, `P1`, `P2`, `P3`, `P4`, `P5`, `P6`, `P7`, `P8`, `P9`, `P10`, `P11`, `P12`, `applicability`, `assembly`, `rescore`, `acceptance`.

`StageStatus = 'candidate' | 'unavailable' | 'unimplemented' | 'failed' | 'blocked'`. No chemistry-success or safe state. Candidates can feed downstream adapters, never certify chemistry. `StageResult = { stage: StageID; tupleHash: string; attempt: 1; status: StageStatus; code: StageCode; artifactHash: string | null; dependencyHashes: readonly string[]; principleImplementationStatus: 'contract-implemented-job-not-implemented' | null }`.

`StageBinding = { sourceId: string /* sha256: prefix, exact Source.id */; sourceVersion: string; evidenceHash: string /* bare hex */; evidenceVersion: string; contractVersion: string }`. `StageRunResult = { runId: string /* bare hash */; binding: StageBinding; stages: readonly StageResult[]; safetyCertified: false; allTwelveSafe: false; ready: false }`.

Reason codes are a closed vocabulary: `CANDIDATE`, `UNAVAILABLE`, `UNIMPLEMENTED`, `DEPENDENCY_BLOCKED`, `JOB_FAILED`, `OUTPUT_INVALID`, `INTERRUPTED`, `DEADLINE`, `RUN_HALTED`. Adapter text is never persisted into stage codes; private referenced artifacts stay with the adapter. Successful synthetic output's arbitrary code is ignored and normalized to CANDIDATE. Reporting should select these closed codes, not arbitrary exception or identity strings.

## Implemented and verified

- Fixed 19-stage topological DAG; serial execution; all P1–P12 enumerated even when blocked. Upstream candidate is only permission to run the next injected adapter, not an applicability approval.
- Immutable content-addressed run manifest includes the binding, exact reviewed model/role/transport versions, implementation versions, DAG and deadline. Each stage tuple additionally binds dependency result hashes. Every attempt is explicitly `1`; resume never automatically retries. Changing a version creates a different tuple/run and is new work, not retry permission.
- Start/result records are create-only and read back byte-for-byte after writes. Resume validates record hashes, binding, dependency hashes, allowed codes and field shape. Interrupted starts become failed, never replayed.
- Global serial execution fence is append-only, capped at 4096 invoked jobs per private adapter. An unresolved invocation (including timeout or result-write failure) permanently halts new execution across changed case/version tuples. No automatic clearing, recovery or reset API. Existing provider remains sole spending authority.
- Whole async job deadline is 1–60,000 ms; abort signal propagates. Late completion cannot append or resume work. Other failures block dependent stages; interruption/deadline halts all new jobs.
- Only imports are `./source` and `./principles`. Existing provider, principal contract markers and production pipeline remain untouched. Private chemistry payloads never enter this substrate; jobs return privately stored artifact references and the store persists only bounded metadata/result references. Exceptions and adapter reason strings are discarded in favor of closed codes.

### Actual verification

1. Initial red: stages module absent, expected missing-feature import failure.
2. First green: **9 stage tests passed**.
3. Additional red: changed-version run after timeout called the hung job twice (1 failed / 9 passed).
4. Global immutable execution fence added; final targeted run: **10 tests passed**.
5. Targeted ESLint: passed, no diagnostics.
6. Strict standalone TypeScript check of both owned TS files and dependencies (`--target es2022 --module esnext --moduleResolution bundler --skipLibCheck`): passed.
7. Project-wide TypeScript: blocked by concurrent extraction-jobs/live-provider/principle-jobs lane errors; no stages diagnostics.
8. Combined decomposed/local regression: **360 passed, 28 failed across 19 files** at this worktree snapshot. Failures were 26 unimplemented concurrent principle-jobs tests and 2 discovery unsafe-path tests; no stage failures. No ownership-crossing edits attempted.
9. `git diff --check` for owned paths: passed. Import scan confirms only source/principles imports.

### Explicit boundaries / remaining gates

This is a working tested substrate, not completed chemistry or a READY implementation. Reporting/acceptance is the integrator's separate module. Concrete real role adapters, app entrypoint, private disk adapter and corpus qualification remain separate work. Synthetic test store proves interface behavior only, not filesystem permissions/crash durability. The production private adapter must implement interprocess exclusion, durable exclusive append, bounded I/O, owner/path access controls and trusted storage integrity; hashes are not authentication. Reviewed config must come from a trusted caller—freezing and `reviewId` do not independently prove approval or attest a served model. The provider still must enforce exact model approval, model attestation, spending and no fallback.

Timers cannot preempt synchronous malicious/CPU-bound adapter code or guarantee a remote abort completed; adapters and storage are trusted injected dependencies, not a sandbox. The unresolved global fence is why timeout cannot unlock another invocation. Independent spec and quality reviews remain required; parent owns reviewer dispatch. No model/network call, install, commit or push was performed.
