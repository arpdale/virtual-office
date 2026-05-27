# boardroom-backend

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
