# Private disk stage journal

## Implemented API

`lib/local-qualification/stage-store.ts` exports:

- `createStageStore(): StageStore` — fixed `PRIVATE_ROOT/stages` (the `PRIVATE_ROOT` exported by `manifests.ts`).
- `createArtifactStore(): ArtifactStore` — fixed `PRIVATE_ROOT/artifacts`; `put(Buffer): Promise<string>` returns an unprefixed SHA-256, and `read(hash): Promise<Buffer | null>` returns exact private bytes.
- `createTestStageStore({ root, synthetic: true })` and `createTestArtifactStore({ root, synthetic: true })` — require `NODE_ENV=test`. Only synthetic temporary fixtures are authorized for these capabilities.

Production factories reject runtime arguments and do not inspect environment/caller roots. Neither adapter reads provider attempt history or imports a provider/client. Existing modules were not changed. Integration can supply `store: createStageStore()` to `runStages`; source/evidence authorization remains the caller's responsibility, not an assertion this storage layer makes.

## Journal and durability contract

All `exclusive` keys use one create-exclusive `.lock`. Concurrent contenders reject with `STAGE_BUSY`; this is fail-fast mutual exclusion, not a waiting queue. Async callbacks retain the lock across awaits, including against separate Node processes. Success removes the verified owned lock and fsyncs its directory. Callback rejection or a caught journal I/O error leaves the lock in place. There is no PID age check, stale-lock stealing, timeout reset, or automatic recovery. A process killed after lock creation therefore cannot silently enable new execution.

Journal filenames are `SHA256(exactKey).stage`, so slash-containing fence/source/stage keys never become paths. Each record consists of a 72-byte binary envelope followed by at most 16,384 UTF-8 payload bytes: `STG1`, 32-byte key commitment, 32-byte payload commitment, and a four-byte big-endian byte length. Reads verify all commitments, exact length, and strict UTF-8; they return the original string, not the envelope. Lone-surrogate input is rejected rather than normalized.

`append` uses `O_CREAT | O_EXCL | O_NOFOLLOW` with mode 0600, fsyncs the file, fsyncs the directory, and reads back exact bytes before resolving. Existing records are never overwritten, including malformed records. Creation is atomic; a crash before completion may leave a partial record, which fails closed rather than masquerading as a missing record. This is deliberately not a replace-by-rename repair protocol. No partial file or uncertainty marker is automatically deleted.

Artifacts use `SHA256(raw).raw`, cap raw payloads at 8 MiB, and verify content hashes on reads. Duplicate puts must match existing bytes and explicitly fsync both existing file and directory before success, covering an earlier writer that created complete bytes but did not durably acknowledge them. A corrupt/partial artifact is not overwritten. Raw buffers are private execution input, not public reports or loggable result objects.

## Filesystem safety and limits

Path preparation rejects symlinks in every component. The private root and leaf must be owned by the effective current user and exactly 0700; existing permissions are never repaired. File opens reject symlinks, non-regular files, extra hard links, wrong ownership, and modes other than exactly 0600, including special permission bits. Reads use a bounded allocation and check descriptor/path inode, device, size, modification time, and change time before/after access. `O_NONBLOCK` avoids blocking on a substituted special file. Directory identity is rechecked around access. New directory entries are synced when created.

Filesystem critical sections are synchronous; the public interface remains async so callers cannot inject event-loop mutations between the check/open/read steps. This favors a small, offline, serial qualification workload over event-loop throughput. As with the existing Node filesystem adapters, this is not a sandbox against a malicious process running as the same owner or root: Node path-based opens do not provide an `openat` capability chain, and trusted ancestor directories/filesystem semantics remain prerequisites. Durability depends on the OS/filesystem honoring fsync; no power-loss hardware claim is made.

Errors contain fixed codes without raw input, private filesystem errors, or nested causes. Callback errors are replaced by `STAGE_WORK_FAILED`. No source, evidence, arbitrary callback exception, or provider text is logged or serialized into lock metadata.

## Verification performed

Tests use freshly created canonical OS temporary directories and synthetic strings/buffers only. Coverage includes exact multibyte limits, slash-containing keys, create-only replay rejection, corrupt/truncated/oversized files, key substitution, permissions, symlink/hardlink rejection, async global exclusion, a real child-process holder killed with SIGKILL, racing appends in two real Node processes, test-only gates, content-addressed readback/corruption, and actual `runStages` durable replay with no provider jobs.

TDD evidence:

1. Initial dedicated suite failed because the adapter module did not exist.
2. Initial implementation passed its nine filesystem tests and TypeScript checking.
3. Added a durability regression requiring duplicate artifact puts to fsync both file and directory; observed a real assertion failure (`0` syncs, expected at least `2`). Implemented existing-file durability and reran green.
4. A narrow fsync wrapper delegates to the real OS normally and injects one failure after create/write to verify non-acknowledgement and create-only readback. No filesystem contents or API responses are fabricated.
5. Full repository `npm test`: **46 test files, 661 tests passed**. `tsc --noEmit --pretty false` and scoped ESLint passed.

No production factory was executed. No private corpus, credentials, network, model calls, installs, commits, or pushes were used. Remote freshness was not fetched because this delegated task explicitly prohibited network access; the local branch was inspected against its already-present remote refs and was level with `origin/main`.
