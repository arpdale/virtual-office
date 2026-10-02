"""Load VP definitions and environment configuration.

A VP is a directory under `vps/` containing:
  - persona.md       — charter / identity (with YAML frontmatter for id/name/role)
  - objectives.yaml  — strategic goals + KPIs (optional but recommended)
  - tools.yaml       — tool & MCP-server whitelist (optional, defaults to empty)

The frontmatter at the top of persona.md is the canonical source for the VP's
identity. The rest of the persona.md body becomes the system-prompt charter.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml
from dotenv import load_dotenv

load_dotenv()


@dataclass
class VPConfig:
    """A loaded VP definition. Static — does not change between turns."""

    id: str
    name: str
    role: str
    persona_body: str
    objectives: dict[str, Any] = field(default_factory=dict)
    tools: dict[str, Any] = field(default_factory=dict)
    source_dir: Path | None = None


_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n(.*)$", re.DOTALL)


def _parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Split a Markdown file with YAML frontmatter into (metadata, body)."""
    m = _FRONTMATTER_RE.match(text)
    if not m:
        return {}, text
    meta = yaml.safe_load(m.group(1)) or {}
    body = m.group(2).strip()
    return meta, body


def load_vp(vp_dir: Path) -> VPConfig:
    """Load one VP from a directory."""
    persona_path = vp_dir / "persona.md"
    if not persona_path.exists():
        raise FileNotFoundError(f"Missing persona.md in {vp_dir}")
    meta, body = _parse_frontmatter(persona_path.read_text(encoding="utf-8"))

    vp_id = meta.get("id") or vp_dir.name
    name = meta.get("name") or vp_id.replace("_", " ").title()
    role = meta.get("role") or "Unspecified"

    objectives: dict[str, Any] = {}
    obj_path = vp_dir / "objectives.yaml"
    if obj_path.exists():
        objectives = yaml.safe_load(obj_path.read_text(encoding="utf-8")) or {}

    tools: dict[str, Any] = {}
    tools_path = vp_dir / "tools.yaml"
    if tools_path.exists():
        tools = yaml.safe_load(tools_path.read_text(encoding="utf-8")) or {}

    return VPConfig(
        id=vp_id,
        name=name,
        role=role,
        persona_body=body,
        objectives=objectives,
        tools=tools,
        source_dir=vp_dir,
    )


def load_all_vps(vps_dir: Path | None = None) -> list[VPConfig]:
    """Load all VPs from the vps directory, sorted by id for stable ordering."""
    if vps_dir is None:
        vps_dir = Path(os.environ.get("BOARDROOM_VPS_DIR", "./vps")).resolve()
    if not vps_dir.exists():
        raise FileNotFoundError(f"vps directory not found: {vps_dir}")
    vps: list[VPConfig] = []
    for entry in sorted(vps_dir.iterdir()):
        if entry.is_dir() and (entry / "persona.md").exists():
            vps.append(load_vp(entry))
    return vps


@dataclass
class Settings:
    anthropic_api_key: str
    database_url: str
    host: str = "127.0.0.1"
    port: int = 8100
    vps_dir: Path = field(default_factory=lambda: Path("./vps").resolve())
    db_path: Path = field(default_factory=lambda: Path("./boardroom.db").resolve())
    vp_model: str = "claude-sonnet-4-6"
    worker_model: str = "claude-haiku-4-5-20251001"
    director_model: str = "claude-opus-4-7"


def load_settings() -> Settings:
    api_key = os.environ.get("ANTHROPIC_API_KEY", "")
    return Settings(
        anthropic_api_key=api_key,
        database_url=os.environ.get("DATABASE_URL", ""),
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8100")),
        vps_dir=Path(os.environ.get("BOARDROOM_VPS_DIR", "./vps")).resolve(),
        db_path=Path(os.environ.get("BOARDROOM_DB_PATH", "./boardroom.db")).resolve(),
        vp_model=os.environ.get("VP_MODEL", "claude-sonnet-4-6"),
        worker_model=os.environ.get("WORKER_MODEL", "claude-haiku-4-5-20251001"),
        director_model=os.environ.get("DIRECTOR_MODEL", "claude-opus-4-7"),
    )
