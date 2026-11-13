// Geometry helpers: TopoJSON decoding, point-in-polygon, bounding boxes, AOI parsing.
// Zero dependencies so the service can be dropped into any government server.
'use strict';
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

// ---------- TopoJSON -> GeoJSON (subset needed for world-atlas) ----------
function decodeTopo(topo, objectName) {
  const { scale, translate } = topo.transform;
  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => {
      x += dx; y += dy;
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
    });
  });
  const arcCoords = (i) => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
  const ring = (idx) => {
    const out = [];
    idx.forEach((i, k) => {
      const a = arcCoords(i);
      out.push(...(k === 0 ? a : a.slice(1)));
    });
    return out;
  };
  const obj = topo.objects[objectName];
  return {
    type: 'FeatureCollection',
    features: obj.geometries.filter((g) => g.type).map((g) => {
      let coordinates;
      if (g.type === 'Polygon') coordinates = g.arcs.map(ring);
      else if (g.type === 'MultiPolygon') coordinates = g.arcs.map((p) => p.map(ring));
      return { type: 'Feature', id: g.id, properties: { ...(g.properties || {}), id: g.id }, geometry: { type: g.type, coordinates } };
    }),
  };
}

// ---------- Geometry primitives ----------
function geomPolygons(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  if (geom.type === 'Feature') return geomPolygons(geom.geometry);
  if (geom.type === 'FeatureCollection') return geom.features.flatMap((f) => geomPolygons(f.geometry));
  return [];
}

function bboxOf(polys) {
  let w = 180, s = 90, e = -180, n = -90;
  for (const poly of polys) for (const [x, y] of poly[0]) {
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y;
  }
  return [w, s, e, n];
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolys(x, y, polys) {
  for (const poly of polys) {
    if (!inRing(x, y, poly[0])) continue;
    let hole = false;
    for (let h = 1; h < poly.length; h++) if (inRing(x, y, poly[h])) { hole = true; break; }
    if (!hole) return true;
  }
  return false;
}

const R_EARTH = 6371.0088;
function haversineKm(lat1, lon1, lat2, lon2) {
  const toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLon = (lon2 - lon1) * toR;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(a));
}

function polygonAreaKm2(polys) {
  // Spherical-excess approximation, good enough for reporting density.
  const toR = Math.PI / 180;
  let total = 0;
  for (const poly of polys) poly.forEach((ring, ri) => {
    let a = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
      a += (x2 - x1) * toR * (2 + Math.sin(y1 * toR) + Math.sin(y2 * toR));
    }
    a = Math.abs((a * R_EARTH * R_EARTH) / 2);
    total += ri === 0 ? a : -a;
  });
  return total;
}

// ---------- Boundary catalogues ----------
let countries = null, districts = null;
const LKA_PROVINCE = {
  Jaffna: 'Northern', Kilinochchi: 'Northern', Mannar: 'Northern', Mullaitivu: 'Northern', Vavuniya: 'Northern',
  Anuradhapura: 'North Central', Polonnaruwa: 'North Central', Kurunegala: 'North Western', Puttalam: 'North Western',
  Kandy: 'Central', Matale: 'Central', 'Nuwara Eliya': 'Central', Ampara: 'Eastern', Batticaloa: 'Eastern', Trincomalee: 'Eastern',
  Badulla: 'Uva', Monaragala: 'Uva', Ratnapura: 'Sabaragamuwa', Kegalle: 'Sabaragamuwa',
  Galle: 'Southern', Matara: 'Southern', Hambantota: 'Southern', Colombo: 'Western', Gampaha: 'Western', Kalutara: 'Western',
};

function loadCountries() {
  if (countries) return countries;
  const topo = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'countries-50m.json'), 'utf8'));
  const fc = decodeTopo(topo, 'countries');
  countries = fc.features.map((f) => {
    const polys = geomPolygons(f.geometry);
    // Antimeridian-crossing countries (Russia, Fiji, USA-Aleutians) get a world-width bbox; fine for prefiltering.
    return { id: String(f.id), name: f.properties.name, polys, bbox: bboxOf(polys) };
  }).filter((c) => c.polys.length);
  return countries;
}

