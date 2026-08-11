# CHEM21 Catalogue Import and Scoped Scientific Chat Design

**Status:** Approved for planning

## Problem

GC.ai currently uses a manually maintained 40-solvent Python map for CHEM21 lookups. The map claims to represent the 53-solvent CHEM21 guide, but omits 13 records and disagrees with the user-provided 53-row CSV for existing entries such as DMF. The chat also restricts CHEM21 lookups to solvents already named in its frozen analysis context, preventing grounded discussion of candidate substitutes.

The repository has no configured CHEM21 API credential and no verified official software API. The downloaded `CHEM21_full.csv` is therefore the immediate data source; no network crawler or long-running synchronizer is justified.

## Authority and provenance

`CHEM21_full.csv` contains 53 solvent records plus a header. Its fields include solvent name, alternate name, CAS, PubChem ID, family, boiling/flash points, worst H3xx/H4xx codes, safety, health, environment, default/discussion rankings, replacement issues, and two explicit replacements.

The implementation must treat this file as a user-supplied candidate source pending a documented provenance/reuse check. It must record:

- the source DOI: `10.1039/C5GC01008J`;
- acquisition date;
- SHA-256 of the unchanged raw file;
- 53-record count;
- source URL or manual-source note;
- reuse/licensing status.

The raw CSV is immutable. Derived data is reproducible from it. The SSG repository's 365-solvent JSON is explicitly out of scope: its `chem21.js` calculates a CHEM21-inspired assessment from a separate property corpus and must never be presented as CHEM21 source data.

## Architecture

### Catalogue loader

A CHEM21 catalogue module loads the versioned CSV and validates it before serving lookups. Validation rejects a catalogue with missing required columns, non-unique normalized names or CAS numbers, invalid ranking values, nonnumeric scores, or scores outside the defined 1–10 range. The loader explicitly maps the CSV's title-cased rankings to the application's lower-case `recommended`, `problematic`, `hazardous`, and `highly_hazardous` values.

Each validated entry exposes a canonical name, aliases, CAS, PubChem ID, S/H/E scores, ranking, discussion ranking when supplied, and the CSV replacement fields. `lookup_solvent_with_evidence()` remains the compatibility adapter used by P5 and the chat service. It returns the existing classification, scores, and CHEM21/Prat citation shape; it also gains only additive, catalogued replacement/provenance fields as needed.

No application path makes a live request to CHEM21, ACS, or RSC.

### Chat tools

The saved protocol, analysis, recommendation, and evidence snapshot remain frozen and read-only. The CHEM21 reference catalogue is separate from that private snapshot: a model may query an exact known solvent from the local catalogue because it reads only versioned public reference data.

The CHEM21 tool supports two server-controlled actions:

1. lookup of a known catalogue solvent, returning only validated catalogue values;
2. alternative lookup for a scoped source solvent, returning only the CSV's explicit replacements plus their validated local CHEM21 records.

An unknown chemical returns `not_found`. A catalogue record is evidence of CHEM21 classification only; it is not evidence that the solvent is suitable for the submitted chemistry. The prompt and UI must state that distinction. The model must not claim CHEM21 ratings or substitution relationships without a tool result.

PubChem and RDKit remain context-scoped as currently designed. The chat keeps its existing request/tool time budgets because all CHEM21 reads are local.

### Import and refresh

The project includes an idempotent import/validation command. It reports source hash, parsed count, invalid records, duplicate aliases, and output location; it does not modify the raw CSV.

A persistent background downloader is deferred. If an authorized, documented external API is identified later, a separate design must define its terms compliance, durable checkpoint, per-run request cap, low fixed rate, exponential backoff, stop-on-4xx policy, audit trail, and human-triggered enablement. Cache content must pass the same validation and provenance checks before replacing a catalogue version.

## Data flow

```text
versioned CHEM21_full.csv
  -> validated catalogue loader
  -> local CHEM21 lookup / replacement resolver
  -> chemistry service tool response
  -> bounded Qwen tool loop
  -> cited chat answer
```

## Error handling

- Invalid catalogue at startup: CHEM21-dependent lookup and scoring report unavailable; they never fall back to the prior hand-maintained Python map.
- Known solvent absent from the catalogue: return `not_found`, not an inferred score.
- Replacement target absent from the catalogue: return the source record plus a structured unavailable-replacement warning; do not fabricate a fallback.
- Missing provenance metadata: import fails rather than presenting unsupported data as CHEM21.
- A future sync failure: preserve the current validated catalogue and report the failed run; never partially overwrite it.

## Testing

Tests must cover:

- exact 53-row parse and required source metadata;
- DMF, ethyl acetate, and at least one previously absent solvent values from the supplied CSV;
- aliases and CAS collision rejection;
- score/ranking validation failures;
- compatibility of the existing P5 scoring and assistant-tool response;
- full-catalogue CHEM21 lookup from chat while PubChem/RDKit remain context-scoped;
- replacement lookup returning only CSV-provided alternatives;
- unknown-catalogue and absent-replacement handling;
- chat copy that distinguishes classification from reaction suitability;
- no external HTTP request during CHEM21 lookup.

## Non-goals

- Scraping or polling ACS/RSC/interactive sites.
- Treating SSG data as CHEM21 data.
- Claiming a CHEM21 classification proves process compatibility, yield, selectivity, or safety for a specific reaction.
- Mutating the saved analysis, protocol, or recommendation from chat.
