"""Read endpoints for VP profile, history, and memories.

Powers the pixel-office overlay tabs: Profile, Recent Work, Memory.
Write endpoints (chat, core_facts pin, editing) live in other route modules.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from boardroom.api.deps import get_store_dep
from boardroom.persistence import Store
from boardroom.persistence.store import MemoryType

router = APIRouter()


# ── Response models ─────────────────────────────────────────


class VPSummary(BaseModel):
    id: str
    name: str
    role: str
    description: str
    palette: int


class CoreFactOut(BaseModel):
    id: str
    content: str
    created_at: datetime


class VPProfile(BaseModel):
    id: str
    name: str
    role: str
    description: str
    persona_body: str
    objectives: dict[str, Any]
    tools: dict[str, Any]
    palette: int
    template_id: str | None
    core_facts: list[CoreFactOut]
    memory_count: int
    directive_count: int


class DirectiveOut(BaseModel):
    id: str
    directive: str
    response: str
    target_scope: Literal["individual", "board"]
    created_at: datetime


class MemoryOut(BaseModel):
    id: str
    memory_type: MemoryType
    content: str
    source_directive_id: str | None
    created_at: datetime


# ── Routes ──────────────────────────────────────────────────


@router.get("/vps", response_model=list[VPSummary])
def list_vps(store: Store = Depends(get_store_dep)) -> list[VPSummary]:
    """Roster for the office UI: every non-archived VP."""
    return [
        VPSummary(
            id=vp.id,
            name=vp.name,
            role=vp.role,
            description=vp.description,
            palette=vp.palette,
        )
        for vp in store.list_vps(include_archived=False)
    ]


@router.get("/vp/{vp_id}", response_model=VPProfile)
def get_vp_profile(vp_id: str, store: Store = Depends(get_store_dep)) -> VPProfile:
    """Full profile: persona, objectives, core_facts, plus tab counts."""
    vp = store.get_vp(vp_id)
    if vp is None:
        raise HTTPException(status_code=404, detail=f"VP not found: {vp_id}")
    core_facts = store.list_core_facts(vp_id)
    directives = store.list_directives(vp_id, limit=10_000)
    memories = store.list_memories(vp_id, limit=10_000)
    return VPProfile(
        id=vp.id,
        name=vp.name,
        role=vp.role,
        description=vp.description,
        persona_body=vp.persona_body,
        objectives=vp.objectives,
        tools=vp.tools,
        palette=vp.palette,
        template_id=vp.template_id,
        core_facts=[
            CoreFactOut(id=f.id, content=f.content, created_at=f.created_at)
            for f in core_facts
        ],
        memory_count=len(memories),
        directive_count=len(directives),
    )


@router.get("/vp/{vp_id}/history", response_model=list[DirectiveOut])
def get_vp_history(
    vp_id: str,
    limit: int = Query(20, ge=1, le=200),
    store: Store = Depends(get_store_dep),
) -> list[DirectiveOut]:
    """Recent directives+responses for the Recent Work tab."""
    if store.get_vp(vp_id) is None:
        raise HTTPException(status_code=404, detail=f"VP not found: {vp_id}")
    return [
        DirectiveOut(
            id=d.id,
            directive=d.directive,
            response=d.response,
            target_scope=d.target_scope,
            created_at=d.created_at,
        )
        for d in store.list_directives(vp_id, limit=limit)
    ]


@router.get("/vp/{vp_id}/memories", response_model=list[MemoryOut])
def get_vp_memories(
    vp_id: str,
    type: MemoryType | None = Query(None, description="Filter by memory type"),
    limit: int = Query(50, ge=1, le=500),
    store: Store = Depends(get_store_dep),
) -> list[MemoryOut]:
    """Typed memories for the Memory tab."""
    if store.get_vp(vp_id) is None:
        raise HTTPException(status_code=404, detail=f"VP not found: {vp_id}")
    return [
        MemoryOut(
            id=m.id,
            memory_type=m.memory_type,
            content=m.content,
            source_directive_id=m.source_directive_id,
            created_at=m.created_at,
        )
        for m in store.list_memories(vp_id, memory_type=type, limit=limit)
    ]
