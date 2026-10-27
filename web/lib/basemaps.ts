// Background maps. Tile services need attribution, shown in the map corner.
export type BasemapId = "light" | "streets" | "satellite" | "terrain" | "custom";

export interface Basemap {
  id: BasemapId;
  label: string;
  preview: string;          // CSS background for the picker swatch
  url: string;
  labels?: string;          // optional label overlay drawn above the data
  attribution: string;
}

const OSM = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const ESRI = "Tiles © Esri and the GIS user community";

export const BASEMAPS: Basemap[] = [
  { id: "light", label: "Light", preview: "linear-gradient(135deg,#f6f3ec,#e3e7e1)",
    url: "https://{a-d}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png",
    labels: "https://{a-d}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}.png",
    attribution: `${OSM}, © <a href="https://carto.com/attributions">CARTO</a>` },
  { id: "streets", label: "Streets", preview: "linear-gradient(135deg,#f2efe9,#cfe3c8 55%,#aad3df)",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: OSM },
  { id: "satellite", label: "Satellite", preview: "linear-gradient(135deg,#2b3a24,#5b6b3a 50%,#1d2a33)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    labels: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    attribution: `${ESRI}, Maxar, Earthstar Geographics` },
  { id: "terrain", label: "Terrain", preview: "linear-gradient(135deg,#efe6cf,#c9d6a8 50%,#a9c1c9)",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: ESRI },
];

export function customBasemap(url: string): Basemap {
  return { id: "custom", label: "Country map", preview: "linear-gradient(135deg,#eee,#ccc)", url, attribution: "" };
}
