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


def items_for(view: dict, values: dict[str, float | None], lang: str,
              period: str | None = None) -> tuple[list[dict], dict | None]:
    """Outlook items for every layer of one period (default: the run's default period),
    plus the advisory (class, label, message) when that period has one."""
    items, advisory = [], None
    start = date.fromisoformat(view["init"])
    period = period or view.get("default_period")
    index = view.get("index") or {k: {period: k} for k in view["layers"]}
    for b in _order(view):
        lid = index.get(b, {}).get(period)
        if lid is None:
            continue
        info = view["layers"][lid]
        lg = info.get("legend") or {}
        v = values.get(lid)
        item = {"id": lid, "base": b, "period": period, "title": text(info["title"], lang) or lid,
                "value": None if v is None else round(float(v), 3), "units": info.get("units") or ""}
        if v is not None and lg.get("classes"):
            cls = next((c for c in lg["classes"] if c["value"] == round(v)), None)
            if cls:
                item["label"] = text(cls["label"], lang)
                if b == ADVISORY_LAYER:
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


def areas_csv(view: dict, summary: dict, lang: str, period: str | None = None) -> str:
    """One row per area: id, name, parent and each layer's value (mean, or class label)."""
    period = period or summary.get("period") or view.get("default_period")
    index = view.get("index") or {k: {period: k} for k in view["layers"]}
    have = set(summary.get("layers", view["layers"]))
    order = [index[b][period] for b in _order(view) if index.get(b, {}).get(period) in have]
    buf = io.StringIO()
    w = csv.writer(buf)
    titles = [text(view["layers"][l]["title"], lang) for l in order]
    w.writerow(["id", "name", "parent_id"] + titles)
    for a in summary["areas"]:
        row = [a["id"], a["name"], a.get("parent_id") or ""]
        for l in order:
            b = view["layers"][l].get("base", l)
            items, _ = items_for({**view, "groups": [{"layers": [b]}]}, {l: area_number(a["values"].get(l))},
                                 lang, period)
            it = items[0]
            row.append(it.get("label") or it.get("date") or ("" if it["value"] is None else it["value"]))
        w.writerow(row)
    return buf.getvalue()


def pick_language(p: Profile, lang: str | None) -> str:
    return lang if lang in p.languages else p.default_language
