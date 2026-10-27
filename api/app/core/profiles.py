"""Country profiles: everything country-specific the interface needs.

One YAML file per country in PROFILES_DIR (`kenya.yaml`, `rwanda.yaml`, ...).
Files starting with `_` are templates and ignored. The registry re-scans the
folder when a file is added, changed or removed, so adding a country needs no
restart and no code change.

Any text shown to users may be a plain string or a per-language map:
    label: County
    label: {en: County, sw: Kaunti}
"""
from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Annotated, Union

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

LOG = logging.getLogger("agclimate.profiles")

Text = Union[str, dict[str, str]]
Month = Annotated[int, Field(ge=1, le=12)]


class _M(BaseModel):
    model_config = ConfigDict(extra="forbid")


class MapConfig(_M):
    center: tuple[float, float] | None = None          # lon, lat
    zoom: float = 6
    bbox: tuple[float, float, float, float] | None = None   # lon0, lat0, lon1, lat1
    basemap: str | None = None                          # XYZ url template; default from the app


class AdminLevel(_M):
    id: str                                             # matches the boundaries level in the pipeline
    label: Text


class Season(_M):
    id: str
    label: Text
    start_months: list[Month]                           # forecast start months that belong to this season


class LayerGroup(_M):
    id: str
    label: Text
    layers: list[str]


class LayerOverride(_M):
    title: Text | None = None
    description: Text | None = None
    classes: dict[int, Text] | None = None              # categorical class labels


class Link(_M):
    name: Text
    url: str


class Profile(_M):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]*$")   # = pipeline domain: published/<id>/
    name: Text
    flag: str = ""
    languages: list[str] = ["en"]
    default_language: str | None = None
    map: MapConfig = MapConfig()
    admin_levels: list[AdminLevel] = []
    seasons: list[Season] = []
    default_season_label: Text = {"en": "Seasonal outlook"}
    layer_groups: list[LayerGroup] = []
    default_layer: str | None = None
    layer_overrides: dict[str, LayerOverride] = {}
    # layer id -> class value -> message (e.g. what an "Alert" means for farmers here)
    advisories: dict[str, dict[int, Text]] = {}
    links: list[Link] = []
    attribution: Text | None = None
    hidden: bool = False                                # keep the profile but hide it from the list

    @field_validator("languages")
    @classmethod
    def _langs(cls, v):
        if not v:
            raise ValueError("at least one language")
        return v

    @model_validator(mode="after")
    def _defaults(self):
        if self.default_language is None:
            self.default_language = self.languages[0]
        if self.default_language not in self.languages:
            raise ValueError(f"default_language {self.default_language!r} not in languages")
        months = [m for s in self.seasons for m in s.start_months]
        if len(months) != len(set(months)):
            raise ValueError("a start month belongs to more than one season")
        return self

    def season_for(self, init: str) -> dict:
        month = int(init[5:7])
        for s in self.seasons:
            if month in s.start_months:
                return {"id": s.id, "label": s.label}
        return {"id": None, "label": self.default_season_label}

    def level_label(self, level: str) -> Text:
        for a in self.admin_levels:
            if a.id == level:
                return a.label
        return level.replace("_", " ").title()


def text(value: Text | None, lang: str, fallback: str = "en") -> str | None:
    """Resolve a Text in one language (used by tests and server-side messages)."""
    if value is None or isinstance(value, str):
        return value
    return value.get(lang) or value.get(fallback) or next(iter(value.values()), None)


class ProfileRegistry:
    def __init__(self, folder: Path):
        self.folder = Path(folder)
        self._lock = threading.Lock()
        self._stamp: tuple | None = None
        self._profiles: dict[str, Profile] = {}
        self.errors: dict[str, str] = {}

    def _scan_stamp(self) -> tuple:
        if not self.folder.is_dir():
            return ()
        return tuple(sorted((p.name, p.stat().st_mtime_ns) for p in self.folder.glob("*.y*ml")))

    def _reload(self) -> None:
        profiles, errors = {}, {}
        for path in sorted(self.folder.glob("*.y*ml")) if self.folder.is_dir() else []:
            if path.name.startswith("_"):
                continue
            try:
                p = Profile.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")) or {})
                if p.id in profiles:
                    raise ValueError(f"duplicate id {p.id!r}")
                if path.stem != p.id:
                    LOG.warning("%s: id %r differs from the file name", path.name, p.id)
                profiles[p.id] = p
            except (ValidationError, ValueError, yaml.YAMLError) as e:
                errors[path.name] = str(e)
                LOG.error("Invalid profile %s: %s", path.name, e)
        self._profiles, self.errors = profiles, errors
        LOG.info("Profiles loaded: %s", ", ".join(profiles) or "none")

    def all(self) -> dict[str, Profile]:
        stamp = self._scan_stamp()
        with self._lock:
            if stamp != self._stamp:
                self._reload()
                self._stamp = stamp
            return self._profiles

    def get(self, cid: str) -> Profile | None:
        return self.all().get(cid)
