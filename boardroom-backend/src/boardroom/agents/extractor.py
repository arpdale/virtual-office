"""Haiku-driven memory extractor.

After every VP directive+response, we call Haiku with a structured prompt:
"here's what just happened, extract memorable facts as a JSON array." The
extracted memories land in Tier 3 (`memories` table), indexed by source
directive so we can trace back.

Taxonomy (borrowed from Walter's Jarvis):
  - preference   — something the user/team wants done a certain way going forward
  - fact         — durable knowledge about the business, product, people, or world
  - relationship — who-knows-who, who-owns-what, who-cares-about-what
  - pattern      — recurring behavior, trend, or system tendency worth noting

Runs via `claude-agent-sdk` → `claude` CLI → Claude Max subscription. No API key
or per-token billing needed.
"""

from __future__ import annotations

import json
import re
from typing import Any

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    TextBlock,
    query,
)

from boardroom.persistence import Store
from boardroom.persistence.store import Memory, MemoryType

VALID_TYPES: set[str] = {"preference", "fact", "relationship", "pattern"}


_EXTRACTOR_SYSTEM = """You are a memory extractor for an AI VP at a company. Your job is to read one directive (from the CEO or Director) and the VP's response, then extract the small set of memorable facts worth saving for future turns.

You return a JSON array. Each element has exactly two fields:
  - "type": one of "preference", "fact", "relationship", "pattern"
  - "content": a single sentence stating the memory in third-person from the VP's perspective

Definitions:
  - preference: the CEO/user wants something done a particular way going forward
  - fact: durable knowledge about the business, product, customers, market, or world that wasn't already in the VP's prompt
  - relationship: who knows whom, who owns what, who cares about what
  - pattern: a recurring behavior, trend, or system tendency

Rules:
  - Extract 0-5 memories. ZERO is a valid answer when nothing in the exchange is worth remembering.
  - Skip anything that is opinion-of-the-moment, restating the directive, or already in the VP's persona.
  - Each "content" sentence is self-contained — readable a year from now without the original directive.
  - Output ONLY the JSON array. No prose, no markdown fences, no commentary.

Example output:
[{"type": "preference", "content": "CEO wants weekly briefings to lead with the single biggest risk, not the status summary."}, {"type": "fact", "content": "Credit-check latency is currently 12s p95, with the underwriting rules engine as the largest contributor."}]
"""


def _build_user_prompt(directive: str, response: str, vp_name: str, vp_role: str) -> str:
    return (
        f"VP: {vp_name} ({vp_role})\n\n"
        f"--- DIRECTIVE ---\n{directive}\n\n"
        f"--- RESPONSE ---\n{response}\n\n"
        "Extract memories now. JSON array only."
    )


def _extract_json_array(raw: str) -> list[dict[str, Any]]:
    """Pull a JSON array out of the model's response.

    Tolerant of accidental markdown fences or leading prose, even though the
    prompt forbids them. Returns [] if nothing parseable is found.
    """
    text = raw.strip()
    # Strip ```json ... ``` fences if present
    fence = re.search(r"```(?:json)?\s*(\[.*?\])\s*```", text, re.DOTALL)
    if fence:
        text = fence.group(1)
    else:
        # First top-level array
        start = text.find("[")
        end = text.rfind("]")
        if start == -1 or end == -1 or end < start:
            return []
        text = text[start : end + 1]
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []
    return [item for item in parsed if isinstance(item, dict)]


def _validate(items: list[dict[str, Any]]) -> list[tuple[MemoryType, str]]:
    out: list[tuple[MemoryType, str]] = []
    for item in items:
        t = item.get("type")
        c = item.get("content")
        if not isinstance(t, str) or not isinstance(c, str):
            continue
        if t not in VALID_TYPES:
            continue
        content = c.strip()
        if not content:
            continue
        out.append((t, content))  # type: ignore[arg-type]
    return out


async def _call_haiku(system: str, user: str, model: str) -> str:
    """One-shot Haiku call via the CLI. Returns the assistant's text."""
    options = ClaudeAgentOptions(
        system_prompt=system,
        model=model,
        tools=[],
        max_turns=1,
        permission_mode="dontAsk",
    )
    chunks: list[str] = []
    async for msg in query(prompt=user, options=options):
        if isinstance(msg, AssistantMessage):
            for block in msg.content:
                if isinstance(block, TextBlock):
                    chunks.append(block.text)
    return "".join(chunks)


async def extract_memories(
    *,
    directive: str,
    response: str,
    vp_id: str,
    vp_name: str,
    vp_role: str,
    source_directive_id: str | None,
    store: Store,
    model: str,
) -> list[Memory]:
    """Call Haiku, parse, validate, write to Tier 3. Returns the written rows.

    Designed to be fire-and-forget from the chat endpoint (`asyncio.create_task`).
    Never raises — failures are swallowed and logged because extraction is
    best-effort, not load-bearing.
    """
    try:
        raw = await _call_haiku(
            _EXTRACTOR_SYSTEM,
            _build_user_prompt(directive, response, vp_name, vp_role),
            model,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[extractor] Haiku call failed for {vp_id}: {exc}")
        return []

    items = _validate(_extract_json_array(raw))
    written: list[Memory] = []
    for memory_type, content in items:
        try:
            written.append(
                store.write_memory(
                    vp_id=vp_id,
                    memory_type=memory_type,
                    content=content,
                    source_directive_id=source_directive_id,
                )
            )
        except Exception as exc:  # noqa: BLE001
            print(f"[extractor] write failed for {vp_id} ({memory_type}): {exc}")
    return written
