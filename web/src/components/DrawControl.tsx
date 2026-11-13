import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from '../lib/leaflet';
import 'leaflet-draw';
import type { AOI } from '../api/types';

/** Rectangle / polygon / circle drawing tools; reports the finished shape as an area of interest. */
export function DrawControl({ onArea }: { onArea: (a: AOI) => void }) {
  const map = useMap();
  const cb = useRef(onArea);
  cb.current = onArea;
  useEffect(() => {
    const drawn = new L.FeatureGroup().addTo(map);
    const shape = { color: '#c2410c' };
    const ctl = new L.Control.Draw({
      position: 'topleft',
      draw: { polyline: false, marker: false, circlemarker: false, rectangle: { shapeOptions: shape }, polygon: { shapeOptions: shape, allowIntersection: false }, circle: { shapeOptions: shape } },
      edit: { featureGroup: drawn, edit: false, remove: true },
    });
    map.addControl(ctl);
    const created = (ev: L.LeafletEvent) => {
      const e = ev as L.DrawEvents.Created;
      drawn.clearLayers();
      drawn.addLayer(e.layer);
      if (e.layerType === 'circle') {
        const c = e.layer as L.Circle, ll = c.getLatLng();
        cb.current({ kind: 'circle', lat: +ll.lat.toFixed(5), lon: +ll.lng.toFixed(5), radius_km: Math.max(1, Math.round(c.getRadius() / 100) / 10) });
      } else if (e.layerType === 'rectangle') {
        const b = (e.layer as L.Rectangle).getBounds();
        cb.current({ kind: 'bbox', bbox: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => +v.toFixed(4)) });
      } else {
        cb.current({ kind: 'polygon', geometry: (e.layer as L.Polygon).toGeoJSON().geometry, label: 'Drawn polygon' });
      }
    };
    map.on(L.Draw.Event.CREATED, created);
    return () => { map.off(L.Draw.Event.CREATED, created); map.removeControl(ctl); drawn.remove(); };
  }, [map]);
  return null;
}
