# Python helper boundary implementation

Scope: isolated-only routing guard; not live helper qualification. No scientific calculations changed.

RED: `python3.14 -m pytest -q test_isolated_llm_boundary.py` from services/chemistry: exit 1, four expected failures (legacy route reached, missing policy module, missing explicit stages).
GREEN: `python3.14 -m pytest -q test_isolated_llm_boundary.py test_llm_client.py`: exit 0, six passed. Injected transports only.

All four helper call sites declare roles. An active context or nonempty GCAI_ISOLATED_EXECUTION intercepts before legacy environment priority. Missing policy, unknown stage/model, returned model mismatch, missing immutable attempt ID, oversized body or transport failure fail closed. Legacy behavior outside this isolated boundary remains unchanged. No production claim.

Pending: independent spec then quality review; actual mission transport bridge with ledger and semantic response validation; real helper runs. Only source-and-official-catalog verified google/gemma-4-31b-it is currently listed. Qwen awaits previous-run metadata verification.

Runtime discovery: plain python3 is 3.9.6 here; python3.14 is 3.14.6 with pytest 9.0.2. No dependencies installed.
