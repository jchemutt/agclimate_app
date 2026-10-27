from fastapi import APIRouter, Depends, Response

from ..core.deps import cache, get_profile, get_registry, get_store
from ..core.profiles import Profile, ProfileRegistry
from ..core.storage import Store
from ..schemas import CountrySummary
from ..services.runs import country_summaries

router = APIRouter(tags=["Countries"])


@router.get("/countries", response_model=list[CountrySummary], summary="List countries")
def list_countries(response: Response, reg: ProfileRegistry = Depends(get_registry),
                   st: Store = Depends(get_store)):
    """Every country with a profile, and its newest published run (null until the first run)."""
    cache(response)
    return country_summaries(reg.all(), st)


@router.get("/countries/{cid}", response_model=Profile, summary="Country profile")
def get_country(response: Response, p: Profile = Depends(get_profile)):
    """The country profile: languages, admin levels, seasons, layer menu, advisory messages."""
    cache(response)
    return p
