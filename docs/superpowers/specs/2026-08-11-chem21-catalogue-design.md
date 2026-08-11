# Local Solvent Evidence Catalogue and Scoped Scientific Chat Design

**Status:** Approved for revised-spec review

## Goal

Replace GC.ai's incomplete hand-maintained CHEM21 map with a validated 53-record catalogue, and make locally stored experimental solvent evidence available to the read-only scientific chat without conflating hazard classifications, physical measurements, and reaction suitability.

## Problem

GC.ai currently uses a manually maintained 40-solvent Python map for CHEM21 lookups. The file claims to represent the 53-solvent CHEM21 guide, but omits 13 records and disagrees with the user-provided 53-row CSV for existing entries such as DMF. The chat also restricts CHEM21 lookups to solvents already named in its frozen analysis context, preventing grounded discussion of candidate substitutes.

The supplied local source collection includes different evidence types:

| Source | Evidence | Scope | License status |
|---|---|---|---|
| `CHEM21_full.csv` | CHEM21 S/H/E scores, rankings, explicit replacements | 53 solvents | User-supplied local file; provenance/reuse status must be recorded before distribution. |
| BigSolDB v2 | Measured single-solvent solubility | 103,944 rows | CC BY 4.0 dataset; preserve upstream attribution and DOI. |
| MixtureSolDB | Measured binary-mixture solubility | 175,626 rows | CC BY 4.0 dataset; preserve upstream attribution and DOI. |
| BigSolDB densities | Measured temperature-indexed density | 2,209 rows | Preserve upstream attribution and DOI. |
| Solv@TUM | Measured non-aqueous partition coefficients and solvation free energies | SDF records with bibliography keys | CC BY-SA 4.0; preserve attribution and share-alike obligations for distributed derivatives. |

`soluprotmutdb_dump.zip` is a protein-mutation database and `IS111.ZIP` is a legacy installer. Neither is included.

There is no configured CHEM21 credential or verified official CHEM21 software API. No request path may scrape, poll, or call an ACS/RSC/CHEM21 endpoint.

## Data authority and provenance

Each source asset is immutable and retained through Git LFS under `services/chemistry/data/solvent-evidence/raw/`. A normal Git manifest accompanies each asset and records:

- dataset ID, version, upstream URL and DOI;
- license, required attribution, and retrieval date;
- SHA-256, byte size, record count, and expected input schema;
- the exact importer version and derived-index schema version.

The raw files, rather than generated code or SQLite output, are authoritative. The CHEM21 manifest must record the supplied CSV's source URL or a clear manual-acquisition note and its reuse status. It must never claim license confirmation when that information is absent.

The SSG repository is not a CHEM21 substitute. Its 365-solvent JSON and `chem21.js` generate a CHEM21-inspired assessment from a separate property corpus; it is outside this release.

## Architecture

### Immutable source assets and generated query index

An import command validates every LFS asset and builds a single generated SQLite read model at `services/chemistry/data/solvent-evidence/solvent-evidence.sqlite`. The SQLite file is ignored by Git and is not a source of truth. Its metadata table records every verified raw-file hash and importer/schema version.

The importer creates these read tables:

- `chem21_solvents`: canonical solvent name, normalized aliases, CAS, PubChem ID, family, S/H/E scores, default/discussion ranking, replacement issue, and two raw replacement names;
- `single_solubility_measurements`: solute/solvent SMILES and names, CAS/PubChem ID, temperature K, all reported solubility units, FDA flag, and source DOI;
- `mixture_solubility_measurements`: all single-solubility identity fields plus both solvent names/SMILES, fraction and fraction type;
- `density_measurements`: solvent, temperature K, density, and source DOI;
- `solvatum_measurements`: solute identity, solvent, `logK`, derived/reported solvation free energy when present, original reference keys, and the bibliography entries required to cite them.

Indexes support exact normalized solvent/solute name, exact SMILES, CAS, dataset kind, and temperature-ordered retrieval. The index is built in a temporary SQLite file, integrity-checked, then atomically replaced. A missing, hash-mismatched, or schema-invalid index makes experimental lookups unavailable; it never triggers a network fetch or falls back to the old hand-maintained map.

### CHEM21 compatibility adapter

`lookup_solvent_with_evidence()` remains the compatibility adapter used by P5 scoring and the chemistry assistant tool. It reads the indexed CHEM21 record and continues returning the existing classification, scores, and Prat citation shape. It may add only catalogued provenance and replacement data.

The loader maps CSV ranking text to the existing lower-case `recommended`, `problematic`, `hazardous`, and `highly_hazardous` values. It rejects missing required columns, duplicate normalized names or CAS numbers, unknown rankings, nonnumeric scores, and scores outside 1–10.

### Read-only scientific-chat tools

