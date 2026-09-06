# Decomposed model pilot

This is a benchmark-only system. It does not import or invoke `lib/pipeline.ts`, application API routes, Supabase, Sentinel, trace logging, or deployment code.

## Input

Keep the input in `tmp/decomposed-benchmarks/` (ignored by git):

```json
{
  "cases": [
    {
      "caseId": "alana-1",
      "protocolText": "...authorized protocol...",
      "eligibility": [
        {
          "sourceQuote": "Step 2: Add acetone (10 mL).",
          "material": "acetone",
          "principleNumber": 5,
          "reason": "Deterministic chemical-data candidate"
        }
      ],
      "evidenceByAlternative": {
        "ethanol": [
          {
            "sourceId": "stable-local-evidence-id",
            "quote": "bounded supporting quote",
            "context": "reaction or workup context"
          }
        ]
      }
    }
  ]
}
```

Each reviewed eligibility candidate contains an exact `sourceQuote`, not a model-generated step number. Before making any model call, the runner performs a deterministic preflight: it normalizes CRLF/CR transport newlines, rejects empty or oversized text, prohibited/invisible Unicode control characters, known prompt-injection/control-message patterns, and text that lacks both a procedural action and chemistry signal. The preflight records whether the accepted input was line-oriented or a single prose span; it does not use a model or rewrite source wording.

The runner then deterministically splits the accepted protocol into non-empty source lines, resolves each quote to exactly one immutable source span, and rejects ambiguous or non-matching quotes before any model call. Only candidate spans are extracted. The model may reject eligibility. A proposed alternative is never turned into a change card unless supplied evidence exists and the evidence-adjudication call confirms applicability.

## Run

Gemma, via OpenRouter:

```bash
OPENROUTER_API_KEY=... npm run benchmark:decomposed-pilot -- \
  --input tmp/decomposed-benchmarks/alana-pilot.json \
  --provider openrouter \
  --model google/gemma-4-31b-it
```

Sonnet, direct Anthropic transport:

```bash
ANTHROPIC_API_KEY=... npm run benchmark:decomposed-pilot -- \
  --input tmp/decomposed-benchmarks/alana-pilot.json \
  --provider anthropic \
  --model claude-sonnet-4-5-20250929
```

Each run writes an ignored local JSON review artifact containing:

- immutable source spans and separately extracted material/mixture and operational/condition facts for eligible spans only;
- source-cited material-audit findings;
- approved evidence-backed change cards;
- an assembled protocol that preserves every non-targeted source span verbatim and applies only independently audited local patches;
- per-stage provider, model, latency, token, generation ID, and provider-reported cost telemetry.

## Fact graph and audit boundary

For each eligible immutable source span, the benchmark makes two narrow extraction calls in parallel:

1. **Material facts**: chemical identity, role, individual amount, material-specific conditions, and mixture composition. This receives an independent, source-cited audit and any finding fails closed.
2. **Operational facts**: actions, ordering-relevant sequence, repetitions, temperature with unit, duration, atmosphere, monitoring, filtration, concentration, separation, and equipment operations. These are retained as provenance but do not independently block a material-substitution recommendation.

Operational preservation is enforced at the only point it can be changed: the runner applies an exact, deterministic replacement of the approved material literal inside the target span, then the independent patch audit compares original and revised text and rejects unsupported chemical or operational changes. This prevents an unrelated full-procedure transcription dispute from blocking an evidence-backed local substitution.

`runDecomposedPilot` accepts an optional `auditModel` (and optional `auditProvider`) for an independent audit-only model. The candidate model performs extraction, issue assessment, alternative selection, and evidence adjudication. The runner constructs the literal substitution deterministically; the independent model receives the material audit and every patch audit.

## Gates

- An extraction omission or unsupported inference stops the case.
- An alternative without supplied evidence cannot become a change card.
- A rejected evidence adjudication produces no patch.
- A patch must include the approved alternative and pass a separate patch audit.
- More than one approved change to a step stops the case until an explicit conflict-resolution stage is designed.

Run one protocol per provider first. Review the local artifacts blind before expanding to the remaining authorized protocols.
