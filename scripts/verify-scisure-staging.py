#!/usr/bin/env python3
"""Read-only SciSure staging verification. Never prints credentials."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
from typing import Any, cast
import urllib.error
import urllib.request

PROJECT_REF = 'qqyzyezwlzvckjtggoes'
MIGRATIONS = (
    ('20261001000000', 'supabase/migrations/20261001000000_create_scisure_bridge.sql'),
    ('20261001010000', 'supabase/migrations/20261001010000_add_scisure_guest_admission.sql'),
    ('20261001020000', 'supabase/migrations/20261001020000_create_partner_inquiry_mail_outbox.sql'),
    ('20261001030000', 'supabase/migrations/20261001030000_harden_scisure_registered_admission_and_review.sql'),
    ('20261001050000', 'supabase/migrations/20261001050000_enable_registered_quota_ledger_rls.sql'),
    ('20261001060000', 'supabase/migrations/20261001060000_record_mail_acceptance_not_delivery.sql'),
)
EXPECTED_RLS_TABLES = (
    'gpc_scisure_principals', 'gpc_scisure_connections', 'gpc_external_source_snapshots',
    'gpc_scisure_jobs', 'gpc_scisure_quota_reservations', 'gpc_scisure_review_decisions',
    'gpc_scisure_email_events', 'gpc_scisure_guest_subjects', 'gpc_scisure_guest_email_challenges',
    'gpc_scisure_guest_admissions', 'gpc_scisure_guest_email_events',
    'gpc_scisure_guest_subject_reservations', 'gpc_scisure_guest_claims',
    'gpc_partner_inquiries', 'gpc_partner_mail_outbox', 'gpc_partner_mail_tokens',
    'gpc_registered_analysis_quota_ledger',
)
EXPECTED_SERVICE_FUNCTIONS = (
    'gpc_reserve_scisure_job', 'gpc_reserve_registered_analysis_run',
    'gpc_lease_scisure_job', 'gpc_heartbeat_scisure_job',
    'gpc_complete_scisure_job', 'gpc_fail_scisure_job',
    'gpc_purge_expired_scisure_lineage', 'gpc_reserve_scisure_guest_job',
    'gpc_consume_scisure_guest_email_challenge', 'gpc_reserve_scisure_guest_subject_trial',
    'gpc_scisure_guest_subject_remaining', 'gpc_claim_scisure_guest_result',
    'gpc_submit_partner_inquiry', 'gpc_lease_partner_mail', 'gpc_finalize_partner_mail',
    'gpc_queue_scisure_mail', 'gpc_unsubscribe_scisure_marketing',
    'gpc_sync_registered_quota_run_state', 'gpc_record_scisure_review_decision',
    'gpc_record_scisure_guest_review_decision', 'gpc_queue_scisure_guest_mail',
)


def access_token() -> str:
    """Read a local Supabase credential without ever emitting its value."""
    for credential_file in (
        Path.home() / '.supabase' / 'access-token',
        Path.home() / '.config' / 'supabase' / 'access-token',
    ):
        try:
            if token := credential_file.read_text(encoding='utf-8').strip():
                return token
        except FileNotFoundError:
            continue
    for service in ('supabase', 'Supabase CLI'):
        try:
            result = subprocess.run(
                ['security', 'find-generic-password', '-s', service, '-w'],
                check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
            )
        except (FileNotFoundError, subprocess.CalledProcessError):
            continue
        if token := result.stdout.strip():
            return token
    if token := os.environ.get('SUPABASE_ACCESS_TOKEN'):
        return token.strip()
    raise RuntimeError('No local Supabase Management API credential is available.')


def management_query(query: str) -> list[dict[str, object]]:
    request = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query',
        data=json.dumps({'query': query}).encode('utf-8'),
        headers={'Authorization': f'Bearer {access_token()}', 'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Staging Management API query failed with HTTP {error.code}.') from error
    if not isinstance(result, list):
        raise RuntimeError('Staging Management API returned an unexpected response shape.')
    return result


def expected_hashes(repo: Path) -> dict[str, str]:
    return {version: hashlib.sha256((repo / path).read_bytes()).hexdigest() for version, path in MIGRATIONS}


def assert_migration_hashes(migrations: object, hashes: dict[str, str]) -> None:
    if not isinstance(migrations, list):
        raise RuntimeError('Staging migration readback is malformed.')
    remote_hashes = {item.get('version'): item.get('source_sha256') for item in migrations if isinstance(item, dict)}
    if remote_hashes != hashes:
        raise RuntimeError('Staging migration source hashes do not match committed source bytes.')


def assert_service_only_functions(functions: object) -> None:
    if not isinstance(functions, list):
        raise RuntimeError('Staging service-only RPC readback is malformed.')
    by_name: dict[str, list[dict[str, object]]] = {}
    for entry in functions:
        if not isinstance(entry, dict) or not isinstance(entry.get('signature'), str):
            raise RuntimeError('Staging service-only RPC readback is malformed.')
        name = entry['signature'].split('(')[0].rsplit('.', 1)[-1]
        by_name.setdefault(name, []).append(entry)
    expected = set(EXPECTED_SERVICE_FUNCTIONS)
    problems: list[str] = []
    if set(by_name) != expected:
        problems.append('expected function set does not match')
    for name in EXPECTED_SERVICE_FUNCTIONS:
        entries = by_name.get(name, [])
        if len(entries) != 1:
            problems.append(f'{name}: expected one signature, got {len(entries)}')
            continue
        entry = entries[0]
        if entry.get('security_definer') is not True:
            problems.append(f'{name}: not SECURITY DEFINER')
        if entry.get('anon_execute') is not False:
            problems.append(f'{name}: anon EXECUTE is not revoked')
        if entry.get('authenticated_execute') is not False:
            problems.append(f'{name}: authenticated EXECUTE is not revoked')
        if entry.get('service_role_execute') is not True:
            problems.append(f'{name}: service_role EXECUTE is missing')
    if problems:
        raise RuntimeError('service-only RPC privilege invariant failed: ' + '; '.join(problems))


def main() -> int:
    parser = argparse.ArgumentParser(
        description=f'Read-only SciSure verifier for staging project {PROJECT_REF}; never prints credentials.'
    )
    parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    hashes = expected_hashes(repo)
    versions = ','.join(f"'{version}'" for version in hashes)
    table_names = ','.join(f"'{name}'" for name in EXPECTED_RLS_TABLES)
    readback = management_query(f"""
      SELECT jsonb_build_object(
        'migrations', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'version', version, 'source_sha256', encode(digest(statements[1], 'sha256'), 'hex')
          ) ORDER BY version), '[]'::jsonb)
          FROM supabase_migrations.schema_migrations
          WHERE version IN ({versions})
        ),
        'functions', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'signature', p.oid::regprocedure::text,
            'security_definer', p.prosecdef,
            'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
            'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
            'service_role_execute', has_function_privilege('service_role', p.oid, 'EXECUTE')
          ) ORDER BY p.oid::regprocedure::text), '[]'::jsonb)
          FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname IN (
            'gpc_reserve_scisure_job', 'gpc_reserve_registered_analysis_run',
            'gpc_lease_scisure_job', 'gpc_heartbeat_scisure_job',
            'gpc_complete_scisure_job', 'gpc_fail_scisure_job',
            'gpc_purge_expired_scisure_lineage', 'gpc_reserve_scisure_guest_job',
            'gpc_consume_scisure_guest_email_challenge', 'gpc_reserve_scisure_guest_subject_trial',
            'gpc_scisure_guest_subject_remaining', 'gpc_claim_scisure_guest_result',
            'gpc_submit_partner_inquiry', 'gpc_lease_partner_mail', 'gpc_finalize_partner_mail',
            'gpc_queue_scisure_mail', 'gpc_unsubscribe_scisure_marketing',
            'gpc_sync_registered_quota_run_state', 'gpc_record_scisure_review_decision',
            'gpc_record_scisure_guest_review_decision', 'gpc_queue_scisure_guest_mail'
          )
        ),
        'rls', (
          SELECT jsonb_build_object('expected', {len(EXPECTED_RLS_TABLES)}, 'enabled', count(*) FILTER (WHERE c.relrowsecurity))
          FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN ({table_names})
        ),
        'quota_ledger', (
          SELECT jsonb_build_object('exists', to_regclass('public.gpc_registered_analysis_quota_ledger') IS NOT NULL)
        )
      ) AS readback
    """)
    if len(readback) != 1 or not isinstance(readback[0].get('readback'), dict):
        raise RuntimeError('Staging Management API did not return the required readback.')
    remote = cast(dict[str, Any], readback[0]['readback'])
    migrations = remote.get('migrations')
    if not isinstance(migrations, list):
        raise RuntimeError('Staging migration readback is malformed.')
    assert_migration_hashes(migrations, hashes)
    assert_service_only_functions(remote.get('functions'))
    output = {
        'project_ref': PROJECT_REF,
        'migration_hashes': [{'version': version, 'sha256': hashes[version]} for version in hashes],
        'functions': remote.get('functions'),
        'rls': remote.get('rls'),
        'quota_ledger': remote.get('quota_ledger'),
    }
    print(json.dumps(output, sort_keys=True, separators=(',', ':')))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f'verification failed: {error}', file=sys.stderr)
        raise SystemExit(1)
