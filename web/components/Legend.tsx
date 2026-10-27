"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { LayerInfo } from "@/lib/types";
import { t, tx } from "@/lib/i18n";
import { legendTicks } from "@/lib/format";
import { GroupIcon } from "./icons";

interface Props {
  layer: LayerInfo;
  lang: string;
  init: string;
  groupIcon?: string | null;
  opacity: number;
  onOpacity: (v: number) => void;
}

export default function Legend({ layer, lang, init, groupIcon, opacity, onOpacity }: Props) {
  const [open, setOpen] = useState(true);
  useEffect(() => {                      // start folded on phones, where the map is small
    if (window.matchMedia("(max-width: 900px)").matches) setOpen(false);
  }, []);
  const lg = layer.legend;
  if (!lg) return null;
  const units = lg.units && lg.type === "continuous" && lg.format !== "days_from_init" ? lg.units : "";
  return (
    <section className={`legend-card${open ? "" : " is-closed"}`} aria-label={`${t(lang, "legend")}: ${tx(layer.title, lang)}`}>
      <button type="button" className="legend-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="legend-icon"><GroupIcon name={groupIcon} size={16} /></span>
        <span className="legend-title">
          {tx(layer.title, lang)}
          {units ? <span className="units"> ({units})</span> : null}
        </span>
        {open ? <ChevronDown size={16} aria-hidden /> : <ChevronUp size={16} aria-hidden />}
      </button>
      {open ? (
        <div className="legend-body">
          {lg.type === "categorical" ? (
            <ul className="legend-classes">
              {lg.classes?.map((c) => (
                <li key={c.value}><span className="swatch" style={{ background: c.color }} />{tx(c.label, lang)}</li>
              ))}
            </ul>
          ) : (
            <>
              <div className="legend-ramp" style={{ background: `linear-gradient(to right, ${(lg.stops ?? []).map((s) => s.color).join(", ")})` }} />
              <div className="legend-ticks">{legendTicks(lg, lang, init).map((x, i) => <span key={i}>{x}</span>)}</div>
            </>
          )}
          {layer.description ? <p className="legend-note">{tx(layer.description, lang)}</p> : null}
          <label className="opacity">
            <span>{t(lang, "opacity")}</span>
            <input type="range" min={0.2} max={1} step={0.05} value={opacity}
                   onChange={(e) => onOpacity(Number(e.target.value))} />
            <span className="opacity-val">{Math.round(opacity * 100)}%</span>
          </label>
        </div>
      ) : null}
    </section>
  );
}
