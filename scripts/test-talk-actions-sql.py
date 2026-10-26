"""Run the talk-about-this actions SQL fixture (approve/reject receipts, procedure proposals)
against the real migrations in a disposable local PG cluster.

Requires Homebrew postgresql@17. Never reads application credentials or
connects to an existing database. Cluster and Unix socket stay under scratch.
"""
from pathlib import Path
import os
import subprocess
import sys
import tempfile
import time

repo = Path(__file__).resolve().parents[1]
fixtures = (Path('tests/sql/talk-actions.sql'),)
if sys.argv[1:] == ['--list']:
    print('\n'.join(str(fixture) for fixture in fixtures))
    raise SystemExit(0)
if len(sys.argv) != 1:
    raise SystemExit('Usage: test-talk-actions-sql.py [--list]')
bin_dir = Path('/opt/homebrew/opt/postgresql@17/bin')
for name in ('initdb', 'pg_ctl', 'psql'):
    if not (bin_dir / name).is_file():
        raise SystemExit('Missing local PostgreSQL executable: ' + name)
scratch = Path.home() / '.hermes/cache/scratch'
scratch.mkdir(parents=True, exist_ok=True)
# Never inherit PG connection parameters from a production shell.
env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
env['LC_ALL'] = 'C'
env['LANG'] = 'C'
for fixture in fixtures:
    with tempfile.TemporaryDirectory(prefix='pg-', dir=str(scratch)) as temp:
        root = Path(temp)
        data = root / 'data'
        def run(args):
            return subprocess.run([str(bin_dir / args[0])] + args[1:], env=env,
                                  cwd=str(repo), check=True, timeout=120)
        run(['initdb', '-D', str(data), '-A', 'trust', '-U', 'talk_test', '--no-locale', '-E', 'UTF8'])
        started = False
        try:
            # No TCP listener. Each fixture gets a new cluster and socket directory.
            run(['pg_ctl', '-D', str(data), '-l', str(root / 'postgres.log'),
                 '-o', "-c listen_addresses='' -k " + str(root), '-w', 'start'])
            started = True
            run(['psql', '-h', str(root), '-U', 'talk_test', '-d', 'postgres',
                 '-v', 'ON_ERROR_STOP=1', '-f', str(repo / fixture)])
            print(f'PASS: {fixture} in isolated PostgreSQL')
            # Two concurrent sessions double-submit the same approval. The conversation row lock
            # must serialize them and the second must replay the first receipt.
            def session(delay):
                sql = (
                    "BEGIN; SET LOCAL ROLE authenticated; "
                    "SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-0000000000a1',true); "
                    "SELECT action_id FROM approve_scoped_recommendation('00000000-0000-0000-0000-0000000000c1'); "
                    f"SELECT pg_sleep({delay}); COMMIT;"
                )
                return subprocess.Popen(
                    [str(bin_dir / 'psql'), '-h', str(root), '-U', 'talk_test', '-d', 'postgres',
                     '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql],
                    env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            first = session(1.5)
            time.sleep(0.5)
            second = session(0)
            outputs = [p.communicate(timeout=60) for p in (first, second)]
            if first.returncode or second.returncode:
                raise SystemExit('Concurrent approvals failed: ' + repr(outputs))
            ids = [out.splitlines()[-1] for out, _ in outputs if out.splitlines()]
            count = subprocess.run(
                [str(bin_dir / 'psql'), '-h', str(root), '-U', 'talk_test', '-d', 'postgres', '-At', '-c',
                 "SELECT count(*) FROM gpc_talk_actions WHERE conversation_id='00000000-0000-0000-0000-0000000000c1'"],
                env=env, capture_output=True, text=True, check=True).stdout.strip()
            if len(ids) != 2 or ids[0] != ids[1] or count != '1':
                raise SystemExit(f'Concurrent double-submit was not idempotent: ids={ids} rows={count}')
            print('PASS: concurrent double-submit approval replays one receipt')
        except Exception:
            log = root / 'postgres.log'
            if log.exists():
                print(log.read_text())
            raise
        finally:
            if started:
                run(['pg_ctl', '-D', str(data), '-m', 'fast', '-w', 'stop'])
