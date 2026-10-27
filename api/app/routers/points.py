from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from ..core.deps import INIT_PARAM, cache, get_profile, get_store, load_catalog, resolve_init
from ..core.profiles import Profile
from ..core.storage import NotFound, Store
from ..schemas import PointResult
from ..services.outlook import items_for, pick_language
from ..services.points import point_values
from ..services.runs import run_view

router = APIRouter(tags=["Points"])


@router.get("/countries/{cid}/runs/{init}/point", response_model=PointResult, summary="Outlook at a location")
def point(response: Response, init: str = INIT_PARAM,
          lat: float = Query(..., ge=-90, le=90, description="Latitude (WGS84)", examples=[-0.3]),
          lon: float = Query(..., ge=-180, le=180, description="Longitude (WGS84)", examples=[37.07]),
          lang: Optional[str] = Query(None, description="Language for titles and advisory text"),
          p: Profile = Depends(get_profile), st: Store = Depends(get_store)):
    """Every map layer at the grid cell containing the point, each ensemble member's
    value, the rainfall tercile thresholds, and the advisory in the requested language.
    `inside` is false over sea or outside the country."""
    real = resolve_init(p, init, st)
    cat = load_catalog(p, real, st)
    data = cat.get("data", {})
    if "layers" not in data:
        raise HTTPException(404, "Point queries need a run published by agclimate-prep v8 or later")
    try:
        members = st.path(f"{p.id}/{real}/{data['members']}") if data.get("members") else None
        out = point_values(st.path(f"{p.id}/{real}/{data['layers']}"), members, lat, lon)
    except NotFound:
        raise HTTPException(404, "Point data missing for this run")
    if out is None:
        raise HTTPException(404, "Location outside the forecast grid")
    language = pick_language(p, lang)
    items, advisory = items_for(run_view(p, real, cat, st), out["layers"], language) if out["inside"] else ([], None)
    cache(response, init)
    return {"country": p.id, "init": real, **out, "language": language, "advisory": advisory, "items": items}
