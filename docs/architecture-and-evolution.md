# VirtualOffice — Architecture, Evolution, and Stack Choices

How the boardroom is built today, why we chose this shape over Hermes / LangGraph / CrewAI / Centaur / Managed Agents, and how the system gets sharper over time.

---

## Tl;dr (for Samuel)

We didn't pick LangGraph, Centaur, CrewAI, Agent SDK alone, or Managed Agents. We built a **thin, transparent orchestrator** on top of two things that are already battle-tested:

1. **Postgres (Supabase)** — for memory, audit trail, and full-text search
2. **Anthropic SDK + claude-agent-sdk** — for LLM access with a dual streaming/CLI path

Everything else (memory tiers, persona assembly, board meetings, the office UI) is a few hundred lines of code we own end-to-end. Total backend is **~2k lines of Python**. The frontend is **~3k lines of React/TypeScript**. We can read every line in an afternoon and explain every behavior.

**Compared to Hermes** (and similar Claude-Code-style harnesses that wrap one agent in a loop), our system is fundamentally **multi-agent and memory-first**. Hermes runs one or more agents on a task; VirtualOffice runs a **persistent boardroom of personalities** that each accumulate their own structured memory and report to a CEO. Different problem shape, different stack.

---

## What we built

```
┌─────────────────────────────────────────────────────────────────┐
│  Pixel-office UI (React + Canvas, port 5173)                    │
│  - Characters represent VPs; click to open per-VP overlay       │
│  - Board meeting overlay with group chat                        │
│  - Onboarding wizard with 12 role templates                     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ HTTP + SSE
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Boardroom backend (FastAPI, port 8100)                         │
│                                                                 │
│  - 21 REST endpoints (CRUD + chat + onboarding wizard)          │
│  - SSE-streaming /vp/{id}/chat                                  │
│  - Dual LLM path:                                               │
│      • ANTHROPIC_API_KEY set → Anthropic SDK direct (per-token) │
│      • Otherwise → claude-agent-sdk CLI subprocess (Max plan)   │
│  - In-process MCP tools (recall_memory, note_to_self)           │
│  - Haiku-driven memory extractor runs after every directive     │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Postgres protocol
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Supabase (Postgres + RLS)                                      │
│                                                                 │
│  Tables: vps, vp_templates, core_facts, directive_history,      │
│          memories                                               │
│  Indexes: tsvector GIN on directive+response (FTS),             │
│           btree on (vp_id, created_at DESC)                     │
│  Row-Level Security enabled (no policies = service_role only)   │
└─────────────────────────────────────────────────────────────────┘
```

### Three-tier memory model (the key idea)

Most agent frameworks treat memory as an afterthought — a vector DB you bolt on, or a flat list of recent messages. We made it first-class with three tiers, each solving a distinct problem:

| Tier | Table | Purpose | Size | Injection |
|---|---|---|---|---|
| **1** | `core_facts` | Anchored knowledge that should never be forgotten (brand voice rules, persistent constraints, hard-won lessons) | ~5-15 per VP | Every prompt, always |
| **2** | `directive_history` | Full audit trail. Every directive + response, verbatim. | Unbounded (millions of rows fine in Postgres) | On demand via `recall_memory(query)` tool with FTS |
| **3** | `memories` | Haiku-extracted typed observations from each turn (`preference` / `fact` / `relationship` / `pattern`) | ~5/directive × 365 days = a few thousand per VP per year | Top-8 most recent in every prompt |

**Why three?** Each tier answers a different question:
- Tier 1: *"What's permanently true about how this VP should think?"*
- Tier 2: *"What did we actually discuss / decide three months ago?"*
- Tier 3: *"What's been on this VP's mind lately?"*

A flat "context window of recent messages" handles Tier 3 but blows up on long timescales. A vector DB handles Tier 2 but is overkill for ~10k rows per VP and adds an embedding round-trip per query. We use Postgres FTS (free, exact, fast) and only swap in pgvector if we hit a precision wall — which our experiments suggest is far off.

