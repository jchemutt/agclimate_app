"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { AreaRecord, AreaSummary, LayerInfo, RunView } from "@/lib/types";
import { t, tx } from "@/lib/i18n";
import { areaNumber, fmtValue } from "@/lib/format";

const ADVISORY = "advisory_class";

interface Props {
  run: RunView;
  lang: string;
  level: string;
  onLevel: (level: string) => void;
  summary: AreaSummary | null;
  layer: LayerInfo | null;
  selectedId: string | null;
  onPick: (level: string, id: string) => void;
}

function severity(a: AreaRecord): [number, number] {
  const v = a.values[ADVISORY];
  if (!v || !("majority" in v)) return [-1, 0];
  const bad = Object.entries(v.share ?? {}).reduce((s, [k, f]) => (Number(k) >= 2 ? s + f : s), 0);
  return [v.majority, bad];
}

function parentHint(id: string) {
  return id.split("/").slice(0, -1).reverse()
    .map((s) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())).join(", ");
}

export default function AreasPanel({ run, lang, level, onLevel, summary, layer, selectedId, onPick }: Props) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const adv = run.layers[ADVISORY]?.legend ?? null;
  const classes = adv?.classes ?? [];

  const counts = useMemo(() => {
    const c: Record<number, number> = {};
    summary?.areas.forEach((a) => {
      const v = a.values[ADVISORY];
      if (v && "majority" in v) c[v.majority] = (c[v.majority] ?? 0) + 1;
    });
    return c;
  }, [summary]);
  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  const rows = useMemo(() => {
    if (!summary) return [];
    const ql = q.trim().toLowerCase();
    if (ql) return summary.areas.filter((a) => a.name.toLowerCase().includes(ql)).slice(0, 50);
    const sorted = [...summary.areas].sort((a, b) => {
      const [ma, ba] = severity(a), [mb, bb] = severity(b);
      return mb - ma || bb - ba || a.name.localeCompare(b.name);
    });
    return all ? sorted : sorted.slice(0, 12);
  }, [summary, q, all]);

  const levelLabel = tx(run.areas.find((a) => a.level === level)?.label, lang);

  return (
    <div className="areas-panel">
      <div className="seg" role="group" aria-label={t(lang, "showBy")}>
        {run.areas.map((a) => (
          <button key={a.level} type="button" className={a.level === level ? "is-on" : ""}
                  aria-pressed={a.level === level} onClick={() => onLevel(a.level)}>
            {tx(a.label, lang)}
          </button>
        ))}
      </div>

      {adv && total ? (
        <section className="card">
          <h3 className="card-title">{tx(run.layers[ADVISORY].title, lang)}</h3>
          <div className="distbar" role="img"
               aria-label={classes.map((c) => `${tx(c.label, lang)}: ${counts[c.value] ?? 0}`).join(", ")}>
            {classes.map((c) => counts[c.value] ? (
              <span key={c.value} style={{ flexGrow: counts[c.value], background: c.color }} />
            ) : null)}
          </div>
          <ul className="dist-legend">
            {classes.map((c) => (
              <li key={c.value}>
                <span className="swatch" style={{ background: c.color }} />
                <span>{tx(c.label, lang)}</span>
                <strong>{counts[c.value] ?? 0}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <label className="search">
        <Search size={16} aria-hidden />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
               placeholder={`${t(lang, "search")} ${levelLabel.toLowerCase()}`} aria-label={t(lang, "search")} />
      </label>

      <h3 className="list-title">{q ? t(lang, "results") : t(lang, "needsAttention")}</h3>
      {!summary ? <p className="muted small">{t(lang, "loading")}</p> : null}
      {summary && q && !rows.length ? <p className="muted small">{t(lang, "noMatch")}</p> : null}
      <ul className="area-list">
        {rows.map((a) => {
          const [m] = severity(a);
          const cls = classes.find((c) => c.value === m);
          const v = layer ? areaNumber(a.values[layer.id] ?? null) : null;
          return (
            <li key={a.id}>
              <button type="button" className={`area-row${selectedId === a.id ? " is-on" : ""}`}
                      onClick={() => onPick(level, a.id)}>
                <span className="area-dot" style={{ background: cls?.color ?? "#ccc" }} />
                <span className="area-name">
                  <strong>{a.name}</strong>
                  <span>{parentHint(a.id)}</span>
                </span>
                <span className="area-val">
                  {layer && layer.id !== ADVISORY ? fmtValue(v, layer.legend, run.init, lang) : tx(cls?.label, lang)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!q && summary && summary.areas.length > 12 ? (
        <button type="button" className="link-btn" onClick={() => setAll((x) => !x)}>
          {all ? t(lang, "showFewer") : `${t(lang, "showAll")} (${summary.areas.length})`}
        </button>
      ) : null}
    </div>
  );
}
