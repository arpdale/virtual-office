"""Persistence layer for the 3-tier memory model and VP records.

`Store` is the abstract interface. `PostgresStore` is the production
implementation (Neon / plain PostgreSQL via psycopg). `get_store(settings)`
returns the active store; today it's hard-wired to Postgres, but the ABC leaves
room for swap-in alternatives.

`MemoryStore` (the older SQLite+markdown design) is kept here only so existing
imports don't break while the agents layer is migrated to the new Store.
"""

from boardroom.config import Settings
from boardroom.persistence.memory import MemoryEntry, MemoryStore
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
from boardroom.persistence.postgres_store import PostgresStore


def get_store(settings: Settings) -> Store:
    if not settings.database_url:
        raise RuntimeError(
            "DATABASE_URL is not set. Add your Neon (PostgreSQL) connection string to .env."
        )
    return PostgresStore(settings.database_url)


__all__ = [
    "CoreFact",
    "Directive",
    "Memory",
    "MemoryEntry",
    "MemoryStore",
    "PostgresStore",
    "MemoryType",
    "Store",
    "TargetScope",
    "VPRecord",
    "VPTemplate",
    "get_store",
]
