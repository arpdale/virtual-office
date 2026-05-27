"""FastAPI dependencies shared across route modules.

The store is stashed on `app.state.store` by `lifespan()` in `main.py`. Routes
declare `store: Store = Depends(get_store_dep)` to read it. If the store
isn't initialized (missing env vars) we 503.
"""

from __future__ import annotations

from fastapi import HTTPException, Request

from boardroom.persistence import Store


def get_store_dep(request: Request) -> Store:
    store: Store | None = getattr(request.app.state, "store", None)
    if store is None:
        raise HTTPException(
            status_code=503,
            detail="Storage backend not initialized. Set SUPABASE_URL and SUPABASE_SERVICE_KEY in .env.",
        )
    return store
