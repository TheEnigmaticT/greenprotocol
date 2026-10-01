"""Run the actual SciSure SQL fixture in a disposable local PG cluster.

Requires Homebrew postgresql@17. Never reads application credentials or
connects to an existing database. Cluster and Unix socket stay under scratch.
"""
from pathlib import Path
import os
import subprocess
import tempfile

repo = Path(__file__).resolve().parents[1]
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
with tempfile.TemporaryDirectory(prefix='pg-', dir=str(scratch)) as temp:
    root = Path(temp)
    data = root / 'data'
    def run(args):
        return subprocess.run([str(bin_dir / args[0])] + args[1:], env=env,
                              cwd=str(repo), check=True, timeout=120)
    run(['initdb', '-D', str(data), '-A', 'trust', '-U', 'scisure_test', '--no-locale', '-E', 'UTF8'])
    started = False
    try:
        # No TCP listener. Each isolated run uses its own Unix-socket directory.
        run(['pg_ctl', '-D', str(data), '-l', str(root / 'postgres.log'),
             '-o', "-c listen_addresses='' -k " + str(root), '-w', 'start'])
        started = True
        run(['psql', '-h', str(root), '-U', 'scisure_test', '-d', 'postgres',
             '-v', 'ON_ERROR_STOP=1', '-f', str(repo / 'tests/sql/scisure-bridge.sql')])
        print('PASS: actual SciSure migration and SQL acceptance in isolated PostgreSQL')
    except Exception:
        log = root / 'postgres.log'
        if log.exists():
            print(log.read_text())
        raise
    finally:
        if started:
            run(['pg_ctl', '-D', str(data), '-m', 'fast', '-w', 'stop'])
