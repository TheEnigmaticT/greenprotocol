"""Private Supabase REST store for chemical references and recovery misses."""

from __future__ import annotations

import os
import re
from datetime import datetime
from typing import Any

import httpx

_NAME_RE = re.compile(r"^[^\x00-\x1f\x7f]{1,200}$")


def normalize_name(name: str) -> str:
    """Return the bounded canonical identity used by cache and queue."""
    normalized = " ".join(str(name).strip().lower().split())
    if not _NAME_RE.fullmatch(normalized):
        raise ValueError("chemical name must contain 1-200 printable characters")
    return normalized


class ReferenceStore:
    def __init__(self, *, client: httpx.AsyncClient | None = None, url: str | None = None, key: str | None = None):
        self.url = (url or os.environ.get("SUPABASE_URL", "")).rstrip("/")
        self.key = key or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
        self._client = client
        self._owned_client = client is None

    @property
    def available(self) -> bool:
        return bool(self.url and self.key)

    async def _rpc(self, function: str, payload: dict[str, Any]) -> Any:
        if not self.available:
            return None
        client = self._client or httpx.AsyncClient(timeout=10.0)
        try:
            response = await client.post(
                f"{self.url}/rest/v1/rpc/{function}",
                headers={"apikey": self.key, "Authorization": f"Bearer {self.key}", "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            detail = " ".join(str(exc).split())[:160]
            print(f"[reference-store] RPC {function} failed: status={status or 'transport'} error={type(exc).__name__}: {detail}")
            return None
        finally:
            if self._owned_client:
                await client.aclose()

    async def get_cache(self, name: str) -> dict[str, Any] | None:
        normalized = normalize_name(name)
        result = await self._rpc("get_chemical_reference_cache", {"p_normalized_name": normalized})
        if isinstance(result, list):
            result = result[0] if result else None
        return result.get("record") if isinstance(result, dict) and isinstance(result.get("record"), dict) else None

    async def upsert_cache(self, name: str, record: dict[str, Any]) -> bool:
        normalized = normalize_name(name)
        result = await self._rpc("upsert_chemical_reference_cache", {"p_normalized_name": normalized, "p_record": record})
        return result is not None

    async def enqueue_miss(self, name: str, *, retryable: bool, http_status: int | None = None, error_code: str | None = None) -> bool:
        normalized = normalize_name(name)
        result = await self._rpc("upsert_chemical_reference_miss", {"p_normalized_name": normalized, "p_display_name": name.strip(), "p_retryable": retryable, "p_http_status": http_status, "p_error_code": error_code})
        return result is not None

    async def claim_due(self, worker_id: str, limit: int = 20, lease_seconds: int = 300) -> list[dict[str, Any]]:
        result = await self._rpc("claim_due_chemical_reference_misses", {"p_worker_id": worker_id, "p_limit": min(max(limit, 1), 50), "p_lease_seconds": lease_seconds})
        return result if isinstance(result, list) else []

    async def complete_miss(self, miss_id: str, worker_id: str, *, result: str, http_status: int | None = None, error_code: str | None = None, next_attempt_at: datetime | None = None) -> bool:
        payload = {"p_id": miss_id, "p_worker_id": worker_id, "p_result": result, "p_http_status": http_status, "p_error_code": error_code, "p_next_attempt_at": next_attempt_at.isoformat() if next_attempt_at else None}
        return (await self._rpc("complete_chemical_reference_miss", payload)) is not None


_default_store: ReferenceStore | None = None


def get_reference_store() -> ReferenceStore:
    global _default_store
    if _default_store is None:
        _default_store = ReferenceStore()
    return _default_store
