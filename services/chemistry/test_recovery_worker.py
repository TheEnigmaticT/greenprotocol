import asyncio

import recovery_worker


class FakeStore:
    def __init__(self):
        self.completed = []

    async def claim_due(self, worker_id, limit=20, lease_seconds=300):
        return [{"id": "m1", "display_name": "benzene"}]

    async def upsert_cache(self, name, record):
        return True

    async def complete_miss(self, *args, **kwargs):
        self.completed.append((args, kwargs))
        return True


def test_worker_resolves_sequentially_and_writes_cache(monkeypatch):
    async def scenario():
        store = FakeStore()
        async def lookup(name):
            return {"molecular_weight": 78.11}
        monkeypatch.setattr(recovery_worker, "lookup_chemical", lookup)
        monkeypatch.setattr(recovery_worker, "get_last_lookup_failure", lambda: None)
        summary = await recovery_worker.run_once(store, "worker")
        assert summary["claimed"] == summary["resolved"] == 1
        assert store.completed[0][1]["result"] == "resolved"
    asyncio.run(scenario())


def test_worker_reschedules_retryable_failure(monkeypatch):
    async def scenario():
        store = FakeStore()
        async def lookup(name):
            return None
        monkeypatch.setattr(recovery_worker, "lookup_chemical", lookup)
        monkeypatch.setattr(recovery_worker, "get_last_lookup_failure", lambda: {"status":"retryable", "error_code":"http_503", "http_status":503})
        summary = await recovery_worker.run_once(store, "worker")
        assert summary["retryable"] == 1
        assert store.completed[0][1]["result"] == "retryable"
    asyncio.run(scenario())


def test_worker_marks_confirmed_absence_terminal(monkeypatch):
    async def scenario():
        store = FakeStore()
        async def lookup(name):
            return None
        monkeypatch.setattr(recovery_worker, "lookup_chemical", lookup)
        monkeypatch.setattr(recovery_worker, "get_last_lookup_failure", lambda: {"status": "terminal_not_found"})
        summary = await recovery_worker.run_once(store, "worker")
        assert summary["terminal"] == 1
        assert store.completed[0][1]["result"] == "terminal"
    asyncio.run(scenario())
