"""PostgreSQL-backed Store implementation (Neon, via psycopg 3).

Connects directly with a standard Postgres connection string (`DATABASE_URL`,
typically Neon's pooled endpoint with `sslmode=require`). A small
`psycopg_pool.ConnectionPool` is used; `check_connection` validates each
connection on checkout so idle Neon suspends don't surface as errors.

The schema lives in `db/schema.sql`. All SQL is parameterized; the only
dynamic SQL (column names in `patch_vp`) is whitelisted and quoted with
`psycopg.sql.Identifier`.

All methods are synchronous. FastAPI runs them in a threadpool via `def`
(non-async) route handlers, which is fine for our load.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone
from typing import Any

from psycopg import Connection, sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

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

_DIRECTIVE_COLS = "id, vp_id, directive, response, target_scope, created_at"

# Columns patch_vp may update; jsonb ones need Jsonb wrapping.
_VP_PATCHABLE = frozenset(
    {
        "name",
        "role",
        "description",
        "persona_body",
        "objectives",
        "tools",
        "palette",
        "template_id",
        "archived_at",
    }
)
_VP_JSON_COLS = frozenset({"objectives", "tools"})


def _parse_dt(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value
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


class PostgresStore(Store):
    def __init__(
        self,
        database_url: str,
        *,
        min_size: int = 1,
        max_size: int = 5,
        configure: Callable[[Connection[Any]], None] | None = None,
    ):
        if not database_url:
            raise RuntimeError("PostgresStore requires a DATABASE_URL connection string")
        self._pool = ConnectionPool(
            database_url,
            min_size=min_size,
            max_size=max_size,
            kwargs={"row_factory": dict_row},
            check=ConnectionPool.check_connection,
            configure=configure,
            open=True,
        )

    def close(self) -> None:
        self._pool.close()

    # ── helpers ──────────────────────────────────────────────

    def _fetchall(self, query: Any, params: Any = None) -> list[dict[str, Any]]:
        with self._pool.connection() as conn:
            return conn.execute(query, params).fetchall()

    def _fetchone(self, query: Any, params: Any = None) -> dict[str, Any] | None:
        with self._pool.connection() as conn:
            return conn.execute(query, params).fetchone()

    def _execute(self, query: Any, params: Any = None) -> None:
        with self._pool.connection() as conn:
            conn.execute(query, params)

    # ── Tier 1: core_facts ───────────────────────────────────

    def list_core_facts(self, vp_id: str) -> list[CoreFact]:
        rows = self._fetchall(
            "SELECT * FROM core_facts WHERE vp_id = %s ORDER BY created_at ASC",
            (vp_id,),
        )
        return [_row_to_core_fact(r) for r in rows]

    def add_core_fact(self, vp_id: str, content: str) -> CoreFact:
        row = self._fetchone(
            "INSERT INTO core_facts (vp_id, content) VALUES (%s, %s) RETURNING *",
            (vp_id, content),
        )
        assert row is not None
        return _row_to_core_fact(row)

    def delete_core_fact(self, fact_id: str) -> None:
        self._execute("DELETE FROM core_facts WHERE id = %s", (fact_id,))

    # ── Tier 2: directive_history ────────────────────────────

    def write_directive(
        self,
        vp_id: str,
        directive: str,
        response: str,
        target_scope: TargetScope = "individual",
        directive_id: str | None = None,
    ) -> Directive:
        if directive_id is not None:
            row = self._fetchone(
                "INSERT INTO directive_history (id, vp_id, directive, response, target_scope) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING " + _DIRECTIVE_COLS,
                (directive_id, vp_id, directive, response, target_scope),
            )
        else:
            row = self._fetchone(
                "INSERT INTO directive_history (vp_id, directive, response, target_scope) "
                "VALUES (%s, %s, %s, %s) RETURNING " + _DIRECTIVE_COLS,
                (vp_id, directive, response, target_scope),
            )
        assert row is not None
        return _row_to_directive(row)

    def list_directives(self, vp_id: str, limit: int = 20) -> list[Directive]:
        rows = self._fetchall(
            f"SELECT {_DIRECTIVE_COLS} FROM directive_history "
            "WHERE vp_id = %s ORDER BY created_at DESC LIMIT %s",
            (vp_id, limit),
        )
        return [_row_to_directive(r) for r in rows]

    def search_directives(self, vp_id: str, query: str, limit: int = 10) -> list[Directive]:
        if not query.strip():
            return []
        rows = self._fetchall(
            f"SELECT {_DIRECTIVE_COLS} FROM directive_history "
            "WHERE vp_id = %s AND fts @@ websearch_to_tsquery('english', %s) "
            "ORDER BY created_at DESC LIMIT %s",
            (vp_id, query, limit),
        )
        return [_row_to_directive(r) for r in rows]

    # ── Tier 3: memories ─────────────────────────────────────

    def write_memory(
        self,
        vp_id: str,
        memory_type: MemoryType,
        content: str,
        source_directive_id: str | None = None,
    ) -> Memory:
        row = self._fetchone(
            "INSERT INTO memories (vp_id, memory_type, content, source_directive_id) "
            "VALUES (%s, %s, %s, %s) RETURNING *",
            (vp_id, memory_type, content, source_directive_id),
        )
        assert row is not None
        return _row_to_memory(row)

    def list_memories(
        self,
        vp_id: str,
        memory_type: MemoryType | None = None,
        limit: int = 50,
    ) -> list[Memory]:
        if memory_type is not None:
            rows = self._fetchall(
                "SELECT * FROM memories WHERE vp_id = %s AND memory_type = %s "
                "ORDER BY created_at DESC LIMIT %s",
                (vp_id, memory_type, limit),
            )
        else:
            rows = self._fetchall(
                "SELECT * FROM memories WHERE vp_id = %s ORDER BY created_at DESC LIMIT %s",
                (vp_id, limit),
            )
        return [_row_to_memory(r) for r in rows]

    def recent_memories(self, vp_id: str, limit: int = 8) -> list[Memory]:
        return self.list_memories(vp_id, memory_type=None, limit=limit)

    # ── VP records ───────────────────────────────────────────

    def list_vps(self, include_archived: bool = False) -> list[VPRecord]:
        where = "" if include_archived else "WHERE archived_at IS NULL "
        rows = self._fetchall(f"SELECT * FROM vps {where}ORDER BY created_at ASC")
        return [_row_to_vp(r) for r in rows]

    def get_vp(self, vp_id: str) -> VPRecord | None:
        row = self._fetchone("SELECT * FROM vps WHERE id = %s LIMIT 1", (vp_id,))
        return _row_to_vp(row) if row else None

    def upsert_vp(self, vp: VPRecord) -> VPRecord:
        row = self._fetchone(
            """
            INSERT INTO vps (id, name, role, description, persona_body,
                             objectives, tools, palette, template_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                role = EXCLUDED.role,
                description = EXCLUDED.description,
                persona_body = EXCLUDED.persona_body,
                objectives = EXCLUDED.objectives,
                tools = EXCLUDED.tools,
                palette = EXCLUDED.palette,
                template_id = EXCLUDED.template_id
            RETURNING *
            """,
            (
                vp.id,
                vp.name,
                vp.role,
                vp.description,
                vp.persona_body,
                Jsonb(vp.objectives),
                Jsonb(vp.tools),
                vp.palette,
                vp.template_id,
            ),
        )
        assert row is not None
        return _row_to_vp(row)

    def patch_vp(self, vp_id: str, **fields: Any) -> VPRecord:
        if not fields:
            current = self.get_vp(vp_id)
            if current is None:
                raise KeyError(vp_id)
            return current
        bad = set(fields) - _VP_PATCHABLE
        if bad:
            raise ValueError(f"Unpatchable vps column(s): {sorted(bad)}")
        assignments = sql.SQL(", ").join(
            sql.SQL("{} = %s").format(sql.Identifier(k)) for k in fields
        )
        values = [Jsonb(v) if k in _VP_JSON_COLS else v for k, v in fields.items()]
        query = sql.SQL("UPDATE vps SET {} WHERE id = %s RETURNING *").format(assignments)
        row = self._fetchone(query, (*values, vp_id))
        if row is None:
            raise KeyError(vp_id)
        return _row_to_vp(row)

    def archive_vp(self, vp_id: str) -> None:
        self._execute(
            "UPDATE vps SET archived_at = %s WHERE id = %s",
            (datetime.now(timezone.utc), vp_id),
        )

    # ── VP templates ─────────────────────────────────────────

    def list_vp_templates(self) -> list[VPTemplate]:
        rows = self._fetchall("SELECT * FROM vp_templates ORDER BY category")
        return [_row_to_template(r) for r in rows]

    def get_vp_template(self, template_id: str) -> VPTemplate | None:
        row = self._fetchone(
            "SELECT * FROM vp_templates WHERE id = %s LIMIT 1", (template_id,)
        )
        return _row_to_template(row) if row else None

    def upsert_vp_template(self, template: VPTemplate) -> VPTemplate:
        row = self._fetchone(
            """
            INSERT INTO vp_templates (id, category, display_name, description, questions,
                                      base_persona, base_objectives, base_core_facts)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO UPDATE SET
                category = EXCLUDED.category,
                display_name = EXCLUDED.display_name,
                description = EXCLUDED.description,
                questions = EXCLUDED.questions,
                base_persona = EXCLUDED.base_persona,
                base_objectives = EXCLUDED.base_objectives,
                base_core_facts = EXCLUDED.base_core_facts
            RETURNING *
            """,
            (
                template.id,
                template.category,
                template.display_name,
                template.description,
                Jsonb(template.questions),
                template.base_persona,
                Jsonb(template.base_objectives),
                Jsonb(template.base_core_facts),
            ),
        )
        assert row is not None
        return _row_to_template(row)
