"""Response models. They define the public contract shown in Swagger
(/api/docs) and are what other systems should code against."""
from __future__ import annotations

from typing import Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

Text = Union[str, dict[str, str]]
"""Plain text, or a map of language code -> text, e.g. {"en": "County", "sw": "Kaunti"}."""


class _Out(BaseModel):
    model_config = ConfigDict(extra="allow")


# ------------------------------------------------------------------ system
class Health(BaseModel):
    status: Literal["ok"]
    version: str
    storage: Literal["local", "s3"]
    countries: list[str]
    invalid_profiles: dict[str, str] = Field(description="Profile files that failed validation, with the error")


# ------------------------------------------------------------------ countries
class Season(BaseModel):
    id: Optional[str] = Field(None, description="Season id from the profile, e.g. `OND`; null if the month has none")
    label: Text


class LatestRun(BaseModel):
    init: str = Field(examples=["2026-10-01"])
    season: Season


class CountrySummary(BaseModel):
    id: str = Field(examples=["kenya"])
    name: Text
    flag: str
    iso2: Optional[str] = None
    description: Optional[Text] = None
    theme: Optional[dict] = None
    languages: list[str]
    default_language: str
    latest: Optional[LatestRun] = Field(None, description="Newest published run; null until the first run")


# ------------------------------------------------------------------ runs
class RunListItem(_Out):
    init: str = Field(examples=["2026-10-01"])
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    catalog: Optional[str] = None
    created: Optional[str] = None
    season: Season


class LegendStop(BaseModel):
    value: float
    color: str


class LegendClass(BaseModel):
    value: int
    label: Text
    color: str


class Legend(_Out):
    id: str
    type: Literal["continuous", "categorical"]
    title: Optional[Text] = None
    units: Optional[str] = None
    format: Optional[str] = Field(None, description="`days_from_init`: value is days after the forecast start")
    range: Optional[list[float]] = None
    stops: Optional[list[LegendStop]] = None
    classes: Optional[list[LegendClass]] = None


class LayerInfo(BaseModel):
    id: str = Field(examples=["rainfall_total__OND"], description="`<base>__<period>`")
    base: str = Field(examples=["rainfall_total"], description="Indicator, as used in the layer menu")
    period: str = Field(examples=["OND"], description="Period id from `periods`")
    type: Literal["continuous", "categorical"]
    units: str
    title: Text
    description: Optional[Text] = None
    cog_url: str = Field(description="Cloud-optimised GeoTIFF (EPSG:4326) of the layer")
    legend: Optional[Legend] = None
    advisories: Optional[dict[str, Text]] = Field(None, description="Advisory message per class value")


class LayerGroup(BaseModel):
    id: str
    label: Text
    layers: list[str] = Field(description="Indicator (base) ids; see `index` for the layer per period")
    icon: Optional[str] = None


class AreaLevel(BaseModel):
    level: str = Field(examples=["county"])
    label: Text
    count: Optional[int] = None
    summary_url: str = Field(description="Summaries for the default period")
    summary_urls: dict[str, str] = Field({}, description="Summaries per period id")
    boundaries_url: str


class Period(BaseModel):
    id: str = Field(examples=["OND"], description="Season id, month (`2026-11`) or `full`")
    kind: Literal["season", "month", "window"]
    label: Text
    start: Optional[str] = None
    end: Optional[str] = None
    days: Optional[int] = None
    months: Optional[list[str]] = None


class RunView(BaseModel):
    country: str
    init: str
    season: Season
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    members: Optional[int] = Field(None, description="Ensemble members")
    created: Optional[str] = None
    bbox: Optional[list[float]] = Field(None, description="lon0, lat0, lon1, lat1")
    grid: Optional[dict] = None
    terciles: Optional[dict] = Field(None, description="Baseline used for the tercile categories")
    preview: bool = Field(False, description="Published before all variables arrived (e.g. temperature only)")
    periods: list[Period] = []
    default_period: Optional[str] = None
    layers: dict[str, LayerInfo]
    index: dict[str, dict[str, str]] = Field({}, description="base -> period -> layer id")
    groups: list[LayerGroup]
    default_layer: Optional[str] = Field(None, description="Base id for the default period")
    default_layers: list[str] = Field([], description="Preferred bases in order; clients pick the first "
                                                      "the chosen period has")
    areas: list[AreaLevel]
    point_query: bool = Field(description="Whether /point is available for this run")


# ------------------------------------------------------------------ outlooks (integration)
class OutlookItem(BaseModel):
    """One layer at one place, ready to show or send (titles in the requested language)."""
    id: str
    base: Optional[str] = None
    period: Optional[str] = None
    title: str
    value: Optional[float] = Field(None, description="Raw value (area mean, or class for categorical layers)")
    units: str = ""
    label: Optional[str] = Field(None, description="Class name for categorical layers")
    date: Optional[str] = Field(None, description="ISO date for day-count layers such as onset")


class Advisory(BaseModel):
    value: int = Field(description="Advisory class: 0 Normal, 1 Watch, 2 Alert, 3 Emergency")
    label: str
    message: Optional[str] = None
    color: Optional[str] = None


class AreaRecord(_Out):
    id: str = Field(examples=["baringo/baringo-central/kabarnet"])
    name: str
    parent_id: Optional[str] = None
    values: dict[str, Optional[dict]] = Field(description="Per layer: {mean,min,max} or {majority,share}")
    coverage: Optional[float] = Field(None, description="% of the area covered by forecast cells")


class AreaSummary(_Out):
    level: str
    period: Optional[str] = None
    areas: list[AreaRecord]


class AreaOutlook(BaseModel):
    country: str
    init: str
    season: Season
    language: str
    level: str
    level_label: str
    period: Optional[str] = None
    id: str
    name: str
    parents: list[str] = Field(description="Names of the enclosing areas, nearest first")
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    advisory: Optional[Advisory] = None
    items: list[OutlookItem]


class SeriesMonth(BaseModel):
    id: str = Field(examples=["2026-11"])
    start: Optional[str] = None
    end: Optional[str] = None


class AreaSeries(BaseModel):
    country: str
    init: str
    level: str
    id: str
    name: Optional[str] = None
    months: list[SeriesMonth]
    series: dict[str, list[Optional[float]]] = Field(description="Indicator (base) -> one value per month "
                                                                  "(area mean, or majority class)")


class Terciles(BaseModel):
    p33: Optional[float] = Field(None, description="Lower tercile of 1991-2020 rainfall for the same weeks (mm)")
    p66: Optional[float] = Field(None, description="Upper tercile (mm)")
    bn: Optional[float] = Field(None, description="% chance below normal")
    nn: Optional[float] = Field(None, description="% chance near normal")
    an: Optional[float] = Field(None, description="% chance above normal")


class PointResult(BaseModel):
    country: str
    init: str
    lat: float = Field(description="Centre of the grid cell used")
    lon: float
    inside: bool = Field(description="False over sea / outside the country")
    layers: dict[str, Optional[float]] = Field(description="Map values at this cell, by layer id")
    members: Optional[dict[str, list[Optional[float]]]] = Field(None, description="Each ensemble member's value")
    terciles: Optional[Terciles] = None
    language: Optional[str] = None
    period: Optional[str] = None
    advisory: Optional[Advisory] = None
    items: list[OutlookItem] = []
