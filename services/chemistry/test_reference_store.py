import asyncio
import pytest
import httpx

from reference_store import ReferenceStore, normalize_name


def test_normalize_name_is_canonical_and_bounded():
    assert normalize_name("  AcETIC   Acid ") == "acetic acid"
    with pytest.raises(ValueError):
        normalize_name("x" * 201)

def test_store_enqueues_claims_and_completes_via_rpc():
  async def scenario():
    calls = []
    def handler(request):
        calls.append((request.url.path, request.read()))
        if "claim_due" in str(request.url):
            return httpx.Response(200, json=[{"id":"1", "display_name":"Acetic Acid"}])
        return httpx.Response(200, json=True)
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    store = ReferenceStore(client=client, url="https://example.supabase.co", key="service-key")
    assert await store.enqueue_miss("Acetic Acid", retryable=True, http_status=503, error_code="http_503")
    assert (await store.claim_due("worker"))[0]["id"] == "1"
    assert await store.complete_miss("1", "worker", result="retryable", error_code="http_503", next_attempt_at=__import__('datetime').datetime.now(__import__('datetime').timezone.utc)) is True
    assert len(calls) == 3
    await client.aclose()
  asyncio.run(scenario())
