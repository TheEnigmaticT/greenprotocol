import asyncio
from pathlib import Path

import pubchem


class DenyingStore:
    available = True

    async def acquire_pubchem_request_slot(self):
        return False, 1000


def test_rate_budget_defers_before_any_http_attempt(monkeypatch):
    async def scenario():
        calls = 0

        class Client:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def get(self, url):
                nonlocal calls
                calls += 1
                raise AssertionError('must not issue HTTP without a shared slot')

        monkeypatch.setattr(pubchem, 'get_reference_store', lambda: DenyingStore())
        monkeypatch.setattr(pubchem.httpx, 'AsyncClient', lambda **kwargs: Client())

        assert await pubchem.fetch_pubchem_json('https://pubchem.example/test', 'test') is None
        assert calls == 0
        assert pubchem.get_last_lookup_failure() == {
            'status': 'retryable', 'error_code': 'rate_budget', 'retry_after_ms': 1000,
        }

    asyncio.run(scenario())


def test_rate_budget_sql_locks_before_reading_server_time():
    migration = Path(__file__).parents[2] / "supabase/migrations/20260908000000_add_pubchem_request_budget.sql"
    sql = migration.read_text()

    lock = sql.index("FOR UPDATE;")
    clock = sql.index("clock_timestamp()")
    assert "SELECT next_allowed_at" in sql[:lock]
    assert clock > lock
