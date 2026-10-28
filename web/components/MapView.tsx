"use client";

import { useEffect, useRef } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import TileLayer from "ol/layer/Tile";
import WebGLTileLayer from "ol/layer/WebGLTile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import XYZ from "ol/source/XYZ";
import GeoTIFF from "ol/source/GeoTIFF";
import GeoJSONFormat from "ol/format/GeoJSON";
import { Fill, Stroke, Style, Circle as CircleStyle } from "ol/style";
import Attribution from "ol/control/Attribution";
import ScaleLine from "ol/control/ScaleLine";
import { getCenter } from "ol/extent";
import { fromLonLat, toLonLat, transformExtent } from "ol/proj";
import type { FeatureLike } from "ol/Feature";
import type { Polygon, MultiPolygon } from "ol/geom";
import "ol/ol.css";

import type { AreaSummary, LayerInfo, RunView, Selection } from "@/lib/types";
import type { Basemap } from "@/lib/basemaps";
import { colorFor, css, webglColor } from "@/lib/color";
import { areaNumber, fmtValue } from "@/lib/format";
import { api } from "@/lib/api";

const INK = "#1f2a2e";
/** Boundary line colours: dark on light basemaps, light on imagery. */
function lines(dark: boolean) {
  return dark
    ? { sel: "#ffffff", hover: "rgba(255,255,255,0.95)", base: "rgba(255,255,255,0.45)", outline: "rgba(255,255,255,0.7)" }
    : { sel: INK, hover: "rgba(31,42,46,0.9)", base: "rgba(31,42,46,0.4)", outline: "rgba(31,42,46,0.55)" };
}

export interface Focus { level: string; id: string; nonce: number }

interface Props {
  run: RunView;
  layer: LayerInfo | null;
  levelUrl: string | null;          // boundaries of the "show by" level (null = grid)
  outlineUrl: string | null;        // top admin level, drawn as outlines in grid view
  summary: AreaSummary | null;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
  lang: string;
  center: [number, number] | null;
  zoom: number;
  basemap: Basemap;
  opacity: number;
  focus: Focus | null;
  levelKey: string | null;
  onReady?: (map: OlMap) => void;
}

