# Scoring UI Integration Spec

## Confidence Tiers

Every `PrincipleScore` returned by `POST /score` includes a `confidence` field. The UI should render scores differently based on this value.

### Tier 1: Solid Score (confidence = "calculated")
- **Display:** Normal score bar, no qualifier
- **Meaning:** All data comes from the protocol text, PubChem, CHEM21, or RDKit. Fully deterministic.
- **Examples:** P5 solvent scoring from CHEM21, P6 temperature deviation, P3/P10/P12 GHS hazard codes

### Tier 2: Estimated Score (confidence = "benchmark" or "partial")
- **Display:** Score bar with info icon. Hover/tap reveals explanation.
- **Meaning:** Some data was derived from ACS GCI benchmarks or incomplete inputs rather than stated protocol data.
- **Info bubble content:** Pull from `details` dict. Key fields:
  - `details.method` — how the score was derived ("benchmark_yield", "stated_yield", etc.)
  - `details.yield_source` — "stated" vs "benchmark"
  - `details.vs_benchmark` — "better_than_typical", "typical", "worse_than_typical"
  - `details.benchmark_pmi` — the ACS GCI reference PMI for comparison
  - `details.warnings` — any validation warnings
- **Example tooltip:** "PMI estimated using ACS GCI acetylation benchmark (typical efficiency 82%, PMI range 6-25). Your protocol did not state yield."

### Tier 3: Unavailable (confidence = "unavailable", score = -1)
- **Display:** Grayed out / dashed outline. Show what's needed.
- **Meaning:** Cannot score this principle — missing required data.
- **Message:** Pull from `details.error`
- **Example:** "Atom economy requires a balanced reaction equation."

## Score Response Structure

```
POST /score -> ScoreAllResponse {
  scores: PrincipleScore[]     // 10 principle scores
  total_score: float           // sum of available scores only
  max_possible: float          // count(available) × 10
  grade: "A"|"B"|"C"|"D"|"F"  // percentage-based
  smiles_extraction: {}        // metadata from auto SMILES extraction
  yield_extraction: {}         // metadata from yield/reaction type extraction
}
```

Each `PrincipleScore`:
```
{
  principle_number: int        // 1-12
  principle_name: string
  score: float                 // 0-10, or -1 if unavailable
  normalized: float            // 0-1, or -1
  confidence: string           // "calculated" | "benchmark" | "partial" | "unavailable"
  details: {}                  // principle-specific breakdown (see below)
  chemicals_flagged: string[]  // chemicals that triggered concerns
  data_sources: string[]       // ["chem21", "pubchem_ghs", "rdkit", "acs_gci_benchmarks", ...]
}
```

## Principle-Specific Detail Fields

### P1 Prevention (Waste/PMI)
- `pmi`: calculated PMI value
- `total_input_g`: sum of all input masses
- `product_mass_g`: estimated product mass
- `yield_pct`: yield used for calculation
- `yield_source`: "stated" or method name
- `reaction_type`: classified reaction type
- `benchmark_pmi`: ACS GCI benchmark for comparison
- `vs_benchmark`: "better_than_typical" | "typical" | "worse_than_typical"

### P2 Atom Economy
- `atom_economy_pct`: calculated AE percentage
- `reaction_smiles`: the balanced reaction equation
- `balanced`: whether atoms are conserved
- `desired_product_mw`: MW of target product
- `total_reactant_mw`: sum of reactant MWs
- `byproduct_mw`: mass going to waste

### P3 Less Hazardous / P10 Degradation / P12 Accident Prevention
- `chemicals`: per-chemical breakdown with H-codes and scores
- `total_mass_g`: aggregate mass
- `cmr_chemicals_count`: (P3 only) count of carcinogenic/mutagenic/reprotoxic

### P4 Product Toxicity
- `products`: per-product GHS breakdown
- `has_cmr_product`: boolean

### P5 Safer Solvents
- `solvents`: per-solvent CHEM21 classification and mass
- `total_solvent_mass_g`: aggregate solvent mass

### P6 Energy Efficiency
- `temperatures`: per-step parsed temperatures with deviation from ambient
- `avg_deviation_c`: mean temperature deviation
- `max_deviation_c`: worst-case deviation

### P7 Renewable Feedstocks
- `chemicals`: per-chemical renewable/petroleum classification
- `renewable_fraction`: mass fraction that is bio-based

### P9 Catalysis
- `catalytic_mass_g` / `stoichiometric_mass_g`: mass breakdown
- `stoichiometric_fraction`: ratio
- `has_catalysts`: boolean

## Integration Flow

1. Next.js pipeline runs Phase 1 (parse) → Phase 2 (evaluate) → Phase 3 (assemble)
2. After Phase 1 completes, call `POST /score` with parsed chemicals, steps, and protocol_text
3. The scoring service handles all LLM follow-ups internally (SMILES extraction, yield extraction)
4. Render deterministic scores alongside LLM qualitative assessments
5. Where both exist for the same principle, show the deterministic score as primary
