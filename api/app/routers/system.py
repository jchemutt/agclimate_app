from fastapi import APIRouter, Depends

from .. import __version__
from ..core.deps import get_registry, get_store
from ..core.profiles import ProfileRegistry
from ..core.storage import Store
from ..schemas import Health

router = APIRouter(tags=["System"])


@router.get("/health", response_model=Health, summary="Service status")
def health(reg: ProfileRegistry = Depends(get_registry), st: Store = Depends(get_store)):
    """Loaded countries, and any profile files that failed validation."""
    return {"status": "ok", "version": __version__, "storage": st.kind,
            "countries": sorted(reg.all()), "invalid_profiles": reg.errors}
