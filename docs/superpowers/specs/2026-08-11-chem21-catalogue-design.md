# Local Solvent Evidence Catalogue and Scoped Scientific Chat Design

**Status:** Approved for final-spec review

## Goal

Replace GC.ai's incomplete hand-maintained CHEM21 map with a validated 53-record catalogue, provide locally stored experimental solvent evidence in the read-only scientific chat, and expose a complete local PubChem GHS hazard snapshot for every solvent represented by the imported evidence sources. The system must never conflate hazard classifications, physical measurements, and reaction suitability.

## Problem

GC.ai currently uses a manually maintained 40-solvent Python map for CHEM21 lookups. The file claims to represent the 53-solvent CHEM21 guide, but omits 13 records and disagrees with the user-provided 53-row CSV for existing entries such as DMF. The chat also restricts CHEM21 lookups to solvents already named in its frozen analysis context, preventing grounded discussion of candidate substitutes.

The supplied local source collection includes distinct evidence types:

| Source | Evidence | Scope | License status |
|---|---|---|---|
| `CHEM21_full.csv` | CHEM21 S/H/E scores, rankings, explicit replacements | 53 solvents | User-supplied local file; provenance/reuse status must be recorded before distribution. |
| BigSolDB v2 | Measured single-solvent solubility | 103,944 rows; 213 solvents; 1,448 solutes | CC BY 4.0 dataset; preserve upstream attribution and DOI. |
| MixtureSolDB | Measured binary-mixture solubility | 175,626 rows; 139 solvents; 813 solutes | CC BY 4.0 dataset; preserve upstream attribution and DOI. |
| BigSolDB densities | Measured temperature-indexed density | 2,209 rows; 70 solvents | Preserve upstream attribution and DOI. |
| PubChem GHS snapshot | GHS classifications and H-code descriptions | Union of 239 indexed solvent identities | PubChem PUG-View evidence; preserve CID, endpoint, retrieval timestamp, raw snapshot hash, and throttling status. |

The 281,779 BigSolDB/MixtureSolDB/density rows are individual measurements across solute–solvent–temperature conditions, not unique solvents. The source-union contains 239 solvents.

`soluprotmutdb_dump.zip` is a protein-mutation database, `IS111.ZIP` is a legacy installer, and Solv@TUM is partition/free-energy evidence outside this release. None is included.

There is no configured CHEM21 credential or verified official CHEM21 software API. No request path may scrape, poll, or call an ACS/RSC/CHEM21 endpoint. Supplier SDS acquisition is also outside this release: supplier documents are versioned, source-specific, and may carry terms that prevent automated collection or redistribution.

## Data authority and provenance

Each raw source asset is immutable and retained through Git LFS under `services/chemistry/data/solvent-evidence/raw/`. A normal Git manifest accompanies each asset and records:

- dataset ID, version, upstream URL and DOI;
- license, required attribution, and retrieval date;
- SHA-256, byte size, record count, and expected input schema;
- the exact importer version and derived-index schema version.

The raw files, rather than generated code or SQLite output, are authoritative. The CHEM21 manifest must record the supplied CSV's source URL or a clear manual-acquisition note and its reuse status. It must never claim license confirmation when that information is absent.

Each PubChem response snapshot is stored as an immutable raw artifact keyed by resolved CID. Its normal-Git manifest records the query URL, retrieval timestamp, HTTP status, `X-Throttling-Control` value when supplied, SHA-256, and parser version. A normalized profile is usable only when its raw snapshot and metadata agree.

The SSG repository is not a CHEM21 substitute. Its 365-solvent JSON and `chem21.js` generate a CHEM21-inspired assessment from a separate property corpus; it is outside this release.

## Architecture

### Immutable source assets and generated query index

An import command validates every LFS source and builds a single generated SQLite read model at `services/chemistry/data/solvent-evidence/solvent-evidence.sqlite`. The SQLite file is ignored by Git and is not a source of truth. Its metadata table records every verified source hash and importer/schema version.

The importer creates these read tables:

