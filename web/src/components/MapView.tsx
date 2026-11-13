import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { MapContainer, TileLayer, LayersControl, LayerGroup, useMap, useMapEvents } from 'react-leaflet';
import L from '../lib/leaflet';
import type { StaticSite } from '../api/types';
import { AGE_CLASSES } from '../lib/colors';

export type Basemap = 'Light' | 'Satellite' | 'Streets';
const BasemapCtx = createContext<Basemap>('Light');
export const useBasemap = () => useContext(BasemapCtx);

const esri = (svc: string) => `https://server.arcgisonline.com/ArcGIS/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`;
function storedBasemap(): Basemap {
  try { const v = localStorage.getItem('hfc.basemap'); return v === 'Satellite' || v === 'Streets' ? v : 'Light'; } catch { return 'Light'; }
}

/** Creates the labels pane synchronously so label tiles can target it on first render. */
function LabelsPane() {
  const map = useMap();
  if (!map.getPane('labels')) {
    const p = map.createPane('labels');
    p.style.zIndex = '350';
    p.style.pointerEvents = 'none';
  }
  return null;
}

/** Wheel zoom only after the user clicks the map, so page scrolling is never hijacked. */
function WheelGuard() {
  const map = useMap();
  useEffect(() => {
    const on = () => map.scrollWheelZoom.enable(), off = () => map.scrollWheelZoom.disable();
    map.on('click focus', on);
    map.on('mouseout blur', off);
    return () => { map.off('click focus', on); map.off('mouseout blur', off); };
  }, [map]);
  return null;
}

function BasemapWatcher({ onChange }: { onChange: (b: Basemap) => void }) {
  useMapEvents({ baselayerchange: (e) => { const b = e.name as Basemap; onChange(b); try { localStorage.setItem('hfc.basemap', b); } catch { /* ignore */ } } });
  return null;
}

interface MapViewProps {
  center?: [number, number];
  zoom?: number;
  minZoom?: number;
  size?: 'short' | 'normal' | 'tall';
  legend?: ReactNode;
  children?: ReactNode;
  label: string;
}

export function MapView({ center = [7.8, 80.7], zoom = 7, minZoom, size = 'normal', legend, children, label }: MapViewProps) {
  const [basemap, setBasemap] = useState<Basemap>(storedBasemap);
  return (
    <div className={`map-wrap${basemap === 'Satellite' ? ' on-imagery' : ''}`}>
      <MapContainer center={center} zoom={zoom} minZoom={minZoom} scrollWheelZoom={false} preferCanvas worldCopyJump
        className={`map${size === 'normal' ? '' : ` ${size}`}`} aria-label={label}>
        <LabelsPane />
        <WheelGuard />
        <BasemapWatcher onChange={setBasemap} />
        <LayersControl position="topright" collapsed={false}>
          <LayersControl.BaseLayer name="Light" checked={basemap === 'Light'}>
            <LayerGroup>
              <TileLayer url={esri('Canvas/World_Light_Gray_Base')} maxZoom={16} attribution="Tiles &copy; Esri — Esri, HERE, Garmin, &copy; OpenStreetMap contributors" />
              <TileLayer url={esri('Canvas/World_Light_Gray_Reference')} maxZoom={16} pane="labels" opacity={0.9} />
            </LayerGroup>
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satellite" checked={basemap === 'Satellite'}>
            <LayerGroup>
              <TileLayer url={esri('World_Imagery')} maxZoom={19} attribution="Imagery &copy; Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN, GIS User Community" />
              <TileLayer url={esri('Reference/World_Boundaries_and_Places')} maxZoom={19} pane="labels" />
              <TileLayer url={esri('Reference/World_Transportation')} maxZoom={19} pane="labels" opacity={0.6} />
            </LayerGroup>
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Streets" checked={basemap === 'Streets'}>
            <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' />
          </LayersControl.BaseLayer>
        </LayersControl>
        <BasemapCtx.Provider value={basemap}>{children}</BasemapCtx.Provider>
      </MapContainer>
      {legend && <div className="map-legend overlay">{legend}</div>}
    </div>
  );
}

/**
 * Many points, drawn imperatively on canvas (thousands of React components would be slow).
 * `make` turns one item into a Leaflet layer; the layer group is rebuilt when `items` changes.
 */
