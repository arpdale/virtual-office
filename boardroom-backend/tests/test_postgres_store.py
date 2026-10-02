"""PostgresStore integration tests.

Run only when TEST_DATABASE_URL is set. Everything happens inside a throwaway
schema (`test_<random>`) that is dropped at the end; the public schema is
never touched.

Session-level `SET search_path` would leak through Neon's transaction-mode
pooler into other clients' connections, so a `-pooler` host is rewritten to
the direct (unpooled) host here.
"""

from __future__ import annotations

import os
import uuid
from pathlib import Path

import psycopg
import pytest
from psycopg import sql

from boardroom.persistence.postgres_store import PostgresStore
from boardroom.persistence.store import VPRecord, VPTemplate

DSN = os.environ.get("TEST_DATABASE_URL", "").replace("-pooler.", ".")
pytestmark = pytest.mark.skipif(not DSN, reason="TEST_DATABASE_URL not set")

SCHEMA_SQL = Path(__file__).resolve().parents[1] / "db" / "schema.sql"


@pytest.fixture(scope="module")
def store():
    schema = f"test_{uuid.uuid4().hex[:12]}"
    ident = sql.Identifier(schema)
    with psycopg.connect(DSN, autocommit=True) as admin:
        admin.execute(sql.SQL("CREATE SCHEMA {}").format(ident))
        try:
            admin.execute(sql.SQL("SET search_path TO {}").format(ident))
            admin.execute(SCHEMA_SQL.read_text())
            admin.execute("RESET search_path")

            def configure(conn: psycopg.Connection) -> None:
                conn.execute(sql.SQL("SET search_path TO {}").format(ident))
                conn.commit()

            s = PostgresStore(DSN, max_size=3, configure=configure)
            try:
                yield s
            finally:
                s.close()
        finally:
            admin.execute("RESET search_path")
            admin.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(ident))


def _vp(id_: str, **kw) -> VPRecord:
    base = dict(
        id=id_, name="N", role="R", description="d", persona_body="p",
        objectives={"a": [1, 2]}, tools={"t": True}, palette=2, template_id=None,
        archived_at=None, created_at=None, updated_at=None,
    )
    base.update(kw)
    return VPRecord(**base)


def test_vp_upsert_get_list_patch_archive(store: PostgresStore):
    a = store.upsert_vp(_vp("vp_a"))
    assert a.objectives == {"a": [1, 2]} and a.tools == {"t": True}
    assert a.palette == 2 and a.archived_at is None
    store.upsert_vp(_vp("vp_b"))

    # upsert overwrites mutable columns, keeps created_at
    a2 = store.upsert_vp(_vp("vp_a", name="New", objectives={}, palette=5, template_id="tpl"))
    assert (a2.name, a2.objectives, a2.palette, a2.template_id) == ("New", {}, 5, "tpl")
    assert a2.created_at == a.created_at

    assert [v.id for v in store.list_vps()] == ["vp_a", "vp_b"]
    assert store.get_vp("vp_a").name == "New"
    assert store.get_vp("missing") is None

    # patch: scalar + jsonb, updated_at trigger
    p = store.patch_vp("vp_a", role="CEO", objectives={"x": 1})
    assert p.role == "CEO" and p.objectives == {"x": 1} and p.updated_at >= a2.updated_at
    assert store.patch_vp("vp_a").id == "vp_a"  # no fields -> current
    with pytest.raises(KeyError):
        store.patch_vp("missing", role="x")
    with pytest.raises(KeyError):
        store.patch_vp("missing")
    with pytest.raises(ValueError):
        store.patch_vp("vp_a", id="evil")
    with pytest.raises(ValueError):
        store.patch_vp("vp_a", **{"name = 'x'; --": 1})

    store.archive_vp("vp_b")
    assert store.get_vp("vp_b").archived_at is not None
    assert [v.id for v in store.list_vps()] == ["vp_a"]
    assert [v.id for v in store.list_vps(include_archived=True)] == ["vp_a", "vp_b"]


