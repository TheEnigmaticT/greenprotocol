# Local Solvent Evidence Catalogue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve validated local CHEM21, measured solubility/density, and cached PubChem GHS evidence to scoped chat, and permit only rigorously gated solvent-screening recommendations.

**Architecture:** Git LFS holds immutable source data and provenance manifests. A deterministic Python importer builds an ignored SQLite read model; a separate, explicitly launched PubChem harvester checkpoints and snapshots the 239 indexed solvent identities. The chemistry service exposes bounded local lookup/screening operations, while the Qwen tool boundary preserves frozen protocol context and the UI labels every source and uncertainty.

**Tech Stack:** Python 3.14, FastAPI, Pydantic, standard-library `csv`/`sqlite3`/`hashlib`, `httpx`, RDKit, Git LFS, Next.js 16, TypeScript, Vitest, Playwright browser smoke.

## Global Constraints

- Version raw CHEM21, BigSolDB, MixtureSolDB, and density files with Git LFS; version manifests, source code, and tests in ordinary Git.
- Preserve source identity, measurement conditions, DOI/reference, license/attribution, raw-file SHA-256, and import schema version.
- Do not call ACS/RSC/CHEM21, scrape SDS PDFs, or contact any third party in a chat request.
- PubChem GHS harvesting is operator-started, single-instance, checkpointed, and limited to one request per two seconds before dynamic-throttling backoff.
- `lookup_chem21_solvent`, experimental-evidence, hazard-profile, and screening reads are local-only. Existing live PubChem/RDKit tools remain scoped to frozen-context chemicals.
- CHEM21 is the only explicit-alternative source. BigSolDB/MixtureSolDB/density data are observations, never substitute endorsements.
- A screening recommendation requires: exact normalized solute structure; same-temperature pure-solvent observations; candidate mole-fraction solubility at least the current solvent’s; complete local GHS profiles; a strict category improvement; and no more-severe CMR, acute, organ, environmental, or physical hazard.
- The browser copy must require laboratory compatibility validation and must name rate, selectivity, catalyst, workup, crystallization, and scale-up as unresolved.

---

## File structure

| Path | Responsibility |
|---|---|
| `.gitattributes` | Route immutable raw solvent-evidence files through Git LFS. |
| `services/chemistry/data/solvent-evidence/raw/` | LFS-managed CHEM21, BigSolDB, MixtureSolDB, and density source files. |
| `services/chemistry/data/solvent-evidence/manifests/*.json` | Source URL/DOI/license/attribution/hash/schema metadata. |
| `services/chemistry/data/solvent-evidence/solvent-evidence.sqlite` | Ignored generated read model; never authoritative. |
| `services/chemistry/solvent_evidence_schema.py` | Typed source records, normalization, validation, and screening result types. |
| `services/chemistry/solvent_evidence_import.py` | CSV/manifest validation and transactional SQLite-index builder. |
| `services/chemistry/solvent_evidence_store.py` | Local CHEM21, measurement, hazard-profile, and screening read queries. |
| `services/chemistry/solvent_hazard_harvest.py` | Resumable, throttle-aware PubChem GHS harvester with snapshot persistence. |
| `scripts/chemistry/build_solvent_evidence_index.py` | Explicit CLI for validating assets and rebuilding SQLite. |
| `scripts/chemistry/harvest_solvent_hazards.py` | Explicit CLI for the single-instance 0.5 request/s PubChem harvest. |
| `services/chemistry/chem21.py` | Compatibility adapter used by P5 and current consumers. |
| `services/chemistry/assistant_tools.py` | Validated local CHEM21/evidence/hazard/screening operations. |
| `services/chemistry/test_solvent_evidence*.py` | Unit and integration tests for imports, queries, and harvest behavior. |
| `lib/talk-about-this/tools.ts` | OpenAI-compatible schemas and frozen-context enforcement. |
| `lib/talk-about-this/agent.ts` | Parse/route new calls and stream informative lifecycle payloads. |
| `lib/talk-about-this/prompt.ts` | Source boundaries and required screening language. |
| `components/TalkAboutThis.tsx` | Source-labelled local-evidence activity and screening uncertainty presentation. |
| `tests/lib/talk-about-this/*.test.ts` | Tool-schema, guard, agent, prompt, and activity regression coverage. |

### Task 1: Version source assets and validate provenance