export function FastLayer<T>({ items, make }: { items: T[]; make: (item: T, renderer: L.Renderer) => L.Layer }) {
  const map = useMap();
  const makeRef = useRef(make);
  makeRef.current = make;
  useEffect(() => {
    const renderer = L.canvas({ padding: 0.3 });
    const group = L.layerGroup(items.map((i) => makeRef.current(i, renderer))).addTo(map);
    return () => { group.remove(); };
  }, [items, map]);
  return null;
}

/** Area outline that stays readable on every basemap (white on imagery); optionally fits the view. */
export function AreaOutline({ geojson, accent = false, fit = true }: { geojson: GeoJSON.Feature; accent?: boolean; fit?: boolean }) {
  const map = useMap();
  const basemap = useBasemap();
  const key = JSON.stringify(geojson.geometry).length + ':' + JSON.stringify(geojson.geometry).slice(0, 200);
  useEffect(() => {
    const style: L.PathOptions = basemap === 'Satellite'
      ? { color: '#ffffff', weight: 2.5, opacity: 0.95, fill: accent, fillOpacity: 0.04, dashArray: accent ? undefined : '6 4' }
      : accent ? { color: '#c2410c', weight: 2, fillOpacity: 0.04 } : { color: '#52514e', weight: 1.5, fill: false, dashArray: '4 3' };
    const layer = L.geoJSON(geojson, { style, interactive: false }).addTo(map);
    return () => { layer.remove(); };
  }, [key, basemap, accent, map]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!fit) return;
    try { map.fitBounds(L.geoJSON(geojson).getBounds(), { padding: [12, 12], maxZoom: 11 }); } catch { /* empty geometry */ }
  }, [key, fit, map]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Permanent heat sources (kilns, refineries, flares), shown so users see what is excluded. */
export function StaticSites({ sites }: { sites?: StaticSite[] }) {
  const map = useMap();
  useEffect(() => {
    if (!sites?.length) return;
    const icon = L.divIcon({ className: 'static-site', html: '<span></span>', iconSize: [14, 14] });
    const g = L.layerGroup(sites.map((s) => L.marker([s.lat, s.lon], { icon, keyboard: false, title: 'Industrial heat source' })
      .bindPopup(`<b>Industrial heat source</b><br>Likely a kiln, refinery, power plant or flare.<br>${esc(s.reason)}.<br><span style="color:#7a7873">Not counted as fire in any figure.</span>`))).addTo(map);
    return () => { g.remove(); };
  }, [sites, map]);
  return null;
}

/** Parks & reserves overlay (Sri Lanka), loaded once and cached. */
let parksCache: GeoJSON.FeatureCollection | null = null;
export function ParksLayer() {
  const map = useMap();
  useEffect(() => {
    let layer: L.GeoJSON | null = null, cancelled = false;
    (async () => {
      if (!parksCache) parksCache = await (await fetch('/data/lka-protected.geojson')).json();
      if (cancelled || !parksCache) return;
      layer = L.geoJSON(parksCache, {
        style: { color: '#16803c', weight: 1.2, fillColor: '#16803c', fillOpacity: 0.08 },
        onEachFeature: (f, l) => l.bindTooltip(esc(String(f.properties?.name ?? '')), { sticky: true }),
      }).addTo(map);
      layer.bringToBack();
    })();
    return () => { cancelled = true; layer?.remove(); };
  }, [map]);
  return null;
}

export function AgeLegend({ parks = false, industrial = true, extra }: { parks?: boolean; industrial?: boolean; extra?: ReactNode }) {
  return (
    <>
      <b>Detected</b>
      {AGE_CLASSES.map((c) => <div key={c.label}><i style={{ background: c.color }} />{c.label}</div>)}
      {parks && <div><i style={{ background: 'rgba(22,128,60,.18)', border: '1.5px solid #16803c', borderRadius: 2 }} />Park / reserve</div>}
      {industrial && <div><i style={{ background: '#3d3d3a', borderRadius: 2, borderColor: '#fff' }} />Industrial heat (excluded)</div>}
      {extra}
    </>
  );
}

export { esc as escapeHTML };
