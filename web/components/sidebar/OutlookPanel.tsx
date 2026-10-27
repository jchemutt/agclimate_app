"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import type { RunView } from "@/lib/types";
import { t, tx } from "@/lib/i18n";
import { groupOf, matches } from "@/lib/layers";
import { GroupIcon } from "../icons";

const SEARCH_FROM = 8;          // show the search box once a country has this many layers

/** Layer menu: a collapsible card per profile group, with a search box across all
 *  layers. The group holding the current layer opens by itself. */
export default function OutlookPanel({ run, value, onChange, lang, autoFocus = false }: {
  run: RunView; value: string | null; onChange: (id: string) => void; lang: string; autoFocus?: boolean;
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
  const groups = run.groups
    .map((g) => ({
      g,
      ids: g.layers.filter((id) => {
        const l = run.layers[id];
        return l && (!searching || matches(`${tx(l.title, lang)} ${tx(l.description, lang)} ${tx(g.label, lang)}`, query));
      }),
    }))
    .filter((x) => x.ids.length);

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
        const current = active && value ? run.layers[value] : null;
        return (
          <section key={g.id} className={`group-card${active ? " is-active" : ""}${isOpen ? " is-open" : ""}`}>
            <button type="button" className="group-head" aria-expanded={isOpen} onClick={() => toggle(g.id)}>
              <span className="group-icon"><GroupIcon name={g.icon ?? g.id} /></span>
              <span className="group-text">
                <span className="group-name">{tx(g.label, lang)}</span>
                {!isOpen && current ? <span className="group-current">{tx(current.title, lang)}</span> : null}
              </span>
              <span className="group-count">{ids.length}</span>
              <ChevronDown size={16} className="group-chev" aria-hidden />
            </button>
            {isOpen ? (
              <div className="group-options" role="radiogroup" aria-label={tx(g.label, lang)}>
                {ids.map((id) => {
                  const l = run.layers[id];
                  const on = value === id;
                  return (
                    <label key={id} className={`layer-option${on ? " is-on" : ""}`}>
                      <input type="radio" name="layer" value={id} checked={on} onChange={() => onChange(id)} />
                      <span className="layer-text">
                        <span>{tx(l.title, lang)}</span>
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
