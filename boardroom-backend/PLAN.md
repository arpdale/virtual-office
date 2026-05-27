# Boardroom Backend — Master Plan

Status: Locked architecture as of 2026-05-26 (revised w/ streaming + overlay + dynamic VPs).
Supersedes prior briefings.

This document captures every decision made so far so we don't lose context.

---

## What We're Building

A virtual business: 6 AI VPs who think, remember, and report up to a CEO (the user). Each VP has a persistent persona, accumulated memory, strategic objectives, and access to delegate work to ephemeral worker subagents. VPs are visualized as characters in a pixel-art office UI; clicking one opens a panel showing what they've been working on, with a chat box to send them new directives.

**Two co-existing surfaces:**
- **Pixel office UI** (existing TypeScript codebase at `pixelagents/`) — visual ambient awareness
- **Slack / iMessage** (future) — text-driven interaction from anywhere

Both talk to one backend.

---

## The Six VPs

| ID | Name | Role | Palette |
|---|---|---|---|
| `ethan_vale` | Ethan Vale | CTO | char_0 |
| `sofia_reyes` | Sofia Reyes | CMO | char_1 |
| `marcus_chen` | Marcus Chen | CFO | char_2 |
| `blake_monroe` | Blake Monroe | Head of Sales | char_3 |
| `jordan_brooks` | Jordan Brooks | Operations Lead | char_4 |
| `valentina_cruz` | Valentina Cruz | Head of Design | char_5 |

Each lives at `vps/<id>/` with three files:
- `persona.md` — charter / identity / voice (YAML frontmatter for id/name/role + markdown body). **Rarely changes.**
- `objectives.yaml` — strategic goals, KPIs, current priorities. **Monthly cadence.**
- `tools.yaml` — tool & MCP-server whitelist. **Per-VP access control.**

Tactical state (the dynamic "what I'm working on") lives in the database, not these files.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Python 3.12 | Standard for agent frameworks |
| HTTP | FastAPI + uvicorn | Async-first, WebSocket support, type-safe |
| Orchestration | LangGraph (when added) | Durable checkpointing, supervisor-worker pattern |
| Agent LLM | `claude-agent-sdk` → subprocess `claude` CLI | Uses Max subscription via `claude login`, no API key needed |
| Database | Supabase (Postgres) | Web admin UI, future cloud accessibility, RLS optional |
| Local dev fallback | SQLite | Same SQL surface, swap-in driver, works without Supabase keys |
| Auth | None for v1 (single user, local) | Add RLS / Supabase Auth when multi-user emerges |

**Why CLI (not Anthropic API):** the user has Claude Max ($200/mo flat). The SDK subprocesses the CLI which uses Max creds. No per-token billing.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       Pixel office UI (TS)                       │
│  - 6 VP characters auto-spawn, walk, sit, hover tooltips         │
│  - Click character → side panel with history + chat              │
└────────────────────────┬─────────────────────────────────────────┘
                         │ HTTP + WebSocket
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│           Boardroom backend (FastAPI, port 8100)                 │
│                                                                  │
│  Routes:                                                         │
│   GET   /vps                  — list roster + profile data       │
│   GET   /vp/{id}              — one VP's full profile            │
│   GET   /vp/{id}/history      — recent directives + responses    │
│   GET   /vp/{id}/memories     — typed extracted memories         │
│   POST  /vp/{id}/chat         — send directive to ONE VP         │
│   POST  /directive            — send to ALL VPs (board mtg)      │
│   POST  /vp/{id}/core_facts   — pin a fact to Tier 1 (manual)    │
│   WS    /ws                   — push activity events to UI       │
│                                                                  │
│  Layers:                                                         │
│   ┌────────────────────────────────────────────────────────┐    │
│   │ Director — fans directive to VPs, aggregates briefing  │    │
│   └────────────────────────────────────────────────────────┘    │
│   ┌────────────────────────────────────────────────────────┐    │
│   │ VP nodes — assemble prompt, call claude-agent-sdk,     │    │
│   │ run recall_memory tool, return response               │    │
│   └────────────────────────────────────────────────────────┘    │
│   ┌────────────────────────────────────────────────────────┐    │
│   │ Memory store (3 tiers) — read recent, write entries,   │    │
│   │ FTS5 search                                            │    │
│   └────────────────────────────────────────────────────────┘    │
│   ┌────────────────────────────────────────────────────────┐    │
│   │ Extractor — Haiku call after each response, writes     │    │
│   │ typed memories                                         │    │
│   └────────────────────────────────────────────────────────┘    │
└────────────────────────┬─────────────────────────────────────────┘
                         │ Postgres protocol
                         ▼
