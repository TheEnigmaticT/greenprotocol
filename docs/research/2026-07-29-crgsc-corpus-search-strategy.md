# CRGSC Corpus Search Strategy

#claudeai

## Goal

Use the downloaded Current Research in Green and Sustainable Chemistry articles as a citable evidence source for GreenChemistry.ai, while preserving article/page provenance and separating direct evidence from background context and model inference.

This corpus should feed retrieval and evidence extraction first. It should not be treated as shared model-training data by default.

## Corpus state

The current local extraction contains:

- 295 canonical research-article PDFs
- 40 canonical supporting documents, primarily contents/editorial material
- 15 duplicate records removed by DOI
- volumes 1, 3, 4, and 6–13 represented
- volumes 2 and 5 not currently present in Downloads
- volume 4 represented by a 100-article archive, not the complete 181-record Crossref inventory

Derived artifacts:

- `data/literature/crgsc/extracted-v4/table-of-contents.json`
- `data/literature/crgsc/extracted-v4/article-index.jsonl`
- `data/literature/crgsc/chunks-v2.jsonl`

The `data/literature/` tree is gitignored because it contains source-derived files.

## Retrieval stages

### 1. Query understanding

Convert the current protocol and user question into a structured retrieval request:

```json
{
  "query": "replace a hazardous solvent while preserving reaction performance",
  "chemicals": ["DMF"],
  "principles": [3, 5, 6],
  "process_type": "reaction",
  "desired_measures": ["yield", "purity", "runtime", "solvent_volume", "waste"],
  "evidence_requirement": "direct_or_supporting",
  "tenant_id": "public"
}
```

Query construction should preserve exact chemical names, synonyms, CAS numbers, reaction families, and units alongside natural-language concepts.

### 2. Candidate generation

Use hybrid retrieval rather than vectors alone:

1. lexical search over exact chemical names, DOI, article number, reaction names, and measurement terms;
2. semantic search over page-aware chunks;
3. metadata filters for volume, year, evidence status, domain, and visibility;
4. optional source-specific retrieval from CHEM21, PubChem, EPA, ACS GCI, or PubMed;
5. union the candidate sets before reranking.

The existing Supabase `literature_precedents` table can remain the first compatibility target, but the richer canonical record must retain the fields it currently lacks.

### 3. Reranking

Rerank candidates using the current protocol’s:

- chemical identity and role
- reaction/process family
- substrate or material class
- scale and operating conditions
- measured outcome requested by the user
- green-chemistry principle(s)
- evidence type
- directness of comparison

A review article may be highly relevant for background but should rank below a direct experimental comparison when the question asks whether an alternative actually improved yield, waste, or runtime.

### 4. Evidence adjudication

Each article and extracted evidence unit receives an explicit state:

- `direct`: experimental comparison or reported process result relevant to the decision
- `supporting`: hazard, solvent, framework, mechanism, or methodology context
- `background`: useful context but not recommendation-grade evidence
- `irrelevant`: outside GreenChemistry.ai’s decision surface
- `uncertain`: requires human review

Evidence-type tags:

- `experimental_comparison`
- `process_method`
- `solvent_or_reagent_assessment`
- `life_cycle_assessment`
- `hazard_assessment`
- `review_or_framework`
- `materials_or_circularity`
- `analytical_method`
- `retraction_or_correction`

No chunk should be embedded into the recommendation-facing index as trusted evidence until its article-level adjudication is complete.

### 5. Citation-grounded answer assembly

The answer layer receives only retrieved evidence records containing:

- DOI or other persistent identifier
- article title and authors
- journal/year/volume
- exact quote
- page number or section
- applicability and limitations
- adjudication state

The output must distinguish:

- **Reported:** directly stated or measured in the source.
- **Applicable precedent:** a source result judged similar enough to inform the current question.
- **GC.ai inference:** a conclusion drawn by the model from the source and current protocol.
- **Unavailable:** no direct supporting source was found.

The model must not invent citation details, page numbers, quotes, measured values, or applicability.

## Index design

The canonical evidence record should eventually include:

```text
source_collection_id
source_document_id
tenant_id
visibility
persistent_id / DOI
title
authors
journal
volume
year
article_type
evidence_type
adjudication_status
domain_tags
chemical_subjects
principles_addressed
claim
quote
page_start / page_end
section
measurements
applicability
limitations
source_pdf_checksum
embedding_model
embedding
```

The current app migration has `title`, `authors`, `journal`, `year`, `doi`, `url`, `abstract`, `content_snippet`, `embedding`, chemical subjects, principles, and hazard types. We should extend it rather than overload `content_snippet` with provenance and adjudication data.

## Search evaluation set

Before using this corpus to influence recommendations, create a small fixed evaluation set with questions from the existing product surface:

1. solvent substitution: DMF, dichloromethane, NMP, toluene, hexane
2. waste/PMI and purification burden
3. energy and temperature
4. catalysis and reduced equivalents
5. renewable feedstocks and biomass valorization
6. process simplification and one-pot/telescoped methods
7. materials recycling and end-of-life
8. analytical monitoring

Each evaluation query needs expected:

- relevant article IDs or “no direct evidence”
- acceptable evidence type
- required citation fields
- disallowed overclaims
- whether the result is direct, supporting, background, or model-inferred

Track retrieval recall, citation correctness, page-location correctness, directness classification, and false-support rate.

## Client generalization

Use the same pipeline for client documents, but isolate them by `tenant_id` and visibility. Client-private documents must never enter public retrieval or another client’s prompt context. Internal SOPs and reports must retain their source type and approval state; they do not automatically receive peer-reviewed evidence status.

## Immediate next step

1. Review the generated article table of contents.
2. Confirm whether the missing volumes 2 and 5 are expected to be supplied separately.
3. Adjudicate the 295-article queue at article level before doing expensive embeddings.
4. Build embeddings only for approved research-article chunks, preserving page-aware chunk IDs.
5. Add one evidence-backed retrieval path to the Evidence Atlas and test its citation rendering.