The saved protocol, analysis, recommendation, and evidence snapshot remain frozen and immutable.

The existing `lookup_chem21_solvent` tool may query any exact locally catalogued CHEM21 solvent because it reads only versioned public reference data. It returns explicit CSV replacement records when available. `not_found` means the solvent is absent from the catalogue, not that it is unsuitable for the submitted chemistry.

A new server-controlled `lookup_experimental_solvent_evidence` tool reads the generated SQLite model. It has four modes:

1. `single_solubility` for BigSolDB measurements;
2. `mixture_solubility` for MixtureSolDB measurements;
3. `density` for BigSolDB density measurements;
4. `solvation` for Solv@TUM partition/solvation observations.

For solubility and solvation modes, the requested solute must match a chemical from the frozen analysis context. Solvent and co-solvent names must resolve to local catalogue records; no external lookup occurs. Density has no solute input. The tool returns at most 20 exact raw measurements, ordered by exact match and then stated-temperature proximity. It never interpolates, extrapolates, predicts a reaction outcome, or ranks candidates.

Every response contains source dataset, measurement type, source values/units, temperature and mixture composition when applicable, and DOI or bibliography-backed reference. The tool rejects malformed modes and out-of-scope solutes before querying SQLite. Absent matching measurements return `not_found`.

PubChem and RDKit remain frozen-context-only. The Qwen tool loop remains bounded; all CHEM21 and experimental-evidence reads are local.

### Presentation and scientific claims

The prompt and chat UI label evidence by source:

- CHEM21: hazard/classification and explicit guide replacement relation;
- BigSolDB/MixtureSolDB: measured solubility under the stated conditions;
- BigSolDB density: measured density at the stated temperature;
- Solv@TUM: non-aqueous partition coefficient or solvation free energy.

The assistant must state that none of these records alone demonstrates reaction compatibility, yield, selectivity, scale-up safety, or a suitable replacement for the user's process. It must not invent CHEM21 scores, substitute relationships, measurements, citations, or unmeasured mixture behavior.

## Import and synchronization

The project provides an idempotent import/validation command. It reports manifest/hash validation, input/output record counts, duplicate/invalid records, source attribution coverage, index metadata, and SQLite integrity status. It does not alter raw LFS assets.

A persistent background downloader is deferred. If an authorized and documented CHEM21 endpoint is identified later, a separate design must define terms compliance, durable checkpointing, per-run request cap, low fixed rate, exponential backoff, stop-on-4xx behavior, audit trail, and human-triggered enablement. Cache content must pass the same provenance and validation checks before entering the index.

## Data flow

```text
Git-LFS raw source assets + normal-Git manifests
  -> deterministic validation/import command
  -> generated, integrity-checked local SQLite read model
  -> chemistry-service CHEM21 / experimental-evidence endpoints
  -> bounded Qwen tool loop
  -> source-labeled, cited chat response
```

## Error handling

- Invalid or hash-mismatched raw asset: import fails with its source ID and leaves the prior SQLite index untouched.
- Invalid candidate index: importer rejects it before atomic replacement.
- Missing/stale index: experimental-evidence lookups are `unavailable`; no network fallback occurs.
- Unknown CHEM21 solvent or missing measurement: return `not_found`, not an inferred result.
- Missing replacement record: return the source record with a structured warning; do not invent an alternative.
- More than 20 matches: return the deterministic first 20 and a truncation warning.
- Unsupported Solv@TUM reference key: return the raw key plus a citation-resolution warning, never a fabricated bibliography entry.

## Testing and verification

Tests must cover:

- exact 53-record CHEM21 import, source metadata, aliases, rankings, and DMF/ethyl-acetate values;
- invalid schema, duplicate identity, score-range, and hash-mismatch failures;
- transactional index replacement and integrity check;
- exact BigSolDB single-solubility rows with units, temperature, and DOI;
- exact MixtureSolDB rows with both solvents, fraction, fraction type, and DOI;
- exact density rows and temperature ordering;
- exact Solv@TUM `logK`/solvation rows and bibliography-key resolution;
- 20-result caps, deterministic ordering, no interpolation, absent-data, malformed-mode, and out-of-scope-solute behavior;
- CHEM21 full-catalogue lookup while PubChem/RDKit remain context-scoped;
- prompt/UI source labels and warnings distinguishing measurement, classification, and reaction suitability;
- no external HTTP request during CHEM21 or experimental-evidence lookup;
- authenticated browser smoke proving a scoped-substrate/candidate-solvent question shows raw measured conditions and provenance without mutating the analysis.

## Non-goals

- Scraping or polling ACS/RSC/interactive sites.
- Treating SSG data as CHEM21 data.
- Predicting solubility, reaction outcome, yield, selectivity, or scale-up safety from these references.
- Mutating the saved analysis, protocol, recommendation, or acceptance state from chat.