┌──────────────────────────────────────────────────────────────────┐
│             Supabase (Postgres + Realtime + Auth)                │
│                                                                  │
│   Tables: core_facts, directive_history, memories                │
│   (Schema below)                                                 │
└──────────────────────────────────────────────────────────────────┘
```

---

## Memory Architecture — Three Tiers

The most-discussed decision. Each tier solves a distinct problem.

### Tier 1 — `core_facts` (always in prompt)

Persistent rules + knowledge that should never be forgotten. Brand voice rules, company values, persistent constraints, named relationships that anchor the VP.

- **Size**: small (~5-15 entries per VP)
- **Curation**: hand-managed at first. User promotes from Tier 3 → Tier 1 by clicking "pin to core" in the UI.
- **Injection**: ALL core_facts always inserted into the system prompt.

### Tier 2 — `directive_history` (full audit + search)

Every directive + every response, captured verbatim. Powers two things:
1. The "click VP → see what they've been working on" UI
2. The `recall_memory(query)` tool — agent can search older specific moments

- **Size**: unbounded (millions of rows fine for Postgres)
- **Indexing**: Postgres full-text search (`tsvector`) on directive + response
- **Retention**: never auto-deleted (audit trail)

### Tier 3 — `memories` (typed, recency-injected)

Structured facts extracted from each directive+response by a Haiku call. The "what's been on my mind lately" layer.

- **Size**: ~5 memories per directive × 365 days = a few thousand per VP per year. Trivial for Postgres.
- **Types**: `preference` / `fact` / `relationship` / `pattern` (taxonomy borrowed from Walter's Jarvis project)
- **Injection**: top-N most recent for that VP injected as "recent context"
- **Decay**: deferred. We won't have a volume problem for years.

### The flow on each directive

```
1. User sends directive to VP-Marketing.

2. Backend assembles VP system prompt:
   - persona.md body (charter)
   - objectives.yaml (current goals)
   - ALL Tier 1 core_facts for this VP
   - TOP-N (default 8) most recent Tier 3 memories for this VP

3. claude-agent-sdk spawns `claude` CLI subprocess for VP:
   - System prompt = above
   - Tools available = recall_memory + note_to_self
   - User message = the directive

4. VP responds (may call recall_memory mid-turn to search Tier 2).

5. Response returned to user.

