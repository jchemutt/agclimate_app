"""AgClimate AF API.

Joins two things:
  * the country profile (profiles/<id>.yaml): names, admin-level labels,
    seasons, layer groups, advisory messages, languages;
  * what the pipeline published for that country (published/<id>/...).

Nothing country-specific lives in the code: a country appears as soon as
its profile exists, and shows its forecasts once the pipeline has published.
"""
from __future__ import annotations

import logging
import re
from functools import lru_cache

from fastapi import Depends, FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse

from . import __version__
from .points import point_values
from .profiles import Profile, ProfileRegistry
from .settings import Settings, get_settings
from .storage import NotFound, Store

LOG = logging.getLogger("agclimate.api")
INIT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
IMMUTABLE = "public, max-age=86400, immutable"     # a published run never changes
SHORT = "public, max-age=60"
FILE_SUFFIXES = (".tif", ".tiff", ".json", ".geojson")


@lru_cache
def _store() -> Store:
    return Store(get_settings())


@lru_cache
def _registry() -> ProfileRegistry:
    return ProfileRegistry(get_settings().profiles_dir)


def store() -> Store:
    return _store()


def registry() -> ProfileRegistry:
    return _registry()


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="AgClimate AF API", version=__version__,
                  docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins),
                           allow_methods=["GET"], allow_headers=["*"])

    def profile_or_404(cid: str, reg: ProfileRegistry = Depends(registry)) -> Profile:
        p = reg.get(cid)
        if p is None:
            raise HTTPException(404, f"Unknown country {cid!r}")
        return p

    def resolve_init(p: Profile, init: str, st: Store) -> str:
        if init == "latest":
            try:
                return st.json(f"{p.id}/latest.json")["init"]
            except NotFound:
                raise HTTPException(404, f"No forecast published for {p.id} yet")
        if not INIT_RE.match(init):
            raise HTTPException(400, "init must be YYYY-MM-DD or 'latest'")
        return init

    def catalog(p: Profile, init: str, st: Store) -> dict:
        try:
            return st.json(f"{p.id}/{init}/catalog.json")
        except NotFound:
            raise HTTPException(404, f"No run {init} for {p.id}")

    # ------------------------------------------------------------------ routes
    @app.get("/api/health")
    def health(reg: ProfileRegistry = Depends(registry), st: Store = Depends(store)):
        profiles = reg.all()
        return {"status": "ok", "version": __version__, "storage": st.kind,
                "countries": sorted(profiles), "invalid_profiles": reg.errors}

    @app.get("/api/countries")
    def countries(response: Response, reg: ProfileRegistry = Depends(registry), st: Store = Depends(store)):
        out = []
        for p in reg.all().values():
            if p.hidden:
                continue
            try:
                latest = st.json(f"{p.id}/latest.json")
                latest = {"init": latest["init"], "season": p.season_for(latest["init"])}
            except NotFound:
                latest = None
            out.append({"id": p.id, "name": p.name, "flag": p.flag, "languages": p.languages,
                        "default_language": p.default_language, "latest": latest})
        response.headers["Cache-Control"] = SHORT
        return sorted(out, key=lambda c: str(c["name"] if isinstance(c["name"], str) else
                                             c["name"].get("en", c["id"])))

    @app.get("/api/countries/{cid}/profile")
    def profile(response: Response, p: Profile = Depends(profile_or_404)):
        response.headers["Cache-Control"] = SHORT
        return p.model_dump()

    @app.get("/api/countries/{cid}/runs")
    def runs(response: Response, p: Profile = Depends(profile_or_404), st: Store = Depends(store)):
        try:
            runs = st.json(f"{p.id}/runs.json")["runs"]
        except NotFound:
            runs = []
        response.headers["Cache-Control"] = SHORT
        return [{**r, "season": p.season_for(r["init"])} for r in runs]

    @app.get("/api/countries/{cid}/runs/{init}")
    def run_view(init: str, response: Response, p: Profile = Depends(profile_or_404),
                 st: Store = Depends(store)):
        """Everything the map needs for one run, in one request."""
        real = resolve_init(p, init, st)
        cat = catalog(p, real, st)
        layers = {}
        for e in cat.get("layers", []):
            ov = p.layer_overrides.get(e["id"])
            try:
                legend = dict(st.json(f"{p.id}/{real}/{e['legend']}"))
            except NotFound:
                legend = None
            if legend and ov and ov.classes and legend.get("classes"):
                legend["classes"] = [{**c, "label": ov.classes.get(int(c["value"]), c["label"])}
                                     for c in legend["classes"]]
            layers[e["id"]] = {
                "id": e["id"], "type": e["type"], "units": e.get("units", ""),
                "title": (ov.title if ov and ov.title else e["title"]),
                "description": (ov.description if ov and ov.description else (legend or {}).get("description")),
                "cog_url": st.public_url(f"{p.id}/{real}/{e['cog']}"),
                "legend": legend,
                "advisories": {str(k): v for k, v in p.advisories.get(e["id"], {}).items()} or None,
            }
        groups, used = [], set()
        for g in p.layer_groups:
            ids = [i for i in g.layers if i in layers]
            if ids:
                groups.append({"id": g.id, "label": g.label, "layers": ids})
                used.update(ids)
        rest = [i for i in layers if i not in used]
        if rest:
            groups.append({"id": "more", "label": {"en": "More layers", "sw": "Tabaka zaidi"}
                           if p.layer_groups else {"en": "Layers", "sw": "Tabaka"}, "layers": rest})
        order = {a.id: k for k, a in enumerate(p.admin_levels)}
        areas = sorted(cat.get("areas", []), key=lambda a: order.get(a["level"], 99))
        default = p.default_layer if p.default_layer in layers else next(iter(layers), None)
        response.headers["Cache-Control"] = SHORT if init == "latest" else IMMUTABLE
        return {
            "country": p.id, "init": real, "season": p.season_for(real),
            "valid_from": cat.get("valid_from"), "valid_to": cat.get("valid_to"),
            "members": cat.get("members"), "created": cat.get("created"),
            "bbox": list(p.map.bbox) if p.map.bbox else cat.get("bbox"),
            "grid": cat.get("grid"), "terciles": cat.get("terciles"),
            "layers": layers, "groups": groups, "default_layer": default,
            "areas": [{"level": a["level"], "label": p.level_label(a["level"]), "count": a.get("count"),
                       "summary_url": f"/api/countries/{p.id}/runs/{real}/areas/{a['level']}",
                       "boundaries_url": f"/api/countries/{p.id}/boundaries/{a['level']}"} for a in areas],
            "point_query": "layers" in cat.get("data", {}),
        }

    @app.get("/api/countries/{cid}/runs/{init}/areas/{level}")
    def area_summary(init: str, level: str, response: Response, p: Profile = Depends(profile_or_404),
                     st: Store = Depends(store)):
        real = resolve_init(p, init, st)
        try:
            data = st.json(f"{p.id}/{real}/areas/{level}.json")
        except NotFound:
            raise HTTPException(404, f"No {level} summaries for {p.id} {real}")
        response.headers["Cache-Control"] = SHORT if init == "latest" else IMMUTABLE
        return data

    @app.get("/api/countries/{cid}/boundaries/{level}")
    def boundaries(level: str, p: Profile = Depends(profile_or_404), st: Store = Depends(store)):
        try:
            path = st.path(f"{p.id}/boundaries/{level}.geojson")
        except NotFound:
            raise HTTPException(404, f"No {level} boundaries for {p.id}")
        return FileResponse(path, media_type="application/geo+json",
                            headers={"Cache-Control": "public, max-age=3600"})

    @app.get("/api/countries/{cid}/runs/{init}/point")
    def point(init: str, response: Response, lat: float = Query(..., ge=-90, le=90),
              lon: float = Query(..., ge=-180, le=180), p: Profile = Depends(profile_or_404),
              st: Store = Depends(store)):
        real = resolve_init(p, init, st)
        data = catalog(p, real, st).get("data", {})
        if "layers" not in data:
            raise HTTPException(404, "Point queries need a run published by agclimate-prep v8 or later")
        try:
            members = st.path(f"{p.id}/{real}/{data['members']}") if data.get("members") else None
            out = point_values(st.path(f"{p.id}/{real}/{data['layers']}"), members, lat, lon)
        except NotFound:
            raise HTTPException(404, "Point data missing for this run")
        if out is None:
            raise HTTPException(404, "Location outside the forecast grid")
        response.headers["Cache-Control"] = SHORT if init == "latest" else IMMUTABLE
        return {"country": p.id, "init": real, **out}

    @app.get("/api/files/{key:path}")
    def files(key: str, reg: ProfileRegistry = Depends(registry), st: Store = Depends(store)):
        """Layer files (COG + legend) when no PUBLIC_DATA_URL/CloudFront is set.
        Range requests are supported, which the browser's GeoTIFF reader uses."""
        cid = key.split("/", 1)[0]
        if cid not in reg.all() or not key.endswith(FILE_SUFFIXES):
            raise HTTPException(404, "Not found")
        try:
            path = st.path(key)
        except NotFound:
            raise HTTPException(404, "Not found")
        media = "image/tiff" if key.endswith((".tif", ".tiff")) else "application/json"
        return FileResponse(path, media_type=media, headers={"Cache-Control": IMMUTABLE})

    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
app = create_app()