**Files:**
- Create: `.gitattributes`
- Create: `services/chemistry/data/solvent-evidence/raw/{CHEM21_full.csv,BigSolDBv2.0.csv,MixtureSolDB.csv,BigSolDBv2.0_densities.csv}`
- Create: `services/chemistry/data/solvent-evidence/manifests/{chem21,bigsoldb,mixturesoldb,densities}.json`
- Create: `services/chemistry/solvent_evidence_schema.py`
- Create: `services/chemistry/test_solvent_evidence_schema.py`

**Interfaces:**
- Produces `DatasetManifest`, `Chem21Record`, `SingleSolubilityRecord`, `MixtureSolubilityRecord`, `DensityRecord`, `normalize_identity(value: str) -> str`, and `validate_manifest(path, asset_path) -> DatasetManifest`.
- Raw input locations are `/Users/ct-mac-mini/Downloads/Solvent DBs/CHEM21_full.csv`, `BigSolDBv2.0.csv`, `MixtureSolDB.csv`, and `BigSolDBv2.0_densities.csv`.

- [ ] **Step 1: Write failing schema/provenance tests.**

```python
def test_chem21_manifest_and_csv_have_53_valid_records(tmp_path):
    manifest = validate_manifest(manifest_path, chem21_csv)
    records = list(read_chem21_csv(chem21_csv))
    assert manifest.record_count == 53
    assert len(records) == 53
    assert records_by_name(records)["n,n-dimethylformamide"].scores == (3, 9, 5)


def test_manifest_rejects_hash_and_required_column_mismatches(tmp_path):
    with pytest.raises(ValueError, match="SHA-256"):
        validate_manifest(manifest_path, tampered_csv)
    with pytest.raises(ValueError, match="Ranking Default"):
        list(read_chem21_csv(csv_without_ranking))
```

- [ ] **Step 2: Run the focused test and confirm it fails because the schema module does not exist.**

Run: `python3 -m pytest services/chemistry/test_solvent_evidence_schema.py -q`

Expected: collection failure for `solvent_evidence_schema`.

- [ ] **Step 3: Configure Git LFS and add immutable raw files plus manifests.**

```gitattributes
/services/chemistry/data/solvent-evidence/raw/*.csv filter=lfs diff=lfs merge=lfs -text
/services/chemistry/data/solvent-evidence/raw/pubchem-ghs/*.json filter=lfs diff=lfs merge=lfs -text
```

Run `git lfs install`, copy the four named downloads to `raw/`, compute SHA-256 and record it in each manifest. Use these source identities: BigSolDB v2 DOI `10.5281/zenodo.15094979`, BigSolDB paper DOI `10.1038/s41597-025-05559-8`, MixtureSolDB DOI `10.5281/zenodo.18660057`; mark CHEM21 as `manual_acquisition` with source DOI `10.1039/C5GC01008J` and `reuse_status: "unverified"`.

- [ ] **Step 4: Implement typed parsing and validation.**

```python
@dataclass(frozen=True)
class Chem21Record:
    name: str
    aliases: tuple[str, ...]
    cas: str
    pubchem_id: int | None
    scores: tuple[int, int, int]
    classification: Literal["recommended", "problematic", "hazardous", "highly_hazardous"]
    replacements: tuple[str, ...]


def normalize_identity(value: str) -> str:
    return " ".join(value.casefold().replace("_", " ").split())
```

Parse the four documented CSV schemas with `csv.DictReader`; reject missing columns, duplicate normalized CHEM21 names/CAS values, invalid ranking text, and scores outside 1–10. Preserve raw units and source DOI values exactly.

- [ ] **Step 5: Run tests and inspect the LFS pointers.**

Run: `python3 -m pytest services/chemistry/test_solvent_evidence_schema.py -q && git lfs ls-files`

Expected: schema tests pass; all four raw CSVs appear as LFS-tracked files.

- [ ] **Step 6: Commit the source boundary.**

```bash
git add .gitattributes services/chemistry/data/solvent-evidence services/chemistry/solvent_evidence_schema.py services/chemistry/test_solvent_evidence_schema.py
git commit -m "feat: add versioned solvent evidence sources"
```

### Task 2: Build the local SQLite index and replace the CHEM21 map

**Files:**
- Create: `services/chemistry/solvent_evidence_import.py`
- Create: `services/chemistry/solvent_evidence_store.py`
- Create: `scripts/chemistry/build_solvent_evidence_index.py`
- Create: `services/chemistry/test_solvent_evidence_import.py`
- Modify: `services/chemistry/chem21.py`
- Modify: `services/chemistry/scoring/p5_safer_solvents.py`
- Modify: `.gitignore`