def test_templates(store: PostgresStore):
    def t(id_, cat, **kw):
        base = dict(
            id=id_, category=cat, display_name="D", description="desc",
            questions=[{"q": 1}], base_persona="bp", base_objectives={"o": 1},
            base_core_facts=["f1"],
        )
        base.update(kw)
        return VPTemplate(**base)

    store.upsert_vp_template(t("t2", "zeta"))
    store.upsert_vp_template(t("t1", "alpha"))
    out = store.upsert_vp_template(t("t1", "alpha", display_name="Changed", questions=[]))
    assert out.display_name == "Changed" and out.questions == []
    assert out.base_core_facts == ["f1"]
    assert [x.id for x in store.list_vp_templates()] == ["t1", "t2"]
    assert store.get_vp_template("t2").category == "zeta"
    assert store.get_vp_template("nope") is None


def test_core_facts(store: PostgresStore):
    store.upsert_vp(_vp("vp_cf"))
    f1 = store.add_core_fact("vp_cf", "one")
    f2 = store.add_core_fact("vp_cf", "two")
    assert f1.id and f1.content == "one"
    assert [f.content for f in store.list_core_facts("vp_cf")] == ["one", "two"]
    store.delete_core_fact(f1.id)
    assert [f.id for f in store.list_core_facts("vp_cf")] == [f2.id]
    store.delete_core_fact("does-not-exist")  # no error


def test_directives_and_search(store: PostgresStore):
    store.upsert_vp(_vp("vp_d"))
    store.upsert_vp(_vp("vp_other"))
    d1 = store.write_directive("vp_d", "Launch the marketing campaign", "On it")
    d2 = store.write_directive("vp_d", "Review budget", "Budget reviewed", "all", directive_id="fixed-id")
    store.write_directive("vp_other", "marketing elsewhere", "x")
    assert d1.target_scope == "individual" and d2.id == "fixed-id" and d2.target_scope == "all"

    listed = store.list_directives("vp_d")
    assert [d.id for d in listed] == ["fixed-id", d1.id]  # newest first
    assert len(store.list_directives("vp_d", limit=1)) == 1

    hits = store.search_directives("vp_d", "marketing campaign")
    assert [d.id for d in hits] == [d1.id]
    assert [d.id for d in store.search_directives("vp_d", "budget OR marketing")] == ["fixed-id", d1.id]
    assert len(store.search_directives("vp_d", "budget OR marketing", limit=1)) == 1
    assert store.search_directives("vp_d", "   ") == []
    assert store.search_directives("vp_d", "zzzznomatch") == []


def test_memories_and_cascades(store: PostgresStore):
    store.upsert_vp(_vp("vp_m"))
    d = store.write_directive("vp_m", "dir", "resp")
    m1 = store.write_memory("vp_m", "fact", "learned", source_directive_id=d.id)
    m2 = store.write_memory("vp_m", "preference", "likes tea")
    store.write_memory("vp_m", "fact", "another")
    assert m1.source_directive_id == d.id and m2.source_directive_id is None

    assert len(store.list_memories("vp_m")) == 3
    assert {m.memory_type for m in store.list_memories("vp_m", memory_type="fact")} == {"fact"}
    assert len(store.list_memories("vp_m", memory_type="fact")) == 2
    assert len(store.list_memories("vp_m", limit=2)) == 2
    assert [m.content for m in store.recent_memories("vp_m", limit=1)] == ["another"]

    # deleting the source directive nulls the reference (SET NULL)
    with store._pool.connection() as conn:
        conn.execute("DELETE FROM directive_history WHERE id = %s", (d.id,))
    assert {m.id: m.source_directive_id for m in store.list_memories("vp_m")}[m1.id] is None

    # deleting the VP cascades to all child tables
    store.add_core_fact("vp_m", "cf")
    with store._pool.connection() as conn:
        conn.execute("DELETE FROM vps WHERE id = %s", ("vp_m",))
    assert store.list_memories("vp_m") == []
    assert store.list_core_facts("vp_m") == []
    assert store.list_directives("vp_m") == []
