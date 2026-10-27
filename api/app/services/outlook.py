"""Human-ready outlooks for one area or point, in one language.

Used by integrations (chatbots, SMS, other platforms) that want text and
labels rather than map styling."""
from __future__ import annotations

import csv
import io
from datetime import date, timedelta

from ..core.profiles import Profile, text

ADVISORY_LAYER = "advisory_class"


def _order(view: dict) -> list[str]:
    return [i for g in view["groups"] for i in g["layers"]]


def area_number(v: dict | None) -> float | None:
    if not v:
        return None
    if "majority" in v:
        return v["majority"]
    return v.get("mean")


def items_for(view: dict, values: dict[str, float | None], lang: str) -> tuple[list[dict], dict | None]:
    """Outlook items for every layer, plus the advisory (class, label, message)."""
    items, advisory = [], None
    start = date.fromisoformat(view["init"])
    for lid in _order(view):
        info = view["layers"][lid]
        lg = info.get("legend") or {}
        v = values.get(lid)
        item = {"id": lid, "title": text(info["title"], lang) or lid,
                "value": None if v is None else round(float(v), 3), "units": info.get("units") or ""}
        if v is not None and lg.get("classes"):
            cls = next((c for c in lg["classes"] if c["value"] == round(v)), None)
            if cls:
                item["label"] = text(cls["label"], lang)
                if lid == ADVISORY_LAYER:
                    msg = (info.get("advisories") or {}).get(str(cls["value"]))
                    advisory = {"value": int(cls["value"]), "label": item["label"],
                                "message": text(msg, lang), "color": cls.get("color")}
        if v is not None and lg.get("format") == "days_from_init":
            item["date"] = (start + timedelta(days=round(v))).isoformat()
            item["units"] = "days after start"
        items.append(item)
    return items, advisory


def parents_of(area: dict, summaries_above: list[dict]) -> list[str]:
    """Names of enclosing areas, nearest first. summaries_above: level summaries, nearest level first."""
    out, pid = [], area.get("parent_id")
    for summ in summaries_above:
        if not pid:
            break
        rec = next((a for a in summ["areas"] if a["id"] == pid), None)
        if not rec:
            break
        out.append(rec["name"])
        pid = rec.get("parent_id")
    return out


def areas_csv(view: dict, summary: dict, lang: str) -> str:
    """One row per area: id, name, parent and each layer's value (mean, or class label)."""
    order = [l for l in _order(view) if l in summary.get("layers", view["layers"])]
    buf = io.StringIO()
    w = csv.writer(buf)
    titles = [text(view["layers"][l]["title"], lang) for l in order]
    w.writerow(["id", "name", "parent_id"] + titles)
    for a in summary["areas"]:
        row = [a["id"], a["name"], a.get("parent_id") or ""]
        for l in order:
            items, _ = items_for({**view, "groups": [{"layers": [l]}]}, {l: area_number(a["values"].get(l))}, lang)
            it = items[0]
            row.append(it.get("label") or it.get("date") or ("" if it["value"] is None else it["value"]))
        w.writerow(row)
    return buf.getvalue()


def pick_language(p: Profile, lang: str | None) -> str:
    return lang if lang in p.languages else p.default_language