**Interfaces:**
- Produces `build_index(raw_dir: Path, manifests_dir: Path, output: Path) -> ImportReport` and `SolventEvidenceStore(path).lookup_chem21(name) -> dict | None`.
- `lookup_solvent_with_evidence(name)` preserves its current response keys: `name`, `classification`, `scores.{safety,health,environment,overall}`, and `evidence`; it adds `replacements` only when present.

- [ ] **Step 1: Write failing importer/store tests.**

```python
def test_build_index_is_transactional_and_queries_all_measurement_kinds(tmp_path):
    report = build_index(fixture_raw, fixture_manifests, tmp_path / "evidence.sqlite")
    store = SolventEvidenceStore(report.index_path)
    assert store.lookup_chem21("DMF")["scores"] == {"safety": 3, "health": 9, "environment": 5, "overall": 9}
    assert store.single_solubility(solute_smiles, "ethanol", 298.15)[0]["source"] == "10.1007/example"
    assert store.mixture_solubility(solute_smiles, "ethanol", "water", 0.5, "mole")
    assert store.density("ethanol", 298.15)[0]["density_g_per_cm3"] > 0


def test_failed_rebuild_leaves_prior_valid_index_untouched(tmp_path):
    build_index(valid_raw, manifests, index)
    with pytest.raises(ValueError):
        build_index(invalid_raw, manifests, index)
    assert SolventEvidenceStore(index).lookup_chem21("DMF") is not None
```

- [ ] **Step 2: Run the focused tests and confirm the importer is absent.**

Run: `python3 -m pytest services/chemistry/test_solvent_evidence_import.py -q`

Expected: import/collection failure for `solvent_evidence_import`.

- [ ] **Step 3: Implement the transactional builder and query store.**

Create normalized tables, schema metadata, and indexes for CHEM21 aliases, single-solubility rows, mixture rows, density rows, and later hazard profiles. Build to `solvent-evidence.sqlite.tmp`, run `PRAGMA integrity_check`, then use `Path.replace()` only after all manifests/hashes/rows validate. Add `services/chemistry/data/solvent-evidence/*.sqlite*` to `.gitignore`.

- [ ] **Step 4: Move `chem21.py` to the compatibility adapter.**

```python
def lookup_solvent_with_evidence(name: str) -> dict | None:
    row = get_store().lookup_chem21(name)
    if row is None:
        return None
    return {
        "name": row["name"],
        "classification": row["classification"],
        "scores": row["scores"],
        "evidence": CHEM21_CITATION,
        "replacements": row["replacements"],
    }
```

Delete the duplicate `_add(...)` map. Update P5’s unknown-solvent path to report CHEM21 data unavailable rather than silently treating an index failure as a `problematic` classification; preserve its ordinary unknown-solvent behavior only when the index is healthy.

- [ ] **Step 5: Build the real index and verify service compatibility.**

Run:

```bash
python3 scripts/chemistry/build_solvent_evidence_index.py --raw services/chemistry/data/solvent-evidence/raw --manifests services/chemistry/data/solvent-evidence/manifests --output services/chemistry/data/solvent-evidence/solvent-evidence.sqlite
python3 -m pytest services/chemistry/test_solvent_evidence_import.py services/chemistry/test_assistant_tools.py -q
```

Expected: 53 CHEM21 records, 103,944 single-solubility rows, 175,626 mixture rows, and 2,210 density rows reported; existing assistant-tool tests pass after updating DMF expectations to the imported evidence.

- [ ] **Step 6: Commit the index foundation.**

```bash
git add .gitignore services/chemistry/{chem21.py,solvent_evidence_import.py,solvent_evidence_store.py,scoring/p5_safer_solvents.py,test_solvent_evidence_import.py} scripts/chemistry/build_solvent_evidence_index.py
git commit -m "feat: build local solvent evidence index"
```

### Task 3: Harvest and serve a durable PubChem GHS snapshot

**Files:**
- Create: `services/chemistry/solvent_hazard_harvest.py`
- Create: `scripts/chemistry/harvest_solvent_hazards.py`
- Create: `services/chemistry/test_solvent_hazard_harvest.py`
- Modify: `services/chemistry/ghs.py`
- Modify: `services/chemistry/solvent_evidence_store.py`

**Interfaces:**
- Produces `harvest_hazards(store, client, snapshot_dir, now, sleep) -> HarvestReport` with state values `unresolved`, `cid_resolved`, `ghs_fetched`, `complete`, and `terminal_not_found`.
- Produces `SolventEvidenceStore.hazard_profile(solvent: str) -> HazardProfile | None`.

