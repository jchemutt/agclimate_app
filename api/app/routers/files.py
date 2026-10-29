from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.responses import FileResponse

from ..core.deps import DATED, IMMUTABLE, get_registry, get_store
from ..core.profiles import ProfileRegistry
from ..core.storage import NotFound, Store

router = APIRouter(tags=["Files"])
SUFFIXES = (".tif", ".tiff", ".json", ".geojson")


@router.get("/files/{key:path}", summary="Layer file (COG / legend)", response_class=FileResponse,
            responses={200: {"content": {"image/tiff": {}, "application/json": {}}}})
def files(key: str = Path(..., description="`<country>/<init>/layers/<id>.tif` as given in `cog_url`"),
          v: Optional[str] = Query(None, description="Run version from `cog_url` (cache key)"),
          reg: ProfileRegistry = Depends(get_registry), st: Store = Depends(get_store)):
    """Published layer files, when no CDN (PUBLIC_DATA_URL) is configured.
    Supports HTTP Range requests, which COG readers (GDAL, QGIS, rasterio, browsers) use."""
    if key.split("/", 1)[0] not in reg.all() or not key.endswith(SUFFIXES):
        raise HTTPException(404, "Not found")
    try:
        path = st.path(key)
    except NotFound:
        raise HTTPException(404, "Not found")
    media = "image/tiff" if key.endswith((".tif", ".tiff")) else "application/json"
    return FileResponse(path, media_type=media, headers={"Cache-Control": IMMUTABLE if v else DATED})
