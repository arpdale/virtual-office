"""Write endpoints for VP records and Tier 1 core_facts.

  POST   /vp/{id}/core_facts       — pin a typed memory or freeform fact to Tier 1
  DELETE /vp/{id}/core_facts/{fid} — unpin a core_fact
  PATCH  /vp/{id}                   — edit persona / objectives / description / palette
  DELETE /vp/{id}                   — archive (soft delete; history remains)
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from boardroom.api.deps import get_store_dep
from boardroom.api.routes_vp import CoreFactOut, VPProfile
from boardroom.persistence import Store

router = APIRouter()


# ── Core facts ───────────────────────────────────────────────


class CoreFactCreate(BaseModel):
    content: str


@router.post("/vp/{vp_id}/core_facts", response_model=CoreFactOut, status_code=201)
def add_core_fact(
    vp_id: str,
    req: CoreFactCreate,
    store: Store = Depends(get_store_dep),
) -> CoreFactOut:
    """Pin a fact to Tier 1. Always injected into the VP's prompt going forward."""
    if store.get_vp(vp_id) is None:
        raise HTTPException(status_code=404, detail=f"VP not found: {vp_id}")
    if not req.content.strip():
        raise HTTPException(status_code=400, detail="content must be non-empty")
    fact = store.add_core_fact(vp_id, req.content.strip())
    return CoreFactOut(id=fact.id, content=fact.content, created_at=fact.created_at)


@router.delete("/vp/{vp_id}/core_facts/{fact_id}", status_code=204)
def delete_core_fact(
    vp_id: str,
    fact_id: str,
    store: Store = Depends(get_store_dep),
) -> None:
    if store.get_vp(vp_id) is None:
        raise HTTPException(status_code=404, detail=f"VP not found: {vp_id}")
    store.delete_core_fact(fact_id)


# ── VP edit ──────────────────────────────────────────────────


class VPPatch(BaseModel):
    name: str | None = None
    role: str | None = None
    description: str | None = None
    persona_body: str | None = None
    objectives: dict[str, Any] | None = None
    tools: dict[str, Any] | None = None
    palette: int | None = None


_PATCHABLE_FIELDS: set[str] = {
    "name",
    "role",
    "description",
    "persona_body",
    "objectives",
    "tools",
    "palette",
}


@router.patch("/vp/{vp_id}", response_model=VPProfile)
def patch_vp(
    vp_id: str,
    req: VPPatch,
    store: Store = Depends(get_store_dep),
) -> VPProfile:
    """Edit a VP in place. Only the fields you send are changed.

    Changes take effect on the next directive — the chat endpoint reads the live
    DB row, no caching.
    """
    if store.get_vp(vp_id) is None:
        raise HTTPException(status_code=404, detail=f"VP not found: {vp_id}")

    updates = {k: v for k, v in req.model_dump(exclude_unset=True).items() if k in _PATCHABLE_FIELDS}
    if not updates:
        raise HTTPException(status_code=400, detail="No patchable fields provided")

    vp = store.patch_vp(vp_id, **updates)
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


@router.delete("/vp/{vp_id}", status_code=204)
def archive_vp(vp_id: str, store: Store = Depends(get_store_dep)) -> None:
    """Soft-delete: VP no longer appears in /vps, but history and memories remain."""
    if store.get_vp(vp_id) is None:
        raise HTTPException(status_code=404, detail=f"VP not found: {vp_id}")
    store.archive_vp(vp_id)
