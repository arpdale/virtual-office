"""Memory store: per-VP Hermes-style memory entries.

Canonical storage: markdown files under `memory/<vp_id>/<entry_id>.md`.
Search index: SQLite FTS5 virtual table.

Pattern:
  - Every VP turn produces one memory entry (auto-written by the Director after
    the response).
  - VPs see the N most recent entries as passive context in their system prompt.
  - VPs can call the `recall_memory(query)` MCP tool to actively search older
    entries when they need to find something specific.

The markdown file is human-readable and version-control-friendly. The SQLite
index is a derived store and can be rebuilt from files via `MemoryStore.reindex()`.
"""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import yaml


@dataclass
class MemoryEntry:
    """One memory entry — a snapshot of a VP's turn or note-to-self."""

    entry_id: str
    vp_id: str
    title: str
    summary: str
    body: str
    tags: list[str]
    created_at: datetime

    def to_markdown(self) -> str:
        """Serialize to markdown with YAML frontmatter."""
        frontmatter = {
            "entry_id": self.entry_id,
            "vp_id": self.vp_id,
            "title": self.title,
            "tags": self.tags,
            "created_at": self.created_at.isoformat(),
        }
        fm_text = yaml.safe_dump(frontmatter, sort_keys=False).strip()
        return f"---\n{fm_text}\n---\n\n# {self.title}\n\n## Summary\n{self.summary}\n\n## Body\n{self.body}\n"

    @classmethod
    def from_markdown(cls, text: str, fallback_path: Path | None = None) -> "MemoryEntry":
        """Parse a markdown memory file back into an entry. Tolerant of missing fields."""
        import re

        m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.DOTALL)
        if not m:
            raise ValueError("memory entry missing frontmatter")
        meta = yaml.safe_load(m.group(1)) or {}
        body_text = m.group(2)
        # Pull "Summary" and "Body" sections back out.
        summary = ""
        body = ""
        summary_match = re.search(r"^## Summary\s*\n(.*?)(?=\n## |\Z)", body_text, re.DOTALL | re.MULTILINE)
        if summary_match:
            summary = summary_match.group(1).strip()
        body_match = re.search(r"^## Body\s*\n(.*?)\Z", body_text, re.DOTALL | re.MULTILINE)
        if body_match:
            body = body_match.group(1).strip()
        return cls(
            entry_id=meta.get("entry_id", str(uuid.uuid4())),
            vp_id=meta.get("vp_id", "unknown"),
            title=meta.get("title", "(untitled)"),
            summary=summary,
            body=body,
            tags=meta.get("tags", []) or [],
            created_at=datetime.fromisoformat(meta.get("created_at", datetime.now(timezone.utc).isoformat())),
        )


_SCHEMA = """
CREATE TABLE IF NOT EXISTS memory_entries (
    entry_id    TEXT PRIMARY KEY,
    vp_id       TEXT NOT NULL,
    title       TEXT NOT NULL,
    summary     TEXT NOT NULL,
    body        TEXT NOT NULL,
    tags        TEXT NOT NULL DEFAULT '',
    file_path   TEXT NOT NULL,
    created_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_vp_created
    ON memory_entries(vp_id, created_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
    entry_id UNINDEXED,
    vp_id UNINDEXED,
    title,
    summary,
    body,
    tags,
    content='memory_entries',
    content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory_entries BEGIN
    INSERT INTO memory_fts(rowid, entry_id, vp_id, title, summary, body, tags)
    VALUES (new.rowid, new.entry_id, new.vp_id, new.title, new.summary, new.body, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory_entries BEGIN
    INSERT INTO memory_fts(memory_fts, rowid, entry_id, vp_id, title, summary, body, tags)
    VALUES ('delete', old.rowid, old.entry_id, old.vp_id, old.title, old.summary, old.body, old.tags);
END;
"""


