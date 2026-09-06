# Safe per-case acceptance reporting

Implemented reporting.ts and eight persistent tests. Initial missing-module RED was followed by eight behavioral RED failures against the deliberately unimplemented function, then eight GREEN and scoped ESLint exit 0.

createCohortReport(manifest, results) is a pure safe projection of trusted adjudication records, not an adjudicator or proof of artifact authenticity. It validates and reconciles unique source hashes, emits one sorted synthetic case row per manifest source, preserves historical splits, and fills missing results/stages as not-run. It requires all 23 reporting stages (including all twelve principles and four Python helpers), five substantive gates, available stored baseline, positive useful-outcome count and adjudication hash before accepting a case. A cohort must also be nonempty and exhaustively discovered to be complete. scientificCertification is always false.

Only fixed enums, validated hashes, synthetic IDs and counts leave the projection. Private extension fields are discarded; errors are fixed. Nested report outputs are frozen. Integrators must independently resolve/authenticate adjudication references and bind actual source/evidence/contract/scenario versions before supplying trusted records. Stage runner has 19 stages and uses coverage rather than source-inventory; a verified integration mapping and explicit helper results are still required. Candidate is not completed scientific acceptance.

Independent SPEC PASS: reporting-spec-review.md. Independent QUALITY report is separate. No actual corpus or adjudications were supplied; tests are synthetic and do not establish chemistry or user usefulness.
