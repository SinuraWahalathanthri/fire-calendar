// SYNTHETIC demo data — used only when no FIRMS MAP_KEY is configured.
// It simulates fire events and how each satellite would detect them (different pixel sizes,
// detection probabilities, overpass times and mission dates) so the full harmonization and
// analytics pipeline can be exercised offline. The UI labels every demo view clearly.
'use strict';
const geo = require('./geo');
const { SAT_INFO } = require('./firms');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

const PROFILES = {
  dryNC: [0.6, 1.6, 2.6, 2.2, 0.8, 0.6, 0.9, 1.3, 1.0, 0.3, 0.15, 0.25],
  north: [0.8, 1.6, 2.0, 1.8, 1.2, 0.8, 0.9, 1.0, 0.8, 0.3, 0.15, 0.4],
  east: [0.5, 1.2, 2.0, 1.8, 1.4, 1.2, 1.4, 1.5, 1.0, 0.3, 0.1, 0.2],
  uva: [0.6, 1.0, 1.4, 1.0, 0.6, 1.0, 2.2, 2.8, 2.2, 0.6, 0.2, 0.3],
  wet: [1.2, 1.6, 1.4, 0.6, 0.2, 0.2, 0.3, 0.4, 0.3, 0.2, 0.2, 0.6],
  south: [0.7, 1.3, 1.6, 1.0, 0.8, 1.3, 1.8, 1.9, 1.4, 0.5, 0.2, 0.3],
  ntrop: [1.4, 2.2, 2.4, 1.6, 0.7, 0.3, 0.2, 0.2, 0.3, 0.5, 0.9, 1.2],
  strop: [0.3, 0.2, 0.2, 0.3, 0.6, 1.0, 1.6, 2.4, 2.6, 1.6, 0.8, 0.4],
  temperate: [0.3, 0.4, 0.9, 1.4, 1.0, 0.9, 1.6, 1.8, 1.4, 0.9, 0.5, 0.3],
};
const LKA_DISTRICTS = {
  Anuradhapura: [10, 'dryNC'], Polonnaruwa: [6, 'dryNC'], Monaragala: [10, 'uva'], Badulla: [7, 'uva'], Ampara: [7, 'east'],
  Trincomalee: [6, 'east'], Batticaloa: [4, 'east'], Vavuniya: [5, 'north'], Mullaitivu: [5, 'north'], Kilinochchi: [4, 'north'],
  Mannar: [4, 'north'], Jaffna: [2, 'north'], Kurunegala: [6, 'dryNC'], Puttalam: [4, 'dryNC'], Hambantota: [5, 'south'],
  Matale: [3, 'dryNC'], 'Nuwara Eliya': [2, 'uva'], Kandy: [1.5, 'wet'], Ratnapura: [2, 'wet'], Kegalle: [1, 'wet'],
  Colombo: [0.3, 'wet'], Gampaha: [0.8, 'wet'], Kalutara: [0.8, 'wet'], Galle: [0.8, 'wet'], Matara: [0.8, 'wet'],
};
// Drought/El Niño-like years are more active, wet years less (illustrative only).
const LKA_YEARS = { 2001: 1.3, 2004: 1.25, 2011: 0.75, 2012: 1.35, 2014: 1.3, 2016: 1.45, 2017: 1.25, 2018: 0.8, 2019: 1.35, 2021: 0.75, 2023: 1.4, 2024: 1.2, 2025: 0.9, 2026: 1.15 };

function poisson(rand, lambda) {
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * gauss(rand)));
  const L = Math.exp(-lambda); let k = 0, p = 1;
  do { k++; p *= rand(); } while (p > L);
  return k - 1;
}
function gauss(rand) { return Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand()); }

const pad = (n) => String(n).padStart(2, '0');
const iso = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };

// Overpass local solar times (hours) and per-sensor detection characteristics.
const OVERPASS = { T: [10.5, 22.5], A: [13.5, 1.5], N: [13.4, 1.4], N20: [13.2, 1.2], N21: [13.0, 1.0] };
const SENSOR = {
  MODIS: { cover: 0.65, k: 1.6, pmax: 0.45, pix: 0.2, maxPix: 3, jitter: 0.003, frp: 1.0 },
  VIIRS: { cover: 0.93, k: 0.9, pmax: 0.9, pix: 1.3, maxPix: 9, jitter: 0.0025, frp: 0.35 },
};

/**
 * Generate synthetic detections.
 * @param {object} o { id, sampler:(rand)=>[lon,lat,profileName,districtName]|null, eventsPerYear, start, end, yearFactors }
 */
