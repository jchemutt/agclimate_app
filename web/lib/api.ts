import type { AreaSummary, CountrySummary, PointResult, Profile, RunListItem, RunView } from "./types";

const cache = new Map<string, Promise<unknown>>();

async function get<T>(url: string, { memo = true } = {}): Promise<T> {
  if (memo && cache.has(url)) return cache.get(url) as Promise<T>;
  const p = fetch(url).then(async (r) => {
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      throw Object.assign(new Error(body.detail || `${r.status} ${url}`), { status: r.status });
    }
    return r.json() as Promise<T>;
  });
  if (memo) {
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

export const api = {
  countries: () => get<CountrySummary[]>("/api/countries"),
  profile: (c: string) => get<Profile>(`/api/countries/${c}/profile`),
  runs: (c: string) => get<RunListItem[]>(`/api/countries/${c}/runs`),
  run: (c: string, init = "latest") => get<RunView>(`/api/countries/${c}/runs/${init}`),
  areas: (url: string) => get<AreaSummary>(url),
  boundaries: (url: string) => get<object>(url),
  point: (c: string, init: string, lat: number, lon: number) =>
    get<PointResult>(`/api/countries/${c}/runs/${init}/point?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`),
};
