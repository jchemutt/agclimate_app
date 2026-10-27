import type { RunView } from "@/lib/types";
import { tx } from "@/lib/i18n";
import { GroupIcon } from "../icons";

/** Layer menu: one card per profile group, layers as options inside it. */
export default function OutlookPanel({ run, value, onChange, lang }: {
  run: RunView; value: string | null; onChange: (id: string) => void; lang: string;
}) {
  return (
    <div className="group-list">
      {run.groups.map((g) => {
        const active = g.layers.includes(value ?? "");
        return (
          <fieldset key={g.id} className={`group-card${active ? " is-active" : ""}`}>
            <legend className="group-head">
              <span className="group-icon"><GroupIcon name={g.icon ?? g.id} /></span>
              <span>{tx(g.label, lang)}</span>
            </legend>
            <div className="group-options">
              {g.layers.map((id) => {
                const l = run.layers[id];
                return (
                  <label key={id} className={`layer-option${value === id ? " is-on" : ""}`}>
                    <input type="radio" name="layer" value={id} checked={value === id} onChange={() => onChange(id)} />
                    <span>{tx(l.title, lang)}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
