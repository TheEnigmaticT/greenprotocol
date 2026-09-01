"""Lease-safe sequential worker for durable PubChem recovery."""
from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timedelta, timezone

from pubchem import lookup_chemical, get_last_lookup_failure
from reference_store import ReferenceStore, get_reference_store


async def run_once(store: ReferenceStore, worker_id: str, limit: int = 20, lease_seconds: int = 300) -> dict[str, int]:
    rows = await store.claim_due(worker_id, limit=limit, lease_seconds=lease_seconds)
    summary = {"claimed": len(rows), "resolved": 0, "retryable": 0, "terminal": 0, "throttle_observations": 0}
    for row in rows:
        started = time.monotonic()
        name = row.get("display_name") or row.get("normalized_name", "")
        miss_id = str(row.get("id", ""))
        try:
            if time.monotonic() - started >= lease_seconds - 15:
                raise TimeoutError("lease reserve unavailable")
            data = await lookup_chemical(name)
            failure = get_last_lookup_failure()
            elapsed = time.monotonic() - started
            if elapsed >= lease_seconds - 15:
                raise TimeoutError("lease reserve unavailable")
            if data:
                if not await store.upsert_cache(name, data):
                    raise RuntimeError("cache write failed")
                await store.complete_miss(miss_id, worker_id, result="resolved")
                summary["resolved"] += 1
            elif failure and failure.get("status") == "terminal_not_found":
                await store.complete_miss(miss_id, worker_id, result="terminal", http_status=404, error_code="not_found")
                summary["terminal"] += 1
            else:
                code = (failure or {}).get("error_code", "network")
                status = (failure or {}).get("http_status")
                when = datetime.now(timezone.utc) + timedelta(minutes=5)
                await store.complete_miss(miss_id, worker_id, result="retryable", http_status=status, error_code=code, next_attempt_at=when)
                summary["retryable"] += 1
                if code in {"http_429", "http_503", "http_504"}:
                    summary["throttle_observations"] += 1
        except Exception:
            when = datetime.now(timezone.utc) + timedelta(minutes=5)
            await store.complete_miss(miss_id, worker_id, result="retryable", error_code="network", next_attempt_at=when)
            summary["retryable"] += 1
    return summary


async def main() -> None:
    store = get_reference_store()
    if not store.available:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    summary = await run_once(store, os.environ.get("WORKER_ID", "reference-recovery"))
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    asyncio.run(main())