- [ ] **Step 1: Write deterministic harvest tests with an injected HTTP client and clock.**

```python
def test_harvest_resumes_without_duplicate_requests_and_respects_two_second_pacing():
    client = FakePubChemClient(cid=702, ghs_payload=dmf_ghs, throttle="Request Count status: Green")
    report = harvest_hazards(store, client, snapshots, now=fake_clock.now, sleep=fake_clock.sleep)
    assert report.complete == 1
    assert fake_clock.sleeps == [2.0]
    assert hazard_profile(store, "DMF").cmr is True
    assert harvest_hazards(store, client, snapshots, now=fake_clock.now, sleep=fake_clock.sleep).requests == 0


def test_harvest_records_terminal_not_found_and_backs_off_on_pubchem_throttle():
    client = FakePubChemClient(sequence=[HttpResponse(503, headers={}), HttpResponse(404, headers={})])
    report = harvest_hazards(store, client, snapshots, now=fake_clock.now, sleep=fake_clock.sleep)
    assert report.terminal_not_found == 1
    assert fake_clock.sleeps == [2.0]
```

- [ ] **Step 2: Run the focused tests and confirm they fail.**

Run: `python3 -m pytest services/chemistry/test_solvent_hazard_harvest.py -q`

Expected: collection failure for `solvent_hazard_harvest`.

- [ ] **Step 3: Implement the single-instance harvester.**

Reuse `ghs.lookup_hcodes_with_details` parsing logic, but expose a client seam that returns status, headers, and JSON. Persist one raw JSON snapshot per CID plus its manifest before marking a profile complete. Parse H-codes into the existing CMR/health/environment/physical categories. Sleep 10 seconds after a yellow throttle status and 60 seconds after a red status; for 429/503, sleep `min(300, 2 ** retry_attempt)` seconds before retrying. Write state durably after every network outcome. Use a filesystem lock to reject concurrent workers.

- [ ] **Step 4: Run behavior tests and launch the real slow worker.**

Run: `python3 -m pytest services/chemistry/test_solvent_hazard_harvest.py -q`

Then launch exactly one supervised process:

```text
application: python3
args: [scripts/chemistry/harvest_solvent_hazards.py, --database, services/chemistry/data/solvent-evidence/solvent-evidence.sqlite, --snapshots, services/chemistry/data/solvent-evidence/raw/pubchem-ghs, --interval-seconds, 2]
ready log: Harvest started.*239
```

Observe its first completed checkpoint and throttling status. Do not start a second worker. The worker is the only planned live PubChem traffic.

- [ ] **Step 5: Commit the harvest implementation, not transient SQLite state.**

```bash
git add services/chemistry/{ghs.py,solvent_evidence_store.py,solvent_hazard_harvest.py,test_solvent_hazard_harvest.py} scripts/chemistry/harvest_solvent_hazards.py .gitattributes
git commit -m "feat: cache PubChem solvent hazard profiles"
```

### Task 4: Enforce evidence and screening gates in the chemistry service

**Files:**
- Create: `services/chemistry/solvent_screening.py`
- Create: `services/chemistry/test_solvent_screening.py`
- Modify: `services/chemistry/assistant_tools.py`
- Modify: `services/chemistry/main.py`
- Modify: `services/chemistry/test_assistant_tools.py`

**Interfaces:**
- Adds operations `solvent_evidence`, `solvent_hazard`, and `solvent_screening` to `AssistantToolRequest`.
- `screen_candidates(solute_smiles: str, current_solvent: str, temperature_k: float) -> list[ScreeningCandidate]` accepts a server-authenticated canonical solute SMILES supplied by the Qwen boundary only after its scoped PubChem profile completed.

- [ ] **Step 1: Write failing screening and request-validation tests.**

```python
def test_screening_requires_exact_structure_same_temperature_and_complete_non_regressing_hazards():
    candidates = screen_candidates(solute_smiles, "DMF", 298.15)
    assert [candidate.solvent for candidate in candidates] == ["Acetonitrile"]
    assert candidates[0].solubility_mole_fraction >= candidates[0].current_solubility_mole_fraction
    assert candidates[0].recommendation == "laboratory_screening"

@pytest.mark.parametrize("mutation", ["different_structure", "temperature_303_15", "lower_solubility", "missing_ghs", "adds_h350"])
def test_screening_rejects_every_failed_gate(mutation):
    assert screen_candidates_for_fixture(mutation) == []
```