- `chem21_solvents`: canonical solvent name, normalized aliases, CAS, PubChem ID, family, S/H/E scores, default/discussion ranking, replacement issue, and two raw replacement names;
- `single_solubility_measurements`: solute/solvent SMILES and names, CAS/PubChem ID, temperature K, all reported solubility units, FDA flag, and source DOI;
- `mixture_solubility_measurements`: all single-solubility identity fields plus both solvent names/SMILES, fraction and fraction type;
- `density_measurements`: solvent, temperature K, density, and source DOI;
- `solvent_hazard_profiles`: canonical solvent identity, resolved PubChem CID, H-code/descriptions, CMR/acute/organ/environmental/physical category flags, source URL, raw snapshot hash, HTTP retrieval time, and current harvest state.

Indexes support exact normalized solvent/solute name, exact SMILES, CAS, dataset kind, and temperature-ordered retrieval. The index is built in a temporary SQLite file, integrity-checked, then atomically replaced. A missing, hash-mismatched, or schema-invalid index makes the affected local lookup unavailable; it never triggers a network fetch or falls back to the old hand-maintained map.

### CHEM21 compatibility adapter

`lookup_solvent_with_evidence()` remains the compatibility adapter used by P5 scoring and the chemistry assistant tool. It reads the indexed CHEM21 record and continues returning the existing classification, scores, and Prat citation shape. It may add only catalogued provenance and replacement data.

The loader maps CSV ranking text to the existing lower-case `recommended`, `problematic`, `hazardous`, and `highly_hazardous` values. It rejects missing required columns, duplicate normalized names or CAS numbers, unknown rankings, nonnumeric scores, and scores outside 1–10.

### PubChem GHS snapshot harvest

A standalone command builds the hazard snapshot from the 239 solvent identities derived from the validated data index. It is not run by the web service or a chat request.

The durable job state is `unresolved`, `cid_resolved`, `ghs_fetched`, `complete`, or `terminal_not_found`. It resolves a solvent to a CID, requests only the PubChem PUG-View `GHS Classification` heading, writes the raw response snapshot and manifest, parses structured H-code data through the existing GHS parser, and stores the normalized profile.

The worker sends at most one request every two seconds. It reads PubChem's `X-Throttling-Control` header: yellow extends the interval, red pauses the job, and 429/503 responses use exponential backoff. Other terminal 4xx responses are recorded without retry. The job checkpoints each state transition so it can resume after interruption without duplicate requests. It must not start automatically or run concurrently more than once.

A successful harvest is not required for the measurement index to operate. An unresolved or terminal-not-found solvent remains an explicit gap; it is never treated as non-hazardous.

### Read-only scientific-chat tools

The saved protocol, analysis, recommendation, and evidence snapshot remain frozen and immutable.

The existing `lookup_chem21_solvent` tool may query any exact locally catalogued CHEM21 solvent because it reads only versioned public reference data. It returns explicit CSV replacement records when available. `not_found` means the solvent is absent from the catalogue, not that it is unsuitable for the submitted chemistry.

A server-controlled `lookup_experimental_solvent_evidence` tool reads the generated SQLite model. It has three modes:

1. `single_solubility` for BigSolDB measurements;
2. `mixture_solubility` for MixtureSolDB measurements;
3. `density` for BigSolDB density measurements.

For solubility modes, the requested solute must match a chemical from the frozen analysis context. Solvent and co-solvent names must resolve to local catalogue records; no external lookup occurs. Density has no solute input. The tool returns at most 20 exact raw measurements, ordered by exact match and then stated-temperature proximity. It never interpolates, extrapolates, predicts a reaction outcome, or ranks candidates.

A server-controlled `lookup_solvent_hazard_profile` tool reads only the local PubChem GHS snapshot for an exact indexed solvent. It returns the raw H-code descriptions, category flags, source identity, snapshot date, and completeness state. A profile with CMR, acute, organ, environmental, or physical hazards must state: “Hazard evidence warrants a replacement search; no source-backed substitute is available in this catalogue.” It must not nominate a substitute. CHEM21 remains the sole source of explicit replacement relations.

Every tool response contains source dataset, measurement type, source values/units, temperature and mixture composition when applicable, and DOI or PubChem source reference. The tools reject malformed modes and out-of-scope solutes before querying SQLite. Absent matching measurements return `not_found`; a missing or incomplete GHS snapshot returns `unavailable` with its harvest state.

PubChem and RDKit's existing live tools remain frozen-context-only. The Qwen tool loop remains bounded; CHEM21, experimental-evidence, and hazard-profile reads are local.

### Presentation and scientific claims

The prompt and chat UI label evidence by source:

