"""Streaming chat endpoint for one VP.

POST /vp/{vp_id}/chat
  Request: { "text": "..." }
  Response: text/event-stream

  event: meta
  data: {"directive_id": "<uuid>"}

  event: token
  data: {"text": "..."}

  ...

  event: done
  data: {"directive_id": "<uuid>"}

The same UUID flows through `meta` and the persisted `directive_history` row,
so the UI can deep-link to the just-written record. Memory extraction kicks
off in the background after the stream closes — the UI re-fetches the
`/vp/{id}/memories` tab to see the new rows when ready.

Sync helper `POST /vp/{vp_id}/chat/sync` returns the full response in one
JSON blob for non-UI callers (cron jobs, the Director, scripts).
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from collections.abc import AsyncIterator
from typing import Any

import yaml
from anthropic import AsyncAnthropic
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    TextBlock,
    query,
)
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from boardroom.agents.extractor import extract_memories
from boardroom.agents.tools import build_vp_tools_server
from boardroom.api.deps import get_store_dep
from boardroom.config import load_settings
from boardroom.persistence import Store
from boardroom.persistence.store import CoreFact, Memory, VPRecord

router = APIRouter()


class ChatRequest(BaseModel):
    text: str


# ── External tool configuration ─────────────────────────────


_NOTION_READ_TOOLS = [
    "mcp__notion__notion-search",
    "mcp__notion__notion-retrieve-a-page",
    "mcp__notion__notion-retrieve-a-database",
    "mcp__notion__notion-query-a-database",
    "mcp__notion__notion-retrieve-block-children",
    "mcp__notion__notion-retrieve-a-comment",
    "mcp__notion__notion-retrieve-a-user",
    "mcp__notion__notion-list-all-users",
]


def _build_agent_options(
    *,
    system_prompt: str,
    model: str,
    store: Store,
    vp: VPRecord,
) -> ClaudeAgentOptions:
    """Build ClaudeAgentOptions with memory tools + external tools (WebFetch,
    WebSearch, Notion read-only) for a single VP turn."""
    mcp_name = f"boardroom_vp_{vp.id}"
    mcp_server = build_vp_tools_server(store, vp.id)

    mcp_servers: dict[str, Any] = {mcp_name: mcp_server}
    allowed: list[str] = [
        f"mcp__{mcp_name}__recall_memory",
        f"mcp__{mcp_name}__note_to_self",
        "WebFetch",
        "WebSearch",
    ]

    notion_key = os.environ.get("NOTION_API_KEY", "")
    if notion_key:
        mcp_servers["notion"] = {
            "command": "npx",
            "args": ["-y", "@notionhq/notion-mcp-server"],
            "env": {"NOTION_API_KEY": notion_key},
        }
        allowed.extend(_NOTION_READ_TOOLS)

    return ClaudeAgentOptions(
        system_prompt=system_prompt,
        model=model,
        tools=["WebFetch", "WebSearch"],
        mcp_servers=mcp_servers,
        allowed_tools=allowed,
        max_turns=8,
        permission_mode="dontAsk",
    )


# ── System prompt assembly ───────────────────────────────────


_RECENT_MEMORIES_LIMIT = 8


def _format_core_facts(facts: list[CoreFact]) -> str:
    if not facts:
        return "(No persistent facts pinned yet.)"
    return "\n".join(f"- {f.content}" for f in facts)


def _format_recent_memories(memories: list[Memory]) -> str:
    if not memories:
        return "(No recent memories yet — this is one of your first conversations.)"
    parts: list[str] = []
    for m in memories:
        parts.append(f"- [{m.memory_type}] {m.content}")
    return "\n".join(parts)


def assemble_system_prompt(
    vp: VPRecord,
    core_facts: list[CoreFact],
    recent: list[Memory],
) -> str:
    parts: list[str] = []
    parts.append(f"# You are {vp.name}, {vp.role}.\n")
    parts.append(vp.persona_body)

    if vp.objectives:
        parts.append("\n\n## Your current objectives\n")
        parts.append(yaml.safe_dump(vp.objectives, sort_keys=False).strip())

    parts.append("\n\n## Persistent facts about how you work\n")
    parts.append(_format_core_facts(core_facts))

    parts.append("\n\n## Recent memory — what's been on your mind lately\n")
    parts.append(_format_recent_memories(recent))

    parts.append(
        "\n\n## How to respond\n"
        "You're receiving a directive from the CEO. Respond in your own voice. Be "
        "specific. Reference your objectives when relevant. Name tradeoffs and "
        "constraints. Keep your response under 250 words unless the directive "
        "explicitly asks for more.\n\n"
        "You have tools available if you need them:\n"
        "- `recall_memory(query)` — search your past directives + responses by keyword "
        "if recent-memory above doesn't cover what you need.\n"
        "- `note_to_self(type, content)` — save a typed memory you want preserved. "
        "Use sparingly; the system already extracts memories from every response.\n"
        "- `WebFetch(url)` — fetch a web page to read its content.\n"
        "- `WebSearch(query)` — search the web for current information.\n"
        "- Notion tools (read-only) — search and read pages, databases, and blocks "
        "in the company Notion workspace. Use these when you need to reference "
        "shared documents, meeting notes, or project specs."
    )

    return "\n".join(parts)


# ── SSE helpers ──────────────────────────────────────────────


def _sse_event(event: str, data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    return f"event: {event}\ndata: {payload}\n\n"


# ── Streaming chat ───────────────────────────────────────────


async def _stream_vp_response(
    *,
    vp: VPRecord,
    directive_text: str,
    directive_id: str,
    store: Store,
    model: str,
    worker_model: str,
) -> AsyncIterator[str]:
    """Generator that yields SSE-framed strings for one VP turn.

    Order: meta → token* → done. After done, kicks off extractor in the
    background so the close isn't delayed by the Haiku call.
    """
    # 1. meta
    yield _sse_event("meta", {"directive_id": directive_id})

    # 2. assemble prompt
    core_facts = store.list_core_facts(vp.id)
    recent = store.recent_memories(vp.id, limit=_RECENT_MEMORIES_LIMIT)
    system_prompt = assemble_system_prompt(vp, core_facts, recent)

    # 3. stream tokens — always use the CLI path so VPs have access to tools
    # (memory, WebFetch, WebSearch, Notion). The CLI inherits ANTHROPIC_API_KEY
    # from the environment if set, otherwise uses `claude login` credentials.
    response_chunks: list[str] = []
    try:
        async for chunk in _stream_via_cli(
            vp=vp,
            store=store,
            system_prompt=system_prompt,
            directive_text=directive_text,
            model=model,
        ):
            response_chunks.append(chunk)
            yield _sse_event("token", {"text": chunk})
    except Exception as exc:  # noqa: BLE001
        err = str(exc)
        if "error result: success" in err:
            err = "API rate limit exceeded — try again in a moment"
        yield _sse_event("error", {"message": err})
        return

    response_text = "".join(response_chunks).strip()

    # 4. persist directive (Tier 2). Use the UUID we already emitted in `meta`
    # so the client can deep-link to this exact row.
    try:
        store.write_directive(
            vp_id=vp.id,
            directive=directive_text,
            response=response_text,
            target_scope="individual",
            directive_id=directive_id,
        )
    except Exception as exc:  # noqa: BLE001
        # Don't fail the stream if write failed — surface to client and continue.
        yield _sse_event("warn", {"message": f"directive persist failed: {exc}"})

    # 5. done. Kick off Haiku extraction in the background — fire-and-forget,
    # the UI re-fetches /memories on tab open to see the new rows.
    asyncio.create_task(
        extract_memories(
            directive=directive_text,
            response=response_text,
            vp_id=vp.id,
            vp_name=vp.name,
            vp_role=vp.role,
            source_directive_id=directive_id,
            store=store,
            model=worker_model,
        )
    )

    yield _sse_event("done", {"directive_id": directive_id})


@router.post("/vp/{vp_id}/chat")
async def post_chat(
    vp_id: str,
    req: ChatRequest,
    store: Store = Depends(get_store_dep),
) -> StreamingResponse:
    vp = store.get_vp(vp_id)
    if vp is None:
        raise HTTPException(status_code=404, detail=f"VP not found: {vp_id}")
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text must be non-empty")

    settings = load_settings()
    directive_id = str(uuid.uuid4())

    return StreamingResponse(
        _stream_vp_response(
            vp=vp,
            directive_text=req.text,
            directive_id=directive_id,
            store=store,
            model=settings.vp_model,
            worker_model=settings.worker_model,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx-style proxy buffering
        },
    )


# ── Sync variant for non-UI callers ──────────────────────────


class ChatSyncResponse(BaseModel):
    directive_id: str
    response: str


@router.post("/vp/{vp_id}/chat/sync", response_model=ChatSyncResponse)
async def post_chat_sync(
    vp_id: str,
    req: ChatRequest,
    store: Store = Depends(get_store_dep),
) -> ChatSyncResponse:
    """One-shot non-streaming chat. Same behavior, returns full response in JSON."""
    vp = store.get_vp(vp_id)
    if vp is None:
        raise HTTPException(status_code=404, detail=f"VP not found: {vp_id}")
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="text must be non-empty")

    settings = load_settings()
    directive_id = str(uuid.uuid4())

    core_facts = store.list_core_facts(vp.id)
    recent = store.recent_memories(vp.id, limit=_RECENT_MEMORIES_LIMIT)
    system_prompt = assemble_system_prompt(vp, core_facts, recent)

    options = _build_agent_options(
        system_prompt=system_prompt,
        model=settings.vp_model,
        store=store,
        vp=vp,
    )

    chunks: list[str] = []
    async for msg in query(prompt=req.text, options=options):
        if isinstance(msg, AssistantMessage):
            for block in msg.content:
                if isinstance(block, TextBlock):
                    chunks.append(block.text)
    response_text = "".join(chunks).strip()

    store.write_directive(
        vp_id=vp.id,
        directive=req.text,
        response=response_text,
        target_scope="individual",
        directive_id=directive_id,
    )

    asyncio.create_task(
        extract_memories(
            directive=req.text,
            response=response_text,
            vp_id=vp.id,
            vp_name=vp.name,
            vp_role=vp.role,
            source_directive_id=directive_id,
            store=store,
            model=settings.worker_model,
        )
    )

    return ChatSyncResponse(directive_id=directive_id, response=response_text)


# ── Streaming backends ──────────────────────────────────────


# Map our short model IDs to API-style dated identifiers when needed.
# The Anthropic API accepts both modern aliases and dated IDs; the CLI
# accepts both too. If a model string fails, the user can override via env.
_ANTHROPIC_MODEL_ALIASES: dict[str, str] = {
    "claude-sonnet-4-6": "claude-sonnet-4-5",  # closest API alias
    "claude-opus-4-7": "claude-opus-4-5",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5-20251001",
}


def _resolve_anthropic_model(model: str) -> str:
    return _ANTHROPIC_MODEL_ALIASES.get(model, model)


async def _stream_via_anthropic_sdk(
    *,
    system_prompt: str,
    directive_text: str,
    model: str,
) -> AsyncIterator[str]:
    """True per-token streaming via the Anthropic Python SDK.

    Requires ANTHROPIC_API_KEY. No tool support here for now — mid-turn
    tool-calls (`recall_memory`, `note_to_self`) still work only on the CLI
    path. Most directives don't need them; the prompt's recent-memories
    section covers 90% of cases.
    """
    client = AsyncAnthropic()
    api_model = _resolve_anthropic_model(model)
    async with client.messages.stream(
        model=api_model,
        max_tokens=1500,
        system=system_prompt,
        messages=[{"role": "user", "content": directive_text}],
    ) as stream:
        async for text in stream.text_stream:
            if text:
                yield text


_MAX_RETRIES = 3
_RETRY_BACKOFF = [2, 5, 10]


async def _stream_via_cli(
    *,
    vp: VPRecord,
    store: Store,
    system_prompt: str,
    directive_text: str,
    model: str,
) -> AsyncIterator[str]:
    """Claude-agent-sdk subprocess flow. Chunk-level streaming (whole blocks
    arrive at once). Supports all tools: memory, WebFetch, WebSearch, Notion.
    Retries on API rate-limit / overload errors (429, 529)."""
    options = _build_agent_options(
        system_prompt=system_prompt,
        model=model,
        store=store,
        vp=vp,
    )
    for attempt in range(_MAX_RETRIES):
        try:
            async for msg in query(prompt=directive_text, options=options):
                if not isinstance(msg, AssistantMessage):
                    continue
                for block in msg.content:
                    if isinstance(block, TextBlock) and block.text:
                        yield block.text
            return
        except Exception as exc:
            err = str(exc)
            is_retryable = "error result: success" in err or "429" in err or "529" in err
            if is_retryable and attempt < _MAX_RETRIES - 1:
                wait = _RETRY_BACKOFF[attempt]
                print(f"[boardroom] {vp.name}: API rate limit, retrying in {wait}s (attempt {attempt + 1}/{_MAX_RETRIES})")
                await asyncio.sleep(wait)
                continue
            raise
