# boardroom-backend

## Database: Neon PostgreSQL (migrated October 2, 2026)

The backend stores VPs, templates, core facts, directive history and memories
in the Neon project `virtual-office` (id `dawn-shape-22567760`, AWS us-east-2,
Postgres 17, database `boardroom`). It connects with psycopg using
`DATABASE_URL` in `boardroom-backend/.env` (the pooled `-pooler` host). Keep that
value backend-only; it carries the database owner password.

From `~/Projects/virtual-office`:

```sh
npm run local:start   # Start backend (:8100) and UI (http://127.0.0.1:5174)
npm run local:stop    # Stop them; data in Neon is unaffected
npm run local:backup  # pg_dump -Fc of Neon into .local-backups/ (needs pg_dump: `brew install libpq`)
```

Schema: `db/schema.sql` (idempotent). Tests: `TEST_DATABASE_URL="$DATABASE_URL"
.venv/bin/python -m pytest tests` — they run in a throwaway schema over the
direct (non-pooler) host. Never run session-level `SET` commands over the pooled
host: Neon's transaction-mode pooler reuses server connections, so the setting
leaks into the app's connections.

Docker and the local Supabase stack are no longer used.

### Migration history and rollback

- Until May 2026: hosted Supabase project `llsjuxaacdfecxeppbix`. It is still
  running (and billing). On October 2, 2026 its 5 tables were row-for-row
  identical to the local copy.
- September 30 to October 2, 2026: local Supabase in Docker (`supabase/` at the repo
  root, containers `supabase_*_virtual-office`, volume preserved, stopped).
- Since October 2, 2026: Neon. Data was copied from the local Supabase database and
  verified by per-table row count and content hash (8 VPs, 14 templates,
  18 directives, 64 memories, 0 core facts).

Backups in `.local-backups/` (ignored by Git): `2026-09-30-hosted/` (hosted
dump and `original.env`), `2026-10-01_164906/` (local Supabase), `env.pre-neon.bak`
(backend `.env` before Neon), `2026-10-02_neon-source-data.sql` (the exact
data loaded into Neon), and later `local:backup` archives. Neon also keeps
point-in-time history (1 day, as configured on this project).

To roll back to local Supabase, check out the commit before the Neon migration,
restore `.local-backups/env.pre-neon.bak` to `boardroom-backend/.env`, and run
the old launcher. Writes made in Neon after the migration must be exported first.

LangGraph-orchestrated AI VPs powering the boardroom virtual-business platform.

## Architecture

- **LangGraph supervisor → VP nodes → ephemeral Haiku worker subagents** (planner-executor pattern)
- VPs hold persistent organizational memory (charter + objectives + tactical state)
- Workers are stateless, scoped to a single task, return structured results
- HTTP API (FastAPI) for directives + WebSocket for live activity streaming to the pixel-office UI

## VP file layout

Each VP lives under `vps/<id>/` with three files:

- `persona.md` — charter / identity / voice (rarely changes)
- `objectives.yaml` — strategic goals, KPIs, current priorities (monthly-ish)
- `tools.yaml` — tool & MCP-server whitelist (what this VP is authorized to call)

Tactical state (what they were working on yesterday) lives in `boardroom.db` (SQLite).

## Running

```powershell
python -m venv .venv
.\.venv\Scripts\activate
pip install anthropic claude-agent-sdk langgraph "langgraph-checkpoint-sqlite" "fastapi[standard]" uvicorn pyyaml python-dotenv sqlalchemy aiosqlite
cp .env.example .env  # then fill in ANTHROPIC_API_KEY
uvicorn boardroom.main:app --reload --port 8100
```

Send a test directive:

```powershell
curl -X POST http://127.0.0.1:8100/directive -H "Content-Type: application/json" -d "{\"text\":\"Q3 focus is solar refi market in Texas. What should each of you be doing this week?\"}"
```
