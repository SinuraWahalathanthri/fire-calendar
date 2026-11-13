// Harmonized Fire Calendar — HTTP server (zero dependencies, Node >= 18).
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const cfg = require('./config');
const geo = require('./geo');
const store = require('./store');
const firms = require('./firms');
const alerts = require('./alerts');
const climate = require('./climate');
const boundaries = require('./boundaries');
const { analyze, districtName } = require('./analytics');
const { harmonize } = require('./harmonize');

const PUBLIC = path.join(__dirname, '..', 'public');
// The React app (web/) builds to web/dist; boundary data lives in public/data.
const WEB_DIST = path.join(__dirname, '..', 'web', 'dist');
const HAS_BUILD = fs.existsSync(path.join(WEB_DIST, 'index.html'));
const MIME = { '.woff2': 'font/woff2', '.map': 'application/json', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.geojson': 'application/geo+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const started = new Date();

// ---------- helpers ----------
function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS', 'Cache-Control': 'no-store', ...extra });
  res.end(data);
}
const bad = (res, msg, status = 400) => send(res, status, { error: msg });
function readBody(req, limit = 25e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function authorized(req) {
  if (!cfg.API_TOKENS.length) return true;
  const h = req.headers.authorization || '';
  return cfg.API_TOKENS.includes(h.replace(/^Bearer\s+/i, ''));
}
const csvCell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const toCSV = (rows, cols) => [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\n');
const baseUrl = (req) => `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// ---------- analysis with small cache ----------
const cache = new Map();
function runAnalysis(aoiSpec, q = {}) {
  const aoi = geo.makeAOI(aoiSpec);
  const ds = store.datasetFor(aoi);
  const baseline = q.baseline ? (Array.isArray(q.baseline) ? q.baseline : String(q.baseline).split(/[,-]/)).map(Number) : null;
  const key = JSON.stringify([aoiSpec, q.start, q.end, baseline, ds.id, ds.points.length, q.includeLow]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60e3) return hit.result;
  const all = store.pointsIn(ds, aoi);
  const st = q.includeStatic === '1' || q.includeStatic === true ? null : store.staticFor(ds);
  const pts = st ? all.filter((p) => !st.isStatic(p)) : all;
  const overlapsLKA = aoi.bbox[0] < 82 && aoi.bbox[2] > 79.4 && aoi.bbox[1] < 10 && aoi.bbox[3] > 5.8;
  const result = analyze(pts, aoi, {
    start: q.start, end: q.end, baseline, historyStart: cfg.HISTORY_START, operating: store.operating, prior: store.priorFor(ds), oni: climate.available() ? climate.oni : null, phaseOf: climate.phaseOf,
    regionSet: aoi.kind === 'country' && !overlapsLKA ? boundaries.regionsFor(aoi.meta.country) : null,
    districtPoints: aoi.kind === 'district' || aoi.kind === 'province' ? (st ? ds.points.filter((p) => !st.isStatic(p)) : ds.points) : null,
    coverageStart: ds.status === 'backfilling' && ds.points.length ? store.datasetInfo(ds).firstDate : null, includeLow: q.includeLow === true || q.includeLow === '1',
    districts: overlapsLKA && (['country', 'province', 'district'].includes(aoi.kind) || q.districts),
  });
  result.dataset = store.datasetInfo(ds);
  result.staticSources = st ? {
    excludedDetections: all.length - pts.length, rules: st.rules,
    sites: st.sites.filter((s) => aoi.contains(s.lon, s.lat)),
  } : { excludedDetections: 0, sites: [], included: true };
  result.mode = cfg.DEMO ? 'demo' : 'live';
  cache.set(key, { at: Date.now(), result, aoi, pts });
  if (cache.size > 40) cache.delete(cache.keys().next().value);
  return result;
}

function hotspotRows(aoiSpec, q) {
  const aoi = geo.makeAOI(aoiSpec);
  const ds = store.datasetFor(aoi);
  const pts = store.pointsIn(ds, aoi);
  const st = store.staticFor(ds);
  const h = harmonize(pts.filter((p) => !st.isStatic(p)), { operating: store.operating, prior: store.priorFor(ds) });
  const start = q.start || '0000', end = q.end || '9999';
  const names = { T: 'Terra', A: 'Aqua', N: 'Suomi NPP', N20: 'NOAA-20', N21: 'NOAA-21' };
  return {
    aoi, rows: pts.filter((p) => p.d >= start && p.d <= end).sort((a, b) => (a.d + a.t).localeCompare(b.d + b.t)).slice(0, 500000).map((p) => {
      const w = h.weightOf(p);
      return {
        latitude: p.la, longitude: p.lo, acq_date: p.d, acq_time: p.t, satellite: names[p.s], sensor: p.s === 'T' || p.s === 'A' ? 'MODIS' : 'VIIRS',
        confidence_raw: p.cr, confidence_class: ['low', 'nominal', 'high'][p.c], frp_mw: p.f, brightness_k: p.b, daynight: p.dn, processing: p.src,
        grid_cell_0_01deg: h.cellId(p), used_in_harmonized_series: w > 0 ? 1 : 0, harmonized_weight: Math.round(w * 10000) / 10000,
        series_method: h.series[p.d.slice(0, 7)]?.method || '', static_source: st.isStatic(p) ? 1 : 0, district: districtName(p.lo, p.la) || '',
      };
    }),
  };
}
const HOTSPOT_COLS = ['latitude', 'longitude', 'acq_date', 'acq_time', 'satellite', 'sensor', 'confidence_raw', 'confidence_class', 'frp_mw', 'brightness_k', 'daynight', 'processing', 'grid_cell_0_01deg', 'used_in_harmonized_series', 'harmonized_weight', 'series_method', 'static_source', 'district'];

// ---------- SSE ----------
const clients = new Set();
function sse(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
store.events.on('hotspots', ({ dataset, points }) => {
  const ds = store.datasets.get(dataset);
  if (ds) { const st = store.staticFor(ds); points = points.filter((p) => !st.isStatic(p)); }
  if (!points.length) return;
  const thin = points.slice(0, 500).map((p) => [p.la, p.lo, p.s, p.c, p.f, p.d, p.t]);
  for (const c of clients) sse(c, 'hotspots', { dataset, count: points.length, points: thin, at: new Date().toISOString() });
});
store.events.on('global', (d) => { for (const c of clients) sse(c, 'global', d); });
alerts.listeners.add((a) => { for (const c of clients) sse(c, 'alert', a); });
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000);

// ---------- routes ----------
async function api(req, res, url) {
  const q = Object.fromEntries(url.searchParams);
  const p = url.pathname.replace(/\/+$/, '');

  if (p === '/api/status' || p === '/api/v1/status') {
    const lka = store.ensureSriLanka();
    return send(res, 200, {
      name: 'Harmonized Fire Calendar', version: '1.0.0', mode: cfg.DEMO ? 'demo' : 'live', startedAt: started.toISOString(), serverTime: new Date().toISOString(),
      pollMinutes: cfg.DEMO ? 1 : cfg.POLL_MINUTES, historyStart: cfg.HISTORY_START, calibrationWindow: [cfg.CALIB_START, cfg.CALIB_END],
      firms: { configured: !!cfg.FIRMS_MAP_KEY, ...firms.stats, transactions: firms.usage.current, transactionLimit: firms.usage.limit, paused: Date.now() < firms.usage.pausedUntil },
      coverage: store.coverageInfo(), enso: climate.latest(), datasets: [...store.datasets.values()].map(store.datasetInfo),
      primary: store.datasetInfo(lka), global: { updatedAt: store.global.updatedAt, status: store.global.status, detections: store.global.points.length },
    });
  }
  if (p === '/api/regions' || p === '/api/v1/regions') {
    const ds = geo.loadDistricts();
    const provinces = [...new Set(ds.map((d) => d.province))].sort();
    return send(res, 200, {
      sriLanka: { districts: ds.map((d) => ({ id: d.id, name: d.name, province: d.province, bbox: d.bbox.map((v) => +v.toFixed(3)), areaKm2: Math.round(d.areaKm2) })).sort((a, b) => a.name.localeCompare(b.name)), provinces },
      countries: geo.loadCountries().map((c) => ({ id: c.id, name: c.name, bbox: c.bbox.map((v) => +v.toFixed(2)) })).sort((a, b) => a.name.localeCompare(b.name)),
      hotZones: [
        { name: 'Wilpattu National Park', lat: 8.45, lon: 80.0, radius_km: 25 },
        { name: 'Yala / Ruhuna', lat: 6.37, lon: 81.5, radius_km: 25 },
        { name: 'Uva grasslands (Badulla–Monaragala)', lat: 6.9, lon: 81.15, radius_km: 30 },
        { name: 'Knuckles Range', lat: 7.45, lon: 80.78, radius_km: 15 },
        { name: 'Horton Plains', lat: 6.8, lon: 80.8, radius_km: 10 },
        { name: 'Wasgamuwa – Minneriya', lat: 7.85, lon: 80.9, radius_km: 25 },
        { name: 'Gal Oya', lat: 7.25, lon: 81.45, radius_km: 25 },
        { name: 'Somawathiya', lat: 8.1, lon: 81.15, radius_km: 20 },
      ],
    });
  }
  if (p === '/api/analyze' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    return send(res, 200, runAnalysis(body.aoi, body));
  }
  if (p === '/api/v1/analyze') return send(res, 200, runAnalysis(geo.aoiFromQuery(q), q));

  if (p === '/api/v1/calendar') {
    const r = runAnalysis(geo.aoiFromQuery(q), q);
    if (q.format === 'csv') {
      const rows = r.calendar.flatMap((y) => y.months.filter(Boolean).map((m) => {
        const s = r.series.find((x) => x.month === m.month) || {};
        return { month: m.month, harmonized_hotspots: m.value, method: m.method, partial_month: m.partial ? 1 : 0, anomaly_pct_vs_mean: m.anomalyPct, z_score: m.z, percentile_rank: m.pctRank, modis_raw_detections: s.modisRaw, viirs_raw_detections: s.viirsRaw, modis_fire_cell_days: s.modisCellDays, viirs_fire_cell_days: s.viirsCellDays, modis_calibrated: s.modisCalibrated, baseline_mean: s.climMean };
      }));
      return send(res, 200, toCSV(rows, Object.keys(rows[0] || { month: 1 })), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="calendar-${slug(r.aoi.label)}.csv"` });
    }
    return send(res, 200, { aoi: r.aoi, units: r.units, baseline: r.baseline, calendar: r.calendar, seasonal: r.seasonal });
  }
  if (p === '/api/v1/outlook') {
    const r = runAnalysis(geo.aoiFromQuery(q), q);
    return send(res, 200, { aoi: r.aoi.label, generatedAt: r.generatedAt, nowcast: r.nowcast, outlook: r.outlook, mode: r.mode });
  }
  if (p === '/api/v1/districts') {
    const r = runAnalysis({ kind: 'country', country: 'Sri Lanka' }, q);
    if (q.format === 'csv') {
      const rows = r.districts.map(({ monthlyProfile, ...d }) => d);
      return send(res, 200, toCSV(rows, Object.keys(rows[0])), 'text/csv; charset=utf-8', { 'Content-Disposition': 'attachment; filename="sri-lanka-districts.csv"' });
    }
    return send(res, 200, { generatedAt: r.generatedAt, mode: r.mode, districts: r.districts });
  }
  if (p === '/api/v1/hotspots' || p === '/api/hotspots') {
    let spec = geo.aoiFromQuery(q);
    if (req.method === 'POST') { const b = JSON.parse((await readBody(req)) || '{}'); spec = b.aoi; Object.assign(q, b); }
    const { aoi, rows } = hotspotRows(spec, q);
    const fname = `hotspots-${slug(aoi.label)}-${q.start || 'all'}-${q.end || 'now'}`;
    if (q.format === 'geojson') {
      return send(res, 200, { type: 'FeatureCollection', features: rows.map((r) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] }, properties: r })) }, 'application/geo+json', { 'Content-Disposition': `attachment; filename="${fname}.geojson"` });
    }
    if (q.format === 'json') return send(res, 200, { aoi: aoi.label, count: rows.length, hotspots: rows });
    return send(res, 200, toCSV(rows, HOTSPOT_COLS), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="${fname}.csv"` });
  }
  if (p === '/api/v1/live') {
    const aoi = geo.makeAOI(geo.aoiFromQuery(q));
    const ds = store.datasetFor(aoi);
    const hrs = Math.min(Number(q.hours) || 24, 240);
    const cutoff = Date.now() - hrs * 3600e3;
    const st = store.staticFor(ds);
    const pts = store.pointsIn(ds, aoi).filter((x) => store.tsOf(x) >= cutoff && !st.isStatic(x)).sort((a, b) => store.tsOf(b) - store.tsOf(a));
    const rows = pts.map((x) => ({ latitude: x.la, longitude: x.lo, acq_date: x.d, acq_time: x.t, satellite: x.s, confidence: ['low', 'nominal', 'high'][x.c], frp_mw: x.f, daynight: x.dn, district: districtName(x.lo, x.la) || '' }));
    if (q.format === 'geojson') return send(res, 200, { type: 'FeatureCollection', features: rows.map((r) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.longitude, r.latitude] }, properties: r })) }, 'application/geo+json');
    if (q.format === 'csv') return send(res, 200, toCSV(rows, Object.keys(rows[0] || { latitude: 1 })), 'text/csv; charset=utf-8');
    return send(res, 200, { aoi: aoi.label, hours: hrs, count: rows.length, mode: cfg.DEMO ? 'demo' : 'live', lastPoll: ds.lastPoll, hotspots: rows });
  }
  if (p === '/api/v1/global') {
    const hrs = Number(q.hours) === 48 ? 48 : 24;
    const cutoff = Date.now() - hrs * 3600e3;
    const pts = store.global.points.filter((x) => store.tsOf(x) >= cutoff);
    return send(res, 200, {
      updatedAt: store.global.updatedAt, status: store.global.status, mode: cfg.DEMO ? 'demo' : 'live', hours: hrs, total: pts.length,
      countries: store.global.byCountry, points: q.points === '0' ? [] : pts.slice(0, 40000).map((x) => [x.la, x.lo, x.s === 'T' || x.s === 'A' ? 0 : 1, x.f]),
    });
  }
  if (p === '/api/v1/datasets') return send(res, 200, [...store.datasets.values()].map(store.datasetInfo));

  // ---- alerts ----
  if (p === '/api/v1/alerts' && req.method === 'GET') return send(res, 200, { rules: alerts.state.rules, recent: alerts.state.log.slice(0, Number(q.limit) || 50) });
  if (p === '/api/v1/alerts' && req.method === 'POST') {
    if (!authorized(req)) return bad(res, 'Unauthorized: send Authorization: Bearer <token>', 401);
    return send(res, 201, alerts.addRule(JSON.parse((await readBody(req)) || '{}')));
  }
  if (p.startsWith('/api/v1/alerts/') && req.method === 'DELETE') {
    if (!authorized(req)) return bad(res, 'Unauthorized', 401);
    return send(res, alerts.deleteRule(p.split('/').pop()) ? 200 : 404, { ok: true });
  }
  if (p === '/api/v1/feeds/alerts.cap.xml' || p === '/api/v1/feeds/cap') return send(res, 200, alerts.capFeed(baseUrl(req)), 'application/xml; charset=utf-8');
  if (p === '/api/v1/feeds/alerts.geojson') return send(res, 200, alerts.geojsonFeed(), 'application/geo+json');
  if (p === '/api/v1/feeds/alerts.rss') return send(res, 200, alerts.rssFeed(baseUrl(req)), 'application/rss+xml; charset=utf-8');

  // ---- import FIRMS CSV (archive download or departmental exports) ----
  if (p === '/api/v1/import' && req.method === 'POST') {
    if (!authorized(req)) return bad(res, 'Unauthorized', 401);
    const source = q.source || 'MODIS_SP';
    if (!firms.SOURCES[source]) return bad(res, `source must be one of ${Object.keys(firms.SOURCES).join(', ')}`);
    const rows = firms.parseCSV(await readBody(req, 500e6)).map((r) => firms.normalizeRow(source, r)).filter(Boolean);
    const ds = store.ensureSriLanka();
    const target = q.dataset ? store.datasets.get(q.dataset) : ds;
    if (!target) return bad(res, 'Unknown dataset');
    const [w, s, e, n] = target.bbox;
    const added = store.addPoints(target, rows.filter((r) => r.lo >= w && r.lo <= e && r.la >= s && r.la <= n));
    store.saveDataset(target);
    cache.clear();
    return send(res, 200, { dataset: target.id, parsed: rows.length, added: added.length });
  }

  if (p === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
    sse(res, 'hello', { mode: cfg.DEMO ? 'demo' : 'live', serverTime: new Date().toISOString() });
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  return bad(res, 'Not found', 404);
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  // Old widget URL keeps working: /embed.html?district=X → React route /#/embed?district=X
  if (rel === '/embed.html') { res.writeHead(302, { Location: `/#/embed${url.search}` }); return res.end(); }
  if (rel === '/') rel = '/index.html';
  if (!HAS_BUILD && !rel.startsWith('/data/')) {
    return send(res, 503, '<!doctype html><meta charset="utf-8"><title>Fire Calendar</title><body style="font:16px system-ui;padding:40px;max-width:640px">' +
      '<h1>Frontend not built yet</h1><p>The API is running (<a href="/api/status">/api/status</a>), but the web app has not been built.</p>' +
      '<p>Run <code>npm run build</code> in the project folder, then restart the server.</p>', 'text/html; charset=utf-8');
  }
  const root = rel.startsWith('/data/') ? PUBLIC : WEB_DIST;
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root)) return bad(res, 'Forbidden', 403);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return bad(res, 'Not found', 404);
    // Vite's hashed asset names never change content, so they can be cached for a year.
    const cache = rel.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : rel.startsWith('/data/') ? 'public, max-age=86400' : 'no-cache';
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url); } catch (e) { console.error(e); if (!res.headersSent) bad(res, e.message, 400); }
    return;
  }
  serveStatic(req, res, url);
});

store.start();
alerts.start();
climate.start();
server.listen(cfg.PORT, cfg.HOST, () => {
  console.log(`Harmonized Fire Calendar on http://localhost:${cfg.PORT}  (${cfg.DEMO ? 'DEMO mode — set FIRMS_MAP_KEY for live NASA FIRMS data' : 'LIVE mode — NASA FIRMS'})`);
});
