"""MCP tools that VPs can call from inside their Claude session.

Built using `claude_agent_sdk.create_sdk_mcp_server` — runs in-process, no
separate subprocess. The VP's claude CLI subprocess talks to this MCP server
via the SDK's transport.

Exposes:
  - recall_memory(query)        — full-text search Tier 2 (directive_history).
                                  Returns matching past directives + responses.
  - note_to_self(type, content) — write a typed memory to Tier 3 directly.
                                  Use sparingly — most memories come from the
                                  Haiku extractor running after each turn.

`vp_id` is closed-over so each VP can only read/write its own data, even if
the model tries to fabricate an id.
"""

from __future__ import annotations

from typing import Any

from claude_agent_sdk import create_sdk_mcp_server, tool

from boardroom.persistence import Store
from boardroom.persistence.store import MemoryType

_VALID_TYPES: set[str] = {"preference", "fact", "relationship", "pattern"}


def build_vp_tools_server(store: Store, vp_id: str) -> Any:
    """Build an in-process MCP server with memory tools scoped to one VP."""

    @tool(
        "recall_memory",
        (
            "Search your own past directives and responses for context relevant to a "
            "topic. Returns up to 5 matching exchanges, ordered newest-first. Use this "
            "when you need to find what you said or decided about something previously "
            "that isn't in the recent-memory section of your prompt."
        ),
        {"query": str},
    )
    async def recall_memory(args: dict[str, Any]) -> dict[str, Any]:
        q = str(args.get("query", "")).strip()
        if not q:
            return {
                "content": [{"type": "text", "text": "Provide a search query."}]
            }
        hits = store.search_directives(vp_id, q, limit=5)
        if not hits:
            return {
                "content": [
                    {"type": "text", "text": f"No past directives matched '{q}'."}
                ]
            }
        parts: list[str] = []
        for h in hits:
            parts.append(
                f"### {h.created_at.strftime('%Y-%m-%d %H:%M')}\n"
                f"**Directive:** {h.directive}\n\n"
                f"**Your response:** {h.response}"
            )
        return {"content": [{"type": "text", "text": "\n\n---\n\n".join(parts)}]}

    @tool(
        "note_to_self",
        (
            "Save a single typed memory that you want to remember in future turns. "
            "Use sparingly — the system automatically extracts memories from your "
            "responses, so only call this for an insight or rule that wouldn't be "
            "obvious from what you just said. "
            "`type` must be one of: 'preference', 'fact', 'relationship', 'pattern'."
        ),
        {"type": str, "content": str},
    )
    async def note_to_self(args: dict[str, Any]) -> dict[str, Any]:
        mem_type = str(args.get("type", "")).strip()
        content = str(args.get("content", "")).strip()
        if mem_type not in _VALID_TYPES:
            return {
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"Invalid type '{mem_type}'. Must be one of: "
                            "preference, fact, relationship, pattern."
                        ),
                    }
                ]
            }
        if not content:
            return {
                "content": [{"type": "text", "text": "Content must be non-empty."}]
            }
        mem = store.write_memory(
            vp_id=vp_id,
            memory_type=mem_type,  # type: ignore[arg-type]
            content=content,
        )
        return {
            "content": [
                {
                    "type": "text",
                    "text": f"Saved [{mem.memory_type}] memory ({mem.id[:8]}).",
                }
            ]
        }

    return create_sdk_mcp_server(
        name=f"boardroom_vp_{vp_id}",
        version="0.1.0",
        tools=[recall_memory, note_to_self],
    )


# ── Legacy ─────────────────────────────────────────────────────────────
# Old MemoryStore-based server kept so `agents/vp.py` and `agents/director.py`
# (which power the legacy /directive endpoint) still import. Those modules
# were already broken before this refactor (signature mismatch in
# director.py); migrating /directive to the 3-tier Store is a separate task.

from boardroom.persistence.memory import MemoryStore  # noqa: E402


def build_vp_mcp_server(memory: MemoryStore, vp_id: str) -> Any:
    """Deprecated: use `build_vp_tools_server(store, vp_id)`."""

    @tool(
        "recall_memory",
        "Search your own memory for past work, decisions, or notes.",
        {"query": str},
    )
    async def recall_memory(args: dict[str, Any]) -> dict[str, Any]:
        q = args.get("query", "")
        entries = memory.search(vp_id, q, limit=5)
        if not entries:
            return {"content": [{"type": "text", "text": f"No entries matched '{q}'."}]}
        rendered = "\n\n".join(
            f"### {e.title} ({e.created_at.strftime('%Y-%m-%d')})\n{e.body}"
            for e in entries
        )
        return {"content": [{"type": "text", "text": rendered}]}

    @tool(
        "note_to_self",
        "Save a note for future turns.",
        {"title": str, "body": str, "tags": list},
    )
    async def note_to_self(args: dict[str, Any]) -> dict[str, Any]:
        entry = memory.write(
            vp_id=vp_id,
            title=args.get("title", "(untitled)"),
            summary=str(args.get("body", ""))[:200],
            body=args.get("body", ""),
            tags=["note_to_self", *(args.get("tags") or [])],
        )
        return {"content": [{"type": "text", "text": f"Saved {entry.title}."}]}

    return create_sdk_mcp_server(
        name=f"boardroom_vp_legacy_{vp_id}",
        version="0.1.0",
        tools=[recall_memory, note_to_self],
    )
