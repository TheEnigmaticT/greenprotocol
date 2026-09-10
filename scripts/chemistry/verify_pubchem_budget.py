"""Verify PubChem budget and recovery migrations in isolated PostgreSQL.

Usage: python3 scripts/chemistry/verify_pubchem_budget.py --container NAME
The container must have no network or published ports and provide psql as
postgres. Creates/drops only a unique test database, never a remote database.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess
import uuid


ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = (
    "20260815000000_create_chemical_reference_recovery.sql",
    "20260901000000_fix_reference_recovery_rpc_ambiguity.sql",
    "20260908000000_add_pubchem_request_budget.sql",
)


def verify(container):
    def docker(*args, input=None):
        result = subprocess.run(
            ["docker", "exec", "-i", container, *args], input=input,
            text=True, capture_output=True, timeout=30,
        )
        if result.returncode:
            raise RuntimeError(result.stderr.strip())
        return result.stdout.strip()

    config = json.loads(subprocess.check_output(["docker", "inspect", container], text=True))[0]
    if config["HostConfig"]["NetworkMode"] != "none" or config["HostConfig"]["PortBindings"]:
        raise RuntimeError("Use an isolated --network none container with no published ports")
    database = "gcai_budget_test_" + uuid.uuid4().hex

    def sql(query, db=database):
        return docker("psql", "-U", "postgres", "-d", db, "-At", "-v", "ON_ERROR_STOP=1", input=query)

    sql("CREATE DATABASE " + database + ";", "postgres")
    try:
        # Supabase roles are cluster-scoped; only create absent test roles.
        sql("""CREATE EXTENSION IF NOT EXISTS pgcrypto;
        DO $$ BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
        END $$;""")
        for filename in MIGRATIONS:
            sql((ROOT / "supabase/migrations" / filename).read_text())

        permissions = sql("""SELECT
          has_function_privilege('anon', 'public.acquire_pubchem_request_slot(integer)', 'EXECUTE'),
          has_function_privilege('authenticated', 'public.acquire_pubchem_request_slot(integer)', 'EXECUTE'),
          has_function_privilege('service_role', 'public.acquire_pubchem_request_slot(integer)', 'EXECUTE'),
          has_function_privilege('anon', 'public.upsert_chemical_reference_miss(text,text,boolean,integer,text)', 'EXECUTE'),
          has_function_privilege('service_role', 'public.upsert_chemical_reference_miss(text,text,boolean,integer,text)', 'EXECUTE');""")
        assert permissions == "f|f|t|f|t", permissions

        # A long requested interval isolates the concurrency test from host load.
        def acquire(_):
            return sql("SELECT * FROM public.acquire_pubchem_request_slot(60000);")

        with ThreadPoolExecutor(max_workers=12) as pool:
            outcomes = list(pool.map(acquire, range(12)))
        winners = [row for row in outcomes if row == "t|0"]
        assert len(winners) == 1, outcomes
        assert all(row == "t|0" or row.startswith("f|") and int(row.split("|")[1]) > 0 for row in outcomes), outcomes

        sql("UPDATE public.gpc_pubchem_request_budget SET next_allowed_at=clock_timestamp()-interval '1 second';")
        minimum = sql("SELECT * FROM public.acquire_pubchem_request_slot(1); SELECT extract(epoch FROM next_allowed_at-updated_at) FROM public.gpc_pubchem_request_budget;")
        granted, seconds = minimum.splitlines()
        assert granted == "t|0" and float(seconds) >= 1, minimum
        expiry = sql("SELECT * FROM public.acquire_pubchem_request_slot(1000); SELECT pg_sleep(1.1); SELECT * FROM public.acquire_pubchem_request_slot(1000);").splitlines()
        assert expiry[0].startswith("f|") and expiry[-1] == "t|0", expiry

        # Exercise the actual recovery RPCs after all migrations: an intentional
        # budget denial queues, can be leased, is retried, and only its lease
        # owner can resolve it. Cache readback proves durable result visibility.
        sql("""DO $$
        DECLARE first_claim record; second_claim record; retry_at timestamptz;
        BEGIN
          PERFORM * FROM public.upsert_chemical_reference_miss(
            'ethyl acetate', 'Ethyl Acetate', true, NULL, 'rate_budget');
          IF (SELECT last_error_code FROM public.gpc_chemical_reference_misses
              WHERE normalized_name='ethyl acetate') <> 'rate_budget' THEN
            RAISE EXCEPTION 'rate_budget was not durably queued';
          END IF;
          SELECT * INTO first_claim FROM public.claim_due_chemical_reference_misses('worker-a', 1, 30);
          IF first_claim.normalized_name <> 'ethyl acetate' OR first_claim.status <> 'retrying' THEN
            RAISE EXCEPTION 'rate_budget queue was not claimed';
          END IF;
          retry_at := clock_timestamp() + interval '1 minute';
          IF NOT public.complete_chemical_reference_miss(first_claim.id, 'worker-a', 'retryable', NULL, 'rate_budget', retry_at) THEN
            RAISE EXCEPTION 'retry completion was not acknowledged';
          END IF;
          IF EXISTS (SELECT 1 FROM public.claim_due_chemical_reference_misses('worker-b', 1, 30)) THEN
            RAISE EXCEPTION 'future retry was claimed early';
          END IF;
          UPDATE public.gpc_chemical_reference_misses SET next_attempt_at=clock_timestamp()-interval '1 second'
            WHERE id=first_claim.id;
          SELECT * INTO second_claim FROM public.claim_due_chemical_reference_misses('worker-b', 1, 30);
          IF second_claim.id <> first_claim.id OR second_claim.attempt_count <> 2 THEN
            RAISE EXCEPTION 'retry was not re-leased';
          END IF;
          IF public.complete_chemical_reference_miss(second_claim.id, 'worker-a', 'resolved') THEN
            RAISE EXCEPTION 'non-owner completed lease';
          END IF;
          PERFORM public.upsert_chemical_reference_cache('ethyl acetate', '{"cid":8857}'::jsonb);
          IF NOT public.complete_chemical_reference_miss(second_claim.id, 'worker-b', 'resolved') THEN
            RAISE EXCEPTION 'owner could not resolve lease';
          END IF;
          IF (SELECT record->>'cid' FROM public.get_chemical_reference_cache('ethyl acetate')) <> '8857' THEN
            RAISE EXCEPTION 'cache readback failed';
          END IF;
        END $$;
        SELECT normalized_name,status,attempt_count,last_error_code,locked_by IS NULL
        FROM public.gpc_chemical_reference_misses WHERE normalized_name='ethyl acetate';""")
        recovery_readback = sql("""SELECT normalized_name,status,attempt_count,last_error_code,locked_by IS NULL
          FROM public.gpc_chemical_reference_misses WHERE normalized_name='ethyl acetate';
          SELECT record->>'cid' FROM public.get_chemical_reference_cache('ethyl acetate');""").splitlines()
        assert recovery_readback == ["ethyl acetate|resolved|2||t", "8857"], recovery_readback

        report = {
            "migrations": "passed",
            "permissions": "passed",
            "concurrent_clients": len(outcomes),
            "grants": len(winners),
            "minimum_interval": "passed",
            "expiry": "passed",
            "recovery_queue_claim_retry_cache_resolve": "passed",
            "recovery_readback": recovery_readback,
        }
        print(json.dumps(report, indent=2))
    finally:
        sql("DROP DATABASE " + database + ";", "postgres")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", required=True)
    verify(parser.parse_args().container)
