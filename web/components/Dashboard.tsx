"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type OlMap from "ol/Map";
import { Download, Home, Layers, MapPinned, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { api } from "@/lib/api";
import type { AreaSummary, PointResult, Profile, RunListItem, RunView, Selection } from "@/lib/types";
import { LANGUAGE_NAMES, t, tx } from "@/lib/i18n";
import { fmtDate } from "@/lib/format";
import { themeVars } from "@/lib/theme";
import { BASEMAPS, customBasemap, type BasemapId } from "@/lib/basemaps";
import Flag from "./Flag";
import Legend from "./Legend";
import MapControls from "./MapControls";
import DetailPanel, { findArea } from "./DetailPanel";
import { GroupIcon } from "./icons";
import { groupOf, stepLayer } from "@/lib/layers";
import OutlookPanel from "./sidebar/OutlookPanel";
import AreasPanel from "./sidebar/AreasPanel";
import DataPanel from "./sidebar/DataPanel";
import type { Focus } from "./MapView";

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <div className="map" /> });
const GRID = "grid";
type Tab = "outlook" | "areas" | "data";

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
  const [tab, setTab] = useState<Tab>("outlook");
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [areasLevel, setAreasLevel] = useState<string | null>(null);
  const [basemapId, setBasemapId] = useState<BasemapId>("light");
  const [opacity, setOpacity] = useState(0.85);
  const [mapObj, setMapObj] = useState<OlMap | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);

  // profile + run list
  useEffect(() => {
    api.profile(country).then((p) => {
      setProfile(p);
      setLang((l) => (l && p.languages.includes(l) ? l : storedLang(country, p)));
      if (p.map.basemap) setBasemapId("custom");
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
      setAreasLevel((l) => (l && r.areas.some((a) => a.level === l) ? l : r.areas[0]?.level ?? null));
    }).catch((e) => setError((prev) => (prev === "missing" ? prev : e.status === 404 ? "nodata" : "failed")));
  }, [country, init]);

  const level = run?.areas.find((a) => a.level === by) ?? null;
  const layer = run && layerId ? run.layers[layerId] ?? null : null;

  // area summaries: the shown level, the Areas-tab level, and levels above a selection (parent names)
  useEffect(() => {
    if (!run) return;
    const want = new Set<string>();
    const upTo = (lv: string | null | undefined) => {
      const i = run.areas.findIndex((a) => a.level === lv);
      run.areas.slice(0, i + 1).forEach((a) => want.add(a.level));
    };
    upTo(level?.level);
    if (tab === "areas") upTo(areasLevel);
    if (selection?.kind === "area") upTo(selection.level);
    want.forEach((lv) => {
      const key = `${run.init}/${lv}`;
      const a = run.areas.find((x) => x.level === lv);
      if (summaries[key] || !a) return;
      api.areas(a.summary_url).then((s) => setSummaries((m) => ({ ...m, [key]: s }))).catch(() => undefined);
    });
  }, [run, level, selection, summaries, tab, areasLevel]);

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

  const basemaps = useMemo(
    () => (profile?.map.basemap ? [customBasemap(profile.map.basemap), ...BASEMAPS] : BASEMAPS),
    [profile],
  );
  const basemap = basemaps.find((b) => b.id === basemapId) ?? basemaps[0];

  const L = lang || profile?.default_language || "en";


  const summary = run && level ? summaries[`${run.init}/${level.level}`] ?? null : null;
  const areasSummary = run && areasLevel ? summaries[`${run.init}/${areasLevel}`] ?? null : null;
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
  const group = run ? groupOf(run, layerId) : null;
  const groupIcon = group?.icon ?? null;
  const position: [number, number] | undefined = group && layerId
    ? [group.layers.filter((id) => run?.layers[id]).indexOf(layerId) + 1, group.layers.filter((id) => run?.layers[id]).length]
    : undefined;
  const step = useCallback((d: number) => {
    if (run) setLayerId((id) => stepLayer(run, id, d) ?? id);
  }, [run]);
  // "[" and "]" step through the layers from anywhere except form fields
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (/^(SELECT|TEXTAREA)$/.test(el.tagName) || el.isContentEditable ||
        (el.tagName === "INPUT" && !["radio", "checkbox", "range", "button"].includes((el as HTMLInputElement).type)));
      if (e.ctrlKey || e.metaKey || e.altKey || typing) return;
      if (e.key === "[") step(-1);
      else if (e.key === "]") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);
  /** Rail shortcut: keep the current layer if it's in the group, else the group's first layer. */
  const pickGroup = (gid: string) => {
    const g = run?.groups.find((x) => x.id === gid);
    const first = g?.layers.find((id) => run?.layers[id]);
    if (g && first) setLayerId((id) => (id && g.layers.includes(id) ? id : first));
  };

  if (error === "missing") return <Message lang={L} text={t(L, "countryMissing")} />;
  if (error === "failed") return <Message lang={L} text={t(L, "loadFailed")} />;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "outlook", label: t(L, "tabOutlook"), icon: <Layers size={16} aria-hidden /> },
    { id: "areas", label: t(L, "tabAreas"), icon: <MapPinned size={16} aria-hidden /> },
    { id: "data", label: t(L, "tabData"), icon: <Download size={16} aria-hidden /> },
  ];
  const openTab = (id: Tab) => {
    setTab(id);
    setCollapsed(false);
    setMobileOpen((o) => (tab === id ? !o : true));
  };
  const pickArea = (lv: string, id: string) => {
    setBy(lv);
    setFocus({ level: lv, id, nonce: Date.now() });
    setMobileOpen(false);
  };

  return (
    <div className={`app${collapsed ? " is-collapsed" : ""}${mobileOpen ? " is-mobile-open" : ""}`} lang={L}
         style={themeVars(profile?.theme)}>
      {collapsed ? (
        <nav className="side-rail" aria-label={t(L, "tabOutlook")}>
          <button type="button" className="rail-btn" onClick={() => setCollapsed(false)} title={t(L, "expand")} aria-label={t(L, "expand")}>
            <PanelLeftOpen size={18} />
          </button>
          <span className="rail-flag"><Flag iso2={profile?.iso2} emoji={profile?.flag} /></span>
          {tabs.map((x) => (
            <button key={x.id} type="button" className={`rail-btn${tab === x.id ? " is-on" : ""}`}
                    onClick={() => openTab(x.id)} title={x.label} aria-label={x.label}>{x.icon}</button>
          ))}
          {run && run.groups.length > 1 ? (
            <div className="rail-groups" role="group" aria-label={t(L, "layers")}>
              {run.groups.map((g) => (
                <button key={g.id} type="button" className={`rail-btn${group?.id === g.id ? " is-on" : ""}`}
                        onClick={() => pickGroup(g.id)} title={tx(g.label, L)} aria-label={tx(g.label, L)}
                        aria-pressed={group?.id === g.id}>
                  <GroupIcon name={g.icon ?? g.id} size={18} />
                </button>
              ))}
            </div>
          ) : null}
          <Link href="/" className="rail-btn rail-home" title={t(L, "home")} aria-label={t(L, "home")}><Home size={18} /></Link>
        </nav>
      ) : (
        <aside className="side">
          <header className="side-head">
            <span className="side-flag"><Flag iso2={profile?.iso2} emoji={profile?.flag} /></span>
            <div className="side-title">
              <strong>{tx(profile?.name, L)}</strong>
              <span>{t(L, "seasonalOutlook")}</span>
            </div>
            <button type="button" className="icon-square hide-mobile" onClick={() => setCollapsed(true)}
                    title={t(L, "collapse")} aria-label={t(L, "collapse")}><PanelLeftClose size={18} /></button>
            <Link href="/" className="icon-square" title={t(L, "home")} aria-label={t(L, "home")}><Home size={18} /></Link>
          </header>

          {profile && profile.languages.length > 1 ? (
            <div className="lang" role="group" aria-label={t(L, "language")}>
              {profile.languages.map((l) => (
                <button key={l} type="button" className={l === L ? "is-on" : ""} aria-pressed={l === L} onClick={() => chooseLang(l)}>
                  {LANGUAGE_NAMES[l] ?? l}
                </button>
              ))}
            </div>
          ) : null}

          <section className="season-card">
            {error === "nodata" ? (
              <>
                <h1>{t(L, "noForecast")}</h1>
                <p>{t(L, "firstRun")}</p>
              </>
            ) : run ? (
              <>
                <p className="season-sub">{t(L, "seasonalOutlook")}</p>
                <h1>{tx(run.season.label, L)} {run.init.slice(0, 4)}</h1>
                <p>{fmtDate(run.valid_from, L)} – {fmtDate(run.valid_to, L)}</p>
                <p className="season-meta">{t(L, "issued")} {fmtDate((run.created ?? run.init).slice(0, 10), L)}, {run.members} {t(L, "members")}</p>
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
              </>
            ) : <h1>{t(L, "loading")}</h1>}
          </section>

          {run ? (
            <>
              <div className="tabs" role="tablist">
                {tabs.map((x) => (
                  <button key={x.id} type="button" role="tab" aria-selected={tab === x.id}
                          className={tab === x.id ? "is-on" : ""} onClick={() => openTab(x.id)}>
                    {x.icon}{x.label}
                  </button>
                ))}
              </div>
              <div className="side-body" role="tabpanel">
                {tab === "outlook" ? (
                  <OutlookPanel run={run} value={layerId} lang={L}
                                onChange={(id) => { setLayerId(id); setMobileOpen(false); }} />
                ) : null}
                {tab === "areas" && areasLevel ? (
                  <AreasPanel run={run} lang={L} level={areasLevel} onLevel={setAreasLevel} summary={areasSummary}
                              layer={layer} selectedId={selection?.kind === "area" ? selection.id : null} onPick={pickArea} />
                ) : null}
                {tab === "data" && profile ? <DataPanel run={run} profile={profile} layer={layer} lang={L} /> : null}
              </div>
            </>
          ) : null}
        </aside>
      )}

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
            basemap={basemap}
            opacity={opacity}
            focus={focus}
            onReady={setMapObj}
          />
        ) : <div className="map" />}

        {run ? (
          <MapControls map={mapObj} bbox={run.bbox} basemap={basemap.id} options={basemaps} onBasemap={setBasemapId}
                       labels={{ zoomIn: t(L, "zoomIn"), zoomOut: t(L, "zoomOut"), fit: t(L, "fit"), basemap: t(L, "basemap") }} />
        ) : null}

        {run && run.areas.length ? (
          <div className="showby" role="group" aria-label={t(L, "showBy")}>
            <span>{t(L, "showBy")}</span>
            {[{ level: GRID, label: t(L, "grid") }, ...run.areas.map((a) => ({ level: a.level, label: tx(a.label, L) }))].map((o) => (
              <button key={o.level} type="button" className={by === o.level ? "is-on" : ""} aria-pressed={by === o.level}
                      onClick={() => { setBy(o.level); setSelection(null); }}>
                {o.label}
              </button>
            ))}
          </div>
        ) : null}

        {run && layer ? (
          <div className="legend-dock">
            <Legend layer={layer} lang={L} init={run.init} groupIcon={groupIcon} opacity={opacity} onOpacity={setOpacity}
                    groupLabel={group ? tx(group.label, L) : undefined} position={position} onStep={step}
                    picker={(close) => (
                      <OutlookPanel run={run} value={layerId} lang={L} autoFocus
                                    onChange={(id) => { setLayerId(id); close(); }} />
                    )} />
          </div>
        ) : null}

        {run && selection ? (
          <DetailPanel run={run} selection={selection} area={selArea} parents={parents} levelLabel={selLevelLabel}
                       point={point} lang={L} onClose={() => setSelection(null)} current={layerId} onLayer={setLayerId} />
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