function generate(o) {
  const rand = mulberry32(hashStr(o.id));
  const pts = [];
  const t0 = Date.parse(o.start), t1 = o.end;
  const yearNoise = {}, monthNoise = {};
  const startYear = new Date(t0).getUTCFullYear();
  for (let t = t0; t <= t1; t += 864e5) {
    const d = new Date(t), y = d.getUTCFullYear(), mi = d.getUTCMonth();
    if (yearNoise[y] == null) yearNoise[y] = (o.yearFactors?.[y] || 1) * Math.exp(0.15 * gauss(rand)) * (1 + 0.01 * (y - startYear));
    const mk = `${y}-${mi}`;
    if (monthNoise[mk] == null) monthNoise[mk] = Math.exp(0.35 * gauss(rand));
    const day = iso(t);
    const lambda = (o.eventsPerYear / 365) * yearNoise[y] * monthNoise[mk] * (o.seasonScale ? o.seasonScale(mi) : 1);
    const n = poisson(rand, lambda);
    for (let e = 0; e < n; e++) {
      const loc = o.sampler(rand, mi);
      if (!loc) continue;
      const [lon, lat, , dist] = loc;
      const intensity = Math.exp(gauss(rand) * 0.9 - 0.2); // ~lognormal fire size/intensity
      const duration = 1 + Math.floor(-Math.log(rand() + 1e-9) * (0.6 + intensity * 0.5));
      for (let k = 0; k < Math.min(duration, 6); k++) {
        const dt = t + k * 864e5;
        if (dt > t1 + 864e5) break;
        const dday = iso(dt);
        const decay = Math.exp(-k * 0.45);
        for (const sat of Object.keys(OVERPASS)) {
          if (dday < SAT_INFO[sat].start) continue;
          const sensor = SAT_INFO[sat].sensor, sp = SENSOR[sensor];
          OVERPASS[sat].forEach((localH, night) => {
            if (rand() > sp.cover) return;
            const I = intensity * decay * (night ? 0.45 : 1);
            const pDet = sp.pmax * (1 - Math.exp(-I * sp.k));
            if (rand() > pDet) return;
            const utcH = (localH - lon / 15 + 24) % 24;
            const hh = Math.floor(utcH), mm = Math.floor((utcH - hh) * 60);
            let ts = dt;
            // a night overpass at 01:30 local belongs to the next calendar day
            if (night && localH < 12) ts = dt + 864e5;
            const tsFull = Date.parse(`${iso(ts)}T00:00:00Z`) + (hh * 60 + mm) * 60000;
            const nPix = Math.min(sp.maxPix, 1 + poisson(rand, I * sp.pix));
            for (let px = 0; px < nPix; px++) {
              const plat = lat + gauss(rand) * sp.jitter, plon = lon + gauss(rand) * sp.jitter;
              const conf = sensor === 'MODIS'
                ? String(Math.max(0, Math.min(100, Math.round(45 + 25 * Math.log(1 + I * 2) + 18 * gauss(rand)))))
                : (rand() < 0.07 ? 'l' : rand() < 0.15 + I * 0.05 ? 'h' : 'n');
              const cNorm = sensor === 'MODIS' ? (Number(conf) < 30 ? 0 : Number(conf) < 80 ? 1 : 2) : conf === 'l' ? 0 : conf === 'h' ? 2 : 1;
              pts.push({
                la: Math.round(plat * 1e5) / 1e5, lo: Math.round(plon * 1e5) / 1e5,
                d: iso(tsFull), t: `${pad(hh)}${pad(mm)}`, s: sat, c: cNorm, cr: conf,
                f: Math.round(Math.max(0.5, I * 12 * sp.frp * Math.exp(gauss(rand) * 0.6)) * 10) / 10,
                b: sensor === 'MODIS' ? Math.round(305 + I * 15 + rand() * 8) : Math.round(300 + I * 25 + rand() * 20),
                sc: 1 + Math.round(rand() * 100) / 100, dn: night ? 'N' : 'D', ty: 0, src: 'DEMO',
                _ts: tsFull, ...(dist ? { _dist: dist } : {}),
              });
            }
          });
        }
      }
    }
  }
  return pts;
}

// Sri Lanka: sample inside district polygons with district-specific seasonality.
function sriLankaSampler() {
  const ds = geo.loadDistricts().map((d) => ({ ...d, w: (LKA_DISTRICTS[d.name] || [1, 'wet'])[0], prof: PROFILES[(LKA_DISTRICTS[d.name] || [1, 'wet'])[1]] }));
  return (rand, mi) => {
    const weights = ds.map((d) => d.w * d.prof[mi]);
    const tot = weights.reduce((a, b) => a + b, 0);
    let r = rand() * tot, d = ds[0];
    for (let i = 0; i < ds.length; i++) { r -= weights[i]; if (r <= 0) { d = ds[i]; break; } }
    for (let tries = 0; tries < 40; tries++) {
      const lon = d.bbox[0] + rand() * (d.bbox[2] - d.bbox[0]);
      const lat = d.bbox[1] + rand() * (d.bbox[3] - d.bbox[1]);
      if (geo.inPolys(lon, lat, d.polys)) return [lon, lat, null, d.name];
    }
    return null;
  };
}

