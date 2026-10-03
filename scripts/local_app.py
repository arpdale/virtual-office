#!/usr/bin/env python3
"""Start/stop/back up virtual-office on this Mac.

Data lives in Neon PostgreSQL (DATABASE_URL in boardroom-backend/.env); no
Docker or local database is involved.
"""
import datetime
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / 'boardroom-backend'
STATE = ROOT / '.local'
STATE.mkdir(exist_ok=True, mode=0o700)
# Homebrew's libpq is keg-only, so its pg_dump is usually not on PATH.
PG_DUMP_FALLBACKS = ['/opt/homebrew/opt/libpq/bin/pg_dump', '/usr/local/opt/libpq/bin/pg_dump']


def database_url():
    for line in (BACKEND / '.env').read_text().splitlines():
        if line.startswith('DATABASE_URL='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise SystemExit('DATABASE_URL is missing from boardroom-backend/.env')


def pg_dump_binary():
    found = shutil.which('pg_dump') or next((p for p in PG_DUMP_FALLBACKS if os.access(p, os.X_OK)), None)
    if not found:
        raise SystemExit('pg_dump not found. Install it with: brew install libpq')
    return found


def identity(pid):
    p = subprocess.run(['ps', '-p', str(pid), '-o', 'lstart=', '-o', 'command='], capture_output=True, text=True)
    return p.stdout.strip() if p.returncode == 0 else ''


def same_process(record):
    # Compare start time only: Python re-execs into its framework binary, so
    # the command line recorded at spawn time no longer matches `ps`.
    current = identity(record['pid'])
    return bool(current) and current[:24] == record.get('identity', '')[:24]


def available(url):
    try:
        with urllib.request.urlopen(url, timeout=2):
            return True
    except Exception:
        return False


def wait_for(url):
    for _ in range(60):
        if available(url):
            return
        time.sleep(1)
    raise SystemExit(f'Service did not become ready: {url}. See .local/*.log')


def spawn(name, cwd, args, url):
    record = STATE / f'{name}.process.json'
    if record.exists() and same_process(json.loads(record.read_text())):
        return
    if available(url):
        print(f'Already running: {url}')
        return
    with (STATE / f'{name}.log').open('a') as log:
        proc = subprocess.Popen(args, cwd=cwd, stdout=log, stderr=log, start_new_session=True)
    record.write_text(json.dumps({'pid': proc.pid, 'identity': identity(proc.pid)}))
    wait_for(url)


mode = sys.argv[1] if len(sys.argv) > 1 else 'start'
if mode == 'start':
    database_url()
    spawn('virtual-office-backend', BACKEND, [str(BACKEND / '.venv/bin/python'), '-m', 'uvicorn', 'boardroom.main:app', '--host', '127.0.0.1', '--port', '8100'], 'http://127.0.0.1:8100')
    spawn('virtual-office-ui', ROOT / 'webview-ui', ['npm', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], 'http://127.0.0.1:5174')
    print('Virtual office: http://127.0.0.1:5174 | Database: Neon project virtual-office')
elif mode == 'stop':
    for record in STATE.glob('*.process.json'):
        old = json.loads(record.read_text())
        if old.get('identity') and same_process(old):
            os.killpg(old['pid'], signal.SIGTERM)
        record.unlink()
    print('Stopped. Data lives in Neon and is unaffected.')
elif mode == 'backup':
    target = ROOT / '.local-backups' / datetime.datetime.now().strftime('%Y-%m-%d_%H%M%S')
    target.mkdir(parents=True, mode=0o700)
    dump = target / 'database.dump'
    with dump.open('wb') as f:
        subprocess.run([pg_dump_binary(), '-Fc', '--no-owner', '--no-privileges', database_url()], stdout=f, check=True)
    dump.chmod(0o600)
    print(f'Private Neon backup: {dump}')
else:
    raise SystemExit('Usage: local_app.py start|stop|backup')
