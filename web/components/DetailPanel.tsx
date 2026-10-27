import type { AreaRecord, AreaSummary, LayerInfo, PointResult, RunView, Selection } from "@/lib/types";
import { t, tx } from "@/lib/i18n";
import { areaNumber, fmtValue } from "@/lib/format";
import { colorFor, css } from "@/lib/color";
import MemberChart from "./MemberChart";
import { GroupIcon } from "./icons";

interface Props {
  run: RunView;
  selection: Selection;
  area: AreaRecord | null;
  parents: string[];
  levelLabel: string;
  point: PointResult | null | "loading" | "error";
  lang: string;
  onClose: () => void;
  current?: string | null;                 // base on the map: its group opens, its row is marked
  period?: string | null;                  // values shown are this period's
  onLayer?: (base: string) => void;        // click a value to show that layer
}

const ADVISORY = "advisory_class";

export default function DetailPanel({ run, selection, area, parents, levelLabel, point, lang, onClose, current, period, onLayer }: Props) {
  const isArea = selection.kind === "area" && area;
  const pt = typeof point === "object" ? point : null;
  const value = (id: string): number | null =>
    isArea ? areaNumber(area!.values[id] ?? null) : pt ? pt.layers[id] ?? null : null;

  const lid = (b: string) => (period && run.index?.[b]?.[period]) || null;
  const advId = lid(ADVISORY);           // only when this period has an advisory
  const adv = advId ? run.layers[advId] : undefined;
  const advValue = advId ? value(advId) : null;
  const advClass = adv?.legend?.classes?.find((c) => c.value === advValue);
  const advText = adv?.advisories && advValue != null ? adv.advisories[String(advValue)] : null;

  const title = isArea ? area!.name
    : `${Math.abs(selection.lat).toFixed(2)}°${selection.lat >= 0 ? "N" : "S"}, ${Math.abs(selection.lon).toFixed(2)}°E`;
  const outside = !isArea && pt && !pt.inside;

  return (
    <aside className="detail" aria-live="polite">
      <header className="detail-head">
        <div>
          <p className="detail-kind">{isArea ? [levelLabel, ...parents].join(", ") : t(lang, "atLocation")}</p>
          <h2>{title}</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label={t(lang, "close")}>×</button>
      </header>

      {point === "loading" && !isArea ? <p className="muted">{t(lang, "loading")}</p> : null}
      {outside || point === "error" && !isArea ? <p className="muted">{t(lang, "outside")}</p> : null}

      {advClass ? (
        <section className="advisory" style={{ ["--adv" as string]: advClass.color }}>
          <p className="advisory-class">{tx(advClass.label, lang)}</p>
          {advText ? <p className="advisory-text">{tx(advText, lang)}</p> : null}
          {isArea && advId && area!.values[advId] && "share" in area!.values[advId]! ? (
            <ShareBar share={(area!.values[advId] as { share: Record<string, number> }).share} layer={adv!} lang={lang} />
          ) : null}
        </section>
      ) : null}

      {!outside && (isArea || pt) ? (
        <div className="value-groups">
          {run.groups.map((g) => {
            const ids = g.layers.filter((b) => b !== ADVISORY && lid(b));
            if (!ids.length) return null;
            const here = g.layers.includes(current ?? "") || run.groups.length === 1;
            return (
              <details key={`${g.id}:${here}`} className="value-group" open={here}>
                <summary>
                  <span className="group-icon"><GroupIcon name={g.icon ?? g.id} size={15} /></span>
                  <span>{tx(g.label, lang)}</span>
                  <span className="group-count">{ids.length}</span>
                </summary>
                <dl className="values">
                  {ids.map((b) => {
                    const id = lid(b)!;
                    const l = run.layers[id];
                    const v = value(id);
                    const c = colorFor(v, l.legend);
                    const label = (
                      <>
                        <dt><span className="dot" style={{ background: css(c) }} />{tx(l.title, lang)}</dt>
                        <dd>{fmtValue(v, l.legend, run.init, lang)}</dd>
                      </>
                    );
                    return onLayer ? (
                      <div key={id} className={`value-row is-link${b === current ? " is-on" : ""}`} role="button" tabIndex={0}
                           aria-current={b === current} onClick={() => onLayer(b)}
                           onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onLayer(b); } }}>
                        {label}
                      </div>
                    ) : <div key={id} className="value-row">{label}</div>;
                  })}
                </dl>
              </details>
            );
          })}
        </div>
      ) : null}
      {isArea ? <p className="muted small">{t(lang, "areaAverage")}</p> : null}

      {/* member totals are for the whole forecast window */}
      {pt && pt.inside && (!period || period === "full") ? <MemberChart point={pt} lang={lang} /> : null}
    </aside>
  );
}

function ShareBar({ share, layer, lang }: { share: Record<string, number>; layer: LayerInfo; lang: string }) {
  const classes = layer.legend?.classes ?? [];
  return (
    <div className="sharebar" role="img"
         aria-label={classes.map((c) => `${tx(c.label, lang)} ${Math.round((share[String(c.value)] ?? 0) * 100)}%`).join(", ")}>
      {classes.map((c) => {
        const f = share[String(c.value)] ?? 0;
        return f > 0 ? <span key={c.value} style={{ flexGrow: f, background: c.color }} title={`${tx(c.label, lang)} ${Math.round(f * 100)}%`} /> : null;
      })}
    </div>
  );
}

export function findArea(s: AreaSummary | null, id: string) {
  return s?.areas.find((a) => a.id === id) ?? null;
}
