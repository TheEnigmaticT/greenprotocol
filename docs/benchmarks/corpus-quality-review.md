# Independent corpus quality and security review

## Verdict

**APPROVED — narrow offline loader unit only.** No blocking security defect or correctness error was found within the documented trusted-local-process boundary. This is not approval of a real snapshot or manifest, permission to set an operational review flag, clearance of a denied access path, or whole-mission acceptance.

Reviewed in full: `lib/local-qualification/corpus.ts`, `tests/lib/local-qualification/corpus.test.ts`, `docs/benchmarks/corpus-discovery.md`, and `docs/benchmarks/corpus-spec-review.md`. Package/test configuration and repository instructions were read only to establish safe verification commands. Production code and tests were not modified.

## Security and correctness findings

- **Authority and isolation:** Module location determines the fixed root; there is no runtime root override, cwd/env authority, production client, provider call, credential lookup, logging, or write operation in the loader (`corpus.ts:1–10,74–105`). `reviewApproved` is a trusted caller assertion, not authentication or evidence that independent review happened. An untrusted caller must not be allowed to manufacture approved manifests.
- **Manifest validation:** Restrictive basenames, bounded nonempty artifact/source arrays, exact SHA-256 syntax, duplicate-entry rejection, and global split consistency are enforced (`44–58`). Copying primitive manifest fields before the first asynchronous boundary prevents subsequent ordinary caller mutations from changing the selected inputs (`107–110`). This is not a sandbox for hostile executable objects/getters inside the same process.
- **File handling:** Component `lstat` checks reject symlinks; designated private ancestors and files require current-user ownership and no group/other mode access. Regular-file and single-link checks, read-only/no-follow/nonblocking open, descriptor identity checks, bounded reads, and post-read metadata checks provide layered protection (`60–98`). The descriptor is closed in a `finally` block. No filesystem permission remediation occurs automatically.
- **Content integrity and bounds:** Artifact bytes must match the reviewed digest before parsing; fatal UTF-8 decoding and protocol surrogate round-trip validation prevent lossy source identity. Byte limits and artifact/case/source limits bound input processing. Exact protocol bytes—not normalized text—determine source hashes (`82–97,115–121`). Limits are per artifact/case, not a small aggregate-memory guarantee across all approved artifacts.
- **Membership, deduplication, splits:** Every observed source must be approved and every allowlisted source must appear; duplicate raw records contribute to raw counts but only one case per hash survives across artifacts. Split classifications come solely from the manifest (`111–141`). First-occurrence eligibility/evidence counts are intentional and documented, not an evidence reconciliation policy.
- **Output and error minimization:** Explicit output reconstruction drops identifiers, baselines, evidence payloads, and arbitrary nested fields. No inherited JSON fields are copied into output objects. Only the count-only summary is suitable for reporting; returned cases deliberately retain private protocol text and source hashes. Error messages are replaced with fixed allowlisted codes and do not retain original filesystem/parser causes (`131–146`).

## Non-blocking follow-ups and boundaries

1. **Strengthen adversarial regression coverage.** Existing tests do not directly exercise hardlinks, incorrect ownership, all byte/count boundaries, malformed UTF-8 bytes, absent allowlisted sources, successful previous-holdout/unclassified summaries, or cross-artifact deduplication/split conflicts. The current conflicting-split test also duplicates a source within one artifact, so it can pass via the local-duplicate guard without proving the global conflict guard. These guards were inspected, but inspection is not execution evidence. Add synthetic cases in a separately authorized implementation task.
2. **Add deterministic read-race coverage.** The existing tests do not inject descriptor/path replacement, growth/shrinkage, short reads, or post-read metadata changes. Future tests should assert fail-closed codes and descriptor cleanup using only synthetic files/mocks. No race exploit was attempted in this review.
3. **Retain the trusted filesystem/process assumption.** Component checks are not atomic directory-descriptor traversal. Repository ancestors above the designated private subtree are checked for type/symlinks, but not for their ownership/write permissions. POSIX mode-bit checks also do not constitute an ACL audit. Deployment must keep the checkout and ancestors trusted and avoid broader ACL grants; do not promote this implementation into a hostile multi-user or same-identity sandbox. The existing spec review already identifies the non-atomic traversal limitation.
4. **Approval-before-read test could be more precise.** The test checks the rejection code but does not spy on filesystem operations to prove that no read occurred. Source order currently establishes that property; a regression test should assert it directly. The duplicate test at `corpus.test.ts:71` also mentions newline distinctions it does not itself exercise; the separate LF/CRLF test does cover them.

These follow-ups do not block the specified narrow unit. They limit the strength and portability of the security assurance; 22 passing tests are not comprehensive adversarial verification.

## Independently executed verification

- `npm test -- tests/lib/local-qualification/corpus.test.ts` — exit 0; **1 test file passed, 22/22 tests passed**.
- `npm run lint -- lib/local-qualification/corpus.ts tests/lib/local-qualification/corpus.test.ts` — exit 0; no diagnostics.
- `git diff --check` — exit 0; no diagnostics before this report was added. Reviewed implementation files were untracked, so their complete file contents—not an empty tracked diff—were the review basis.
- Existing tests mock module location into their own newly created synthetic temporary directories. They were run unchanged; no real loader invocation was added.
- `git fetch` succeeded. Current branch matched its upstream; the separate local `main` was eight commits behind `origin/main`. No unrelated worktree or branch reconciliation was performed.

No original/private corpus artifact was accessed, enumerated, copied, or loaded. The previously denied specific metadata path was not retried or approached through another tool. No models, credentials, package installs, inline `-c` scripts, commits, or pushes were used. Only this report was authored by the reviewer.

## Remaining operational gates

The actual approved snapshot and exhaustive manifest still require separate authorization, integrity/provenance review, and resolution of the access denial before any real load. This report does not populate a manifest or change `reviewApproved`.

The loader supplies protocol inputs plus counts, not approved evidence payloads, validated eligibility candidates, historical baseline results, span/rubric support, or an execution-ready benchmark cohort. Complete historical cohort membership, real source/duplicate/split totals, frozen evidence availability, baseline availability, cumulative spend, and the requested exact Qwen model IDs remain **UNKNOWN / unverified**. No paid-work authorization or certification of the cumulative budget follows from this approval.
