#!/usr/bin/env python3
"""Start/stop this Mac's migrated apps without resetting their databases.

virtual-office keeps its data in Neon PostgreSQL (DATABASE_URL in
boardroom-backend/.env) and needs no local database containers. cma-app still
uses its local Supabase containers.
"""
import datetime
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
PROJECT = ROOT.name
STATE = ROOT / '.local'
STATE.mkdir(exist_ok=True, mode=0o700)

def run(args):
    return subprocess.check_output(args, text=True).strip()

def containers():
    names = run(['docker', 'ps', '-a', '--filter', f'label=com.supabase.cli.project={PROJECT}', '--format', '{{.Names}}']).splitlines()
    if not names or f'supabase_db_{PROJECT}' not in names:
        raise SystemExit('Local containers are missing. Restore from .local-backups before starting; do not reset the database.')
    for item in json.loads(run(['docker', 'inspect', *names])):
        for bindings in (item['HostConfig'].get('PortBindings') or {}).values():
            if any(binding.get('HostIp') != '127.0.0.1' for binding in bindings):
                raise SystemExit('Refusing to start: a container has non-localhost ports. Restore its saved localhost configuration.')
    return names

def database_url():
    env = ROOT / 'boardroom-backend' / '.env'
    for line in env.read_text().splitlines():
        if line.startswith('DATABASE_URL='):
            return line.split('=', 1)[1].strip().strip('"').strip("'")
    raise SystemExit('DATABASE_URL is missing from boardroom-backend/.env')

def pg_dump(url):
    # Neon runs Postgres 17; use a matching client (local if installed, else Docker).
    local = subprocess.run(['sh', '-c', 'command -v pg_dump'], capture_output=True, text=True).stdout.strip()
    if local:
        return [local, '-Fc', '--no-owner', '--no-privileges', url]
    return ['docker', 'run', '--rm', 'postgres:17-alpine', 'pg_dump', '-Fc', '--no-owner', '--no-privileges', url]

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

def spawn(name, cwd, args, url=None):
    record = STATE / f'{name}.process.json'
    if record.exists():
        old = json.loads(record.read_text())
        if same_process(old):
            return
    if url and available(url):
        print(f'Already running: {url}')
        return
    with (STATE / f'{name}.log').open('a') as log:
        proc = subprocess.Popen(args, cwd=cwd, stdout=log, stderr=log, start_new_session=True)
    record.write_text(json.dumps({'pid': proc.pid, 'identity': identity(proc.pid)}))
    if url:
        wait_for(url)

mode = sys.argv[1] if len(sys.argv) > 1 else 'start'
if PROJECT not in ('cma-app', 'virtual-office'):
    raise SystemExit('This launcher is scoped to the two migrated personal apps.')
if PROJECT == 'virtual-office' and mode in ('start', 'stop', 'backup'):
    # Neon-backed: no database containers to manage.
    if mode == 'start':
        database_url()
        backend = ROOT / 'boardroom-backend'
        spawn('virtual-office-backend', backend, [str(backend / '.venv/bin/python'), '-m', 'uvicorn', 'boardroom.main:app', '--host', '127.0.0.1', '--port', '8100'], 'http://127.0.0.1:8100')
        spawn('virtual-office-ui', ROOT / 'webview-ui', ['npm', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], 'http://127.0.0.1:5174')
        print('Virtual office: http://127.0.0.1:5174 | Database: Neon project virtual-office')
    elif mode == 'stop':
        for record in STATE.glob('*.process.json'):
            old = json.loads(record.read_text())
            if old.get('identity') and same_process(old):
                os.killpg(old['pid'], signal.SIGTERM)
            record.unlink()
        print('Stopped. Data lives in Neon and is unaffected.')
    else:
        target = ROOT / '.local-backups' / datetime.datetime.now().strftime('%Y-%m-%d_%H%M%S')
        target.mkdir(parents=True, mode=0o700)
        dump = target / 'database.dump'
        with dump.open('wb') as f:
            subprocess.run(pg_dump(database_url()), stdout=f, check=True)
        dump.chmod(0o600)
        print(f'Private Neon backup: {dump}')
elif mode == 'start':
    names = containers()
    db = f'supabase_db_{PROJECT}'
    subprocess.run(['docker', 'start', db], check=True, stdout=subprocess.DEVNULL)
    for _ in range(60):
        check = subprocess.run(['docker', 'exec', db, 'pg_isready', '-U', 'postgres'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if check.returncode == 0:
            break
        time.sleep(1)
    else:
        raise SystemExit('Local database did not become ready.')
    subprocess.run(['docker', 'start', *[n for n in names if n != db]], check=True, stdout=subprocess.DEVNULL)
    port = 54421 if PROJECT == 'cma-app' else 54521
    wait_for(f'http://127.0.0.1:{port}/auth/v1/health')
    if PROJECT == 'cma-app':
        spawn('functions', ROOT, ['supabase', 'functions', 'serve', '--network-id', 'supabase-personal-local', '--env-file', 'supabase/functions/.env'])
        spawn('cma-app', ROOT, ['npm', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], 'http://127.0.0.1:5173')
        print('CMA: http://127.0.0.1:5173 | Database Studio: http://127.0.0.1:54423')
    else:
        backend = ROOT / 'boardroom-backend'
        spawn('virtual-office-backend', backend, [str(backend / '.venv/bin/python'), '-m', 'uvicorn', 'boardroom.main:app', '--host', '127.0.0.1', '--port', '8100'], 'http://127.0.0.1:8100')
        spawn('virtual-office-ui', ROOT / 'webview-ui', ['npm', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], 'http://127.0.0.1:5174')
        print('Virtual office: http://127.0.0.1:5174 | Database Studio: http://127.0.0.1:54523')
elif mode == 'stop':
    for record in STATE.glob('*.process.json'):
        old = json.loads(record.read_text())
        if old.get('identity') and same_process(old):
            os.killpg(old['pid'], signal.SIGTERM)
        record.unlink()
    subprocess.run(['docker', 'stop', *containers()], check=True, stdout=subprocess.DEVNULL)
    print('Stopped. Database volumes and backups are preserved.')
elif mode == 'backup':
    containers()
    target = ROOT / '.local-backups' / datetime.datetime.now().strftime('%Y-%m-%d_%H%M%S')
    target.mkdir(parents=True, mode=0o700)
    dump = target / 'database.dump'
    with dump.open('wb') as f:
        subprocess.run(['docker', 'exec', f'supabase_db_{PROJECT}', 'pg_dump', '-U', 'postgres', '-d', 'postgres', '-Fc'], stdout=f, check=True)
    dump.chmod(0o600)
    print(f'Private database backup: {dump}')
else:
    raise SystemExit('Usage: local_app.py start|stop|backup')
