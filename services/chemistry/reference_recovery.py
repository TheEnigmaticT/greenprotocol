"""Safe classification and retry timing for PubChem transport outcomes."""
from __future__ import annotations

import random

RETRYABLE_HTTP_STATUSES = {429: "http_429", 503: "http_503", 504: "http_504"}


def classify_pubchem_status(status: int) -> tuple[str, str | None]:
    if status == 200:
        return "resolved", None
    if status == 404:
        return "terminal_not_found", "not_found"
    if status in RETRYABLE_HTTP_STATUSES:
        return "retryable", RETRYABLE_HTTP_STATUSES[status]
    return "terminal_http", f"http_{status}"


def full_jitter_backoff(attempt: int, *, base: float = 0.5, cap: float = 30.0, rng: random.Random | None = None) -> float:
    maximum = min(cap, base * (2 ** max(0, attempt)))
    return (rng or random).uniform(0, maximum)