- CHEM21: hazard/classification and explicit guide replacement relation;
- BigSolDB/MixtureSolDB: measured solubility under the stated conditions;
- BigSolDB density: measured density at the stated temperature;
- PubChem GHS snapshot: classified health, environmental, and physical hazards at the snapshot date.

The assistant must state that none of these records alone demonstrates reaction compatibility, yield, selectivity, scale-up safety, or a suitable replacement for the user's process. It must not invent CHEM21 scores, substitute relationships, measurements, citations, unmeasured mixture behavior, or an absence-of-hazard conclusion from a missing profile.

## Import and synchronization

The project provides an idempotent source import/validation command. It reports manifest/hash validation, input/output record counts, duplicate/invalid records, source attribution coverage, index metadata, and SQLite integrity status. It does not alter raw LFS assets.

The project provides a distinct resumable PubChem GHS snapshot command. It reports current checkpoint counts, request interval, throttling decisions, complete/terminal/unresolved profiles, raw snapshots written, and final index integrity. It requires explicit operator start.

A persistent CHEM21 downloader is deferred. If an authorized and documented CHEM21 endpoint is identified later, a separate design must define terms compliance, durable checkpointing, per-run request cap, low fixed rate, exponential backoff, stop-on-4xx behavior, audit trail, and human-triggered enablement. Cache content must pass the same provenance and validation checks before entering the index.

## Data flow

```text
Git-LFS raw CHEM21 / BigSolDB / MixtureSolDB / density assets + manifests
  -> deterministic source validation/import command
  -> generated, integrity-checked local SQLite measurement model
  -> explicit, checkpointed PubChem GHS snapshot harvest for 239 solvents
  -> local hazard profiles + source snapshots
  -> chemistry-service CHEM21 / measurement / hazard endpoints
  -> bounded Qwen tool loop
  -> source-labeled, cited chat response
```

## Error handling

- Invalid or hash-mismatched raw asset: source import fails with its source ID and leaves the prior SQLite index untouched.
- Invalid candidate index: importer rejects it before atomic replacement.
- Missing/stale measurement index: measurement lookups are `unavailable`; no network fallback occurs.
- Unknown CHEM21 solvent or missing measurement: return `not_found`, not an inferred result.
- Missing replacement record: return the source record with a structured warning; do not invent an alternative.
- More than 20 measurements: return the deterministic first 20 and a truncation warning.
- GHS source throttling, unavailable endpoint, or interrupted harvest: preserve prior completed profiles, report the exact checkpoint state, and never present a missing profile as safe.
- GHS identity ambiguity: record `unresolved` with the candidate name and do not attach a hazard profile to it.

## Testing and verification

Tests must cover:

- exact 53-record CHEM21 import, source metadata, aliases, rankings, and DMF/ethyl-acetate values;
- invalid schema, duplicate identity, score-range, and hash-mismatch failures;
- transactional index replacement and integrity check;
- exact BigSolDB single-solubility rows with units, temperature, and DOI;
- exact MixtureSolDB rows with both solvents, fraction, fraction type, and DOI;
- exact density rows and temperature ordering;
- 20-result caps, deterministic ordering, no interpolation, absent-data, malformed-mode, and out-of-scope-solute behavior;
- 239-solvent harvest enumeration, CID resolution, raw snapshot metadata, restart/resume behavior, 2-second pacing, dynamic-throttle/backoff behavior, terminal 4xx handling, and no duplicate fetches;
- H-code extraction, CMR/acute/organ/environmental/physical flags, unresolved identities, and missing-profile handling;
- CHEM21 full-catalogue and local hazard-profile lookup while PubChem/RDKit live tools remain context-scoped;
- prompt/UI source labels and warnings distinguishing measurement, classification, hazard screening, and reaction suitability;
- no external HTTP request during CHEM21, measurement, or hazard-profile lookup;
- authenticated browser smoke proving a scoped-substrate/candidate-solvent question shows raw measured conditions, local hazard evidence, and provenance without mutating the analysis.

## Non-goals

- Scraping or polling ACS/RSC/interactive sites.
- Supplier SDS acquisition, scraping, parsing, or distribution.
- Treating SSG data as CHEM21 data.
- Solv@TUM partition/free-energy ingestion.
- Predicting solubility, reaction outcome, yield, selectivity, or scale-up safety from these references.
- Mutating the saved analysis, protocol, recommendation, or acceptance state from chat.
