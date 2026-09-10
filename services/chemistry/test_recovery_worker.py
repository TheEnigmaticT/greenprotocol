import asyncio
from types import SimpleNamespace

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


def test_worker_does_not_restart_the_shared_lease_clock_for_each_row(monkeypatch):
    async def scenario():
        store = FakeStore()
        clock = [0.0]
        looked_up = []

        async def claim(*args, **kwargs):
            return [{"id": "m1", "display_name": "benzene"}, {"id": "m2", "display_name": "ethanol"}]

        async def lookup(name):
            looked_up.append(name)
            return {"molecular_weight": 78.11}

        async def complete(*args, **kwargs):
            store.completed.append((args, kwargs))
            clock[0] = 290.0
            return True

        store.claim_due = claim
        store.complete_miss = complete
        monkeypatch.setattr(recovery_worker, "time", SimpleNamespace(monotonic=lambda: clock[0]))
        monkeypatch.setattr(recovery_worker, "lookup_chemical", lookup)
        monkeypatch.setattr(recovery_worker, "get_last_lookup_failure", lambda: None)
        summary = await recovery_worker.run_once(store, "worker", lease_seconds=300)
        assert looked_up == ["benzene"]
        assert summary["resolved"] == 1
        assert summary["retryable"] == 1
        assert store.completed[-1][1]["error_code"] == "timeout"

    asyncio.run(scenario())


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


def test_worker_does_not_count_or_recomplete_when_completion_ack_is_false(monkeypatch):
    async def scenario():
        store = FakeStore()

        async def lookup(name):
            return {"molecular_weight": 78.11}

        async def unacknowledged_completion(*args, **kwargs):
            store.completed.append((args, kwargs))
            return False

        store.complete_miss = unacknowledged_completion
        monkeypatch.setattr(recovery_worker, "lookup_chemical", lookup)
        monkeypatch.setattr(recovery_worker, "get_last_lookup_failure", lambda: None)
        summary = await recovery_worker.run_once(store, "worker")
        assert summary["resolved"] == 0
        assert summary["completion_unacknowledged"] == 1
        assert len(store.completed) == 1
        assert store.completed[0][1]["result"] == "resolved"

    asyncio.run(scenario())


def test_worker_does_not_recomplete_when_completion_transport_is_ambiguous(monkeypatch):
    async def scenario():
        store = FakeStore()

        async def lookup(name):
            return {"molecular_weight": 78.11}

        async def dropped_completion(*args, **kwargs):
            store.completed.append((args, kwargs))
            raise RuntimeError("response lost after completion")

        store.complete_miss = dropped_completion
        monkeypatch.setattr(recovery_worker, "lookup_chemical", lookup)
        monkeypatch.setattr(recovery_worker, "get_last_lookup_failure", lambda: None)
        summary = await recovery_worker.run_once(store, "worker")
        assert summary["resolved"] == summary["retryable"] == 0
        assert summary["completion_unacknowledged"] == 1
        assert len(store.completed) == 1
        assert store.completed[0][1]["result"] == "resolved"

    asyncio.run(scenario())
