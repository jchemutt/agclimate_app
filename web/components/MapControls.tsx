"use client";

import { useEffect, useRef, useState } from "react";
import type OlMap from "ol/Map";
import { transformExtent } from "ol/proj";
import { Check, Layers, Maximize, Minus, Plus } from "lucide-react";
import { BASEMAPS, type Basemap, type BasemapId } from "@/lib/basemaps";

interface Props {
  map: OlMap | null;
  bbox: number[] | null;
  basemap: BasemapId;
  options?: Basemap[];
  onBasemap: (id: BasemapId) => void;
  labels: { zoomIn: string; zoomOut: string; fit: string; basemap: string };
}

export default function MapControls({ map, bbox, basemap, options = BASEMAPS, onBasemap, labels }: Props) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const out = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", out);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", out);
      document.removeEventListener("keydown", esc);
    };
  }, []);

  const zoom = (d: number) => {
    const v = map?.getView();
    if (v) v.animate({ zoom: (v.getZoom() ?? 6) + d, duration: 200 });
  };
  const fit = () => {
    if (map && bbox) map.getView().fit(transformExtent(bbox, "EPSG:4326", "EPSG:3857"), { padding: [72, 40, 40, 40], duration: 400 });
  };
  const current = options.find((o) => o.id === basemap) ?? options[0];

  return (
    <div className="map-controls" ref={box}>
      <div className="ctl-stack">
        <button type="button" onClick={() => zoom(1)} aria-label={labels.zoomIn} title={labels.zoomIn}><Plus size={18} /></button>
        <button type="button" onClick={() => zoom(-1)} aria-label={labels.zoomOut} title={labels.zoomOut}><Minus size={18} /></button>
        <button type="button" onClick={fit} aria-label={labels.fit} title={labels.fit}><Maximize size={16} /></button>
      </div>
      <div className="basemap">
        <button type="button" className="basemap-btn" aria-expanded={open} aria-haspopup="listbox"
                onClick={() => setOpen((o) => !o)} title={labels.basemap}>
          <span className="swatch-lg" style={{ background: current.preview }} />
          <Layers size={16} aria-hidden />
        </button>
        {open ? (
          <ul className="basemap-menu" role="listbox" aria-label={labels.basemap}>
            {options.map((o) => (
              <li key={o.id}>
                <button type="button" role="option" aria-selected={o.id === basemap}
                        className={o.id === basemap ? "is-on" : ""}
                        onClick={() => { onBasemap(o.id); setOpen(false); }}>
                  <span className="swatch-lg" style={{ background: o.preview }} />
                  <span>{o.label}</span>
                  {o.id === basemap ? <Check size={15} aria-hidden /> : null}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
