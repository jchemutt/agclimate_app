"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import type { RunView } from "@/lib/types";
import { t, tx } from "@/lib/i18n";
import { availableIn, groupOf, layerIdFor, matches, periodLabel, periodsOf } from "@/lib/layers";
import { GroupIcon } from "../icons";

const SEARCH_FROM = 8;          // show the search box once a country has this many layers

/** Layer menu: a collapsible card per profile group, with a search box across all
 *  layers. The group holding the current layer opens by itself. Layers the current
 *  period doesn't have are dimmed with the periods that do; choosing one switches period. */
export default function OutlookPanel({ run, value, period, onChange, lang, autoFocus = false }: {
  run: RunView; value: string | null; period: string | null; onChange: (base: string) => void;
  lang: string; autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const activeGroup = groupOf(run, value)?.id ?? null;
  const [open, setOpen] = useState<Set<string>>(() => new Set(activeGroup ? [activeGroup] : []));
  const search = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  // follow the current layer when it changes from elsewhere (legend arrows, keyboard)
  useEffect(() => {
    if (activeGroup) setOpen((o) => (o.has(activeGroup) ? o : new Set(o).add(activeGroup)));
  }, [activeGroup]);
  useEffect(() => {                      // in the map picker: focus search, show the current layer
    if (!autoFocus) return;
    search.current?.focus({ preventScroll: true });
    const box = root.current?.parentElement;
    const on = root.current?.querySelector<HTMLElement>(".layer-option.is-on");
    if (box && on) box.scrollTop = Math.max(0, on.offsetTop - box.clientHeight / 2);
  }, [autoFocus]);

  const total = useMemo(() => run.groups.reduce((n, g) => n + g.layers.length, 0), [run]);
  const searching = query.trim().length > 0;
  // any period's layer gives the base's title/description
  const info = (b: string) => run.layers[layerIdFor(run, b, period) ?? Object.values(run.index?.[b] ?? {})[0] ?? ""];
  const groups = run.groups
    .map((g) => ({
      g,
      ids: g.layers.filter((b) => {
        const l = info(b);
        return l && (!searching || matches(`${tx(l.title, lang)} ${tx(l.description, lang)} ${tx(g.label, lang)}`, query));
      }),
    }))
    .filter((x) => x.ids.length)
    // available layers first; within each, profile order
    .map((x) => ({ ...x, ids: [...x.ids.filter((b) => availableIn(run, b, period)),
                               ...x.ids.filter((b) => !availableIn(run, b, period))] }));
  const elsewhere = (b: string) => {
    const ps = periodsOf(run, b);
    const names = ps.slice(0, 3).map((p) => periodLabel(p, lang, run.init));
    return names.join(" · ") + (ps.length > 3 ? " …" : "");
  };

  const toggle = (id: string) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div className="group-list" ref={root}>
      {total >= SEARCH_FROM ? (
        <label className="layer-search">
          <Search size={16} aria-hidden />
          <input ref={search} type="search" value={query} placeholder={t(lang, "findLayer")} aria-label={t(lang, "findLayer")}
                 onChange={(e) => setQuery(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === "Escape") setQuery("");
                   if (e.key === "Enter" && groups[0]) onChange(groups[0].ids[0]);
                 }} />
          {searching ? (
            <button type="button" onClick={() => setQuery("")} aria-label={t(lang, "close")}><X size={14} /></button>
          ) : null}
        </label>
      ) : null}

      {groups.length === 0 ? <p className="muted small">{t(lang, "noLayerMatch")}</p> : null}

      {groups.map(({ g, ids }) => {
        const isOpen = searching || open.has(g.id);
        const active = g.id === activeGroup;
        const current = active && value ? info(value) : null;
        const here = ids.filter((b) => availableIn(run, b, period)).length;
        return (
          <section key={g.id} className={`group-card${active ? " is-active" : ""}${isOpen ? " is-open" : ""}`}>
            <button type="button" className={`group-head${here ? "" : " is-dim"}`} aria-expanded={isOpen} onClick={() => toggle(g.id)}>
              <span className="group-icon"><GroupIcon name={g.icon ?? g.id} /></span>
              <span className="group-text">
                <span className="group-name">{tx(g.label, lang)}</span>
                {!isOpen && current ? <span className="group-current">{tx(current.title, lang)}</span> : null}
              </span>
              <span className="group-count">{here}</span>
              <ChevronDown size={16} className="group-chev" aria-hidden />
            </button>
            {isOpen ? (
              <div className="group-options" role="radiogroup" aria-label={tx(g.label, lang)}>
                {ids.map((b) => {
                  const l = info(b);
                  const on = value === b;
                  const avail = availableIn(run, b, period);
                  return (
                    <label key={b} className={`layer-option${on ? " is-on" : ""}${avail ? "" : " is-elsewhere"}`}
                           title={avail ? undefined : t(lang, "otherPeriod")}>
                      <input type="radio" name="layer" value={b} checked={on} onChange={() => onChange(b)} />
                      <span className="layer-text">
                        <span>{tx(l.title, lang)}</span>
                        {!avail ? <span className="layer-periods">{elsewhere(b)}</span> : null}
                        {on && l.description ? <span className="layer-desc">{tx(l.description, lang)}</span> : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