### Persona stability

Every directive triggers this prompt assembly (about 20 lines in `routes_chat.py`):

```
# You are <name>, <role>.

<persona_body markdown — rarely changes, ~500 tokens>

## Your current objectives
<objectives YAML — updated ~monthly, ~500 tokens>

## Persistent facts about how you work
<all core_facts — hand-curated, ~200 tokens>

## Recent memory — what's been on your mind lately
<top 8 typed memories — auto-extracted by Haiku, ~600 tokens>

## How to respond
<system instructions + tool docs, ~300 tokens>
```

Total system prompt: ~2-3k tokens. Predictable cost per turn. Persona doesn't drift between sessions because every turn rebuilds the prompt from the same source-of-truth (`vps` row + queries).

### Memory extraction loop

After every chat response completes:

1. The directive + response gets written to `directive_history` (Tier 2)
2. **`asyncio.create_task` kicks off a Haiku call** with a structured extraction prompt: *"Pull out the 0-5 memorable facts as JSON `{type, content}`"*
3. Validated rows insert into `memories` (Tier 3)
4. Next turn, Tier 3's `recent_memories` query picks up the new entries

The user never waits for extraction — it's fire-and-forget. The "memories typed and pinned" UX is what makes the boardroom feel like it has continuity.

---

## How it gets better over time

Every framework promises "it learns." Here's the concrete mechanics for VirtualOffice:

### 1. Tier 2 → searchable institutional memory
- Every directive lands in Postgres with a GIN-indexed `tsvector` over `directive + response`
- VPs call `recall_memory("Q3 latency project")` mid-turn → relevant past exchanges return in milliseconds
- After 100 conversations, recalling past decisions is a single SQL `text_search` away
- After 1000 conversations, the same query still returns in <50ms

### 2. Tier 3 → emergent persona refinement
- Haiku extracts patterns like *"CTO prioritizes fixing internal bottlenecks before third-party API latency"*
- These get injected into every future prompt
- The VP's responses naturally re-reflect their accumulated history
- We've already seen this work: Ethan's second-turn response in testing referenced a `Drools 5-DB-hit` fact that Haiku had extracted from his first turn

### 3. Tier 1 → human-in-the-loop constitution
- Memory tab in the overlay shows extracted Tier 3 memories with a **Pin** button
- Click pin → that fact gets promoted to `core_facts` and lives in the system prompt forever
- This is *deliberate* memory curation, not implicit drift
- After a few months of pinning, each VP has a personal "constitution" of how they operate — auditable, editable, durable

### 4. Templates → new role onboarding gets faster
- 12 archetypes ship today: CMO data-driven, CFO conservative, CTO pragmatist, etc.
- Each template = `base_persona` markdown with `{{placeholders}}` + 6 questions + starter `core_facts`
- Onboarding a new VP is ~90 seconds; the new VP starts with reasonable defaults instead of a blank slate
- As we observe what works, we add/refine templates

### 5. Cross-VP visibility (next phase)
- Today each VP's memory is private (intentional — keeps personas distinct)
- Next: a small set of **company-wide facts** all VPs can see (e.g., "GoodLeap launched Solar Plus in Q3-2026")
- This is one new table + a join, not a new framework

### 6. Hierarchy → delegation chains (org chart phase)
- When we add the org chart upload feature, a VP can call `delegate_task(report_id, task)`
- That spawns a subordinate chat thread; the parent's response includes the child's summary
- Audit trail captures the whole tree. Postgres makes this a join, not a graph DB.

---

## Why this stack — and why not the alternatives

We evaluated the alternatives in our briefing doc. Here's why we landed where we did.

### vs. LangGraph (graph orchestration)

**LangGraph's pitch:** Model agents as nodes in a directed graph with explicit state transitions. Persistent checkpointing.

