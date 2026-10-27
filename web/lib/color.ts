import type { Legend } from "./types";

export type RGBA = [number, number, number, number];

export function hexToRgba(hex: string, alpha = 1): RGBA {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

/** Colour of a value under a legend (used by choropleths and swatches). */
export function colorFor(v: number | null | undefined, legend: Legend | null): RGBA | null {
  if (v == null || Number.isNaN(v) || !legend) return null;
  if (legend.type === "categorical") {
    const c = legend.classes?.find((k) => k.value === Math.round(v));
    return c ? hexToRgba(c.color) : null;
  }
  const stops = legend.stops ?? [];
  if (!stops.length) return null;
  if (v <= stops[0].value) return hexToRgba(stops[0].color);
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1], b = stops[i];
    if (v <= b.value) {
      const f = (v - a.value) / (b.value - a.value || 1);
      const ca = hexToRgba(a.color), cb = hexToRgba(b.color);
      return [0, 1, 2].map((k) => Math.round(ca[k] + (cb[k] - ca[k]) * f)).concat(1) as RGBA;
    }
  }
  return hexToRgba(stops[stops.length - 1].color);
}

export const css = (c: RGBA | null, alpha?: number) =>
  c ? `rgba(${c[0]},${c[1]},${c[2]},${alpha ?? c[3]})` : "transparent";

/** OpenLayers WebGL style expression for a single-band GeoTIFF. Band 2 is the
 *  alpha band OpenLayers adds for nodata pixels. */
export function webglColor(legend: Legend): unknown {
  const transparent = [0, 0, 0, 0];
  let body: unknown;
  if (legend.type === "categorical") {
    const pairs = (legend.classes ?? []).flatMap((c) => [c.value, hexToRgba(c.color)]);
    body = ["match", ["round", ["band", 1]], ...pairs, transparent];
  } else {
    const stops = (legend.stops ?? []).flatMap((s) => [s.value, hexToRgba(s.color)]);
    body = ["interpolate", ["linear"], ["band", 1], ...stops];
  }
  return ["case", ["==", ["band", 2], 0], transparent, body];
}
