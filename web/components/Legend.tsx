import type { LayerInfo } from "@/lib/types";
import { tx } from "@/lib/i18n";
import { legendTicks } from "@/lib/format";

export default function Legend({ layer, lang, init }: { layer: LayerInfo; lang: string; init: string }) {
  const lg = layer.legend;
  if (!lg) return null;
  return (
    <figure className="legend" aria-label={`Legend: ${tx(layer.title, lang)}`}>
      <figcaption>
        {tx(layer.title, lang)}
        {lg.units && lg.type === "continuous" && lg.format !== "days_from_init" ? <span className="units"> ({lg.units})</span> : null}
      </figcaption>
      {lg.type === "categorical" ? (
        <ul className="legend-classes">
          {lg.classes?.map((c) => (
            <li key={c.value}>
              <span className="swatch" style={{ background: c.color }} />
              {tx(c.label, lang)}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <div
            className="legend-ramp"
            style={{ background: `linear-gradient(to right, ${(lg.stops ?? []).map((s) => s.color).join(", ")})` }}
          />
          <div className="legend-ticks">
            {legendTicks(lg, lang, init).map((t, i) => (
              <span key={i}>{t}</span>
            ))}
          </div>
        </>
      )}
      {layer.description ? <p className="legend-note">{tx(layer.description, lang)}</p> : null}
    </figure>
  );
}
