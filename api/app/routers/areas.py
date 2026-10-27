from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Response
from fastapi.responses import FileResponse, PlainTextResponse

from ..core.deps import INIT_PARAM, cache, get_profile, get_store, load_catalog, resolve_init
from ..core.profiles import Profile, text
from ..core.storage import NotFound, Store
from ..schemas import AreaOutlook, AreaSummary
from ..services.outlook import area_number, areas_csv, items_for, parents_of, pick_language
from ..services.runs import run_view, summary_key

router = APIRouter(tags=["Areas"])
LEVEL = Path(..., description="Admin level id from the run's `areas`, e.g. `county`", examples=["county"])
LANG = Query(None, description="Language code from the profile (e.g. `en`, `sw`); default: the profile's default")
PERIOD = Query(None, description="Period id from the run's `periods`: a season (`OND`), a month (`2026-11`) "
                                 "or `full` (whole forecast). Default: the run's default period",
               examples=["OND"])


def _summary(p: Profile, init: str, level: str, st: Store, period: str | None = None) -> dict:
    try:
        key, pid = summary_key(load_catalog(p, init, st), level, period)
        data = st.json(f"{p.id}/{init}/{key}")
    except NotFound:
        raise HTTPException(404, f"No {level} summaries for {p.id} {init}" + (f" period {period}" if period else ""))
    return {**data, "period": pid}


@router.get("/countries/{cid}/boundaries/{level}", summary="Boundaries (GeoJSON)",
            response_class=FileResponse,
            responses={200: {"content": {"application/geo+json": {}}, "description": "FeatureCollection; "
                             "properties: id, name, parent_id"}})
def boundaries(level: str = LEVEL, p: Profile = Depends(get_profile), st: Store = Depends(get_store)):
    """Simplified admin boundaries for one level. Feature `id` matches the area ids in summaries."""
    try:
        path = st.path(f"{p.id}/boundaries/{level}.geojson")
    except NotFound:
        raise HTTPException(404, f"No {level} boundaries for {p.id}")
    return FileResponse(path, media_type="application/geo+json", headers={"Cache-Control": "public, max-age=3600"})


@router.get("/countries/{cid}/runs/{init}/areas/{level}", response_model=AreaSummary,
            summary="Area summaries for one level",
            responses={200: {"content": {"text/csv": {}}, "description": "JSON, or CSV with `format=csv`"}})
def area_summaries(response: Response, init: str = INIT_PARAM, level: str = LEVEL,
                   q: Optional[str] = Query(None, description="Filter: area name contains this text (any case)"),
                   parent: Optional[str] = Query(None, description="Filter: only areas inside this parent id"),
                   format: Literal["json", "csv"] = Query("json", description="`csv` for a spreadsheet"),
                   lang: Optional[str] = LANG, period: Optional[str] = PERIOD,
                   p: Profile = Depends(get_profile), st: Store = Depends(get_store)):
    """Every area's value for every layer of one period: mean/min/max for continuous
    layers, majority class and class shares for categorical ones. Keys are layer ids
    (`<base>__<period>`)."""
    real = resolve_init(p, init, st)
    data = _summary(p, real, level, st, period)
    if q or parent:
        ql = (q or "").lower()
        data = {**data, "areas": [a for a in data["areas"]
                                  if (not q or ql in a["name"].lower())
                                  and (not parent or a.get("parent_id") == parent
                                       or (a.get("parent_id") or "").startswith(parent + "/"))]}
    if format == "csv":
        view = run_view(p, real, load_catalog(p, real, st), st)
        body = areas_csv(view, data, pick_language(p, lang), data["period"])
        return PlainTextResponse(body, media_type="text/csv", headers={
            "Content-Disposition": f'attachment; filename="{p.id}_{real}_{data["period"]}_{level}.csv"',
            "Cache-Control": "public, max-age=60" if init == "latest" else "public, max-age=86400"})
    cache(response, init)
    return data


@router.get("/countries/{cid}/runs/{init}/areas/{level}/{area_id:path}", response_model=AreaOutlook,
            summary="Outlook for one area")
def area_outlook(response: Response, init: str = INIT_PARAM, level: str = LEVEL,
                 area_id: str = Path(..., description="Area id, e.g. `baringo` or `baringo/baringo-central`",
                                     examples=["baringo"]),
                 lang: Optional[str] = LANG, period: Optional[str] = PERIOD,
                 p: Profile = Depends(get_profile), st: Store = Depends(get_store)):
    """Advisory class and message plus every layer's value for one area and period, with titles,
    class names and dates in the requested language. Suited to chatbots, SMS and
    other systems that need text rather than maps."""
    real = resolve_init(p, init, st)
    cat = load_catalog(p, real, st)
    view = run_view(p, real, cat, st)
    summ = _summary(p, real, level, st, period)
    rec = next((a for a in summ["areas"] if a["id"] == area_id), None)
    if rec is None:
        raise HTTPException(404, f"No {level} {area_id!r} in {p.id}")
    language = pick_language(p, lang)
    items, advisory = items_for(view, {k: area_number(v) for k, v in rec["values"].items()}, language,
                                summ["period"])
    levels = [a["level"] for a in view["areas"]]
    above = []
    for lv in reversed(levels[:levels.index(level)] if level in levels else []):
        try:
            above.append(_summary(p, real, lv, st, summ["period"]))
        except HTTPException:
            break
    cache(response, init)
    return {"country": p.id, "init": real, "season": view["season"], "language": language,
            "level": level, "level_label": text(p.level_label(level), language), "period": summ["period"],
            "id": rec["id"], "name": rec["name"], "parents": parents_of(rec, above),
            "valid_from": view["valid_from"], "valid_to": view["valid_to"],
            "advisory": advisory, "items": items}
