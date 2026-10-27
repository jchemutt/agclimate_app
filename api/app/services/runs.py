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


def run_view(p: Profile, init: str, cat: dict, st: Store) -> dict:
    """Everything a client needs for one run: layers with legends, the layer
    menu, admin levels with their labels, and links to the other resources."""
    base = f"{API_V1}/countries/{p.id}"
    layers = {}
    for e in cat.get("layers", []):
        ov = p.layer_overrides.get(e["id"])
        try:
            legend = dict(st.json(f"{p.id}/{init}/{e['legend']}"))
        except NotFound:
            legend = None
        if legend and ov and ov.classes and legend.get("classes"):
            legend["classes"] = [{**c, "label": ov.classes.get(int(c["value"]), c["label"])}
                                 for c in legend["classes"]]
        layers[e["id"]] = {
            "id": e["id"], "type": e["type"], "units": e.get("units", ""),
            "title": ov.title if ov and ov.title else e["title"],
            "description": ov.description if ov and ov.description else (legend or {}).get("description"),
            "cog_url": st.public_url(f"{p.id}/{init}/{e['cog']}"),
            "legend": legend,
            "advisories": {str(k): v for k, v in p.advisories.get(e["id"], {}).items()} or None,
        }
    groups, used = [], set()
    for g in p.layer_groups:
        ids = [i for i in g.layers if i in layers]
        if ids:
            groups.append({"id": g.id, "label": g.label, "layers": ids, "icon": g.icon or g.id})
            used.update(ids)
    rest = [i for i in layers if i not in used]
    if rest:
        groups.append({"id": "more", "layers": rest, "icon": "layers",
                       "label": {"en": "More layers", "sw": "Tabaka zaidi"} if p.layer_groups
                       else {"en": "Layers", "sw": "Tabaka"}})
    order = {a.id: k for k, a in enumerate(p.admin_levels)}
    areas = sorted(cat.get("areas", []), key=lambda a: order.get(a["level"], 99))
    return {
        "country": p.id, "init": init, "season": p.season_for(init),
        "valid_from": cat.get("valid_from"), "valid_to": cat.get("valid_to"),
        "members": cat.get("members"), "created": cat.get("created"),
        "bbox": list(p.map.bbox) if p.map.bbox else cat.get("bbox"),
        "grid": cat.get("grid"), "terciles": cat.get("terciles"),
        "layers": layers, "groups": groups,
        "default_layer": p.default_layer if p.default_layer in layers else next(iter(layers), None),
        "areas": [{"level": a["level"], "label": p.level_label(a["level"]), "count": a.get("count"),
                   "summary_url": f"{base}/runs/{init}/areas/{a['level']}",
                   "boundaries_url": f"{base}/boundaries/{a['level']}"} for a in areas],
        "point_query": "layers" in cat.get("data", {}),
    }