function sriLankaSeasonScale() {
  // Overall Sri Lanka seasonality emerges from the district mix; normalise so mean ≈ 1.
  const ds = Object.values(LKA_DISTRICTS);
  const tot = ds.reduce((a, [w]) => a + w, 0);
  const s = Array.from({ length: 12 }, (_, mi) => ds.reduce((a, [w, p]) => a + w * PROFILES[p][mi], 0) / tot);
  return (mi) => s[mi];
}

function genericProfile(lat) {
  if (lat > 30) return PROFILES.temperate;
  if (lat > -8) return PROFILES.ntrop;
  if (lat > -35) return PROFILES.strop;
  return PROFILES.temperate.map((_, i, a) => a[(i + 6) % 12]);
}

function genericDataset(id, bbox, containsFn) {
  const [w, s, e, n] = bbox;
  const midLat = (s + n) / 2;
  const prof = genericProfile(midLat);
  const areaKm2 = Math.abs((e - w) * (n - s)) * 111 * 111 * Math.cos((midLat * Math.PI) / 180);
  const aridityFactor = Math.abs(midLat) > 50 ? 0.25 : Math.abs(midLat) < 25 ? 1.3 : 0.7;
  const eventsPerYear = Math.min(3500, Math.max(60, areaKm2 * 0.02 * aridityFactor));
  // Pre-compute a pool of valid land locations once (point-in-polygon is the slow part),
  // then draw fire locations from the pool with small jitter.
  const pool = [];
  const r0 = mulberry32(hashStr(id + 'pool'));
  for (let tries = 0; tries < 60000 && pool.length < 4000; tries++) {
    const lon = w + r0() * (e - w), lat = s + r0() * (n - s);
    if (containsFn ? containsFn(lon, lat) : geo.isLand(lon, lat)) pool.push([lon, lat]);
  }
  const jit = Math.min(e - w, n - s) / 200;
  const sampler = (rand) => {
    if (!pool.length) return null;
    const [lon, lat] = pool[Math.floor(rand() * pool.length)];
    return [lon + gauss(rand) * jit, lat + gauss(rand) * jit];
  };
  return { sampler, eventsPerYear, seasonScale: (mi) => prof[mi] };
}

// Global snapshot for the live world view (last 48 h).
function globalSnapshot(nowMs) {
  const rand = mulberry32(Math.floor(nowMs / 3600e3));
  const mi = new Date(nowMs).getUTCMonth();
  const hotZones = [ // [lon, lat, spread°, weight, profile]
    [20, 5, 12, 10, 'ntrop'], [25, -12, 10, 12, 'strop'], [-55, -10, 10, 8, 'strop'], [-63, -17, 5, 5, 'strop'],
    [100, 18, 6, 7, 'ntrop'], [80, 22, 7, 5, 'ntrop'], [132, -16, 12, 7, 'strop'], [115, 0, 6, 3, 'strop'],
    [-100, 20, 6, 2, 'ntrop'], [-120, 40, 5, 2, 'temperate'], [130, 55, 15, 2, 'temperate'], [45, 50, 12, 2, 'temperate'],
    [-75, 5, 5, 2, 'ntrop'], [10, 9, 8, 6, 'ntrop'], [80.7, 7.8, 0.9, 0.6, 'dryNC'], [35, 0, 6, 3, 'strop'], [-45, -5, 6, 4, 'strop'],
  ];
  const tot = hotZones.reduce((a, z) => a + z[3] * PROFILES[z[4]][mi], 0);
  const pts = [];
  const N = 9000;
  for (let i = 0; i < N; i++) {
    let r = rand() * tot, z = hotZones[0];
    for (const hz of hotZones) { r -= hz[3] * PROFILES[hz[4]][mi]; if (r <= 0) { z = hz; break; } }
    const lon = z[0] + gauss(rand) * z[2], lat = z[1] + gauss(rand) * z[2] * 0.6;
    if (!geo.isLand(lon, lat)) continue;
    const ago = rand() * 48 * 3600e3;
    const ts = nowMs - ago;
    const dt = new Date(ts);
    const sat = rand() < 0.28 ? (rand() < 0.5 ? 'T' : 'A') : ['N', 'N20', 'N21'][Math.floor(rand() * 3)];
    pts.push({ la: Math.round(lat * 1e4) / 1e4, lo: Math.round(lon * 1e4) / 1e4, d: iso(ts), t: `${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}`, s: sat, c: rand() < 0.2 ? 2 : 1, f: Math.round(Math.exp(gauss(rand) + 2) * 10) / 10, dn: rand() < 0.3 ? 'N' : 'D', src: 'DEMO' });
  }
  return pts;
}

module.exports = { generate, sriLankaSampler, sriLankaSeasonScale, genericDataset, globalSnapshot, LKA_YEARS };
