# Generalized Literature Evidence Ingestion Workflow

#claudeai

**Status:** Local PDF corpus discovered and extracted into a page-aware, adjudication-ready dataset. Current derived inventory: 295 canonical research articles, 40 supporting documents, 15 duplicate DOI records removed, and 11,238 retrieval chunks. Full-text acquisition from the downloaded PDFs succeeded; relevance adjudication and embeddings are still pending.

**Initial corpus:** [Current Research in Green and Sustainable Chemistry](https://www.sciencedirect.com/journal/current-research-in-green-and-sustainable-chemistry/issues), Elsevier / ScienceDirect, ISSN `2666-0865`.

**Metadata snapshot:** 2026-07-29

## Purpose

Create a reusable ingestion and evidence-retrieval process that can support:

1. GreenChemistry.ai's public green-chemistry evidence corpus.
2. Future public literature collections.
3. Client-specific internal documents, without leaking one client's data into another client's retrieval or training context.

The system is an **evidence retrieval and citation layer**, not initially a model-training pipeline. Documents may be used for retrieval, extraction, adjudication, evaluation, and citation grounding. Any future fine-tuning requires a separate license and data-governance decision.

## Source audit: first corpus

The ScienceDirect issue page returned HTTP 403 from the available browser and direct HTTP environment. The public Crossref API was accessible and returned:

- 517 records published from 2020 onward for ISSN `2666-0865`.
- 513 candidate records whose volume is 1–12, including the combined `1–2` volume.
- Records also exist in volume 13, so “12 volumes” must be confirmed against the intended cutoff.
- The specific volume route `https://www.sciencedirect.com/journal/current-research-in-green-and-sustainable-chemistry/vol/4/suppl/C` was also tested through Browserless and returned the same Cloudflare error page, with no article/PDF links exposed to the session.
- The Elsevier full-text XML endpoint is reachable without a visible API key from this environment, but the 10-record pilot returned valid metadata-only XML (`openaccessArticle` metadata and license fields, without article body/original-text elements). Adding `view=FULL` through Browserless returned `AUTHENTICATION_ERROR / Invalid API Key`. This is not yet a successful full-text download and must not be represented as one.
- Crossref records expose Elsevier text/data-mining license metadata and, for many records, a version-of-record Creative Commons license entry.
- The presence of a Crossref license or link is not treated as blanket permission to download, retain, redistribute, or use every article for AI training.

The first metadata manifest is:

`docs/research/crgsc-volumes-1-12-crossref-manifest.json`

It preserves DOI, title, authors, publication data, volume/issue, publisher URL, license metadata, full-text link metadata where exposed, and retrieval date.

## Canonical workflow

### Stage 0 — Register the source

Create a source record before downloading content:

- source ID and human-readable name
- publisher/repository
- canonical landing page
- ISSN, DOI prefix, or API identifier
- intended volume/date range
- access method
- license/reuse notes
- retrieval timestamp
- owner and review status

Do not start with a pile of PDFs whose provenance has to be reconstructed later.

### Stage 1 — Acquire and preserve

For every article or document:

- retain the original downloaded artifact where permitted
- compute a checksum
- record URL, HTTP status, content type, and retrieval timestamp
- record the specific version: publisher PDF, accepted manuscript, XML, HTML, or abstract-only
- record license/access state: open license, text/data-mining permission, institutional access, supplied by client, abstract-only, or unknown
- never silently replace a source artifact; create a new version record

If automated access remains blocked, Trevor can supply the permitted files. Supplied files enter the same manifest and provenance path; they do not bypass rights review.

### Stage 2 — Normalize and extract

Extract text while preserving citation location:

- page number where available
- article section
- paragraph or block offset
- table/figure identifiers
- supplementary-information relationship
- extraction method and version
- OCR confidence or parser warnings

Keep raw files, normalized text, and extracted evidence as separate layers.

### Stage 3 — Relevance adjudication

Run a cheap first-pass classifier, then human-review a representative sample and all uncertain/high-impact records.

Allowed relevance states:

- `direct`: likely to support a recommendation or process comparison
- `supporting`: useful for hazard, solvent, methodology, or framework context
- `background`: useful context but not recommendation evidence
- `irrelevant`: outside the product's decision surface
- `uncertain`: requires human review

Tag the decision surface, rather than relying on a single “green chemistry” label:

- solvent/reagent substitution
- waste prevention / PMI / material efficiency
- atom economy
- energy efficiency
- catalysis
- renewable feedstocks
- derivatization
- process simplification
- purification/separation burden
- degradation/end-of-life
- accident prevention
- analytical monitoring
- yield, purity, runtime, and step count

Adjudication must be reversible and auditable. Store the classifier result, reviewer decision, reviewer notes, timestamp, and adjudication version.

### Stage 4 — Extract evidence units

The retrieval and Evidence Atlas unit is a citable passage or structured claim, not an entire article.

Each evidence unit should retain:

- source/article ID
- claim type and decision-surface tags
- verbatim quote
- context immediately around the quote
- page/section/table/figure location
- reported measurements and units
- reaction/process/substrate/scale applicability
- limitations and uncertainty
- citation metadata: authors, title, journal, year, DOI, URL
- extraction method and review state

Only evidence units with a persistent source identifier and usable location should be eligible to support a `sourced` recommendation. Abstract-only records can be searchable but must not be presented as full-text evidence.

### Stage 5 — Index for hybrid retrieval

Use multiple retrieval signals:

1. Semantic embeddings for conceptual similarity.
2. Lexical search for exact chemicals, CAS numbers, reactions, acronyms, and units.
3. Structured metadata filters for principle, evidence type, reaction family, source, date, and tenant.
4. Applicability reranking against the current protocol.
5. Citation and rights checks before evidence is passed to recommendation generation.

The vector database is an implementation detail. The canonical source/evidence records must remain portable so the system can move between local and hosted indexes.

### Stage 6 — Evidence-grounded recommendation review

For each recommendation:

- retrieve candidate evidence
- rerank for chemistry/process applicability
- distinguish direct reported evidence from analogy and model inference
- attach citations and exact evidence locations
- downgrade or suppress claims that retrieved evidence contradicts
- preserve “no direct literature support” when retrieval finds only related or background material

The model must not invent a citation, DOI, quote, measured value, or applicability claim.

### Stage 7 — Evidence Atlas rendering

The Evidence Atlas should render:

- evidence state: sourced, benchmark-derived, model-inferred, unavailable
- supporting-reference count
- citation in ACS format with working link
- expandable quote and source location
- applicability caveat
- reported result versus GC.ai inference
- access limitation or missing-full-text notice
- GC.ai software version and analysis timestamp

## Multi-client data model

Every document, evidence unit, embedding, retrieval event, and evaluation example needs a tenant/visibility boundary.

Suggested visibility classes:

- `public_shared`
- `client_private`
- `client_approved`
- `draft_unreviewed`
- `historical`

Public evidence may be shared across clients. Client-private documents must be filtered before retrieval and must never enter another client's prompt context or shared training set.

Internal documents should not automatically receive the evidentiary status of peer-reviewed literature. The source type and approval state must remain visible.

## Minimum canonical entities

```text
SourceCollection
  id, name, publisher, canonical_url, identifier, license_policy, status

Document
  id, collection_id, tenant_id, source_url, persistent_id, version,
  checksum, access_state, retrieved_at, raw_artifact_path

DocumentText
  id, document_id, page, section, block_index, text, extraction_method,
  extraction_warnings

Adjudication
  id, document_id, relevance, domain_tags, evidence_types, reviewer,
  classifier_version, decision_notes, decided_at

EvidenceUnit
  id, document_id, text_block_ids, claim, quote, measurements,
  applicability, limitations, citation, review_state

EmbeddingChunk
  id, evidence_unit_id, embedding_model, index_name, vector_ref,
  tenant_id, visibility

RetrievalEvent
  id, analysis_id, query, filters, retrieved_evidence_ids, reranker_version,
  created_at
```

## First implementation slice

1. Confirm whether the target is volumes 1–12 or a different 12-volume cutoff.
2. Confirm the allowed acquisition route: open-license files, Elsevier TDM/API access, institutional access, or Trevor-supplied downloads.
3. Reconcile the Crossref manifest against the journal issue listing.
4. Acquire a small pilot: one volume or 25–50 articles across multiple years.
5. Run extraction and relevance adjudication on the pilot.
6. Have a human review the classifier's direct/supporting/background decisions.
7. Extract evidence units from the reviewed relevant subset.
8. Add the units to the existing literature/vector-search path.
9. Evaluate retrieval and citation correctness with fixed chemistry questions.
10. Connect one evidence-backed recommendation to the Evidence Atlas before scaling the corpus.

## Acceptance criteria for the pilot

- Every ingested item has a persistent identifier, provenance, access state, and checksum.
- The original artifact and extracted text can be traced to one another.
- Relevance decisions are stored separately from model output.
- At least one retrieved passage includes a working DOI, verbatim quote, location, and applicability caveat.
- The system can explicitly return “no direct supporting evidence found.”
- Client-private records are excluded from public/shared retrieval.
- The same workflow can accept a public article, a client PDF, and an abstract-only record without changing the canonical schema.

## Non-goals for the first pass

- Fine-tuning a model on the corpus.
- Treating all articles as equally authoritative.
- Downloading or redistributing paywalled content without verified rights.
- Replacing existing structured sources such as CHEM21, PubChem, EPA, or ACS GCI data.
- Making literature precedent sound like a guarantee for a user's exact protocol.
