// Shapes returned by the API (api/app/main.py).

export type Text = string | Record<string, string>;

export interface CountryTheme { primary?: string; accent?: string }

export interface CountrySummary {
  id: string;
  name: Text;
  flag: string;
  iso2?: string | null;
  description?: Text | null;
  theme?: CountryTheme | null;
  languages: string[];
  default_language: string;
  latest: { init: string; season: Season } | null;
}

export interface Season {
  id: string | null;
  label: Text;
}

export interface Profile {
  id: string;
  name: Text;
  flag: string;
  iso2?: string | null;
  description?: Text | null;
  theme?: CountryTheme | null;
  languages: string[];
  default_language: string;
  map: { center: [number, number] | null; zoom: number; bbox: number[] | null; basemap: string | null };
  links: { name: Text; url: string }[];
  attribution: Text | null;
}

export interface LegendStop { value: number; color: string }
export interface LegendClass { value: number; label: Text; color: string }

export interface Legend {
  id: string;
  title: Text;
  units?: string;
  type: "continuous" | "categorical";
  description?: string;
  format?: string;
  range?: [number, number];
  stops?: LegendStop[];
  classes?: LegendClass[];
  stats?: { min: number; max: number; mean: number } | null;
}

export interface LayerInfo {
  id: string;
  type: "continuous" | "categorical";
  units: string;
  title: Text;
  description: Text | null;
  cog_url: string;
  legend: Legend | null;
  advisories: Record<string, Text> | null;
}

export interface AreaLevel {
  level: string;
  label: Text;
  count: number;
  summary_url: string;
  boundaries_url: string;
}

export interface RunView {
  country: string;
  init: string;
  season: Season;
  valid_from: string;
  valid_to: string;
  members: number;
  created: string;
  bbox: [number, number, number, number];
  layers: Record<string, LayerInfo>;
  groups: { id: string; label: Text; layers: string[]; icon?: string | null }[];
  default_layer: string | null;
  areas: AreaLevel[];
  point_query: boolean;
  terciles: { baseline: number[]; years_used: number } | null;
}

export interface RunListItem {
  init: string;
  valid_from: string;
  valid_to: string;
  season: Season;
}

export type AreaValue =
  | { mean: number; min: number; max: number }
  | { majority: number; share: Record<string, number> }
  | null;

export interface AreaRecord {
  id: string;
  name: string;
  parent_id: string | null;
  values: Record<string, AreaValue>;
  coverage?: number;
}

export interface AreaSummary {
  level: string;
  layers: string[];
  areas: AreaRecord[];
}

export interface PointResult {
  lat: number;
  lon: number;
  inside: boolean;
  layers: Record<string, number | null>;
  members?: Record<string, (number | null)[]>;
  terciles?: { p33?: number | null; p66?: number | null; bn?: number | null; nn?: number | null; an?: number | null } | null;
}

export type Selection =
  | { kind: "point"; lat: number; lon: number }
  | { kind: "area"; level: string; id: string; lat: number; lon: number };
