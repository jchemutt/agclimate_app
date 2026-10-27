import type { RunView } from "@/lib/types";
import { t, tx } from "@/lib/i18n";

export default function LayerMenu({ run, value, onChange, lang }: {
  run: RunView; value: string | null; onChange: (id: string) => void; lang: string;
}) {
  return (
    <nav className="layers" aria-label={t(lang, "layers")}>
      {run.groups.map((g) => (
        <fieldset key={g.id} className="layer-group">
          <legend>{tx(g.label, lang)}</legend>
          {g.layers.map((id) => {
            const l = run.layers[id];
            return (
              <label key={id} className={`layer-option${value === id ? " is-on" : ""}`}>
                <input type="radio" name="layer" value={id} checked={value === id} onChange={() => onChange(id)} />
                <span>{tx(l.title, lang)}</span>
              </label>
            );
          })}
        </fieldset>
      ))}
    </nav>
  );
}
