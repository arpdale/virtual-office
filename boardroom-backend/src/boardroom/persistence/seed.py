"""Boot-time VP seeder.

Filesystem `vps/<id>/` directories are seed data. On boot we scan them and
upsert into the `vps` table ONLY for VPs that don't already exist in the DB.
This means users can edit a VP via the UI without their changes being clobbered
on every restart — the filesystem is read once, then the DB is the source of
truth.

To force-resync a VP from disk, the row has to be deleted first (or we add a
re-seed admin endpoint later).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from boardroom.config import VPConfig
from boardroom.persistence.store import Store, VPRecord


# Maps the six seed VPs to their pixel sprite palettes (PLAN.md table).
SEED_PALETTES: dict[str, int] = {
    "ethan_vale": 0,
    "sofia_reyes": 1,
    "marcus_chen": 2,
    "blake_monroe": 3,
    "jordan_brooks": 4,
    "valentina_cruz": 5,
}


@dataclass
class SeedReport:
    inserted: list[str]
    skipped: list[str]


def _extract_description(persona_body: str) -> str:
    """Pull the first paragraph under '## Identity' as the hover-tooltip blurb."""
    m = re.search(
        r"^##\s+Identity\s*\n+(.+?)(?=\n##\s+|\Z)",
        persona_body,
        re.DOTALL | re.MULTILINE,
    )
    if not m:
        return ""
    # Take the first non-empty paragraph (collapse internal newlines to spaces).
    para = m.group(1).strip().split("\n\n", 1)[0]
    return re.sub(r"\s+", " ", para).strip()


def vp_config_to_record(cfg: VPConfig) -> VPRecord:
    """Build a VPRecord from a filesystem-loaded VPConfig. Timestamps left as
    epoch placeholders — the DB fills them on insert."""
    from datetime import datetime, timezone

    placeholder = datetime.fromtimestamp(0, tz=timezone.utc)
    return VPRecord(
        id=cfg.id,
        name=cfg.name,
        role=cfg.role,
        description=_extract_description(cfg.persona_body),
        persona_body=cfg.persona_body,
        objectives=cfg.objectives or {},
        tools=cfg.tools or {},
        palette=SEED_PALETTES.get(cfg.id, 0),
        template_id=None,
        archived_at=None,
        created_at=placeholder,
        updated_at=placeholder,
    )


def seed_vps(store: Store, configs: list[VPConfig]) -> SeedReport:
    """Insert any filesystem VPs that aren't already in the DB.

    Existing rows are left untouched so user edits via the UI persist across
    restarts.
    """
    existing_ids = {vp.id for vp in store.list_vps(include_archived=True)}
    inserted: list[str] = []
    skipped: list[str] = []
    for cfg in configs:
        if cfg.id in existing_ids:
            skipped.append(cfg.id)
            continue
        store.upsert_vp(vp_config_to_record(cfg))
        inserted.append(cfg.id)
    return SeedReport(inserted=inserted, skipped=skipped)


def seed_templates(store: Store) -> SeedReport:
    """Insert the bundled VP templates if they're not already in the DB.

    Existing rows are left untouched — users may edit templates later, and we
    don't want to clobber their changes on every restart.
    """
    from boardroom.templates_data import TEMPLATES

    existing_ids = {t.id for t in store.list_vp_templates()}
    inserted: list[str] = []
    skipped: list[str] = []
    for t in TEMPLATES:
        if t.id in existing_ids:
            skipped.append(t.id)
            continue
        store.upsert_vp_template(t)
        inserted.append(t.id)
    return SeedReport(inserted=inserted, skipped=skipped)
