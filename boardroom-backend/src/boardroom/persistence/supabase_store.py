"""Supabase-backed Store implementation.

Uses the official `supabase-py` client. The backend authenticates with the
service_role key, which bypasses RLS. RLS is enabled on every table with no
policies, so anon/authenticated keys see nothing — defense in depth in case
those keys ever leak.

All methods are synchronous. FastAPI runs them in a threadpool via `def`
(non-async) route handlers, which is fine for our load. Async wrapper layer
can be added later if it matters.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from supabase import Client, create_client

from boardroom.persistence.store import (
    CoreFact,
    Directive,
    Memory,
    MemoryType,
    Store,
    TargetScope,
    VPRecord,
    VPTemplate,
)


def _parse_dt(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
    # Supabase returns ISO-8601 strings with 'Z' or '+00:00'
    text = str(value).replace("Z", "+00:00")
    return datetime.fromisoformat(text)


def _parse_optional_dt(value: Any) -> datetime | None:
    if value is None:
        return None
    return _parse_dt(value)


def _row_to_core_fact(row: dict[str, Any]) -> CoreFact:
    return CoreFact(
        id=row["id"],
        vp_id=row["vp_id"],
        content=row["content"],
        created_at=_parse_dt(row["created_at"]),
    )


def _row_to_directive(row: dict[str, Any]) -> Directive:
    return Directive(
        id=row["id"],
        vp_id=row["vp_id"],
        directive=row["directive"],
        response=row["response"],
        target_scope=row.get("target_scope", "individual"),
        created_at=_parse_dt(row["created_at"]),
    )


def _row_to_memory(row: dict[str, Any]) -> Memory:
    return Memory(
        id=row["id"],
        vp_id=row["vp_id"],
        memory_type=row["memory_type"],
        content=row["content"],
        source_directive_id=row.get("source_directive_id"),
        created_at=_parse_dt(row["created_at"]),
    )


def _row_to_vp(row: dict[str, Any]) -> VPRecord:
    return VPRecord(
        id=row["id"],
        name=row["name"],
        role=row["role"],
        description=row.get("description", ""),
        persona_body=row.get("persona_body", ""),
        objectives=row.get("objectives") or {},
        tools=row.get("tools") or {},
        palette=row.get("palette", 0),
        template_id=row.get("template_id"),
        archived_at=_parse_optional_dt(row.get("archived_at")),
        created_at=_parse_dt(row["created_at"]),
        updated_at=_parse_dt(row["updated_at"]),
    )


def _row_to_template(row: dict[str, Any]) -> VPTemplate:
    return VPTemplate(
        id=row["id"],
        category=row["category"],
        display_name=row["display_name"],
        description=row["description"],
        questions=row.get("questions") or [],
        base_persona=row.get("base_persona", ""),
        base_objectives=row.get("base_objectives") or {},
        base_core_facts=row.get("base_core_facts") or [],
    )


class SupabaseStore(Store):
    def __init__(self, url: str, service_key: str):
        if not url or not service_key:
            raise RuntimeError(
                "SupabaseStore requires SUPABASE_URL and SUPABASE_SERVICE_KEY env vars"
            )
        self._client: Client = create_client(url, service_key)

    # ── Tier 1: core_facts ───────────────────────────────────

    def list_core_facts(self, vp_id: str) -> list[CoreFact]:
        res = (
            self._client.table("core_facts")
            .select("*")
            .eq("vp_id", vp_id)
            .order("created_at", desc=False)
            .execute()
        )
        return [_row_to_core_fact(r) for r in (res.data or [])]

    def add_core_fact(self, vp_id: str, content: str) -> CoreFact:
        res = (
            self._client.table("core_facts")
            .insert({"vp_id": vp_id, "content": content})
            .execute()
        )
        return _row_to_core_fact(res.data[0])

    def delete_core_fact(self, fact_id: str) -> None:
        self._client.table("core_facts").delete().eq("id", fact_id).execute()

    # ── Tier 2: directive_history ────────────────────────────

    def write_directive(
        self,
        vp_id: str,
        directive: str,
        response: str,
        target_scope: TargetScope = "individual",
        directive_id: str | None = None,
    ) -> Directive:
        payload: dict[str, Any] = {
            "vp_id": vp_id,
            "directive": directive,
            "response": response,
            "target_scope": target_scope,
        }
        if directive_id is not None:
            payload["id"] = directive_id
        res = (
            self._client.table("directive_history")
            .insert(payload)
            .execute()
        )
        return _row_to_directive(res.data[0])

    def list_directives(self, vp_id: str, limit: int = 20) -> list[Directive]:
        res = (
            self._client.table("directive_history")
            .select("id, vp_id, directive, response, target_scope, created_at")
            .eq("vp_id", vp_id)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return [_row_to_directive(r) for r in (res.data or [])]

    def search_directives(self, vp_id: str, query: str, limit: int = 10) -> list[Directive]:
        if not query.strip():
            return []
        # PostgREST builder quirk: `text_search` returns a builder that drops
        # `.order()` and `.limit()`. Fetch all matches, sort + slice in Python.
        # Volumes are small (single VP, conversational history), so this is fine.
        res = (
            self._client.table("directive_history")
            .select("id, vp_id, directive, response, target_scope, created_at")
            .eq("vp_id", vp_id)
            .text_search("fts", query, options={"type": "web_search"})
            .execute()
        )
        rows = sorted(
            res.data or [],
            key=lambda r: r["created_at"],
            reverse=True,
        )[:limit]
        return [_row_to_directive(r) for r in rows]

    # ── Tier 3: memories ─────────────────────────────────────

    def write_memory(
        self,
        vp_id: str,
        memory_type: MemoryType,
        content: str,
        source_directive_id: str | None = None,
    ) -> Memory:
        payload: dict[str, Any] = {
            "vp_id": vp_id,
            "memory_type": memory_type,
            "content": content,
        }
        if source_directive_id is not None:
            payload["source_directive_id"] = source_directive_id
        res = self._client.table("memories").insert(payload).execute()
        return _row_to_memory(res.data[0])

    def list_memories(
        self,
        vp_id: str,
        memory_type: MemoryType | None = None,
        limit: int = 50,
    ) -> list[Memory]:
        q = self._client.table("memories").select("*").eq("vp_id", vp_id)
        if memory_type is not None:
            q = q.eq("memory_type", memory_type)
        res = q.order("created_at", desc=True).limit(limit).execute()
        return [_row_to_memory(r) for r in (res.data or [])]

    def recent_memories(self, vp_id: str, limit: int = 8) -> list[Memory]:
        return self.list_memories(vp_id, memory_type=None, limit=limit)

    # ── VP records ───────────────────────────────────────────

    def list_vps(self, include_archived: bool = False) -> list[VPRecord]:
        q = self._client.table("vps").select("*")
        if not include_archived:
            q = q.is_("archived_at", "null")
        res = q.order("created_at", desc=False).execute()
        return [_row_to_vp(r) for r in (res.data or [])]

    def get_vp(self, vp_id: str) -> VPRecord | None:
        res = self._client.table("vps").select("*").eq("id", vp_id).limit(1).execute()
        rows = res.data or []
        return _row_to_vp(rows[0]) if rows else None

    def upsert_vp(self, vp: VPRecord) -> VPRecord:
        payload = {
            "id": vp.id,
            "name": vp.name,
            "role": vp.role,
            "description": vp.description,
            "persona_body": vp.persona_body,
            "objectives": vp.objectives,
            "tools": vp.tools,
            "palette": vp.palette,
            "template_id": vp.template_id,
        }
        res = self._client.table("vps").upsert(payload, on_conflict="id").execute()
        return _row_to_vp(res.data[0])

    def patch_vp(self, vp_id: str, **fields: Any) -> VPRecord:
        if not fields:
            current = self.get_vp(vp_id)
            if current is None:
                raise KeyError(vp_id)
            return current
        res = (
            self._client.table("vps")
            .update(fields)
            .eq("id", vp_id)
            .execute()
        )
        if not res.data:
            raise KeyError(vp_id)
        return _row_to_vp(res.data[0])

    def archive_vp(self, vp_id: str) -> None:
        self._client.table("vps").update(
            {"archived_at": datetime.utcnow().isoformat()}
        ).eq("id", vp_id).execute()

    # ── VP templates ─────────────────────────────────────────

    def list_vp_templates(self) -> list[VPTemplate]:
        res = self._client.table("vp_templates").select("*").order("category").execute()
        return [_row_to_template(r) for r in (res.data or [])]

    def get_vp_template(self, template_id: str) -> VPTemplate | None:
        res = (
            self._client.table("vp_templates")
            .select("*")
            .eq("id", template_id)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return _row_to_template(rows[0]) if rows else None

    def upsert_vp_template(self, template: VPTemplate) -> VPTemplate:
        payload = {
            "id": template.id,
            "category": template.category,
            "display_name": template.display_name,
            "description": template.description,
            "questions": template.questions,
            "base_persona": template.base_persona,
            "base_objectives": template.base_objectives,
            "base_core_facts": template.base_core_facts,
        }
        res = self._client.table("vp_templates").upsert(payload, on_conflict="id").execute()
        return _row_to_template(res.data[0])
