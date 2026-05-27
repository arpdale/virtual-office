"""FastAPI entry point for boardroom-backend.

Routes:
  GET  /                       health check
  GET  /vps                    list VP roster (from DB)
  GET  /vp/{id}                full profile incl. core_facts + counts
  GET  /vp/{id}/history        recent directives + responses
  GET  /vp/{id}/memories       typed memories
  POST /directive              send a directive to the board

Backend uses claude-agent-sdk which subprocesses the `claude` CLI. The CLI's
auth (Claude Max subscription via `claude login`, or ANTHROPIC_API_KEY env) is
inherited by every VP call. No separate API key configuration needed here.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from boardroom.agents.director import DirectiveResult, run_directive
from boardroom.api.routes_chat import router as chat_router
from boardroom.api.routes_onboard import router as onboard_router
from boardroom.api.routes_vp import router as vp_router
from boardroom.api.routes_vp_edit import router as vp_edit_router
from boardroom.config import VPConfig, load_all_vps, load_settings
from boardroom.persistence import Store, get_store
from boardroom.persistence.seed import seed_templates, seed_vps


class _Globals:
    settings = load_settings()
    vps: list[VPConfig] = []
    store: Store | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    _Globals.vps = load_all_vps(_Globals.settings.vps_dir)
    print(
        f"[boardroom] Loaded {len(_Globals.vps)} VPs from disk: "
        + ", ".join(f"{v.name} ({v.role})" for v in _Globals.vps)
    )
    print(
        f"[boardroom] VP model: {_Globals.settings.vp_model} | "
        f"Director model: {_Globals.settings.director_model} | "
        f"Worker model: {_Globals.settings.worker_model}"
    )

    try:
        _Globals.store = get_store(_Globals.settings)
        vp_report = seed_vps(_Globals.store, _Globals.vps)
        tmpl_report = seed_templates(_Globals.store)
        app.state.store = _Globals.store
        print(
            f"[boardroom] DB seed VPs: inserted={vp_report.inserted} skipped={vp_report.skipped}"
        )
        print(
            f"[boardroom] DB seed templates: inserted={len(tmpl_report.inserted)} skipped={len(tmpl_report.skipped)}"
        )
    except Exception as exc:  # noqa: BLE001
        print(f"[boardroom] WARNING: store init/seed failed: {exc}")
        print(
            "[boardroom] Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env to enable "
            "memory + persistence. /directive still works without a store."
        )

    print(
        "[boardroom] Agent calls subprocess the `claude` CLI — make sure you've "
        "run `claude login` (for Max) or set ANTHROPIC_API_KEY (for API billing)."
    )
    yield


app = FastAPI(title="boardroom-backend", version="0.1.0", lifespan=lifespan)

# CORS — pixel-office UI runs locally (Vite dev server). Multiple ports
# allowed for flexibility: 3101 (CLAUDE.md convention), 5173 (Vite default).
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(127\.0\.0\.1|localhost):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(vp_router)
app.include_router(vp_edit_router)
app.include_router(onboard_router)
app.include_router(chat_router)


class DirectiveRequest(BaseModel):
    text: str


@app.get("/")
def health() -> dict[str, Any]:
    return {"status": "ok", "vp_count": len(_Globals.vps)}


@app.post("/directive")
async def post_directive(req: DirectiveRequest) -> DirectiveResult:
    if not _Globals.vps:
        raise HTTPException(status_code=500, detail="No VPs loaded")
    result = await run_directive(
        directive=req.text,
        vps=_Globals.vps,
        vp_model=_Globals.settings.vp_model,
        director_model=_Globals.settings.director_model,
    )
    return result