- [ ] **Step 2: Run the focused tests and confirm failure.**

Run: `python3 -m pytest services/chemistry/test_solvent_screening.py services/chemistry/test_assistant_tools.py -q`

Expected: missing screening module and unsupported operation failures.

- [ ] **Step 3: Implement typed local-only service operations.**

Define discriminated Pydantic request models rather than an unvalidated parameter dictionary. `solvent_evidence` accepts a mode plus exact solute/solvent/co-solvent/temperature fields; `solvent_hazard` accepts one solvent; `solvent_screening` accepts a server-authenticated `solute_smiles`, a current solvent, and temperature. Cap raw measurement results at 20 and return a truncation warning. Reject non-finite temperature, unknown mode, and malformed identities before querying SQLite.

- [ ] **Step 4: Implement the partial-order screening gate server-side.**

```python
def is_strict_hazard_improvement(current: HazardProfile, candidate: HazardProfile) -> bool:
    current_levels = current.category_levels()
    candidate_levels = candidate.category_levels()
    return (
        all(candidate_levels[k] <= current_levels[k] for k in current_levels)
        and any(candidate_levels[k] < current_levels[k] for k in current_levels)
    )
```

Join only observations with the identical normalized solute structure and `abs(measurement.temperature_k - requested_temperature_k) <= 0.01`. Compare `Solubility(mole_fraction)`; exclude mixtures and incomplete/unresolved hazard profiles. Return the measured rows, category-by-category comparison, source citations, CHEM21 relation if present, and the mandatory validation warning. Never return a candidate that merely resembles the current solute or has a tradeoff in any hazard category.

- [ ] **Step 5: Run service regression tests.**

Run: `python3 -m pytest services/chemistry/test_solvent_screening.py services/chemistry/test_assistant_tools.py services/chemistry/test_solvent_evidence_import.py -q`

Expected: all local operations are authenticated when `CHEMISTRY_SERVICE_TOKEN` is configured; no test reaches PubChem.

- [ ] **Step 6: Commit the service boundary.**

```bash
git add services/chemistry/{assistant_tools.py,main.py,solvent_screening.py,test_solvent_screening.py,test_assistant_tools.py}
git commit -m "feat: expose local solvent evidence screening"
```

### Task 5: Extend the frozen-context Qwen tool boundary

**Files:**
- Modify: `lib/talk-about-this/tools.ts`
- Modify: `lib/talk-about-this/agent.ts`
- Modify: `lib/talk-about-this/prompt.ts`
- Modify: `tests/lib/talk-about-this/tools.test.ts`
- Modify: `tests/lib/talk-about-this/agent.test.ts`
- Create: `tests/lib/talk-about-this/prompt.test.ts`

**Interfaces:**
- Adds `lookup_experimental_solvent_evidence`, `lookup_solvent_hazard_profile`, and `screen_solvent_candidates` tool names.
- `parseScopedToolCall()` permits catalogue solvents only for local CHEM21/hazard evidence, requires both the solute and current solvent to be frozen-context chemicals for screening, and attaches a canonical solute SMILES only from a preceding scoped `lookup_pubchem_profile` tool result in the same server-side tool loop.

- [ ] **Step 1: Write failing TypeScript tests for schemas and guards.**

```ts
expect(buildChatTools(context)).toEqual(expect.arrayContaining([
  expect.objectContaining({ function: expect.objectContaining({ name: 'screen_solvent_candidates' }) }),
]))
await expect(executeScopedTool(context, {
  id: 'x', name: 'screen_solvent_candidates', solute: 'benzene', currentSolvent: 'DMF', temperatureK: 298.15,
})).rejects.toThrow('outside this scoped discussion')
```

Also assert CHEM21/hazard lookup can request a local catalogue candidate such as ethyl acetate, and PubChem/RDKit cannot.

- [ ] **Step 2: Run the focused tests and confirm failure.**

Run: `npm test -- tests/lib/talk-about-this/tools.test.ts tests/lib/talk-about-this/agent.test.ts tests/lib/talk-about-this/prompt.test.ts`

Expected: tool-name/schema assertion failures.

- [ ] **Step 3: Implement schemas, parser, and local service routing.**

