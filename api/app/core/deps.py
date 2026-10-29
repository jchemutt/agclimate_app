"""Shared FastAPI dependencies: storage, profiles, country and run resolution."""
from __future__ import annotations

import re
from functools import lru_cache

from fastapi import Depends, HTTPException, Path, Response

from .config import get_settings
from .profiles import Profile, ProfileRegistry
from .storage import NotFound, Store

INIT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
IMMUTABLE = "public, max-age=31536000, immutable" # versioned URL: content never changes
SHORT = "public, max-age=60"
DATED = "public, max-age=300"                          # a dated run can be republished (preview -> full)


@lru_cache
def get_store() -> Store:
    return Store(get_settings())


@lru_cache
def get_registry() -> ProfileRegistry:
    return ProfileRegistry(get_settings().profiles_dir)


def reset_caches() -> None:
    """For tests: re-read settings, storage and profiles."""
    get_settings.cache_clear()
    get_store.cache_clear()
    get_registry.cache_clear()


def get_profile(cid: str = Path(..., description="Country id, e.g. `kenya`", examples=["kenya"]),
                reg: ProfileRegistry = Depends(get_registry)) -> Profile:
    p = reg.get(cid)
    if p is None:
        raise HTTPException(404, f"Unknown country {cid!r}")
    return p


def resolve_init(p: Profile, init: str, st: Store) -> str:
    """'latest' -> the newest published start date; otherwise validate YYYY-MM-DD."""
    if init == "latest":
        try:
            return st.json(f"{p.id}/latest.json")["init"]
        except NotFound:
            raise HTTPException(404, f"No forecast published for {p.id} yet")
    if not INIT_RE.match(init):
        raise HTTPException(400, "init must be YYYY-MM-DD or 'latest'")
    return init


def load_catalog(p: Profile, init: str, st: Store) -> dict:
    try:
        return st.json(f"{p.id}/{init}/catalog.json")
    except NotFound:
        raise HTTPException(404, f"No run {init} for {p.id}")


def cache(response: Response, requested_init: str | None = None, seconds: int | None = None,
          versioned: bool = False) -> None:
    """Immutable only for versioned URLs (`?v=<created>`, which change when a run is
    republished); short for 'latest', indexes and unversioned dated requests."""
    if seconds is not None:
        response.headers["Cache-Control"] = f"public, max-age={seconds}"
    elif versioned and requested_init and requested_init != "latest":
        response.headers["Cache-Control"] = IMMUTABLE
    elif requested_init and requested_init != "latest":
        response.headers["Cache-Control"] = DATED
    else:
        response.headers["Cache-Control"] = SHORT


INIT_PARAM = Path(..., description="Forecast start date `YYYY-MM-DD`, or `latest`", examples=["latest", "2026-10-01"])