class MemoryStore:
    """Persistent per-VP memory: markdown files + SQLite FTS5 index.

    Thread-safe-ish — uses a single connection with `check_same_thread=False`.
    For real concurrent use we'd want a connection pool; for now the FastAPI
    workers serialize through the GIL anyway.
    """

    def __init__(self, db_path: Path, memory_dir: Path):
        self.db_path = db_path
        self.memory_dir = memory_dir
        self.memory_dir.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    # ── Writing ──────────────────────────────────────────────

    def write(
        self,
        vp_id: str,
        title: str,
        summary: str,
        body: str,
        tags: list[str] | None = None,
    ) -> MemoryEntry:
        """Write a new memory entry. Persists both markdown file and SQLite row."""
        tags = tags or []
        entry = MemoryEntry(
            entry_id=str(uuid.uuid4()),
            vp_id=vp_id,
            title=title,
            summary=summary,
            body=body,
            tags=tags,
            created_at=datetime.now(timezone.utc),
        )
        # Markdown file path: memory/<vp_id>/<YYYY-MM-DD>-<slug>-<short_id>.md
        slug = _slugify(title)[:48] or "entry"
        date_str = entry.created_at.strftime("%Y-%m-%d")
        short_id = entry.entry_id[:8]
        vp_dir = self.memory_dir / vp_id
        vp_dir.mkdir(parents=True, exist_ok=True)
        file_path = vp_dir / f"{date_str}-{slug}-{short_id}.md"
        file_path.write_text(entry.to_markdown(), encoding="utf-8")

        # Insert into SQLite.
        self._conn.execute(
            "INSERT INTO memory_entries (entry_id, vp_id, title, summary, body, tags, file_path, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                entry.entry_id,
                entry.vp_id,
                entry.title,
                entry.summary,
                entry.body,
                ",".join(entry.tags),
                str(file_path),
                entry.created_at.isoformat(),
            ),
        )
        self._conn.commit()
        return entry

    # ── Reading ──────────────────────────────────────────────

    def recent(self, vp_id: str, limit: int = 5) -> list[MemoryEntry]:
        """Return the N most recent entries for one VP (chronologically newest first)."""
        rows = self._conn.execute(
            "SELECT entry_id, vp_id, title, summary, body, tags, created_at "
            "FROM memory_entries WHERE vp_id = ? "
            "ORDER BY created_at DESC LIMIT ?",
            (vp_id, limit),
        ).fetchall()
        return [_row_to_entry(r) for r in rows]

    def search(self, vp_id: str, query: str, limit: int = 5) -> list[MemoryEntry]:
        """Full-text search a VP's memory. Returns top-N by BM25 relevance."""
        if not query.strip():
            return []
        # FTS5 MATCH with vp_id filter post-search (vp_id is UNINDEXED).
        rows = self._conn.execute(
            "SELECT m.entry_id, m.vp_id, m.title, m.summary, m.body, m.tags, m.created_at "
            "FROM memory_fts f "
            "JOIN memory_entries m ON m.entry_id = f.entry_id "
            "WHERE f.memory_fts MATCH ? AND m.vp_id = ? "
            "ORDER BY rank LIMIT ?",
            (_escape_fts(query), vp_id, limit),
        ).fetchall()
        return [_row_to_entry(r) for r in rows]

    def list_all(self, vp_id: str | None = None, limit: int = 100) -> list[MemoryEntry]:
        """All entries (optionally filtered to one VP). Used by the UI history view."""
        if vp_id:
            rows = self._conn.execute(
                "SELECT entry_id, vp_id, title, summary, body, tags, created_at "
                "FROM memory_entries WHERE vp_id = ? ORDER BY created_at DESC LIMIT ?",
                (vp_id, limit),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT entry_id, vp_id, title, summary, body, tags, created_at "
                "FROM memory_entries ORDER BY created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [_row_to_entry(r) for r in rows]


# ── Helpers ────────────────────────────────────────────────


def _row_to_entry(row: tuple) -> MemoryEntry:
    entry_id, vp_id, title, summary, body, tags, created_at = row
    return MemoryEntry(
        entry_id=entry_id,
        vp_id=vp_id,
        title=title,
        summary=summary,
        body=body,
        tags=[t for t in tags.split(",") if t] if tags else [],
        created_at=datetime.fromisoformat(created_at),
    )


def _slugify(s: str) -> str:
    import re

    s = s.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")


def _escape_fts(query: str) -> str:
    """Escape FTS5 special chars and wrap in quotes for a tolerant default search."""
    # Simplest tolerant strategy: split into terms, drop FTS operators, join with space.
    safe_terms = []
    for word in query.split():
        cleaned = "".join(c for c in word if c.isalnum() or c in "-_")
        if cleaned:
            safe_terms.append(f'"{cleaned}"')
    return " ".join(safe_terms) if safe_terms else '"."'