**Why we didn't pick it:**
- Our per-VP turn is **one prompt-response**, not a multi-node graph traversal. We don't have branching state machines per directive.
- LangGraph's value proposition (durable execution, time travel, conditional edges) shines for *long-running workflows*. Our chat turns complete in seconds.
- Persistence is already solved by Postgres directly — we don't need a checkpoint layer.
- ~120 lines for a two-agent flow vs. ~40 in ours. The graph abstraction is overhead for our use case.

**Where LangGraph wins:** If we needed multi-step research workflows ("research the market, then synthesize, then write a report"), LangGraph would be the right tool. We don't yet.

### vs. Centaur (Paradigm's K8s control plane)

**Centaur's pitch:** Self-hosted sandboxed pods + credential proxy + checkpointed workflows.

**Why we didn't pick it:**
- We don't run untrusted code from agents. Our tool whitelist is `recall_memory` + `note_to_self` + future `delegate_task` — none execute arbitrary code.
- We don't need sandboxing for hostile/zero-trust scenarios.
- Kubernetes ops adds an order-of-magnitude operational complexity for a single-user demo.
- ~60% of Centaur's value is solving problems we don't have.

**Where Centaur wins:** If we ever expose this to external users running their own agents, or if VPs start executing shell commands / browsing untrusted sites, Centaur becomes interesting as a hardening layer *on top of* our backend.

### vs. CrewAI (role-based pipeline)

**CrewAI's pitch:** Define agents with roles → assemble into a crew → execute a pipeline.

**Why we didn't pick it:**
- CrewAI is fundamentally **"a team runs a pipeline once."** Our model is **"persistent employees collaborate dynamically."**
- Agent-to-agent communication in CrewAI is mediated through task outputs only; ours has direct broadcast + `@mention` in the board meeting chat.
- CrewAI has documented production reliability ~80%. Agents can enter coordination loops burning tokens. We can't tolerate that for a CEO-facing demo.
- No first-class long-term memory.

**Where CrewAI wins:** Quick prototyping of a "run a pipeline" feature, like "marketing crew researches and drafts a campaign."

### vs. Claude Managed Agents (Anthropic hosted)

**Managed Agents' pitch:** Anthropic-hosted Agent Teams with direct inter-agent communication and shared task lists.

**Why we didn't pick it (today):**
- Anthropic-only vendor lock-in. We want the option to swap providers (GPT, local models) if billing or capability shifts.
- Data sovereignty concern — every memory row would live on Anthropic infrastructure rather than our Supabase.
- Architecturally closer to what we want, but the trade-off is "easier infrastructure" vs. "owning our data."

**Where Managed Agents win:** If we get to 50+ concurrent agents and the operations layer becomes the bottleneck, Managed Agents could replace our `claude-agent-sdk` layer with minimal code changes (we already abstract LLM access).

### vs. Anthropic Agent SDK alone

**Agent SDK's pitch:** First-party Anthropic tooling for agent loops + subagent spawning.

**Why "alone" doesn't work:**
- No memory, no observability, no state persistence across sessions, no multi-agent coordination beyond spawning subagents.
- It's the *execution primitive*, not the orchestration layer.

**What we did:** We use the Agent SDK (`claude-agent-sdk`) for the CLI-subprocess path, layered with our own Postgres-backed memory and orchestration. Best of both — first-party Anthropic execution + everything missing built on top.

### vs. Hermes (Claude-Code-style harness)

**Hermes' pitch:** Single-agent harness that runs Claude in a loop on a task (similar to Claude Code / "openclaude" patterns).

**Why this is a different problem:**
- Hermes is **task-oriented**: give it a goal, it runs until done.
- VirtualOffice is **personality-oriented**: 7 long-lived characters with accumulated memory and distinct voices.
- Hermes doesn't need cross-session memory because each task is bounded; ours requires it because Sofia (CMO) needs to remember Q2's campaign decisions when discussing Q3.
- Hermes' UX is a CLI/dashboard; ours is a pixel office with characters that walk and sit at desks — emotional engagement + ambient observability.

