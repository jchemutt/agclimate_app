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
import { defaults as defaultControls } from "ol/control/defaults";
import { fromLonLat, toLonLat, transformExtent } from "ol/proj";
import type { FeatureLike } from "ol/Feature";
import "ol/ol.css";

import type { AreaSummary, LayerInfo, RunView, Selection } from "@/lib/types";
import { colorFor, css, webglColor } from "@/lib/color";
import { areaNumber, fmtValue } from "@/lib/format";
import { api } from "@/lib/api";

const BASE = "https://{a-d}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png";
const LABELS = "https://{a-d}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png";
const BASE_ATTRIB = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, © <a href="https://carto.com/attributions">CARTO</a>';
const INK = "#1f2d36";

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
  basemap: string | null;
  levelKey: string | null;
}

export default function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const map = useRef<OlMap | null>(null);
  const grid = useRef<WebGLTileLayer | null>(null);
  const areas = useRef<VectorLayer<VectorSource> | null>(null);
  const outline = useRef<VectorLayer<VectorSource> | null>(null);
  const marker = useRef<VectorSource>(new VectorSource());
  const state = useRef(p);
  state.current = p;

  // -------------------------------------------------------------- map, once
  useEffect(() => {
    if (!el.current) return;
    const base = p.basemap ?? BASE;
    const m = new OlMap({
      target: el.current,
      controls: defaultControls({ rotate: false, attributionOptions: { collapsible: true } }),
      layers: [
        new TileLayer({ source: new XYZ({ url: base, attributions: BASE_ATTRIB, crossOrigin: "anonymous" }) }),
      ],
      view: new View({ center: fromLonLat(p.center ?? [0, 0]), zoom: p.zoom, maxZoom: 12, minZoom: 3 }),
    });
    const vector = (z: number) => {
      const l = new VectorLayer({ source: new VectorSource(), zIndex: z });
      m.addLayer(l);
      return l;
    };
    areas.current = vector(2);
    outline.current = vector(3);
    if (!p.basemap) m.addLayer(new TileLayer({ zIndex: 4, source: new XYZ({ url: LABELS, crossOrigin: "anonymous" }) }));
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
      if (target) target.style.cursor = f || !s.levelKey ? "crosshair" : "";
      if (!f) {
        tip.current.hidden = true;
        return;
      }
      const rec = lookup(s.summary, String(f.get("id")));
      const v = rec && s.layer ? areaNumber(rec.values[s.layer.id]) : null;
      const box = tip.current;
      box.hidden = false;
      box.style.transform = `translate(${e.pixel[0] + 14}px, ${e.pixel[1] + 14}px)`;
      box.textContent = `${f.get("name")}: ${fmtValue(v, s.layer?.legend ?? null, s.run.init, s.lang)}`;
    });
    m.getViewport()?.addEventListener("pointerleave", () => {
      if (tip.current) tip.current.hidden = true;
    });
    map.current = m;
    return () => m.setTarget(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------- fit to the run
  useEffect(() => {
    const m = map.current;
    if (!m || !p.run.bbox) return;
    m.getView().fit(transformExtent(p.run.bbox, "EPSG:4326", "EPSG:3857"), { padding: [24, 24, 24, 24], maxZoom: 9 });
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
      opacity: 0.88,
      source: new GeoTIFF({ sources: [{ url }], normalize: false, interpolate: false }),
      style: { color: webglColor(p.layer.legend) as never },
    });
    m.addLayer(layer);
    grid.current = layer;
  }, [p.layer, p.levelKey]);

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
    });
    return () => {
      live = false;
    };
  }, [p.levelUrl]);

  useEffect(() => {
    const lyr = areas.current;
    if (!lyr) return;
    const sel = p.selection?.kind === "area" ? p.selection.id : null;
    lyr.setStyle((f: FeatureLike) => {
      const rec = lookup(state.current.summary, String(f.get("id")));
      const lg = state.current.layer?.legend ?? null;
      const c = rec && lg ? colorFor(areaNumber(rec.values[state.current.layer!.id]), lg) : null;
      const isSel = sel === f.get("id");
      return new Style({
        fill: new Fill({ color: c ? css(c, 0.82) : "rgba(255,255,255,0.35)" }),
        stroke: new Stroke({ color: isSel ? INK : "rgba(31,45,54,0.45)", width: isSel ? 2.5 : 0.6 }),
        zIndex: isSel ? 10 : 0,
      });
    });
  }, [p.summary, p.layer, p.selection, p.levelUrl]);

  // -------------------------------------------------------------- outlines in grid view
  useEffect(() => {
    const lyr = outline.current;
    const src = lyr?.getSource();
    if (!lyr || !src) return;
    src.clear();
    lyr.setStyle(new Style({ stroke: new Stroke({ color: "rgba(31,45,54,0.55)", width: 0.8 }) }));
    if (!p.outlineUrl || p.levelKey) return;
    let live = true;
    api.boundaries(p.outlineUrl).then((gj) => {
      if (live) src.addFeatures(new GeoJSONFormat().readFeatures(gj, { featureProjection: "EPSG:3857" }));
    });
    return () => {
      live = false;
    };
  }, [p.outlineUrl, p.levelKey]);

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
  image: new CircleStyle({ radius: 6, fill: new Fill({ color: "#ffffff" }), stroke: new Stroke({ color: INK, width: 2.5 }) }),
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
