"""Join a country profile with what the pipeline published."""
from __future__ import annotations

from ..core.config import API_V1
from ..core.profiles import Profile
from ..core.storage import NotFound, Store


def country_summaries(profiles: dict[str, Profile], st: Store) -> list[dict]:
    out = []
    for p in profiles.values():
        if p.hidden:
            continue
        try:
            latest = st.json(f"{p.id}/latest.json")
            latest = {"init": latest["init"], "season": p.season_for(latest["init"])}
        except NotFound:
            latest = None
        out.append({"id": p.id, "name": p.name, "flag": p.flag, "iso2": p.iso2, "description": p.description,
                    "theme": p.theme.model_dump(exclude_none=True), "languages": p.languages,
                    "default_language": p.default_language, "latest": latest})
    return sorted(out, key=lambda c: c["name"] if isinstance(c["name"], str) else c["name"].get("en", c["id"]))


def run_list(p: Profile, st: Store) -> list[dict]:
    try:
        runs = st.json(f"{p.id}/runs.json")["runs"]
    except NotFound:
        runs = []
    return [{**r, "season": p.season_for(r["init"])} for r in runs]


WHOLE = "full"
WHOLE_LABEL = {"en": "Whole forecast", "sw": "Kipindi chote cha utabiri"}


def normalise_catalog(cat: dict) -> dict:
    """Catalogs before periods (v10 and older) become one 'full' period, so old runs still open."""
    if cat.get("periods"):
        return cat
    layers = [{**e, "id": e["id"], "base": e.get("base", e["id"]), "period": e.get("period", WHOLE)}
              for e in cat.get("layers", [])]
    areas = [{**a, "summaries": a.get("summaries") or ({WHOLE: a["summary"]} if a.get("summary") else {})}
             for a in cat.get("areas", [])]
    return {**cat, "layers": layers, "areas": areas, "default_period": WHOLE,
            "periods": [{"id": WHOLE, "kind": "window", "start": cat.get("valid_from"),
                         "end": cat.get("valid_to"), "days": cat.get("days")}]}


def period_label(p: Profile, per: dict) -> dict:
    if per["kind"] == "season":
        s = next((s for s in p.seasons if s.id == per["id"]), None)
        label = s.label if s else per.get("label", per["id"])
        return label if isinstance(label, dict) else {"en": label}
    if per["kind"] == "window":
        return WHOLE_LABEL
    return {"en": per.get("label", per["id"])}             # months: clients localise from `start`


def run_view(p: Profile, init: str, cat: dict, st: Store) -> dict:
    """Everything a client needs for one run: layers with legends, the layer
    menu, periods (seasons, months, whole forecast), admin levels and links."""
    cat = normalise_catalog(cat)
    base = f"{API_V1}/countries/{p.id}"
    from urllib.parse import quote
    ver = quote(str(cat.get("created") or ""), safe="")   # changes when the run is republished
    vq = f"v={ver}" if ver else ""
    layers, index = {}, {}
    for e in cat.get("layers", []):
        b, per = e.get("base", e["id"]), e.get("period", WHOLE)
        ov = p.layer_overrides.get(b)
        try:
            legend = dict(st.json(f"{p.id}/{init}/{e['legend']}"))
        except NotFound:
            legend = None
        if legend and ov and ov.classes and legend.get("classes"):
            legend["classes"] = [{**c, "label": ov.classes.get(int(c["value"]), c["label"])}
                                 for c in legend["classes"]]
        layers[e["id"]] = {
            "id": e["id"], "base": b, "period": per, "type": e["type"], "units": e.get("units", ""),
            "title": ov.title if ov and ov.title else e["title"],
            "description": ov.description if ov and ov.description else (legend or {}).get("description"),
            "cog_url": st.public_url(f"{p.id}/{init}/{e['cog']}") + (f"?{vq}" if vq else ""),
            "legend": legend,
            "advisories": {str(k): v for k, v in p.advisories.get(b, {}).items()} or None,
        }
        index.setdefault(b, {})[per] = e["id"]
    groups, used = [], set()
    for g in p.layer_groups:
        ids = [i for i in g.layers if i in index]
        if ids:
            groups.append({"id": g.id, "label": g.label, "layers": ids, "icon": g.icon or g.id})
            used.update(ids)
    rest = [i for i in index if i not in used]
    if rest:
        groups.append({"id": "more", "layers": rest, "icon": "layers",
                       "label": {"en": "More layers", "sw": "Tabaka zaidi"} if p.layer_groups
                       else {"en": "Layers", "sw": "Tabaka"}})
    periods = [{**per, "label": period_label(p, per)} for per in cat["periods"]
               if any(per["id"] in v for v in index.values())]
    pids = [x["id"] for x in periods]
    default_period = next((x for x in (p.default_period, cat.get("default_period")) if x in pids),
                          pids[0] if pids else None)
    menu = [b for g in groups for b in g["layers"]]
    prefs = [p.default_layer] if isinstance(p.default_layer, str) else list(p.default_layer or [])
    prefs = [b for b in prefs if b in index]
    default_layer = next((b for b in prefs if default_period in index[b]),
                         next((b for b in menu if default_period in index[b]), next(iter(index), None)))
    order = {a.id: k for k, a in enumerate(p.admin_levels)}
    areas = sorted(cat.get("areas", []), key=lambda a: order.get(a["level"], 99))
    return {
        "country": p.id, "init": init, "season": p.season_for(init),
        "valid_from": cat.get("valid_from"), "valid_to": cat.get("valid_to"),
        "members": cat.get("members"), "created": cat.get("created"), "version": cat.get("created"),
        "preview": bool(cat.get("preview")),
        "bbox": list(p.map.bbox) if p.map.bbox else cat.get("bbox"),
        "grid": cat.get("grid"), "terciles": cat.get("terciles"),
        "periods": periods, "default_period": default_period, "default_layers": prefs,
        "layers": layers, "index": index, "groups": groups, "default_layer": default_layer,
        "areas": [{"level": a["level"], "label": p.level_label(a["level"]), "count": a.get("count"),
                   "summary_url": f"{base}/runs/{init}/areas/{a['level']}" + (f"?{vq}" if vq else ""),
                   "summary_urls": {pid: f"{base}/runs/{init}/areas/{a['level']}?period={pid}" + (f"&{vq}" if vq else "")
                                    for pid in a.get("summaries", {})},
                   "boundaries_url": f"{base}/boundaries/{a['level']}"} for a in areas],
        "point_query": "layers" in cat.get("data", {}),
    }


def summary_key(cat: dict, level: str, period: str | None) -> tuple[str, str]:
    """(storage key relative to the run, period id) of an area summary file."""
    cat = normalise_catalog(cat)
    entry = next((a for a in cat.get("areas", []) if a["level"] == level), None)
    if entry is None:
        raise NotFound(level)
    summ = entry.get("summaries", {})
    pid = period if period in summ else (cat.get("default_period") if cat.get("default_period") in summ
                                         else next(iter(summ), None))
    if period and period not in summ:
        raise NotFound(f"{level}/{period}")
    if pid is None:
        raise NotFound(level)
    return summ[pid], pid
