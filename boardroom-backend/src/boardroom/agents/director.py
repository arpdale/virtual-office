"""Director: routes a CEO directive to the relevant VPs and synthesizes their
responses into a single briefing.

v1 sends the directive to ALL VPs in parallel and asks Opus (via Claude CLI) to
compose the briefing. v2 will route only to relevant VPs based on directive content.
"""

from __future__ import annotations

import asyncio

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    TextBlock,
    query,
)
from pydantic import BaseModel

from boardroom.agents.vp import VPResponse, run_vp
from boardroom.config import VPConfig


class DirectiveResult(BaseModel):
    directive: str
    per_vp: list[VPResponse]
    briefing: str


async def run_directive(
    directive: str,
    vps: list[VPConfig],
    vp_model: str,
    director_model: str,
) -> DirectiveResult:
    """Fan out the directive to all VPs in parallel, then compose a CEO briefing."""
    # Phase 1: fan out to all VPs in parallel.
    vp_results: list[VPResponse] = await asyncio.gather(
        *(run_vp(vp, directive, vp_model) for vp in vps),
    )

    # Phase 2: aggregator — Opus composes a CEO-facing briefing.
    formatted = "\n\n".join(
        f"### {r.role} ({r.vp_name})\n{r.response}" for r in vp_results
    )
    briefing_user = (
        f"The CEO sent this directive:\n\n> {directive}\n\n"
        f"Here is what each VP said:\n\n{formatted}\n\n"
        "Compose the briefing."
    )
    briefing_system = (
        "You are the Director, the CEO's chief of staff. You receive responses "
        "from each VP and compose a single briefing for the CEO. Be concise. "
        "Lead with the one or two things the CEO most needs to know. Then a "
        "short per-VP summary. Then any escalations or decisions the CEO needs "
        "to make. Keep the entire briefing under 300 words."
    )
    options = ClaudeAgentOptions(
        system_prompt=briefing_system,
        model=director_model,
        tools=[],
        max_turns=1,
        permission_mode="dontAsk",
    )

    briefing_chunks: list[str] = []
    async for msg in query(prompt=briefing_user, options=options):
        if isinstance(msg, AssistantMessage):
            for block in msg.content:
                if isinstance(block, TextBlock):
                    briefing_chunks.append(block.text)

    return DirectiveResult(
        directive=directive,
        per_vp=vp_results,
        briefing="\n".join(briefing_chunks).strip(),
    )
