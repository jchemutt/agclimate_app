import type { RunView } from "./types";

/** Every layer in menu order (profile groups first to last), with its group. */
export function layerOrder(run: RunView): { id: string; group: RunView["groups"][number] }[] {
  return run.groups.flatMap((g) => g.layers.filter((id) => run.layers[id]).map((id) => ({ id, group: g })));
}

/** The layer `step` places before/after `current` in menu order, wrapping around. */
export function stepLayer(run: RunView, current: string | null, step: number): string | null {
  const all = layerOrder(run);
  if (!all.length) return null;
  const i = all.findIndex((x) => x.id === current);
  return all[(((i < 0 ? 0 : i) + step) % all.length + all.length) % all.length].id;
}

export function groupOf(run: RunView, id: string | null) {
  return run.groups.find((g) => g.layers.includes(id ?? "")) ?? null;
}

/** Accent-insensitive match for the layer search box. */
export function matches(text: string, query: string) {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = norm(query.trim());
  return !q || q.split(/\s+/).every((w) => norm(text).includes(w));
}
