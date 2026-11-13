// First-level administrative regions (provinces / states / counties) for any country, fetched
// on demand from geoBoundaries (CC-BY / ODbL) and cached on disk. Lets every country get the
// same "regions to watch" table that Sri Lanka has for its districts.
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');
const geo = require('./geo');

const dir = path.join(cfg.DATA_DIR, 'boundaries');
fs.mkdirSync(dir, { recursive: true });
const INDEX_URL = 'https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM1/';
const loaded = new Map();   // country name -> { regions, lookup } | 'loading' | 'failed'
let index = null;

const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
// Natural Earth short names that differ from geoBoundaries names.
const ALIAS = { demrepcongo: 'democraticrepublicofthecongo', congo: 'republicofthecongo', centralafricanrep: 'centralafricanrepublic', ssudan: 'southsudan', dominicanrep: 'dominicanrepublic', bosniaandherz: 'bosniaandherzegovina', eqguinea: 'equatorialguinea', laos: 'laopeoplesdemocraticrepublic', unitedstatesofamerica: 'unitedstates', cotedivoire: 'ivorycoast', tanzania: 'unitedrepublicoftanzania', myanmar: 'myanmar', russia: 'russianfederation', southkorea: 'republicofkorea', northkorea: 'democraticpeoplesrepublicofkorea', iran: 'iranislamicrepublicof', syria: 'syrianarabrepublic', vietnam: 'vietnam', venezuela: 'venezuela', bolivia: 'bolivia' };

async function getIndex() {
  if (index) return index;
  const f = path.join(dir, 'index_ADM1.json');
  if (fs.existsSync(f)) index = JSON.parse(fs.readFileSync(f, 'utf8'));
  else {
    const res = await fetch(INDEX_URL, { signal: AbortSignal.timeout(60000) });
    index = (await res.json()).map((x) => ({ iso: x.boundaryISO, name: x.boundaryName, url: x.simplifiedGeometryGeoJSON, count: Number(x.admUnitCount) }));
    fs.writeFileSync(f, JSON.stringify(index));
  }
  return index;
}

function match(idx, countryName) {
  const n = norm(countryName), a = ALIAS[n];
  return idx.find((x) => norm(x.name) === n) || (a && idx.find((x) => norm(x.name) === a)) ||
    idx.find((x) => norm(x.name).startsWith(n) || n.startsWith(norm(x.name)));
}

function build(fc, iso) {
  const regions = fc.features.map((f) => {
    const polys = geo.geomPolygons(f.geometry);
    return { name: f.properties.shapeName, id: f.properties.shapeISO || f.properties.shapeID, polys, bbox: geo.bboxOf(polys), areaKm2: geo.polygonAreaKm2(polys) };
  }).filter((r) => r.polys.length);
  const memo = new Map();
  const lookup = (lon, lat) => {
    const k = `${Math.round(lat * 50)}_${Math.round(lon * 50)}`; // ~2 km memo grid
    if (memo.has(k)) return memo.get(k);
    const r = regions.find((x) => lon >= x.bbox[0] && lon <= x.bbox[2] && lat >= x.bbox[1] && lat <= x.bbox[3] && geo.inPolys(lon, lat, x.polys)) || null;
    memo.set(k, r);
    return r;
  };
  return { iso, regions, lookup };
}

async function fetchCountry(countryName) {
  const idx = await getIndex();
  const m = match(idx, countryName);
  if (!m) throw new Error(`No geoBoundaries ADM1 for ${countryName}`);
  const f = path.join(dir, `${m.iso}_ADM1.geojson`);
  let fc;
  if (fs.existsSync(f)) fc = JSON.parse(fs.readFileSync(f, 'utf8'));
  else {
    const res = await fetch(m.url, { signal: AbortSignal.timeout(90000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    fc = JSON.parse(text);
    fs.writeFileSync(f, text);
  }
  return build(fc, m.iso);
}

/** Returns regions if ready; otherwise starts loading and returns { status }. Never blocks. */
function regionsFor(countryName) {
  const s = loaded.get(countryName);
  if (s && typeof s === 'object') return s;
  if (!s) {
    loaded.set(countryName, 'loading');
    fetchCountry(countryName).then((r) => loaded.set(countryName, r)).catch(() => loaded.set(countryName, 'failed'));
  }
  return { status: loaded.get(countryName) };
}

module.exports = { regionsFor };
