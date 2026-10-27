import { Download, FileCode2, FileSpreadsheet, Map as MapIcon } from "lucide-react";
import type { LayerInfo, Profile, RunView } from "@/lib/types";
import { t, tx } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";

export default function DataPanel({ run, profile, layer, lang }: {
  run: RunView; profile: Profile; layer: LayerInfo | null; lang: string;
}) {
  return (
    <div className="data-panel">
      <section className="card">
        <h3 className="card-title">{t(lang, "downloads")}</h3>
        <ul className="dl-list">
          {run.areas.map((a) => (
            <li key={a.level}>
              <a href={`${a.summary_url}?format=csv&lang=${lang}`} download>
                <FileSpreadsheet size={18} aria-hidden />
                <span><strong>{tx(a.label, lang)}</strong> {t(lang, "csvTable")}</span>
                <Download size={16} aria-hidden />
              </a>
            </li>
          ))}
          {layer ? (
            <li>
              <a href={layer.cog_url} download>
                <MapIcon size={18} aria-hidden />
                <span><strong>{tx(layer.title, lang)}</strong> GeoTIFF</span>
                <Download size={16} aria-hidden />
              </a>
            </li>
          ) : null}
        </ul>
      </section>

      <section className="card">
        <h3 className="card-title">{t(lang, "aboutRun")}</h3>
        <dl className="facts">
          <div><dt>{t(lang, "forecastRun")}</dt><dd>{fmtDate(run.init, lang)}</dd></div>
          <div><dt>{t(lang, "covers")}</dt><dd>{fmtDate(run.valid_from, lang)} – {fmtDate(run.valid_to, lang)}</dd></div>
          <div><dt>{t(lang, "membersLabel")}</dt><dd>{run.members}</dd></div>
          {run.terciles ? (
            <div><dt>{t(lang, "baseline")}</dt><dd>{run.terciles.baseline.join("–")} ({run.terciles.years_used} {t(lang, "years")})</dd></div>
          ) : null}
        </dl>
        {profile.attribution ? <p className="muted small">{tx(profile.attribution, lang)}</p> : null}
      </section>

      <section className="card">
        <h3 className="card-title">{t(lang, "integrate")}</h3>
        <p className="small">{t(lang, "integrateText")}</p>
        <a className="btn-secondary" href="/api/docs" target="_blank" rel="noreferrer">
          <FileCode2 size={16} aria-hidden /> {t(lang, "apiDocs")}
        </a>
      </section>

      {profile.links.length ? (
        <section className="card">
          <h3 className="card-title">{t(lang, "sources")}</h3>
          <ul className="link-list">
            {profile.links.map((l) => <li key={l.url}><a href={l.url} target="_blank" rel="noreferrer">{tx(l.name, lang)}</a></li>)}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
