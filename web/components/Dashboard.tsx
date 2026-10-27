"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { api } from "@/lib/api";
import type { AreaSummary, PointResult, Profile, RunListItem, RunView, Selection } from "@/lib/types";
import { LANGUAGE_NAMES, t, tx } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";
import LayerMenu from "./LayerMenu";
import Legend from "./Legend";
import DetailPanel, { findArea } from "./DetailPanel";

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <div className="map" /> });
const GRID = "grid";

interface Query { lang: string | null; run: string | null; layer: string | null; by: string | null }

export default function Dashboard({ country, query: q }: { country: string; query: Query }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState<"missing" | "nodata" | "failed" | null>(null);
  const [lang, setLang] = useState<string>(q.lang ?? "");
  const [init, setInit] = useState<string>(q.run ?? "latest");
  const [layerId, setLayerId] = useState<string | null>(q.layer);
  const [by, setBy] = useState<string | null>(q.by);
  const [summaries, setSummaries] = useState<Record<string, AreaSummary>>({});
  const [selection, setSelection] = useState<Selection | null>(null);
  const [point, setPoint] = useState<PointResult | null | "loading" | "error">(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // profile + run list
  useEffect(() => {
    api.profile(country).then((p) => {
      setProfile(p);
      setLang((l) => (l && p.languages.includes(l) ? l : storedLang(country, p)));
    }).catch((e) => setError(e.status === 404 ? "missing" : "failed"));
    api.runs(country).then(setRuns).catch(() => setRuns([]));
  }, [country]);

  // the selected run
  useEffect(() => {
    setRun(null);
    api.run(country, init).then((r) => {
      setRun(r);
      setError(null);
      setLayerId((id) => (id && r.layers[id] ? id : r.default_layer));
      setBy((b) => (b === GRID || r.areas.some((a) => a.level === b) ? b : r.areas[0]?.level ?? GRID));
    }).catch((e) => setError((prev) => (prev === "missing" ? prev : e.status === 404 ? "nodata" : "failed")));
  }, [country, init]);

  const level = run?.areas.find((a) => a.level === by) ?? null;
  const layer = run && layerId ? run.layers[layerId] ?? null : null;

  // area summaries for the shown level (and the levels above, for parent names)
  useEffect(() => {
    if (!run) return;
    const want = level ? run.areas.slice(0, run.areas.indexOf(level) + 1) : [];
    if (selection?.kind === "area") {
      const i = run.areas.findIndex((a) => a.level === selection.level);
      run.areas.slice(0, i + 1).forEach((a) => !want.includes(a) && want.push(a));
    }
    want.forEach((a) => {
      const key = `${run.init}/${a.level}`;
      if (summaries[key]) return;
      api.areas(a.summary_url).then((s) => setSummaries((m) => ({ ...m, [key]: s }))).catch(() => undefined);
    });
  }, [run, level, selection, summaries]);

  // point values for the selection
  useEffect(() => {
    if (!run || !selection || !run.point_query) return setPoint(null);
    setPoint("loading");
    let live = true;
    api.point(country, run.init, selection.lat, selection.lon)
      .then((p) => live && setPoint(p))
      .catch(() => live && setPoint("error"));
    return () => {
      live = false;
    };
  }, [country, run, selection]);

  // keep the URL shareable
  useEffect(() => {
    if (!run) return;
    const u = new URLSearchParams();
    if (init !== "latest") u.set("run", init);
    if (layerId && layerId !== run.default_layer) u.set("layer", layerId);
    if (by) u.set("by", by);
    if (profile && lang && lang !== profile.default_language) u.set("lang", lang);
    const s = u.toString();
    window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
  }, [run, init, layerId, by, lang, profile]);

  const chooseLang = useCallback((l: string) => {
    setLang(l);
    try { localStorage.setItem(`lang:${country}`, l); } catch { /* private mode */ }
  }, [country]);

  const L = lang || profile?.default_language || "en";

  if (error === "missing") return <Message lang={L} text={t(L, "countryMissing")} />;
  if (error === "failed") return <Message lang={L} text={t(L, "loadFailed")} />;

  const summary = run && level ? summaries[`${run.init}/${level.level}`] ?? null : null;
  const selArea = selection?.kind === "area" && run ? findArea(summaries[`${run.init}/${selection.level}`] ?? null, selection.id) : null;
  const parents: string[] = [];
  if (selArea && run && selection?.kind === "area") {
    let pid = selArea.parent_id;
    const selLevel = selection.level;
    for (let i = run.areas.findIndex((a) => a.level === selLevel) - 1; i >= 0 && pid; i--) {
      const rec = findArea(summaries[`${run.init}/${run.areas[i].level}`] ?? null, pid);
      if (!rec) break;
      parents.push(rec.name);
      pid = rec.parent_id;
    }
  }
  const selLevelLabel = selection?.kind === "area" ? tx(run?.areas.find((a) => a.level === selection.level)?.label, L) : "";
  const year = run ? run.init.slice(0, 4) : "";

  return (
    <div className="app" lang={L}>
      <section className={`rail${menuOpen ? " is-open" : ""}`}>
        <header className="rail-head">
          <Link href="/" className="country-link">
            <span aria-hidden>{profile?.flag}</span> {tx(profile?.name, L)}
          </Link>
          {profile && profile.languages.length > 1 ? (
            <div className="lang" role="group" aria-label={t(L, "language")}>
              {profile.languages.map((l) => (
                <button key={l} className={l === L ? "is-on" : ""} aria-pressed={l === L} onClick={() => chooseLang(l)}>
                  {LANGUAGE_NAMES[l] ?? l}
                </button>
              ))}
            </div>
          ) : null}
        </header>

        {error === "nodata" ? (
          <div>
            <p className="season-empty">{t(L, "noForecast")}</p>
            <p className="season-meta">{t(L, "firstRun")}</p>
          </div>
        ) : run ? (
          <div className="season">
            <h1>{tx(run.season.label, L)} {year}</h1>
            <p className="season-meta">
              {t(L, "covers")} {fmtDate(run.valid_from, L)} – {fmtDate(run.valid_to, L)}.{" "}
              {t(L, "issued")} {fmtDate((run.created ?? run.init).slice(0, 10), L)}, {run.members} {t(L, "members")}.
            </p>
            {runs.length > 1 ? (
              <label className="run-pick">
                <span>{t(L, "forecastRun")}</span>
                <select value={init === "latest" ? run.init : init} onChange={(e) => { setSelection(null); setInit(e.target.value); }}>
                  {runs.map((r) => (
                    <option key={r.init} value={r.init}>
                      {tx(r.season.label, L)} {r.init.slice(0, 4)} ({fmtDate(r.init, L, { month: "short", year: "numeric" })})
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : (
          <p className="season-empty">{t(L, "loading")}</p>
        )}

        <button className="menu-toggle" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          {t(L, "layers")}{layer ? `: ${tx(layer.title, L)}` : ""}
        </button>
        {run ? <LayerMenu run={run} value={layerId} onChange={(id) => { setLayerId(id); setMenuOpen(false); }} lang={L} /> : null}

        {profile ? (
          <footer className="rail-foot">
            {profile.attribution ? <p>{tx(profile.attribution, L)}</p> : null}
            {profile.links.length ? (
              <p>
                {t(L, "sources")}:{" "}
                {profile.links.map((l, i) => (
                  <span key={l.url}>{i ? ", " : ""}<a href={l.url} target="_blank" rel="noreferrer">{tx(l.name, L)}</a></span>
                ))}
              </p>
            ) : null}
          </footer>
        ) : null}
      </section>

      <main className="stage">
        {run && profile ? (
          <MapView
            run={run}
            layer={layer}
            levelKey={level?.level ?? null}
            levelUrl={level?.boundaries_url ?? null}
            outlineUrl={run.areas[0]?.boundaries_url ?? null}
            summary={summary}
            selection={selection}
            onSelect={setSelection}
            lang={L}
            center={profile.map.center}
            zoom={profile.map.zoom}
            basemap={profile.map.basemap}
          />
        ) : <div className="map" />}

        {run && run.areas.length ? (
          <div className="showby" role="group" aria-label={t(L, "showBy")}>
            <span>{t(L, "showBy")}</span>
            {[{ level: GRID, label: t(L, "grid") }, ...run.areas.map((a) => ({ level: a.level, label: tx(a.label, L) }))].map((o) => (
              <button key={o.level} className={by === o.level ? "is-on" : ""} aria-pressed={by === o.level}
                      onClick={() => { setBy(o.level); setSelection(null); }}>
                {o.label}
              </button>
            ))}
          </div>
        ) : null}

        {run && layer ? <div className="legend-dock"><Legend layer={layer} lang={L} init={run.init} /></div> : null}

        {run && selection ? (
          <DetailPanel run={run} selection={selection} area={selArea} parents={parents} levelLabel={selLevelLabel}
                       point={point} lang={L} onClose={() => setSelection(null)} />
        ) : run ? <p className="hint">{t(L, "clickHint")}</p> : null}
      </main>
    </div>
  );
}

function storedLang(country: string, p: Profile) {
  try {
    const l = localStorage.getItem(`lang:${country}`);
    if (l && p.languages.includes(l)) return l;
  } catch { /* private mode */ }
  const nav = typeof navigator !== "undefined" ? navigator.language.slice(0, 2) : "";
  return p.languages.includes(nav) ? nav : p.default_language;
}

function Message({ text, lang }: { text: string; lang: string }) {
  return (
    <div className="message">
      <p>{text}</p>
      <Link href="/">{t(lang, "allCountries")}</Link>
    </div>
  );
}