**Concrete architectural deltas:**
| Concern | Hermes-style | VirtualOffice |
|---|---|---|
| Lifespan | Bounded task | Persistent persona |
| Memory | Session-local context window | 3-tier durable in Postgres |
| Multi-agent | Optional subagent spawning | First-class boardroom with directives + meetings |
| User-visible identity | Conversation log | Named character + sprite + role + history |
| Observability | Tool-call traces | Live pixel office + per-VP overlay with 5 tabs |
| Failure mode | "Agent gave up / ran out of budget" | "VP's response was off — pin a corrective core_fact" |
| Source of truth | Hermes orchestrator state | Postgres rows (`vps`, `core_facts`, `directive_history`, `memories`) |

**Both can co-exist.** A VP in VirtualOffice could spawn a Hermes-style worker subagent for a bounded research task (e.g., "go research the competitive landscape and report back"). That's planned for the next phase — `delegate_task(spec, return_schema)` will use the existing `claude-agent-sdk` subagent mechanism. Hermes is a *primitive* we can compose with; the difference is we don't want our top-level abstraction to be Hermes.

---

## What we own end-to-end (and why that matters)

Every piece of our system is code we wrote and can change:

| Layer | File | Lines |
|---|---|---|
| Storage interface | `boardroom-backend/src/boardroom/persistence/store.py` | ~150 |
| Supabase impl | `.../persistence/supabase_store.py` | ~270 |
| Memory extractor | `.../agents/extractor.py` | ~160 |
| MCP tools | `.../agents/tools.py` | ~120 |
| Chat endpoint (SSE + dual path) | `.../api/routes_chat.py` | ~330 |
| VP read endpoints | `.../api/routes_vp.py` | ~130 |
| VP edit + core_facts | `.../api/routes_vp_edit.py` | ~120 |
| Templates + onboarding wizard | `.../api/routes_onboard.py` | ~280 |
| Frontend API client | `webview-ui/src/services/boardroom.ts` | ~260 |
| Office integration | `webview-ui/src/office/boardroomRoster.ts`, `boardMeeting.ts`, `seatClassifier.ts` | ~300 |
| VP overlay (5 tabs) | `webview-ui/src/components/VPOverlay.tsx` | ~700 |
| Board meeting overlay | `.../components/BoardMeetingOverlay.tsx` | ~500 |
| Conference scene canvas | `.../components/ConferenceScene.tsx` | ~200 |
| Onboarding wizard | `.../components/OnboardingWizard.tsx` | ~400 |

Total: ~4,000 lines we control. When something behaves unexpectedly we read the code; we don't file an upstream issue.

**Compare:** A LangGraph + LangChain + LangSmith stack pulls in ~50k LoC of framework code. Centaur is K8s + Postgres + Python + iron-proxy. CrewAI adds 8MB of dependencies. Every one of those frameworks has a debugging surface that's *larger than the problem we're solving.*

The trade is real: we built our own checkpointing (none needed — atomic Postgres writes), our own observability (the pixel office IS the dashboard), our own multi-agent coordination (the meeting chat broadcasts). We didn't have to build a graph engine, a sandboxed runtime, or a role-pipeline DSL because we don't have those problems.

---

## What this means for the demo + next phases

### What works today
- 7 persistent VPs (6 seeded + Lena from the wizard) with distinct personas
- Chat any VP → they walk to their desk, respond, walk away
- Board meeting → all VPs walk to the conference table, round-robin chat
- Onboarding wizard with 12 templates → spawn an 8th VP in 90 seconds
- Memory accumulates across sessions; visible in the Memory tab; pinnable to Tier 1
- Personality editable in the Personality tab; takes effect next directive

