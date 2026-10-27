"use client";

import { useEffect, useMemo, useRef } from "react";
import { geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";

// ISO 3166 alpha-2 -> numeric ids used by world-atlas (Africa + a few neighbours).
const ISO_NUM: Record<string, string> = {
  DZ: "012", AO: "024", BJ: "204", BW: "072", BF: "854", BI: "108", CV: "132", CM: "120", CF: "140",
  TD: "148", KM: "174", CG: "178", CD: "180", CI: "384", DJ: "262", EG: "818", GQ: "226", ER: "232",
  SZ: "748", ET: "231", GA: "266", GM: "270", GH: "288", GN: "324", GW: "624", KE: "404", LS: "426",
  LR: "430", LY: "434", MG: "450", MW: "454", ML: "466", MR: "478", MU: "480", MA: "504", MZ: "508",
  NA: "516", NE: "562", NG: "566", RW: "646", ST: "678", SN: "686", SC: "690", SL: "694", SO: "706",
  ZA: "710", SS: "728", SD: "729", TZ: "834", TG: "768", TN: "788", UG: "800", ZM: "894", ZW: "716",
  EH: "732", YE: "887", SA: "682", OM: "512",
};

const SPHERE: GeoPermissibleObjects = { type: "Sphere" };

export interface GlobeCountry { iso2?: string | null; name: string; ready: boolean }

/** Orthographic globe that swings gently around Africa, with the app's countries
 *  highlighted (gold = forecast published, sand = coming soon). */
export default function Globe({ countries, className = "" }: { countries: GlobeCountry[]; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const key = useMemo(() => JSON.stringify(countries), [countries]);

  useEffect(() => {
    const el = canvasRef.current;
    const context = el?.getContext("2d");
    if (!el || !context) return;
    const canvas: HTMLCanvasElement = el;
    const ctx: CanvasRenderingContext2D = context;
    const list: GlobeCountry[] = JSON.parse(key);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const projection = geoOrthographic().precision(0.4);
    const path = geoPath(projection, ctx);
    const graticule = geoGraticule10();
    let land: Feature<Geometry>[] = [];
    let ready: Feature<Geometry>[] = [];
    let soon: Feature<Geometry>[] = [];
    let raf = 0;
    let cancelled = false;
    const t0 = performance.now();

    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.round(Math.max(r.width, 1) * dpr);
      canvas.height = Math.round(Math.max(r.height, 1) * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { w: Math.max(r.width, 1), h: Math.max(r.height, 1) };
    };
    let dims = size();
    const onResize = () => { dims = size(); };
    window.addEventListener("resize", onResize);

    const fillAll = (fs: Feature<Geometry>[]) => { ctx.beginPath(); fs.forEach((f) => path(f)); };

    function draw(now: number) {
      const { w, h } = dims;
      const r = Math.min(w, h) / 2 - 2;
      const swing = reduced ? 0 : Math.sin((now - t0) / 9000) * 38;
      projection.scale(r).translate([w / 2, h / 2]).rotate([-(20 + swing), -2]);
      ctx.clearRect(0, 0, w, h);

      ctx.beginPath(); path(SPHERE);
      const ocean = ctx.createRadialGradient(w / 2 - r * 0.35, h / 2 - r * 0.4, r * 0.1, w / 2, h / 2, r);
      ocean.addColorStop(0, "#2f6b72");
      ocean.addColorStop(0.6, "#17434a");
      ocean.addColorStop(1, "#0a2226");
      ctx.fillStyle = ocean; ctx.fill();

      ctx.beginPath(); path(graticule);
      ctx.lineWidth = 0.5; ctx.strokeStyle = "rgba(242, 222, 170, 0.10)"; ctx.stroke();

      fillAll(land);
      ctx.fillStyle = "rgba(166, 160, 118, 0.92)"; ctx.fill();
      ctx.lineWidth = 0.4; ctx.strokeStyle = "rgba(40, 46, 30, 0.55)"; ctx.stroke();

      if (soon.length) {
        fillAll(soon);
        ctx.fillStyle = "rgba(236, 214, 160, 0.95)"; ctx.fill();
      }
      if (ready.length) {
        fillAll(ready);
        ctx.fillStyle = "rgba(232, 168, 64, 0.98)"; ctx.fill();
        ctx.save();
        ctx.lineJoin = "round"; ctx.shadowColor = "rgba(255, 220, 140, 0.9)"; ctx.shadowBlur = 10;
        ctx.lineWidth = 1.6; ctx.strokeStyle = "rgba(255, 236, 180, 0.98)"; ctx.stroke();
        ctx.restore();
      }

      ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
      ctx.lineWidth = 1; ctx.strokeStyle = "rgba(242, 222, 170, 0.35)"; ctx.stroke();
    }

    const tick = (now: number) => {
      if (cancelled) return;
      draw(now);
      if (!reduced) raf = requestAnimationFrame(tick);
    };

    import("world-atlas/countries-110m.json").then((mod) => {
      if (cancelled) return;
      const topo = (mod.default ?? mod) as unknown as { objects: { countries: unknown } };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fc = feature(topo as any, (topo as any).objects.countries) as unknown as
        FeatureCollection<Geometry, { name?: string }>;
      land = fc.features;
      const match = (c: GlobeCountry) => (f: Feature<Geometry, { name?: string }>) =>
        (c.iso2 && ISO_NUM[c.iso2.toUpperCase()] === String(f.id)) || f.properties?.name === c.name;
      ready = fc.features.filter((f) => list.some((c) => c.ready && match(c)(f)));
      soon = fc.features.filter((f) => list.some((c) => !c.ready && match(c)(f)));
      raf = requestAnimationFrame(tick);
    }).catch(() => undefined);

    return () => { cancelled = true; cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, [key]);

  return (
    <div className={`globe ${className}`}>
      <canvas ref={canvasRef} aria-hidden />
    </div>
  );
}
