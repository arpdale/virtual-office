"""Persistence layer for the 3-tier memory model and VP records.

`Store` is the abstract interface. `SupabaseStore` is the production
implementation. `get_store(settings)` returns the active store; today it's
hard-wired to Supabase, but the ABC leaves room for swap-in alternatives.

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
from boardroom.persistence.supabase_store import SupabaseStore


def get_store(settings: Settings) -> Store:
    return SupabaseStore(
        url=settings.supabase_url,
        service_key=settings.supabase_service_key,
    )


__all__ = [
    "CoreFact",
    "Directive",
    "Memory",
    "MemoryEntry",
    "MemoryStore",
    "MemoryType",
    "Store",
    "SupabaseStore",
    "TargetScope",
    "VPRecord",
    "VPTemplate",
    "get_store",
]
