"""AgClimate AF API: application factory.

Layout
  core/      configuration, storage (local / S3), country profiles, shared dependencies
  services/  logic: joining profiles with published runs, outlooks, point reads
  schemas/   response models (the public contract shown in Swagger)
  routers/   one module per resource, all under /api/v1

Nothing country-specific lives in the code: a country appears as soon as its
profile exists, and shows forecasts once the pipeline has published.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import RedirectResponse
from fastapi.routing import APIRoute

from . import __version__
from .core.config import API_V1, Settings, get_settings
from .routers import areas, countries, files, points, runs, system

DESCRIPTION = """
Seasonal agro-climate outlooks (rainfall, drought, heat, rainy-season onset and
advisories) from the AgClimate AF pipeline, per country, per admin area and per
grid cell. Data are public and read-only; responses are JSON unless stated.

**Typical integration flow**

1. `GET /api/v1/countries`: which countries exist, and their latest run.
2. `GET /api/v1/countries/{cid}/runs/latest`: layers, legends, admin levels.
3. Then either
   * `GET .../runs/latest/areas/{level}?q=<name>` to find an area, and
     `GET .../runs/latest/areas/{level}/{area_id}?lang=sw` for its advisory and
     values as text; or
   * `GET .../runs/latest/point?lat=..&lon=..&lang=en` for a location.
4. Bulk: `GET .../runs/latest/areas/{level}?format=csv`, or read the COG files
   (`cog_url`) directly in GIS software.

`latest` always means the newest run. Dated runs (`2026-10-01`) never change and
can be cached indefinitely.
"""

TAGS = [
    {"name": "Countries", "description": "Countries and their profiles."},
    {"name": "Forecast runs", "description": "Monthly forecast runs and their layers."},
    {"name": "Areas", "description": "Admin-area summaries, outlooks and boundaries."},
    {"name": "Points", "description": "Values at a location."},
    {"name": "Files", "description": "Raw layer files (Cloud-optimised GeoTIFF)."},
    {"name": "System", "description": "Service status."},
]


def _operation_id(route: APIRoute) -> str:
    return route.name          # stable, readable names for generated clients


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title="AgClimate AF API", version=__version__, description=DESCRIPTION, openapi_tags=TAGS,
        docs_url="/api/docs", redoc_url="/api/redoc", openapi_url="/api/openapi.json",
        generate_unique_id_function=_operation_id,
        contact={"name": "Alliance of Bioversity International and CIAT"},
    )
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=list(settings.cors_origins),
                           allow_methods=["GET"], allow_headers=["*"], expose_headers=["Content-Range"])
    for r in (countries, runs, areas, points, files, system):
        app.include_router(r.router, prefix=API_V1)

    @app.get("/api", include_in_schema=False)
    def docs_redirect():
        return RedirectResponse("/api/docs")

    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s - %(message)s")
app = create_app()
