import type { AreaValue, Legend } from "./types";
import { t, tx } from "./i18n";

export function locale(lang: string) {
  return lang === "en" ? "en-GB" : lang;
}

export function fmtDate(iso: string, lang: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) {
  const d = new Date(iso + "T00:00:00Z");
  try {
    return new Intl.DateTimeFormat(locale(lang), { ...opts, timeZone: "UTC" }).format(d);
  } catch {
    return iso;
  }
}

export function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + Math.round(n));
  return d.toISOString().slice(0, 10);
}

/** Human value for one layer at one place (numbers, classes, onset dates). */
export function fmtValue(v: number | null | undefined, legend: Legend | null, init: string, lang: string): string {
  if (v == null || Number.isNaN(v)) {
    return legend?.format === "days_from_init" ? t(lang, "noOnset") : "–";
  }
  if (legend?.type === "categorical") {
    const c = legend.classes?.find((k) => k.value === Math.round(v));
    return c ? tx(c.label, lang) : String(v);
  }
  if (legend?.format === "index") return `${indexLabel(v, lang)} (${v.toFixed(2)})`;
  if (legend?.format === "days_from_init") {
    return `${t(lang, "around")} ${fmtDate(addDays(init, v), lang, { day: "numeric", month: "long" })}`;
  }
  const units = legend?.units ?? "";
  const digits = Math.abs(v) >= 10 ? 0 : 1;
  const r = Number(v.toFixed(digits)) || 0;           // also turns -0 into 0
  const n = new Intl.NumberFormat(locale(lang), { maximumFractionDigits: digits }).format(r);
  if (units === "%") return `${r > 0 && legend?.id?.includes("anomaly") ? "+" : ""}${n}%`;
  return units ? `${n} ${units}` : n;
}

export function areaNumber(v: AreaValue): number | null {
  if (!v) return null;
  if ("majority" in v) return v.majority;
  return v.mean;
}

/** 0-1 scores from the indices engine, in plain words (thirds of the 0-1 range). */
export function indexLabel(v: number, lang: string): string {
  return t(lang, v < 1 / 3 ? "indexLow" : v < 2 / 3 ? "indexModerate" : "indexHigh");
}

export function legendTicks(legend: Legend, lang: string, init: string): string[] {
  if (legend.format === "index") return ["indexLow", "indexModerate", "indexHigh"].map((k) => t(lang, k));
  const [lo, hi] = legend.range ?? [0, 1];
  const mid = (lo + hi) / 2;
  return [lo, mid, hi].map((x) =>
    legend.format === "days_from_init" ? fmtDate(addDays(init, x), lang, { day: "numeric", month: "short" }) : fmtValue(x, legend, init, lang),
  );
}