### Near-term roadmap
1. **Org chart import** (the Samuel project): YAML/JSON schema → bulk-onboard → hierarchy-aware delegation. *(Designed below.)*
2. **Worker subagents**: `delegate_task` tool that spawns short-lived Haiku/Sonnet workers. The Hermes-style primitive composed into our model.
3. **Activity feed**: WebSocket push of every directive/response system-wide for live "what's happening in the office" view.
4. **iMessage adapter** (per your preference, not Slack): SMS bridge so you can text the office from your phone.

### Far-term
- Multi-user (RLS already enabled, just need policies)
- Vector search (only when we hit FTS precision limits)
- Multi-company (one VirtualOffice instance hosts multiple business simulations)

---

## Appendix A — Org chart import (proposed schema)

```yaml
project: GoodGrid Activation
description: Cross-functional team launching the GoodGrid product
ceo: walter
vps:
  - id: aria_solomon
    role: VP of Product Marketing
    template: cmo_data_driven
    palette: 1
    reports_to: walter
    objectives:
      north_star: Drive 10K signups in first 90 days
    tools:
      - recall_memory
      - note_to_self
      - delegate_task

  - id: kai_nguyen
    role: VP of Engineering
    template: cto_pragmatist
    palette: 0
    reports_to: walter

  - id: leo_park
    role: Senior Engineer
    template: blank
    reports_to: kai_nguyen
    persona_overrides:
      voice: "Pragmatic, ship-first, allergic to bikeshedding"
```

Upload endpoint: `POST /org_charts/import` (multipart YAML/JSON file). Returns project_id + list of created vp_ids. UI then renders them all together in a project-specific view.

This composes cleanly with our existing onboarding wizard endpoints — `org_charts/import` is just a loop over `POST /vps/onboard` + `POST /vps/onboard/.../answer` + commit, with the answers pre-filled from the YAML.

---

## Appendix B — Migration to CLI (if you want to ditch the API key for the demo)

Today the backend auto-detects: if `ANTHROPIC_API_KEY` is set in `.env`, it uses Anthropic SDK direct (per-token streaming). Otherwise, it falls back to `claude-agent-sdk` (subprocesses the `claude` CLI, uses Claude Max flat rate).

To switch:

```sh
# 1. Authenticate the CLI once (interactive)
claude login

# 2. Remove ANTHROPIC_API_KEY from boardroom-backend/.env
#    (just delete that line)

# 3. Restart the backend
```

Trade-off: text arrives in slightly larger chunks instead of true per-token. Tool calls (`recall_memory`, `note_to_self`) actually work better via CLI because the MCP integration is more mature in `claude-agent-sdk`. Nothing functional is lost. Memory extractor uses Haiku — works either way.

The dual path is intentional: when Anthropic ships new features (extended thinking, etc.) we can flip to API on a per-VP basis without touching agent code. Cost vs. capability becomes a config toggle.

---

## Appendix C — What's missing (and not pretending otherwise)

Honest about the gaps before Samuel finds them:

| Gap | Status | When to fix |
|---|---|---|
| No worker subagents yet | `delegate_task` planned, not built | Next phase (alongside org chart) |
| No production observability | Console logs only | Add LangSmith-equivalent before scaling past a few users |
| `/directive` (board-wide via legacy Director) still uses old MemoryStore — broken | Pre-existing bug, out of scope this session | Migrate Director to the new Store, or rewrite using the board meeting overlay's broadcast logic |
| Memory decay | None — entries accumulate forever | Not a problem until ~10k memories per VP. Add scoring/decay then. |
| Vector search | None | Not needed unless FTS precision becomes a real issue |
| Multi-user auth | Schema is RLS-ready, no policies yet | Add when a second user shows up |
| Pixel-office runs only as a Vite dev server today (not packaged) | Works for demo | Production build before any hosted deployment |

---

*Last updated: 2026-05-27. Maintained alongside the code at `Walter-Richard-GL/VirtualOffice`.*
