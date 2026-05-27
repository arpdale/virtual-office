"""VP node: takes a directive + VP config + memory access, returns a response.

Uses `claude_agent_sdk.query()` which spawns the `claude` CLI as a subprocess.
This means VPs draw against the user's Claude Max subscription via the CLI's
existing auth — no API key needed.

Memory is hybrid:
  - PASSIVE: the N most recent memory entries are auto-injected into the system
    prompt as "recent work" tactical state.
  - ACTIVE: VPs get an in-process MCP server with `recall_memory(query)` and
    `note_to_self(title, body)` tools. They call recall_memory when they need
    to fetch older context that wasn't in the recent slice.

This is the "thinking" half of the planner-executor pattern. Worker subagent
spawning lives in `worker.py` (added in a later milestone).
"""

from __future__ import annotations

import yaml
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    TextBlock,
    query,
)
from pydantic import BaseModel

from boardroom.agents.tools import build_vp_mcp_server
from boardroom.config import VPConfig
from boardroom.persistence.memory import MemoryEntry, MemoryStore


class VPResponse(BaseModel):
    """What a VP returns for one directive turn."""

    vp_id: str
    vp_name: str
    role: str
    response: str
    recent_entries_used: int = 0


_RECENT_ENTRIES_FOR_PASSIVE_CONTEXT = 4


def _format_recent_entries(entries: list[MemoryEntry]) -> str:
    if not entries:
        return "(No prior memory entries yet — this is your first turn.)"
    parts: list[str] = []
    for e in entries:
        parts.append(
            f"### {e.title} ({e.created_at.strftime('%Y-%m-%d')})\n"
            f"{e.summary}"
        )
    parts.append(
        "\n_Use `recall_memory(query)` to search older entries by keyword._"
    )
    return "\n\n".join(parts)


def assemble_system_prompt(vp: VPConfig, recent: list[MemoryEntry]) -> str:
    """Compose the VP's full system prompt: charter + objectives + recent memory."""
    parts: list[str] = []

    parts.append(f"# You are {vp.name}, {vp.role}.\n")
    parts.append(vp.persona_body)

    if vp.objectives:
        parts.append("\n\n## Your current objectives\n")
        parts.append(yaml.safe_dump(vp.objectives, sort_keys=False).strip())

    parts.append("\n\n## Your recent work\n")
    parts.append(_format_recent_entries(recent))

    parts.append(
        "\n\n## How to respond\n"
        "You're receiving a directive from the CEO (or Director acting on the CEO's "
        "behalf). Respond in your own voice. Be specific. Reference your objectives "
        "when relevant. If you'd delegate parts to workers, name what you'd delegate "
        "and what you'd want back. If you think it'd help to look up something from "
        "before that isn't in your recent-work summary, call `recall_memory(query)`. "
        "Keep your response under 200 words unless the directive explicitly asks for more."
    )

    return "\n".join(parts)


async def run_vp(
    vp: VPConfig,
    directive: str,
    model: str,
    memory: MemoryStore,
) -> VPResponse:
    """Run one VP turn against a directive.

    Loads recent memory entries for passive context, attaches an in-process MCP
    server so the VP can call `recall_memory` and `note_to_self` if needed.
    """
    recent = memory.recent(vp.id, limit=_RECENT_ENTRIES_FOR_PASSIVE_CONTEXT)
    system_prompt = assemble_system_prompt(vp, recent)

    mcp_server = build_vp_mcp_server(memory, vp.id)
    options = ClaudeAgentOptions(
        system_prompt=system_prompt,
        model=model,
        # We expose recall_memory + note_to_self via the in-process MCP server.
        # No CLI built-in tools enabled — VPs are pure reasoning + memory access.
        tools=[],
        mcp_servers={f"boardroom_vp_{vp.id}": mcp_server},
        allowed_tools=[
            f"mcp__boardroom_vp_{vp.id}__recall_memory",
            f"mcp__boardroom_vp_{vp.id}__note_to_self",
        ],
        max_turns=4,  # allow tool-calls to happen, then final response
        permission_mode="dontAsk",
    )

    response_chunks: list[str] = []
    async for msg in query(prompt=directive, options=options):
        if isinstance(msg, AssistantMessage):
            for block in msg.content:
                if isinstance(block, TextBlock):
                    response_chunks.append(block.text)

    return VPResponse(
        vp_id=vp.id,
        vp_name=vp.name,
        role=vp.role,
        response="\n".join(response_chunks).strip(),
        recent_entries_used=len(recent),
    )