function loadDistricts() {
  if (districts) return districts;
  const fc = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'lka-districts.geojson'), 'utf8'));
  districts = fc.features.map((f) => {
    const name = f.properties.shapeName.replace(/ District$/, '');
    const polys = geomPolygons(f.geometry);
    return { id: f.properties.shapeISO, name, province: LKA_PROVINCE[name] || '', polys, bbox: bboxOf(polys), areaKm2: polygonAreaKm2(polys) };
  });
  return districts;
}

// Sri Lanka national parks, sanctuaries and reserves (OpenStreetMap, ODbL).
let protectedAreas = null;
function loadProtected() {
  if (protectedAreas) return protectedAreas;
  const file = path.join(DATA_DIR, 'lka-protected.geojson');
  if (!fs.existsSync(file)) return (protectedAreas = []);
  const fc = JSON.parse(fs.readFileSync(file, 'utf8'));
  protectedAreas = fc.features.map((f) => { const polys = geomPolygons(f.geometry); return { ...f.properties, polys, bbox: bboxOf(polys) }; });
  return protectedAreas;
}
const paMemo = new Map();
function protectedAreaAt(lon, lat) {
  if (lon < 79.4 || lon > 82 || lat < 5.8 || lat > 10) return null;
  const k = `${Math.round(lat * 200)}_${Math.round(lon * 200)}`;
  if (paMemo.has(k)) return paMemo.get(k);
  const pa = loadProtected().find((a) => lon >= a.bbox[0] && lon <= a.bbox[2] && lat >= a.bbox[1] && lat <= a.bbox[3] && inPolys(lon, lat, a.polys)) || null;
  paMemo.set(k, pa);
  return pa;
}

function findCountry(q) {
  const list = loadCountries();
  const s = String(q).trim().toLowerCase();
  return list.find((c) => c.id === s.replace(/^0+/, '') || c.id === s) ||
    list.find((c) => c.name.toLowerCase() === s) ||
    (s === 'lka' || s === 'lk' ? list.find((c) => c.name === 'Sri Lanka') : null) ||
    list.find((c) => c.name.toLowerCase().startsWith(s));
}

let landIndex = null;
function isLand(lon, lat) {
  const list = loadCountries();
  if (!landIndex) landIndex = list.filter((c) => c.bbox[2] - c.bbox[0] < 300);
  for (const c of list) {
    const [w, s, e, n] = c.bbox;
    if (lon < w || lon > e || lat < s || lat > n) continue;
    if (inPolys(lon, lat, c.polys)) return c;
  }
  return null;
}

