from fastapi import APIRouter, Depends, Response

from ..core.deps import INIT_PARAM, cache, get_profile, get_store, load_catalog, resolve_init
from ..core.profiles import Profile
from ..core.storage import Store
from ..schemas import RunListItem, RunView
from ..services.runs import run_list, run_view

router = APIRouter(tags=["Forecast runs"])


@router.get("/countries/{cid}/runs", response_model=list[RunListItem], summary="List forecast runs")
def list_runs(response: Response, p: Profile = Depends(get_profile), st: Store = Depends(get_store)):
    """Published runs, newest first, with their season."""
    cache(response)
    return run_list(p, st)


@router.get("/countries/{cid}/runs/{init}", response_model=RunView, summary="One forecast run")
def get_run(response: Response, init: str = INIT_PARAM, p: Profile = Depends(get_profile),
            st: Store = Depends(get_store)):
    """Layers (with legends and COG links), layer groups, admin levels and links to
    area summaries and boundaries, in one response. Use `latest` for the newest run."""
    real = resolve_init(p, init, st)
    cache(response, init)
    return run_view(p, real, load_catalog(p, real, st), st)