Keep `additionalProperties: false`. Give experimental evidence an explicit `mode` enum; require scoped `solute`, `solvent`, and `temperatureK` for solubility; and allow density/hazard requests only against local indexed solvents. `screen_solvent_candidates` requires scoped `solute`, scoped `currentSolvent`, and `temperatureK`; reject it with `Resolve the scoped solute with PubChem before screening` unless `runScopedToolChat()` has already received a canonical SMILES from the scoped PubChem result for that solute. Send that trusted SMILES to the chemistry service, never a model-supplied structure. Extend `ToolResult.operation` to include `solvent_evidence`, `solvent_hazard`, and `solvent_screening`. Map activity payloads to dataset/source/measurement metadata without sending hidden analysis data to the provider.

- [ ] **Step 4: Tighten the system prompt.**

Add explicit instructions: only a `solvent_screening` result with `recommendation: "laboratory_screening"` permits that phrasing; CHEM21 endorsement exists only when its returned replacement relation names the candidate; missing GHS means unknown, never safe; measurements do not prove reaction performance.

- [ ] **Step 5: Run TypeScript regression tests.**

Run: `npm test -- tests/lib/talk-about-this/tools.test.ts tests/lib/talk-about-this/agent.test.ts tests/lib/talk-about-this/prompt.test.ts`

Expected: local catalogue access is allowed only for the three new local-evidence workflows; frozen-context escapes are rejected.

- [ ] **Step 6: Commit the model boundary.**

```bash
git add lib/talk-about-this/{tools.ts,agent.ts,prompt.ts} tests/lib/talk-about-this/{tools.test.ts,agent.test.ts,prompt.test.ts}
git commit -m "feat: ground chat in local solvent evidence"
```

### Task 6: Present source-labelled evidence and verify the workflow

**Files:**
- Modify: `components/TalkAboutThis.tsx`
- Modify: `app/api/talk-about-this/[conversationId]/messages/route.ts`
- Create: `tests/lib/talk-about-this/activity.test.ts`
- Modify: `.env.local.example`

**Interfaces:**
- Activity events display source, operation, status, and a short honest measurement/hazard summary.
- Screening output always includes the laboratory-validation disclosure and source/provenance values.

- [ ] **Step 1: Write failing activity/copy tests.**

```ts
expect(activityForEvent('tool-complete', {
  tool: 'screen_solvent_candidates', source: 'BigSolDB + PubChem GHS', status: 'ok',
})).toMatchObject({ label: 'Received local solvent screening evidence' })
expect(buildTalkAboutSystemPrompt(context)).toContain('laboratory compatibility validation')
```

- [ ] **Step 2: Run focused tests and confirm failure.**

Run: `npm test -- tests/lib/talk-about-this/activity.test.ts`

Expected: missing activity formatter or expected copy.

- [ ] **Step 3: Implement safe presentation.**

Render a source-labelled activity row for CHEM21, BigSolDB, MixtureSolDB, density, and PubChem GHS events. Do not render tool-returned URLs as trusted HTML. Preserve the existing safe GFM behavior. Show completed local screening only with its validation disclosure; show unavailable/missing profile state without downgrading it to safe.

- [ ] **Step 4: Add operator configuration documentation.**

Document `CHEMISTRY_SERVICE_URL`, `CHEMISTRY_SERVICE_TOKEN`, local index path, and the explicit hazard-harvest command. Do not add a CHEM21 API-key setting because no endpoint is used.

- [ ] **Step 5: Verify automated and browser workflows.**

Run:

```bash
npm test
npm run build
```

Then use the authenticated browser at `http://127.0.0.1:3001` to open a scoped analysis and ask for a solvent comparison. Verify: tool activity appears; the answer shows raw source conditions and PubChem GHS provenance; a recommendation appears only with all gate evidence; the immutable analysis payload is unchanged. Also test one failed gate and observe a candidate/warning rather than a recommendation.

- [ ] **Step 6: Commit the user-facing integration.**

```bash
git add components/TalkAboutThis.tsx app/api/talk-about-this/[conversationId]/messages/route.ts tests/lib/talk-about-this/activity.test.ts .env.local.example
git commit -m "feat: present grounded solvent evidence"
```

## Final verification checklist

- [ ] `git lfs ls-files` lists the four raw solvent source assets.
- [ ] The index build reports the exact source row counts and passes `PRAGMA integrity_check`.
- [ ] The single supervised PubChem worker reaches at least one durable `complete` checkpoint and honors its two-second interval.
- [ ] Python chemistry-service tests pass.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] Browser smoke proves both a fully gated screening recommendation and a rejected unsafe/insufficient-evidence candidate without mutating the analysis.
