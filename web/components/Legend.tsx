"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ListFilter } from "lucide-react";
import type { LayerInfo } from "@/lib/types";
import { t, tx } from "@/lib/i18n";
import { legendTicks } from "@/lib/format";
import { GroupIcon } from "./icons";

interface Props {
  layer: LayerInfo;
  lang: string;
  init: string;
  groupIcon?: string | null;
  groupLabel?: string;
  position?: [number, number];            // [index in group (1-based), group size]
  onStep?: (step: number) => void;        // previous / next layer
  picker?: (close: () => void) => ReactNode;   // full layer menu, shown above the card
  opacity: number;
  onOpacity: (v: number) => void;
}

/** Legend card that doubles as the map's layer switcher: arrows step through the
 *  layers, the title opens the full (searchable) layer menu. */
export default function Legend({ layer, lang, init, groupIcon, groupLabel, position, onStep, picker,
                                 opacity, onOpacity }: Props) {
  const [open, setOpen] = useState(true);
  const [picking, setPicking] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {                      // start folded on phones, where the map is small
    if (window.matchMedia("(max-width: 900px)").matches) setOpen(false);
  }, []);
  useEffect(() => {                      // close the picker on outside click / Escape
    if (!picking) return;
    const down = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setPicking(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setPicking(false); };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key); };
  }, [picking]);

  const lg = layer.legend;
  if (!lg) return null;
  const units = lg.units && lg.type === "continuous" && lg.format !== "days_from_init" ? lg.units : "";
  return (
    <div className="legend-wrap" ref={root}>
      {picking && picker ? (
        <div className="layer-pop" role="dialog" aria-label={t(lang, "changeLayer")}>
          {picker(() => setPicking(false))}
        </div>
      ) : null}
      <section className={`legend-card${open ? "" : " is-closed"}`} aria-label={`${t(lang, "legend")}: ${tx(layer.title, lang)}`}>
        <div className="legend-head">
          <span className="legend-icon"><GroupIcon name={groupIcon} size={16} /></span>
          <button type="button" className="legend-title" onClick={() => picker && setPicking((p) => !p)}
                  aria-expanded={picking} title={t(lang, "changeLayer")}>
            {groupLabel ? (
              <span className="legend-group">
                <span className="legend-group-name">{groupLabel}</span>
                {position && position[1] > 1 ? <span className="legend-pos">{position[0]}/{position[1]}</span> : null}
                {picker ? <ListFilter size={14} className="legend-pick" aria-hidden /> : null}
              </span>
            ) : null}
            <span className="legend-name">
              {tx(layer.title, lang)}
              {units ? <span className="units"> ({units})</span> : null}
            </span>
          </button>
          {onStep ? (
            <span className="legend-steps">
              <button type="button" onClick={() => onStep(-1)} title={`${t(lang, "prevLayer")} ( [ )`} aria-label={t(lang, "prevLayer")}>
                <ChevronLeft size={16} />
              </button>
              <button type="button" onClick={() => onStep(1)} title={`${t(lang, "nextLayer")} ( ] )`} aria-label={t(lang, "nextLayer")}>
                <ChevronRight size={16} />
              </button>
            </span>
          ) : null}
          <button type="button" className="legend-fold" onClick={() => setOpen((o) => !o)} aria-expanded={open}
                  aria-label={t(lang, "legend")}>
            {open ? <ChevronDown size={16} aria-hidden /> : <ChevronUp size={16} aria-hidden />}
          </button>
        </div>
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
    </div>
  );
}
