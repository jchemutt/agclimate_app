import type { Period, RunView } from "./types";
import { fmtDate } from "./format";
import { tx } from "./i18n";

// The layer menu lists indicators ("bases", e.g. rainfall_total). Each base exists for
// one or more periods (a season, a month, the whole forecast); the map shows the
// layer for the current base *and* period: run.index[base][period].

export function layerIdFor(run: RunView, base: string | null, period: string | null): string | null {
  if (!base || !period) return null;
  return run.index?.[base]?.[period] ?? null;
}

export function availableIn(run: RunView, base: string, period: string | null) {
  return !!layerIdFor(run, base, period);
}

/** Periods (in run order) that have this base. */
export function periodsOf(run: RunView, base: string): Period[] {
  const has = run.index?.[base] ?? {};
  return run.periods.filter((p) => has[p.id]);
}

/** The base actually shown: the chosen one if this period has it, else the profile's
 *  default, else the first base of the menu that the period has. */
export function shownBase(run: RunView, base: string | null, period: string | null): string | null {
  if (base && availableIn(run, base, period)) return base;
  for (const b of run.default_layers ?? []) if (availableIn(run, b, period)) return b;
  if (run.default_layer && availableIn(run, run.default_layer, period)) return run.default_layer;
  return menuOrder(run, period)[0]?.base ?? null;
}

/** Bases in menu order that exist for `period`, with their group. */
export function menuOrder(run: RunView, period: string | null) {
  return run.groups.flatMap((g) => g.layers.filter((b) => availableIn(run, b, period)).map((base) => ({ base, group: g })));
}

/** The base `step` places before/after `current` among this period's layers, wrapping around. */
export function stepLayer(run: RunView, current: string | null, period: string | null, step: number): string | null {
  const all = menuOrder(run, period);
  if (!all.length) return null;
  const i = all.findIndex((x) => x.base === current);
  return all[(((i < 0 ? 0 : i) + step) % all.length + all.length) % all.length].base;
}

export function groupOf(run: RunView, base: string | null) {
  return run.groups.find((g) => g.layers.includes(base ?? "")) ?? null;
}

/** Short label for the period selector: "Short rains", "Nov", "Jan 27", "Whole forecast". */
export function periodLabel(p: Period, lang: string, init: string, long = false): string {
  if (p.kind === "month" && p.start) {
    const otherYear = p.start.slice(0, 4) !== init.slice(0, 4);
    return fmtDate(p.start, lang, long || otherYear ? { month: long ? "long" : "short", year: long ? "numeric" : "2-digit" }
                                                     : { month: "short" });
  }
  return tx(p.label, lang) || p.id;
}

/** Accent-insensitive match for the layer search box. */
export function matches(text: string, query: string) {
  const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const q = norm(query.trim());
  return !q || q.split(/\s+/).every((w) => norm(text).includes(w));
}
