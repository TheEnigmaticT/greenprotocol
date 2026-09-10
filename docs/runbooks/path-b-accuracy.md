# Path B accuracy verification

Scope: `feat/local-model-pipeline`, starting at `7af3d21`. Target runtime model is explicitly configured as `qwen/qwen3.8-27b`; the runtime does not silently choose this model when configuration is absent.

Further accuracy work follows the [scientific pipeline realignment contract](scientific-pipeline-realignment.md): restore evidence before decisions rather than tune prompts to force more substitutions. The recorded runs below predate that realignment.

## Runtime boundaries

`components/ProtocolInput.tsx` submits to the authenticated `/api/analyze` SSE route. The route creates an audit run, invokes `lib/pipeline.ts`, then persists the analysis and any complete canonical scoring snapshot in owner-scoped Supabase tables. The result is rendered by the recommendation/result components, which also use `lib/recommendation-kind.ts`.

The local path uses `local-parse.ts` and `local-result-validate.ts` before downstream consumption. Principles generate recommendations; kind classification segregates substitutions from process/analytical advice. Inventory-gated repair may propose missing substitutions. Only substitution recommendations enter literature grounding, reevaluation and protocol assembly. Chemistry enrichment/scoring and literature evidence are separate service/data dependencies. These changes do not change workers, persistence schemas, ownership, or confidence downgrade policy.

`GCAI_LOCAL_PIPELINE=1` is a fail-closed provider boundary: local-stage failures must not fall through to Anthropic. `GCAI_LOCAL_PROVIDER=openrouter` means hosted inference of local-capable models, not on-device execution. Ollama is the on-device alternative.

## Observable acceptance

- A dose/condition instruction or analytical method is not represented as a chemical substitution.
- Monitoring mentioned in a real substitution's rationale/caveats does not hide the substitution.
- Hollow alternatives and declared identity substitutions fail validation before literature/reevaluation/assembly; the existing bounded repair can correct the response.
- Repair substitutions replace an actual hazardous inventory entry, including reagent/catalyst entries, without raising confidence or hardcoding a brand.
- A parsed chemical name occurs in its own verbatim source step, rather than being imported from another step.
- Actual improvement in stochastic aspirin output requires repeated live runs; passing synthetic regression tests is not evidence of that improvement.

## Local checks

Focused regression check:

```sh
npx vitest run tests/lib/recommendation-kind.test.ts tests/lib/local-result-validate.test.ts tests/lib/local-parse.test.ts tests/lib/hazardous-inventory.test.ts tests/lib/chemical-swap-repair.test.ts tests/lib/local-pipeline-routing.test.ts
```

Existing CI gates remain authoritative:

```sh
npm run test
npm run lint
npx tsc --noEmit
npm run build
```

If discovery tests fail under parallel load, preserve the original failure log and rerun `npm run test -- --maxWorkers=1`. A serial pass does not prove default parallel execution is fixed; do not delete the failing tests.

## Live-model check (separate approval/configuration gate)

Existing runner: `scripts/smoke-full-analyze-local.ts`. It loads `.env.local`; do not display credentials. The user authorized hosted Qwen validation without the proposed $5 cap; keep experiments bounded by a concrete question rather than spend. Set the local pipeline/provider/model explicitly. Use the built-in aspirin fixture and a reviewed non-aspirin protocol file, with a unique `OUT_SUMMARY` and captured stdout/stderr for each run. Preserve failures as well as successes.

The smoke runner calls the pipeline directly, not the authenticated web route: it does not verify browser SSE, database persistence, or background recovery. Its `ok: true` means a result returned, not that recommendation quality, scoring availability or assembly passed. Review recommendation identities/kinds, low-confidence downgrades, empty revised protocols, and chemistry availability explicitly. Its summaries do not preserve full raw model responses; a proper repeated accuracy benchmark needs approved raw-response capture and spend accounting before it can establish a stochastic improvement.

## Verification recorded for this change

- Full serial suite: **930 tests passed across 71 files** after the live-derived regressions.
- Full lint, TypeScript, production build and `git diff --check` passed. Existing lint warnings remain. Environment dictionary types and typed fetch mocks were corrected without changing provider behavior.
- Default parallel tests still have an intermittent discovery-attribution failure (`OPEN_IDENTITY_CHANGED` instead of the injected fault). The descriptor helper compares directory timestamps during traversal, so concurrent shared-ancestor mutation is a plausible cause; its security checks were not relaxed. The real-I/O file-count test now has a scoped 20-second timeout after measured execution exceeded 8 seconds under parallel load; its 2049-file limit assertion is unchanged.
- **Seven hosted runs returned results:** four aspirin, three Suzuki. All parsed and scored; two aspirin runs had a principle timeout and continued with partial principle coverage. This is not seven accuracy passes.
- Raw requests/responses (without authentication headers), summaries and failure logs are retained in `/tmp/gcai-path-b-live` and `/tmp/gcai-path-b-live-evidence.tar.gz`. A hashed response manifest is in [path-b-live-evidence.json](../benchmarks/path-b-live-evidence.json).
- The runs exposed correctly model-labeled process instructions being promoted by our distinct-name heuristic. Exact addition, dose, stoichiometry, purification and recovery phrases now have regression tests that assert exclusion from both reevaluation and assembly. The final recovery-from correction was verified offline, not by another live run.
- Latest Suzuki run: four substance swaps, three process recommendations, three analytical recommendations. This demonstrates classification on that sample, not chemical validation or universal accuracy.
- Aspirin remains inconsistent. Catalyst candidates were low/medium confidence; bogus process suggestions also entered older run outputs. Do not claim stronger or scientifically validated aspirin alternatives.
- The chemistry service and local literature index were exercised by direct pipeline runs. Authenticated browser/SSE and persistence were not: browser automation timed out, and an unauthenticated request to the worktree app at `127.0.0.1:3001/analyze` redirected to `/login`. No auth bypass, database write, or worker validation was attempted.
- Existing user edits adding allowed models in `lib/local-llm.ts` were preserved. No commit, push, merge or deploy.

## Remaining release blockers / follow-up

1. **Evidence-to-assembly boundary:** captured reevaluations can report `supportsAlternative: false` and `contextMatch: none` yet the low-confidence candidate is still incorporated into the draft revised protocol. Example artifacts: `aspirin-1/model-016.json`, `suzuki-1/model-014.json`, `suzuki-1/model-018.json`, and their assembly outputs. Retaining a hypothesis card is different from automatically applying it. A defined assembly eligibility policy is needed; confidence labels alone do not validate chemistry.
2. **Aspirin substance quality:** repeated runs did not establish consistent evidence-supported reagent/catalyst alternatives. More prompt pressure to emit a swap is not evidence of a usable replacement.
3. **Parallel discovery reliability and authenticated UI/persistence verification** remain open as described above. Serial test success and direct pipeline smoke success are not substitutes for these checks.
