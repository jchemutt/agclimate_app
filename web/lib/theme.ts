import type { CSSProperties } from "react";
import type { CountryTheme } from "./types";

/** Per-country accent colours (profile `theme`) as CSS variables. */
export function themeVars(theme?: CountryTheme | null): CSSProperties {
  const v: Record<string, string> = {};
  if (theme?.primary) {
    v["--primary"] = theme.primary;
    v["--primary-dark"] = shade(theme.primary, -0.28);
    v["--primary-soft"] = hexAlpha(theme.primary, 0.12);
  }
  if (theme?.accent) v["--accent"] = theme.accent;
  return v as CSSProperties;
}

function hexAlpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function shade(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) =>
    Math.round(f < 0 ? x * (1 + f) : x + (255 - x) * f),
  );
  return `#${c.map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}
