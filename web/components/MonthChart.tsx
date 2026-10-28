"use client";

import { useState } from "react";
import type { Legend, Period } from "@/lib/types";
import { t } from "@/lib/i18n";
import { colorFor, css } from "@/lib/color";
import { fmtValue } from "@/lib/format";
import { periodLabel } from "@/lib/layers";

interface Props {
  title: string;                      // indicator title (already translated)
  months: Period[];
  values: (number | null)[];          // one per month, aligned with `months`
  legends: (Legend | null)[];         // each month's legend (colours match the map)
  highlight: Set<string>;             // months inside the selected period
  init: string;
  lang: string;
  onPick?: (monthId: string) => void;
}

const W = 340, H = 148, PAD = { l: 8, r: 8, t: 22, b: 22 };

/** One indicator, month by month, for the selected place. Bars use the layer's own
 *  colour scale; the selected period's months are outlined, the rest recede. */
export default function MonthChart({ title, months, values, legends, highlight, init, lang, onPick }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const lg = legends.find(Boolean) ?? null;
  const categorical = lg?.type === "categorical";
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!months.length || !finite.length) return null;

  const plotW = W - PAD.l - PAD.r, plotH = H - PAD.t - PAD.b;
  const step = plotW / months.length;
  const bw = Math.min(30, step * 0.62);
  // keep at least a quarter of the legend's range on the axis, so ±0.2 °C doesn't fill the chart
  const [r0, r1] = lg?.range ?? [0, 0];
  const minSpan = Math.abs(r1 - r0) * 0.25;
  let lo = categorical ? 0 : Math.min(0, ...finite);
  let hi = categorical ? 1 : Math.max(0, ...finite);
  if (!categorical && hi - lo < minSpan) {
    if (lo < 0 && hi > 0) { const k = minSpan / (hi - lo); lo *= k; hi *= k; }
    else if (lo < 0) lo = -minSpan; else hi = minSpan;
  }
  if (hi === lo) hi = lo + 1;
  // bar colour: class colours for categories; for scales, the legend's poles (diverging)
  // or its strong end (sequential) - pale mid-scale colours would make bars invisible
  const stops = lg?.stops ?? [];
  const diverging = !categorical && r0 < 0 && r1 > 0 && stops.length > 1;
  const strong = stops.length ? stops[Math.round((stops.length - 1) * 0.75)].color : "var(--primary)";
  const barColour = (v: number, i: number) => categorical ? css(colorFor(v, legends[i] ?? lg))
    : diverging ? (v < 0 ? stops[1]?.color ?? stops[0].color : stops[stops.length - 2]?.color ?? stops[stops.length - 1].color)
    : strong;
  const y = (v: number) => PAD.t + (hi - v) / (hi - lo) * plotH;
  const zero = y(0);
  const fmt = (i: number) => fmtValue(values[i], legends[i] ?? lg, init, lang);
  // selective labels: the highlighted months, or the largest bar when nothing is highlighted
  const labelled = new Set<number>(months.map((m, i) => (highlight.has(m.id) ? i : -1)).filter((i) => i >= 0));
  if (!labelled.size && !categorical) labelled.add(values.indexOf(Math.max(...finite)));

  return (
    <figure className="month-chart">
      <figcaption>
        <span className="mc-kicker">{t(lang, "monthByMonth")}</span>
        <span className="mc-title">{title}</span>
      </figcaption>
      <div className="mc-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img"
             aria-label={`${title}: ${months.map((m, i) => `${periodLabel(m, lang, init)} ${fmt(i)}`).join(", ")}`}>
          <line x1={PAD.l} x2={W - PAD.r} y1={zero} y2={zero} className="mc-base" />
          {months.map((m, i) => {
            const v = values[i];
            const cx = PAD.l + step * i + step / 2;
            const on = highlight.has(m.id);
            const fill = v == null ? "transparent" : barColour(v, i);
            let top = zero, bottom = zero;
            if (v != null) {
              if (categorical) { top = PAD.t + plotH * 0.15; bottom = zero; }
              else if (v >= 0) top = y(v); else bottom = y(v);
            }
            const h = Math.max(bottom - top, v == null ? 0 : 1.5);
            const r = Math.min(4, h / 2, bw / 2);
            const down = !categorical && v != null && v < 0;
            // rounded at the data end only, square on the baseline
            const path = down
              ? `M${cx - bw / 2},${top} h${bw} v${h - r} q0,${r} ${-r},${r} h${-(bw - 2 * r)} q${-r},0 ${-r},${-r} z`
              : `M${cx - bw / 2},${top + h} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z`;
            return (
              <g key={m.id} className={`mc-bar${on ? " is-on" : ""}${hover === i ? " is-hover" : ""}`}
                 onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                 onClick={() => onPick?.(m.id)} style={{ cursor: onPick ? "pointer" : undefined }}>
                <rect x={cx - step / 2} y={0} width={step} height={H} fill="transparent" />
                {v == null ? <text x={cx} y={zero - 4} className="mc-na">–</text> : <path d={path} fill={fill} />}
                {labelled.has(i) && v != null && !categorical ? (
                  <text x={cx} y={down ? zero - 5 : top - 5} className="mc-val">{fmt(i)}</text>
                ) : null}
                <text x={cx} y={H - 6} className="mc-x">{periodLabel(m, lang, init)}</text>
              </g>
            );
          })}
        </svg>
        {hover != null ? (
          <div className="mc-tip" style={{ left: `${((PAD.l + step * hover + step / 2) / W) * 100}%` }}>
            <strong>{periodLabel(months[hover], lang, init, true)}</strong>
            <span>{fmt(hover)}</span>
          </div>
        ) : null}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {months.map((m, i) => <tr key={m.id}><th scope="row">{periodLabel(m, lang, init, true)}</th><td>{fmt(i)}</td></tr>)}
        </tbody>
      </table>
    </figure>
  );
}
