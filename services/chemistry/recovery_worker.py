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
    # All rows share the claim's lease, including time spent processing earlier
    # rows. Starting before the RPC also conservatively includes transit time.
    started = time.monotonic()
    rows = await store.claim_due(worker_id, limit=limit, lease_seconds=lease_seconds)
    summary = {"claimed": len(rows), "resolved": 0, "retryable": 0, "terminal": 0, "throttle_observations": 0, "completion_unacknowledged": 0}

    async def acknowledge(
        miss_id: str,
        *,
        result: str,
        http_status: int | None = None,
        error_code: str | None = None,
        next_attempt_at: datetime | None = None,
    ) -> bool:
        """A completion response can be lost after the server changed the row.

        Never issue a second completion in that state: this worker no longer
        knows it owns the lease, and a subsequent claimant may own it instead.
        """
        try:
            return await store.complete_miss(
                miss_id, worker_id, result=result, http_status=http_status,
                error_code=error_code, next_attempt_at=next_attempt_at,
            )
        except Exception:
            return False

    for row in rows:
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
                if await acknowledge(miss_id, result="resolved"):
                    summary["resolved"] += 1
                else:
                    summary["completion_unacknowledged"] += 1
            elif failure and failure.get("status") == "terminal_not_found":
                if await acknowledge(miss_id, result="terminal", http_status=404, error_code="not_found"):
                    summary["terminal"] += 1
                else:
                    summary["completion_unacknowledged"] += 1
            else:
                code = (failure or {}).get("error_code", "network")
                status = (failure or {}).get("http_status")
                when = datetime.now(timezone.utc) + timedelta(minutes=5)
                if await acknowledge(miss_id, result="retryable", http_status=status, error_code=code, next_attempt_at=when):
                    summary["retryable"] += 1
                    if code in {"http_429", "http_503", "http_504"}:
                        summary["throttle_observations"] += 1
                else:
                    summary["completion_unacknowledged"] += 1
        except Exception as error:
            when = datetime.now(timezone.utc) + timedelta(minutes=5)
            code = "timeout" if isinstance(error, TimeoutError) else "network"
            if await acknowledge(miss_id, result="retryable", error_code=code, next_attempt_at=when):
                summary["retryable"] += 1
            else:
                summary["completion_unacknowledged"] += 1
    return summary


async def main() -> None:
    store = get_reference_store()
    if not store.available:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
    summary = await run_once(store, os.environ.get("WORKER_ID", "reference-recovery"))
    print(json.dumps(summary, sort_keys=True))


if __name__ == "__main__":
    asyncio.run(main())