// ---------- Area of interest ----------
// An AOI is { kind, label, bbox:[w,s,e,n], contains(lon,lat), areaKm2, geojson }
function makeAOI(spec) {
  if (!spec || typeof spec !== 'object') throw new Error('AOI required');
  const kind = spec.kind || (spec.country ? 'country' : spec.district ? 'district' : spec.bbox ? 'bbox' : spec.lat != null ? 'circle' : spec.geometry ? 'polygon' : null);

  if (kind === 'country') {
    const c = findCountry(spec.country || spec.id);
    if (!c) throw new Error(`Unknown country: ${spec.country}`);
    return polyAOI('country', c.name, c.polys, { id: c.id, country: c.name });
  }
  if (kind === 'district') {
    const name = String(spec.district || spec.id).replace(/ District$/i, '').toLowerCase();
    const d = loadDistricts().find((x) => x.name.toLowerCase() === name || x.id.toLowerCase() === name);
    if (!d) throw new Error(`Unknown Sri Lanka district: ${spec.district}`);
    return polyAOI('district', `${d.name} District, Sri Lanka`, d.polys, { id: d.id, district: d.name, province: d.province, country: 'Sri Lanka' });
  }
  if (kind === 'province') {
    const name = String(spec.province).toLowerCase();
    const ds = loadDistricts().filter((x) => x.province.toLowerCase() === name);
    if (!ds.length) throw new Error(`Unknown Sri Lanka province: ${spec.province}`);
    return polyAOI('province', `${ds[0].province} Province, Sri Lanka`, ds.flatMap((d) => d.polys), { province: ds[0].province, country: 'Sri Lanka' });
  }
  if (kind === 'bbox') {
    let b = spec.bbox;
    if (typeof b === 'string') b = b.split(',').map(Number);
    let [w, s, e, n] = b.map(Number);
    if ([w, s, e, n].some((v) => !Number.isFinite(v))) throw new Error('bbox must be west,south,east,north');
    if (w > e) [w, e] = [e, w];
    if (s > n) [s, n] = [n, s];
    const ring = [[w, s], [e, s], [e, n], [w, n], [w, s]];
    return polyAOI('bbox', spec.label || `Box ${w.toFixed(2)}, ${s.toFixed(2)} → ${e.toFixed(2)}, ${n.toFixed(2)}`, [[ring]], {});
  }
  if (kind === 'circle') {
    const lat = Number(spec.lat), lon = Number(spec.lon), r = Math.min(Math.max(Number(spec.radius_km || spec.radiusKm || 25), 1), 1000);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error('Invalid latitude/longitude');
    const dLat = r / 111.32, dLon = r / (111.32 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
    const ring = [];
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * 2 * Math.PI;
      ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
    }
    return {
      kind: 'circle', label: spec.label || `${r} km around ${lat.toFixed(3)}, ${lon.toFixed(3)}`,
      bbox: [lon - dLon, lat - dLat, lon + dLon, lat + dLat], areaKm2: Math.PI * r * r,
      meta: { lat, lon, radius_km: r },
      contains: (x, y) => haversineKm(lat, lon, y, x) <= r,
      geojson: { type: 'Feature', properties: { label: spec.label }, geometry: { type: 'Polygon', coordinates: [ring] } },
    };
  }
  if (kind === 'polygon') {
    const polys = geomPolygons(spec.geometry);
    if (!polys.length) throw new Error('Polygon geometry required');
    return polyAOI('polygon', spec.label || 'Custom area', polys, {});
  }
  throw new Error('Unsupported AOI. Use country, district, province, bbox, circle (lat/lon/radius_km) or polygon.');
}

function polyAOI(kind, label, polys, meta) {
  const bbox = bboxOf(polys);
  return {
    kind, label, bbox, meta, areaKm2: polygonAreaKm2(polys),
    contains: (x, y) => x >= bbox[0] && x <= bbox[2] && y >= bbox[1] && y <= bbox[3] && inPolys(x, y, polys),
    geojson: { type: 'Feature', properties: { label }, geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys } },
  };
}

// Parse AOI from URL query params (for simple GET integrations).
function aoiFromQuery(q) {
  if (q.country) return { kind: 'country', country: q.country };
  if (q.district) return { kind: 'district', district: q.district };
  if (q.province) return { kind: 'province', province: q.province };
  if (q.bbox) return { kind: 'bbox', bbox: q.bbox };
  if (q.lat != null && q.lon != null) return { kind: 'circle', lat: q.lat, lon: q.lon, radius_km: q.radius_km || q.radius };
  if (q.aoi) { try { return JSON.parse(q.aoi); } catch { /* fallthrough */ } }
  return { kind: 'country', country: 'Sri Lanka' };
}

module.exports = {
  decodeTopo, geomPolygons, bboxOf, inPolys, haversineKm, polygonAreaKm2,
  loadCountries, loadDistricts, loadProtected, protectedAreaAt, findCountry, isLand, makeAOI, aoiFromQuery, LKA_PROVINCE,
};
