"use client";

import { useEffect, useRef } from "react";
import type { RunView } from "@/lib/types";
import { t } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";
import { periodLabel } from "@/lib/layers";

/** Season | months | whole forecast. Seasons and months come from the run
 *  (only complete ones are published), so nothing here is country-specific. */
export default function PeriodBar({ run, value, onChange, lang }: {
  run: RunView; value: string | null; onChange: (id: string) => void; lang: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {                         // keep the chosen pill in view on narrow screens
    const on = bar.current?.querySelector<HTMLElement>("button.is-on");
    const box = bar.current?.querySelector<HTMLElement>(".period-pills");
    if (on && box && (on.offsetLeft < box.scrollLeft || on.offsetLeft + on.offsetWidth > box.scrollLeft + box.clientWidth)) {
      box.scrollLeft = on.offsetLeft - 8;
    }
  }, [value]);
  if (run.periods.length < 2) return null;
  const kinds = ["season", "month", "window"] as const;
  return (
    <div className="period-bar" ref={bar} role="group" aria-label={t(lang, "period")}>
      <span className="period-title">{t(lang, "period")}</span>
      <div className="period-pills">
        {kinds.map((k) => {
          const ps = run.periods.filter((p) => p.kind === k);
          if (!ps.length) return null;
          return (
            <span key={k} className={`period-set is-${k}`}>
              {ps.map((p) => {
                const on = p.id === value;
                const range = p.start && p.end
                  ? `${fmtDate(p.start, lang, { day: "numeric", month: "short" })} – ${fmtDate(p.end, lang)}` : "";
                return (
                  <button key={p.id} type="button" className={on ? "is-on" : ""} aria-pressed={on}
                          title={`${periodLabel(p, lang, run.init, true)}${range ? ` · ${range}` : ""}`}
                          onClick={() => onChange(p.id)}>
                    {periodLabel(p, lang, run.init)}
                    {p.kind === "season" && p.id !== periodLabel(p, lang, run.init) ? <small>{p.id}</small> : null}
                  </button>
                );
              })}
            </span>
          );
        })}
      </div>
    </div>
  );
}
