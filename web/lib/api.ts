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

const V1 = "/api/v1";

export const api = {
  countries: () => get<CountrySummary[]>(`${V1}/countries`),
  profile: (c: string) => get<Profile>(`${V1}/countries/${c}`),
  runs: (c: string) => get<RunListItem[]>(`${V1}/countries/${c}/runs`),
  run: (c: string, init = "latest") => get<RunView>(`${V1}/countries/${c}/runs/${init}`),
  areas: (url: string) => get<AreaSummary>(url),
  boundaries: (url: string) => get<object>(url),
  point: (c: string, init: string, lat: number, lon: number) =>
    get<PointResult>(`${V1}/countries/${c}/runs/${init}/point?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`),
};
