"""Storage interface for the 3-tier memory model and VP records.

Backed by Supabase (Postgres). See `supabase_store.py` for the implementation.

Tiers:
  1. core_facts          — always-injected persistent knowledge (hand-curated)
  2. directive_history   — full audit + FTS search of every directive+response
  3. memories            — Haiku-extracted typed memories, recency-injected
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

MemoryType = Literal["preference", "fact", "relationship", "pattern"]
TargetScope = Literal["individual", "board"]


@dataclass
class CoreFact:
    id: str
    vp_id: str
    content: str
    created_at: datetime


@dataclass
class Directive:
    id: str
    vp_id: str
    directive: str
    response: str
    target_scope: TargetScope
    created_at: datetime


@dataclass
class Memory:
    id: str
    vp_id: str
    memory_type: MemoryType
    content: str
    source_directive_id: str | None
    created_at: datetime


@dataclass
class VPRecord:
    id: str
    name: str
    role: str
    description: str
    persona_body: str
    objectives: dict[str, Any]
    tools: dict[str, Any]
    palette: int
    template_id: str | None
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime


@dataclass
class VPTemplate:
    id: str
    category: str
    display_name: str
    description: str
    questions: list[dict[str, Any]]
    base_persona: str
    base_objectives: dict[str, Any]
    base_core_facts: list[str] = field(default_factory=list)


class Store(ABC):
    # ── Tier 1: core_facts ───────────────────────────────────

    @abstractmethod
    def list_core_facts(self, vp_id: str) -> list[CoreFact]: ...

    @abstractmethod
    def add_core_fact(self, vp_id: str, content: str) -> CoreFact: ...

    @abstractmethod
    def delete_core_fact(self, fact_id: str) -> None: ...

    # ── Tier 2: directive_history ────────────────────────────

    @abstractmethod
    def write_directive(
        self,
        vp_id: str,
        directive: str,
        response: str,
        target_scope: TargetScope = "individual",
        directive_id: str | None = None,
    ) -> Directive: ...

    @abstractmethod
    def list_directives(self, vp_id: str, limit: int = 20) -> list[Directive]: ...

    @abstractmethod
    def search_directives(self, vp_id: str, query: str, limit: int = 10) -> list[Directive]: ...

    # ── Tier 3: memories ─────────────────────────────────────

    @abstractmethod
    def write_memory(
        self,
        vp_id: str,
        memory_type: MemoryType,
        content: str,
        source_directive_id: str | None = None,
    ) -> Memory: ...

    @abstractmethod
    def list_memories(
        self,
        vp_id: str,
        memory_type: MemoryType | None = None,
        limit: int = 50,
    ) -> list[Memory]: ...

    @abstractmethod
    def recent_memories(self, vp_id: str, limit: int = 8) -> list[Memory]: ...

    # ── VP records ───────────────────────────────────────────

    @abstractmethod
    def list_vps(self, include_archived: bool = False) -> list[VPRecord]: ...

    @abstractmethod
    def get_vp(self, vp_id: str) -> VPRecord | None: ...

    @abstractmethod
    def upsert_vp(self, vp: VPRecord) -> VPRecord: ...

    @abstractmethod
    def patch_vp(self, vp_id: str, **fields: Any) -> VPRecord: ...

    @abstractmethod
    def archive_vp(self, vp_id: str) -> None: ...

    # ── VP templates ─────────────────────────────────────────

    @abstractmethod
    def list_vp_templates(self) -> list[VPTemplate]: ...

    @abstractmethod
    def get_vp_template(self, template_id: str) -> VPTemplate | None: ...

    @abstractmethod
    def upsert_vp_template(self, template: VPTemplate) -> VPTemplate: ...