6. Background tasks (don't block response):
   a. INSERT into directive_history (Tier 2)
   b. Haiku extraction call: "extract memorable facts as JSON"
   c. INSERT each extracted memory into Tier 3
```

---

## Supabase Schema

Three tables. Copy-paste into the Supabase SQL editor once the project exists.

```sql
-- Tier 1: Always in prompt. Hand-curated persistent knowledge.
CREATE TABLE core_facts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vp_id        text NOT NULL,
    content      text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_core_facts_vp ON core_facts(vp_id);

-- Tier 2: Full audit trail. Powers history UI + recall_memory tool.
CREATE TABLE directive_history (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vp_id        text NOT NULL,
    directive    text NOT NULL,
    response     text NOT NULL,
    -- target_scope = 'individual' (single VP chat) or 'board' (all-hands directive)
    target_scope text NOT NULL DEFAULT 'individual',
    -- Postgres full-text search vector, auto-maintained
    fts          tsvector GENERATED ALWAYS AS (
        to_tsvector('english', coalesce(directive,'') || ' ' || coalesce(response,''))
    ) STORED,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_directive_history_vp_created ON directive_history(vp_id, created_at DESC);
CREATE INDEX idx_directive_history_fts ON directive_history USING GIN(fts);

-- Tier 3: Typed extracted memories. Recency-injected into prompts.
CREATE TABLE memories (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    vp_id                 text NOT NULL,
    memory_type           text NOT NULL CHECK (memory_type IN ('preference','fact','relationship','pattern')),
    content               text NOT NULL,
    source_directive_id   uuid REFERENCES directive_history(id) ON DELETE SET NULL,
    created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_memories_vp_created ON memories(vp_id, created_at DESC);
CREATE INDEX idx_memories_type ON memories(vp_id, memory_type);
```

**RLS:** Not enabled for v1. The backend uses the service_role key which bypasses RLS anyway. We add it when we move to multi-user.

**Realtime:** Don't enable on these tables for v1. We push activity via WebSocket directly from the backend; Supabase realtime is duplicative.

---

## API Surface (every endpoint, contract included)

### `GET /vps`
List the roster. Used by the UI to know who to render.

```json
[
  { "id": "ethan_vale", "name": "Ethan Vale", "role": "CTO", "palette": 0 },
  ...
]
```

### `GET /vp/{id}`
Full profile for one VP. Used by the side panel header.

```json
{
  "id": "ethan_vale",
  "name": "Ethan Vale",
  "role": "CTO",
  "palette": 0,
  "description": "Brilliant, intense, slightly mysterious...",
  "objectives": { "quarter": "2026-Q3", "north_star": "..." },
  "core_facts": [ {"id": "...", "content": "..."} ],
  "memory_count": 47,
  "directive_count": 12
}
```

### `GET /vp/{id}/history?limit=20`
Recent directives + responses for this VP. Powers the "what they've been working on" tab.

```json
[
  {
    "id": "...",
    "directive": "...",
    "response": "...",
    "target_scope": "individual",
    "created_at": "2026-05-26T14:32:00Z"
  },
  ...
]
```

### `GET /vp/{id}/memories?type=preference&limit=50`
Typed memories for this VP. Powers the "what they remember" tab.

```json
[
  { "id": "...", "memory_type": "preference", "content": "...", "created_at": "..." }
]
```

### `POST /vp/{id}/chat` — STREAMING (Server-Sent Events)

Send a directive to ONE VP. Response **streams** so the user sees text appear token-by-token in the UI.

Request:
```json
{ "text": "What's our next move on the credit-check latency project?" }
```

Response: `Content-Type: text/event-stream`

```
event: meta
data: {"directive_id": "..."}

event: token
data: {"text": "I think "}

event: token
data: {"text": "the right move "}

...

event: done
data: {"memories_extracted": 3}
```

The frontend opens an EventSource on the response body and appends each `token` event's text to the message view. `done` signals end of stream + how many memories were extracted in the background.

Sync version of this endpoint kept as `POST /vp/{id}/chat/sync` for non-UI callers (cron jobs, scripts, the Director when aggregating).

### `POST /directive`
Send to ALL VPs (existing endpoint). The board-meeting path.

Same shape as before — Director aggregates per-VP responses into a briefing.

### `POST /vp/{id}/core_facts`
Pin a fact to Tier 1 (manual promotion). Used when the user reads a memory and thinks "this should be persistent."

Request:
```json
{ "content": "Brand voice avoids the word 'innovative'." }
```

### `WS /ws`
WebSocket stream of activity events. The pixel office subscribes to animate characters.

Event shape:
```json
{ "type": "vp_thinking", "vp_id": "ethan_vale" }
{ "type": "vp_responding", "vp_id": "ethan_vale" }
{ "type": "vp_done", "vp_id": "ethan_vale" }
{ "type": "memory_extracted", "vp_id": "ethan_vale", "count": 3 }
```

---

## Frontend Integration (the pixel office UI)

The existing UI lives at `C:\Users\wrichard\desktop\pixelagents\webview-ui\` (TypeScript, React, Canvas). Six VP characters auto-spawn and walk around.

### What's needed — full-screen overlay (gamified)

1. **Click handler:** clicking a character opens a **full-screen overlay** that dims the office behind it. Pixel-art styled borders + buttons to fit the boardroom aesthetic. Esc or click-outside closes.
2. **VPOverlay component** (new) with 5 tabs across the top:
   - **Profile** — avatar, name, role, description, current objectives (read-only)
   - **Recent Work** — scrollable `directive_history` list, newest first, collapsible cards
   - **Memory** — typed memories grouped by type (preference/fact/relationship/pattern), each with "pin to core" button
   - **Chat** — main interaction surface. Textarea at bottom, message history above. Responses **stream token-by-token via SSE** so text appears as the VP "thinks."
   - **Personality** — editable persona + objectives. User can directly edit the charter, tweak goals, hit save. Changes hot-reload into the VP's next prompt.
3. While the VP is thinking, the character in the office (still partially visible behind the overlay) animates "thinking" via the existing tool-status animation hooks.
4. **"+ New VP" button** in the bottom toolbar opens the onboarding wizard (see Dynamic VP Creation section below).

### Backend ↔ frontend wiring

- Backend serves `http://127.0.0.1:8100`
- Frontend (already on `127.0.0.1:3101`) fetches over HTTP with CORS allowed
- WebSocket: frontend connects to `ws://127.0.0.1:8100/ws` IN ADDITION to the existing `/ws` for office state. Two WS connections is fine; we keep concerns separate.

---

## Backend Code Organization

```
boardroom-backend/
├── pyproject.toml + .env.example + README.md + PLAN.md (this file)
├── vps/                          ← per-VP config (filesystem)
│   └── <id>/{persona.md, objectives.yaml, tools.yaml}
├── src/boardroom/
│   ├── config.py                  ← load VPs + env settings ✅ DONE
│   ├── main.py                    ← FastAPI app ✅ DONE (needs new endpoints)
│   ├── agents/
│   │   ├── vp.py                  ← VP node ✅ DONE (needs memory wiring)
│   │   ├── director.py            ← supervisor ✅ DONE
│   │   ├── tools.py               ← recall_memory + note_to_self MCP tools
│   │   └── extractor.py           ← Haiku-driven memory extraction (NEW)
│   ├── persistence/
│   │   ├── store.py               ← Storage interface (NEW)
│   │   ├── sqlite_store.py        ← Local dev impl (NEW)
│   │   └── supabase_store.py      ← Production impl (NEW)
│   └── api/
│       ├── routes_vp.py           ← /vp/{id}/* endpoints (NEW)
│       └── ws.py                  ← /ws WebSocket (NEW)
```

The **storage interface** (`Store` abstract base class) defines the surface:

```python
class Store(ABC):
    # Tier 1
    def list_core_facts(self, vp_id: str) -> list[CoreFact]: ...
    def add_core_fact(self, vp_id: str, content: str) -> CoreFact: ...

    # Tier 2
    def write_directive(self, vp_id: str, directive: str, response: str, scope: str) -> Directive: ...
    def list_directives(self, vp_id: str, limit: int = 20) -> list[Directive]: ...
    def search_directives(self, vp_id: str, query: str, limit: int = 10) -> list[Directive]: ...

    # Tier 3
    def write_memory(self, vp_id: str, type: str, content: str, source_id: str | None) -> Memory: ...
    def list_memories(self, vp_id: str, type: str | None, limit: int = 50) -> list[Memory]: ...
    def recent_memories(self, vp_id: str, limit: int = 8) -> list[Memory]: ...
```

Two implementations behind the same interface. Env var `STORAGE_BACKEND=sqlite|supabase` picks one at boot.

---

## Migration Path: SQLite → Supabase

When you create the Supabase project and paste me the keys, the migration is:

1. Set `STORAGE_BACKEND=supabase` and `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` in `.env`
2. Run the schema SQL (above) in Supabase SQL editor
3. Optional one-shot script to copy SQLite rows to Postgres (we write it when you're ready)
4. Restart backend — it picks up the Supabase driver

Zero code changes; just config + data move.

---

## Dynamic VP Creation & Customization

VPs are not hard-coded. The 6 we have today (Ethan, Sofia, Marcus, Blake, Jordan, Valentina) are *seed data*. Users can add new VPs, edit existing ones, and the VPs themselves can evolve based on feedback. This is the "gamified custom-GPT for VPs" pattern.

### Three sub-features

**1. Add a new VP (onboarding wizard)**

User clicks "+ New VP" in the office toolbar. Modal opens with a template gallery: archetypes for common business roles, each with a distinctive flavor.

| Template | Display name | Distinct flavor |
|---|---|---|
| `cmo_data_driven` | CMO — Data-driven | Optimizes for measurable conversion; suspicious of "brand vibes" |
| `cmo_creative` | CMO — Creative | Brand-first, taste-driven, allergic to spreadsheet thinking |
| `cfo_conservative` | CFO — Conservative | Long-horizon, risk-averse, asks "what does this cost if wrong?" |
| `cfo_growth` | CFO — Growth-oriented | Comfortable with debt for opportunity; thinks in IRR |
| `sales_hunter` | Head of Sales — Hunter | Pipeline-first, competitive, closes fast |
| `sales_farmer` | Head of Sales — Farmer | Account-relationship-first, long sales cycles |
| `cto_pragmatist` | CTO — Pragmatist | Ship-it bias, technical debt is a budget line |
| `cto_architect` | CTO — Architect | Systems thinker, will block a release to get the abstraction right |
| `head_of_design` | Head of Design | Taste-maker, visual-first |
| `head_of_people` | Head of People | Org-culture-first, hiring + retention obsessed |
| `head_of_ops` | Operations Lead | Process-oriented, "every problem has an owner" |
| `blank` | Custom (start from scratch) | No template; user defines everything |

After picking a template, the wizard walks through ~6 questions:

| # | Question | Why |
|---|---|---|
| 1 | What name do they go by? | Lets user personalize ("Liz Carter" vs default "Sofia Reyes") |
| 2 | What's your business / industry? | Grounds the persona's domain reasoning |
| 3 | What's the single most important goal they should optimize for? | Becomes their north_star objective |
| 4 | Describe their voice in 1-2 sentences (e.g. "punchy and energetic") | Becomes voice section in persona.md |
| 5 | Name one thing they should ALWAYS do, and one thing they should NEVER do | Two starter `core_facts` (Tier 1) |
| 6 | Pick their pixel avatar (sprite palette 0-5) | Visual identity in the office |

Backend assembles persona.md + objectives.yaml + initial core_facts from answers + template scaffolding. Preview shown. User can tweak in a final editor pass before committing.

**2. Edit a VP's personality (Settings tab on overlay)**

The **Personality tab** on the VP overlay lets the user directly edit:
- Persona body (the markdown charter)
- Voice/tone guidelines
- Current objectives
- Reorder / remove / pin core_facts

Edits take effect on the VP's NEXT directive. No restart needed. (Implementation: when a directive comes in, the backend reads the live DB rows, doesn't cache.)

**3. Adaptive evolution from feedback (opt-in confirmation)**

When the user sends a directive containing language like "from now on", "stop doing X", "always Y", "be more Z" — the VP detects it and at the end of its normal response asks:

> "Want me to make this a permanent part of how I work? (Adds to your core facts about me.)"

If user clicks confirm, a new core_fact is inserted. This makes the VP's behavior change for all future directives, transparently, with user consent.

Implementation: a small classifier prompt on the directive ("does this contain a behavioral instruction?") gates the offer. We start with the confirmation-required version; if the user finds it annoying we add a "skip confirmation for behavioral updates" setting.

### Schema additions

Move VP records from filesystem to DB. Filesystem becomes seed data loaded on first boot.

```sql
-- Persistent VP records (replaces filesystem vps/<id>/)
CREATE TABLE vps (
    id              text PRIMARY KEY,                 -- slug, e.g. "ethan_vale"
    name            text NOT NULL,
    role            text NOT NULL,
    description     text NOT NULL,                    -- short blurb (hover tooltip)
    persona_body    text NOT NULL,                    -- full markdown charter
    objectives      jsonb NOT NULL DEFAULT '{}'::jsonb,
    tools           jsonb NOT NULL DEFAULT '{}'::jsonb,
    palette         int NOT NULL DEFAULT 0,
    template_id     text,                              -- which template they were born from (NULL for legacy/manual)
    archived_at     timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Role-template library (seed data)
CREATE TABLE vp_templates (
    id              text PRIMARY KEY,                 -- "cmo_data_driven"
    category        text NOT NULL,                     -- "marketing" / "finance" / etc.
    display_name    text NOT NULL,                     -- "CMO — Data-driven"
    description     text NOT NULL,                     -- shown in the gallery
    questions       jsonb NOT NULL,                    -- ordered list of {id, prompt, hint, field}
    base_persona    text NOT NULL,                     -- markdown with {{placeholders}}
    base_objectives jsonb NOT NULL,                    -- starter objectives template
    base_core_facts jsonb NOT NULL DEFAULT '[]'::jsonb -- starter Tier 1 facts
);
```

### New API endpoints

```
GET    /vp_templates              — list all templates for the gallery
GET    /vp_templates/{id}         — get one template with its questions
POST   /vps/onboard               — start a new-VP wizard session, returns first question
POST   /vps/onboard/{session_id}/answer
                                  — submit answer, get next question OR finish (returns preview)
POST   /vps/onboard/{session_id}/commit
                                  — finalize: writes the new VP row, returns the live VP
PATCH  /vp/{id}                   — edit persona/objectives/etc. directly
DELETE /vp/{id}                   — archive a VP (soft delete; their history remains)
POST   /vp/{id}/feedback          — classify whether user input contains behavioral instruction;
                                    if yes, return a proposed core_fact for confirmation
```

### How seed VPs migrate

On first boot of the new schema:
1. Backend scans `vps/<id>/` directories on disk
2. For each VP folder it finds, inserts a row into the `vps` table if missing (so existing Ethan, Sofia, etc. become DB records)
3. After migration, filesystem files become read-only documentation. The DB is the source of truth.

This means our existing 6 VPs become editable through the UI immediately. No data loss.

These are good ideas that aren't worth the complexity until we feel their absence. Each has a documented trigger for when to revisit.

| Feature | Why deferred | When to add |
|---|---|---|
| Vector search (pgvector) | Keyword search handles 80% for our domain | When we find FTS misses too many things |
| Memory decay/scoring | 11k memories/year is nothing | When prompt bloat from injection becomes real |
| Procedural lesson extraction (daily cron) | Need enough episodic data to extract from | After ~30 days of accumulated directives |
| Haiku worker subagent spawning | Each VP works fine without delegation for v1 | When VPs need to do multi-step research |
| Slack adapter | Pixel office is the v1 surface | When you want directive intake from your phone |
| iMessage / Mac mini integration | Same as Slack | Same trigger |
| Multi-user auth + RLS | Single user for v1 | When Samuel or Matt need their own boardroom |
| LangGraph supervisor pattern | Direct fan-out works for 6 VPs | When agent topology gets complex (>15 nodes) |
| Realtime memory updates via Supabase | WS already pushes activity from backend | When external clients need direct DB subscriptions |

---

## Build Order (this session and immediate next)

This session (right now, no Supabase needed — SQLite stand-in):

**Phase A — Storage + VP records in DB**
1. ✅ Backend skeleton (done)
2. ⏳ Storage abstraction (Store ABC + SQLite impl)
3. ⏳ Migrate VPs to DB: scan `vps/<id>/` on boot, seed the `vps` table

**Phase B — Memory + tools**
4. ⏳ Memory tools (`recall_memory`, `note_to_self`) wired via in-process MCP
5. ⏳ Extractor: Haiku call after each VP response → typed memories
6. ⏳ Profile/history/memory endpoints

**Phase C — Streaming chat**
7. ⏳ SSE-streaming `POST /vp/{id}/chat` (yield tokens as they arrive)
8. ⏳ Async kickoff of memory extraction so chat returns immediately after stream ends

**Phase D — Dynamic VPs**
9. ⏳ Seed vp_templates table (the role gallery)
10. ⏳ Onboarding wizard endpoints (`/vps/onboard/*`)
11. ⏳ Direct edit endpoint (`PATCH /vp/{id}`) + archive
12. ⏳ Feedback classifier endpoint (`POST /vp/{id}/feedback`)

**Phase E — Frontend (in existing pixel-office UI)**
13. ⏳ Click handler in OfficeCanvas → open overlay
14. ⏳ VPOverlay component (5 tabs: Profile / Recent Work / Memory / Chat / Personality)
15. ⏳ SSE streaming chat consumer
16. ⏳ "+ New VP" button + onboarding wizard UI
17. ⏳ CORS config + backend HTTP client

Next session (Supabase ready):
- Paste schema into Supabase SQL editor
- Set env vars, switch STORAGE_BACKEND
- Run seed data migration script
- Verify all flows work against Postgres

---

## Decisions Locked

| Decision | Choice |
|---|---|
| Memory scope | VP-private |
| Procedural extraction | Manual promotion to core_facts (no auto extraction yet) |
| Search complexity | Keyword (Postgres FTS / SQLite FTS5), no vectors |
| Memory taxonomy | preference / fact / relationship / pattern |
| Auth provider | Claude Max via `claude login` |
| Database | Supabase (production), SQLite (local dev / fallback) |
| Extraction cadence | After every directive (Haiku) |
| Frontend interaction | Click character → **full-screen overlay** with 5 tabs |
| Chat response shape | **Streaming via SSE** (tokens render progressively) |
| VP record source of truth | **Database** (filesystem becomes seed data only) |
| Adding new VPs | **Onboarding wizard** with template gallery + 6-question flow |
| Editing VPs | **Personality tab** on overlay (direct edit) + adaptive feedback (opt-in) |
| Backend port | 8100 |
| Visualization | Existing pixel office at port 3101 |
| Backend stack | Python 3.12 + FastAPI + claude-agent-sdk + LangGraph (added later) |

---

## What I Need From You

Before I start writing code:

1. **Sanity-check this plan.** Did I capture everything? Did I sneak in something we didn't agree on?
2. **Confirm build order** — happy with #1-9 above, or want to reshuffle?
3. **Supabase project** — you can create it whenever. Code works against SQLite until then.

When ready, I build sections in order and check in at meaningful milestones (storage layer → extractor → endpoints → frontend panel). No more silent runaway building.
</thinking>