export default function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const map = useRef<OlMap | null>(null);
  const base = useRef<TileLayer<XYZ> | null>(null);
  const labels = useRef<TileLayer<XYZ> | null>(null);
  const grid = useRef<WebGLTileLayer | null>(null);
  const areas = useRef<VectorLayer<VectorSource> | null>(null);
  const outline = useRef<VectorLayer<VectorSource> | null>(null);
  const marker = useRef<VectorSource>(new VectorSource());
  const hoverId = useRef<string | null>(null);
  const state = useRef(p);
  state.current = p;

  // -------------------------------------------------------------- map, once
  useEffect(() => {
    if (!el.current) return;
    const m = new OlMap({
      target: el.current,
      controls: [new Attribution({ collapsible: true }), new ScaleLine({ units: "metric", minWidth: 80 })],
      view: new View({ center: fromLonLat(p.center ?? [0, 0]), zoom: p.zoom, maxZoom: 13, minZoom: 3 }),
    });
    base.current = new TileLayer({ zIndex: 0 });
    labels.current = new TileLayer({ zIndex: 4 });
    m.addLayer(base.current);
    m.addLayer(labels.current);
    const vector = (z: number) => {
      const l = new VectorLayer({ source: new VectorSource(), zIndex: z });
      m.addLayer(l);
      return l;
    };
    areas.current = vector(2);
    outline.current = vector(3);
    m.addLayer(new VectorLayer({ source: marker.current, zIndex: 5, style: markerStyle }));

    m.on("singleclick", (e) => {
      const [lon, lat] = toLonLat(e.coordinate);
      const s = state.current;
      if (s.levelKey) {
        const f = m.forEachFeatureAtPixel(e.pixel, (f) => f, { layerFilter: (l) => l === areas.current });
        if (f) {
          s.onSelect({ kind: "area", level: s.levelKey, id: String(f.get("id")), lat, lon });
          return;
        }
      }
      s.onSelect({ kind: "point", lat, lon });
    });
    m.on("pointermove", (e) => {
      if (e.dragging || !tip.current) return;
      const s = state.current;
      const f = s.levelKey ? m.forEachFeatureAtPixel(e.pixel, (f) => f, { layerFilter: (l) => l === areas.current }) : null;
      const target = m.getTargetElement();
      if (target) target.style.cursor = f || !s.levelKey ? "pointer" : "";
      const id = f ? String(f.get("id")) : null;
      if (id !== hoverId.current) {
        hoverId.current = id;
        areas.current?.changed();          // redraw hover outline
      }
      const box = tip.current;
      if (!f) {
        box.hidden = true;
        return;
      }
      const rec = lookup(s.summary, String(f.get("id")));
      const v = rec && s.layer ? areaNumber(rec.values[s.layer.id]) : null;
      box.hidden = false;
      box.style.transform = `translate(${e.pixel[0] + 16}px, ${e.pixel[1] + 16}px)`;
      box.replaceChildren();
      const name = document.createElement("strong");
      name.textContent = String(f.get("name"));
      const val = document.createElement("span");
      val.textContent = fmtValue(v, s.layer?.legend ?? null, s.run.init, s.lang);
      box.append(name, val);
    });
    m.getViewport()?.addEventListener("pointerleave", () => {
      if (tip.current) tip.current.hidden = true;
      hoverId.current = null;
      areas.current?.changed();
    });
    map.current = m;
    p.onReady?.(m);
    return () => m.setTarget(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------- basemap
  useEffect(() => {
    const b = p.basemap;
    base.current?.setSource(new XYZ({ url: b.url, attributions: b.attribution || undefined, crossOrigin: "anonymous", maxZoom: 19 }));
    labels.current?.setSource(b.labels ? new XYZ({ url: b.labels, crossOrigin: "anonymous" }) : null);
  }, [p.basemap]);

  // -------------------------------------------------------------- fit to the run
  useEffect(() => {
    const m = map.current;
    if (!m || !p.run.bbox) return;
    m.getView().fit(transformExtent(p.run.bbox, "EPSG:4326", "EPSG:3857"), { padding: [72, 40, 40, 40], maxZoom: 9 });
  }, [p.run.country, p.run.bbox]);

  // -------------------------------------------------------------- grid layer (COG)
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (grid.current) {
      m.removeLayer(grid.current);
      grid.current.dispose();
      grid.current = null;
    }
    if (!p.layer?.legend || p.levelKey) return;
    const url = new URL(p.layer.cog_url, window.location.href).toString();
    const layer = new WebGLTileLayer({
      zIndex: 1,
      opacity: state.current.opacity,
      source: new GeoTIFF({ sources: [{ url }], normalize: false, interpolate: false }),
      style: { color: webglColor(p.layer.legend) as never },
    });
    m.addLayer(layer);
    grid.current = layer;
  }, [p.layer, p.levelKey]);

  useEffect(() => {
    grid.current?.setOpacity(p.opacity);
    areas.current?.changed();
  }, [p.opacity]);

  // -------------------------------------------------------------- areas (choropleth)
  useEffect(() => {
    const src = areas.current?.getSource();
    if (!src) return;
    src.clear();
    if (!p.levelUrl) return;
    let live = true;
    api.boundaries(p.levelUrl).then((gj) => {
      if (!live) return;
      src.addFeatures(new GeoJSONFormat().readFeatures(gj, { featureProjection: "EPSG:3857" }));
      focusIfPending();
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.levelUrl]);

  useEffect(() => {
    const lyr = areas.current;
    if (!lyr) return;
    lyr.setStyle((f: FeatureLike) => {
      const s = state.current;
      const sel = s.selection?.kind === "area" ? s.selection.id : null;
      const rec = lookup(s.summary, String(f.get("id")));
      const lg = s.layer?.legend ?? null;
      const c = rec && lg ? colorFor(areaNumber(rec.values[s.layer!.id]), lg) : null;
      const isSel = sel === f.get("id");
      const ln = lines(s.basemap.id === "satellite");
      const isHover = hoverId.current === f.get("id");
      return new Style({
        fill: new Fill({ color: c ? css(c, 0.9 * s.opacity) : "rgba(255,255,255,0.3)" }),
        stroke: new Stroke({
          color: isSel ? ln.sel : isHover ? ln.hover : ln.base,
          width: isSel ? 3 : isHover ? 1.8 : 0.6,
        }),
        zIndex: isSel ? 10 : isHover ? 5 : 0,
      });
    });
  }, [p.summary, p.layer, p.selection, p.levelUrl, p.basemap]);

  // -------------------------------------------------------------- outlines in grid view
  useEffect(() => {
    const lyr = outline.current;
    const src = lyr?.getSource();
    if (!lyr || !src) return;
    src.clear();
    lyr.setStyle(new Style({ stroke: new Stroke({ color: lines(p.basemap.id === "satellite").outline, width: 0.8 }) }));
    if (!p.outlineUrl || p.levelKey) return;
    let live = true;
    api.boundaries(p.outlineUrl).then((gj) => {
      if (live) src.addFeatures(new GeoJSONFormat().readFeatures(gj, { featureProjection: "EPSG:3857" }));
    });
    return () => {
      live = false;
    };
  }, [p.outlineUrl, p.levelKey, p.basemap]);

  // -------------------------------------------------------------- zoom to an area picked in the sidebar
  const pendingFocus = useRef<Focus | null>(null);
  function focusIfPending() {
    const f = pendingFocus.current;
    const m = map.current;
    const src = areas.current?.getSource();
    if (!f || !m || !src || state.current.levelKey !== f.level) return;
    const feat = src.getFeatures().find((x) => String(x.get("id")) === f.id);
    if (!feat) return;
    pendingFocus.current = null;
    const geom = feat.getGeometry() as Polygon | MultiPolygon | undefined;
    if (!geom) return;
    m.getView().fit(geom.getExtent(), { padding: [90, 440, 60, 60], maxZoom: 10, duration: 500 });
    let pt: number[] = getCenter(geom.getExtent());
    if (geom.getType() === "MultiPolygon") {
      const largest = (geom as MultiPolygon).getPolygons().sort((a, b) => b.getArea() - a.getArea())[0];
      if (largest) pt = largest.getInteriorPoint().getCoordinates();
    } else if (geom.getType() === "Polygon") {
      pt = (geom as Polygon).getInteriorPoint().getCoordinates();
    }
    const [lon, lat] = toLonLat(pt.slice(0, 2));
    state.current.onSelect({ kind: "area", level: f.level, id: f.id, lat, lon });
  }
  useEffect(() => {
    if (!p.focus) return;
    pendingFocus.current = p.focus;
    focusIfPending();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.focus, p.levelKey]);

  // -------------------------------------------------------------- marker
  useEffect(() => {
    marker.current.clear();
    if (p.selection) marker.current.addFeature(new Feature(new Point(fromLonLat([p.selection.lon, p.selection.lat]))));
  }, [p.selection]);

  return (
    <div className="map-wrap">
      <div ref={el} className="map" role="application" aria-label="Forecast map" />
      <div ref={tip} className="map-tip" hidden />
    </div>
  );
}

const markerStyle = new Style({
  image: new CircleStyle({ radius: 7, fill: new Fill({ color: "#ffffff" }), stroke: new Stroke({ color: INK, width: 3 }) }),
});

const index = new WeakMap<AreaSummary, Map<string, AreaSummary["areas"][number]>>();
function lookup(s: AreaSummary | null, id: string) {
  if (!s) return null;
  let m = index.get(s);
  if (!m) {
    m = new Map(s.areas.map((a) => [a.id, a]));
    index.set(s, m);
  }
  return m.get(id) ?? null;
}
