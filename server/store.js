// Hotspot datasets: one per region bbox. Live mode backfills history from FIRMS and polls NRT;
// demo mode generates synthetic data. Emits 'hotspots' events for real-time push + alerts.
'use strict';
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const cfg = require('./config');
const firms = require('./firms');
const geo = require('./geo');
const demo = require('./demo');
const { detectStatic } = require('./static');

const events = new EventEmitter();
events.setMaxListeners(200);
const datasets = new Map();
const dsDir = path.join(cfg.DATA_DIR, 'datasets');
fs.mkdirSync(dsDir, { recursive: true });

const pad = (n) => String(n).padStart(2, '0');
const iso = (t) => { const d = new Date(t); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; };
const keyOf = (p) => `${p.s}|${p.la}|${p.lo}|${p.d}|${p.t}`;
const tsOf = (p) => Date.parse(`${p.d}T${p.t.slice(0, 2)}:${p.t.slice(2, 4)}:00Z`);

function snapBbox(b, step = 0.25) {
  return [Math.floor(b[0] / step) * step, Math.floor(b[1] / step) * step, Math.ceil(b[2] / step) * step, Math.ceil(b[3] / step) * step];
}
const contains = (outer, inner) => inner[0] >= outer[0] - 1e-9 && inner[1] >= outer[1] - 1e-9 && inner[2] <= outer[2] + 1e-9 && inner[3] <= outer[3] + 1e-9;
const areaDeg = (b) => (b[2] - b[0]) * (b[3] - b[1]);

function createDataset({ id, name, bbox }) {
  const ds = {
    id, name, bbox, points: [], keys: new Set(), pending: [],
    status: 'idle', progress: { done: 0, total: 0, message: '' }, coverage: {}, updatedAt: null, lastPoll: null, demo: cfg.DEMO,
    errors: [],
  };
  datasets.set(id, ds);
  return ds;
}

function addPoints(ds, pts, { emit = false } = {}) {
  const fresh = [];
  for (const p of pts) {
    const k = keyOf(p);
    if (ds.keys.has(k)) continue;
    ds.keys.add(k); ds.points.push(p); fresh.push(p);
  }
  if (fresh.length) {
    ds.updatedAt = new Date().toISOString();
    if (emit) events.emit('hotspots', { dataset: ds.id, points: fresh });
  }
  return fresh;
}

// ---------------- persistence (live mode) ----------------
function saveDataset(ds) {
  if (ds.demo) return;
  const file = path.join(dsDir, `${ds.id}.json`);
  const compact = ds.points.map((p) => [p.la, p.lo, p.d, p.t, p.s, p.c, p.cr, p.f, p.b, p.dn, p.ty, p.src]);
  fs.writeFileSync(file + '.tmp', JSON.stringify({ id: ds.id, name: ds.name, bbox: ds.bbox, coverage: ds.coverage, points: compact }));
  fs.renameSync(file + '.tmp', file);
}
function loadDataset(ds) {
  const file = path.join(dsDir, `${ds.id}.json`);
  if (!fs.existsSync(file)) return false;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  ds.coverage = j.coverage || {};
  addPoints(ds, j.points.map(([la, lo, d, t, s, c, cr, f, b, dn, ty, src]) => ({ la, lo, d, t, s, c, cr, f, b, sc: 1, dn, ty, src })));
  return true;
}

// ---------------- demo ----------------
function buildDemo(ds, aoiContains) {
  const now = Date.now();
  const endOfToday = Date.parse(`${iso(now)}T23:59:59Z`);
  let opts;
  if (ds.id === 'lka') {
    opts = { sampler: demo.sriLankaSampler(), eventsPerYear: 1700, seasonScale: demo.sriLankaSeasonScale(), yearFactors: demo.LKA_YEARS };
  } else {
    opts = demo.genericDataset(ds.id, ds.bbox, aoiContains);
  }
  const pts = demo.generate({ id: ds.id, start: cfg.HISTORY_START, end: endOfToday, ...opts });
  // Detections "in the future" relative to now are released gradually -> simulated live feed.
  const past = [], future = [];
  for (const p of pts) (p._ts <= now ? past : future).push(p);
  addPoints(ds, past);
  ds.pending = future.sort((a, b) => a._ts - b._ts);
  ds.status = 'ready';
  ds.coverage = { DEMO: { from: cfg.HISTORY_START, to: iso(now) } };
  ds.updatedAt = new Date().toISOString();
}

function releaseDemo(ds) {
  const now = Date.now();
  const out = [];
  while (ds.pending.length && ds.pending[0]._ts <= now) out.push(ds.pending.shift());
  if (out.length) addPoints(ds, out, { emit: true });
  ds.lastPoll = new Date().toISOString();
}

// ---------------- live backfill ----------------
const HISTORY_SOURCES = [
  { sp: 'MODIS_SP', nrt: 'MODIS_NRT', start: '2000-11-01' },
  { sp: 'VIIRS_SNPP_SP', nrt: 'VIIRS_SNPP_NRT', start: '2012-01-20' },
  { sp: 'VIIRS_NOAA20_SP', nrt: 'VIIRS_NOAA20_NRT', start: '2018-04-01' },
  { sp: null, nrt: 'VIIRS_NOAA21_NRT', start: '2024-01-17' },
];

async function backfill(ds) {
  if (ds.status === 'backfilling') return;
  ds.status = 'backfilling';
  const avail = await firms.availability().catch((e) => { ds.errors.push(e.message); return {}; });
  const today = iso(Date.now());
  const span = cfg.FIRMS_DAY_RANGE;
  const jobs = [];
  let alreadyDone = 0;
  for (const src of HISTORY_SOURCES) {
    const start = src.start > cfg.HISTORY_START ? src.start : cfg.HISTORY_START;
    const spMax = src.sp && avail[src.sp] ? avail[src.sp].max : null;
    const ranges = [];
    if (src.sp && spMax) ranges.push([src.sp, start, spMax]);
    const nrtStart = spMax ? iso(Date.parse(spMax) + 864e5) : (avail[src.nrt]?.min || iso(Date.now() - 60 * 864e5));
    ranges.push([src.nrt, nrtStart > start ? nrtStart : start, today]);
    for (const [source, from, to] of ranges) {
      const toMs = Date.parse(to);
      for (let chunkStart = Date.parse(from); chunkStart <= toMs; chunkStart += span * 864e5) {
        const days = Math.min(span, Math.round((toMs - chunkStart) / 864e5) + 1);
        const ck = `${source}:${iso(chunkStart)}:${days}`;
        if (ds.coverage.chunks && ds.coverage.chunks[ck]) { alreadyDone++; continue; }
        jobs.push({ source, date: iso(chunkStart), days, ck });
      }
    }
  }
  // Most recent first so dashboards fill in quickly.
  jobs.sort((a, b) => b.date.localeCompare(a.date));
  ds.coverage.chunks = ds.coverage.chunks || {};
  // Progress counts chunks finished in earlier runs too, so a restart doesn't reset it to 0 %.
  ds.progress = { done: alreadyDone, total: alreadyDone + jobs.length, startedAt: Date.now(), doneThisRun: 0, message: `Fetching ${jobs.length} FIRMS chunks` };
  let sinceSave = 0;
  await Promise.all(jobs.map(async (j) => {
    try {
      const pts = await firms.areaPoints(j.source, ds.bbox, j.days, j.date, ds.id === 'lka' ? 0 : 2);
      addPoints(ds, pts);
      // NRT chunks from the last 2 weeks are re-polled; don't mark them as done.
      if (Date.now() - Date.parse(j.date) > 14 * 864e5) ds.coverage.chunks[j.ck] = 1;
    } catch (e) {
      if (ds.errors.length < 20) ds.errors.push(`${j.source} ${j.date}: ${e.message}`);
    } finally {
      ds.progress.done++; ds.progress.doneThisRun++;
      if (++sinceSave >= 50) { sinceSave = 0; try { saveDataset(ds); } catch { /* ignore */ } }
    }
  }));
  ds.status = 'ready';
  ds.progress.message = `Backfill complete (${ds.points.length.toLocaleString()} detections)`;
  saveDataset(ds);
}

async function pollLive(ds) {
  const date = iso(Date.now() - 864e5);
  const srcs = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'MODIS_NRT'];
  let fresh = 0;
  for (const s of srcs) {
    try {
      const pts = await firms.areaPoints(s, ds.bbox, 2, date, 0); // live polling always goes first
      fresh += addPoints(ds, pts, { emit: true }).length;
    } catch (e) { if (ds.errors.length < 20) ds.errors.push(`poll ${s}: ${e.message}`); }
  }
  ds.lastPoll = new Date().toISOString();
  if (fresh) saveDataset(ds);
  return fresh;
}

// ---------------- static heat sources (recomputed as the dataset grows) ----------------
function staticFor(ds) {
  const n = ds.points.length;
  if (!ds._static || n > ds._static.n * 1.02 || Date.now() - ds._static.at > 30 * 60e3) {
    ds._static = { n, at: Date.now(), ...detectStatic(ds.points) };
  }
  return ds._static;
}

// Regional calibration prior: the dataset-wide MODIS→VIIRS ratios. Small areas with few
// overlapping detections shrink toward these instead of a generic constant.
function priorFor(ds) {
  const { harmonize, DEFAULT_PRIOR } = require('./harmonize');
  const n = ds.points.length;
  if (!ds._prior || n > ds._prior.n * 1.05) {
    const st = staticFor(ds);
    const c = harmonize(ds.points.filter((p) => !st.isStatic(p)), { operating }).calibration;
    const ok = c.modisCellDaysInWindow >= 300;
    ds._prior = { n, value: ok ? { kV: c.kV, kTA: c.kTA, source: `regional (${ds.name})` } : { ...DEFAULT_PRIOR, source: 'default' } };
  }
  return ds._prior.value;
}

// ---------------- satellite coverage (which feeds actually have data on a given day) ----------------
const SAT_SOURCES = { T: ['MODIS_SP', 'MODIS_NRT'], A: ['MODIS_SP', 'MODIS_NRT'], N: ['VIIRS_SNPP_SP', 'VIIRS_SNPP_NRT'], N20: ['VIIRS_NOAA20_SP', 'VIIRS_NOAA20_NRT'], N21: ['VIIRS_NOAA21_SP', 'VIIRS_NOAA21_NRT'] };
let coverage = null; // sat -> [[from,to],...]
async function refreshCoverage() {
  if (cfg.DEMO) return;
  try {
    const av = await firms.availability();
    const c = {};
    for (const [sat, srcs] of Object.entries(SAT_SOURCES)) {
      c[sat] = srcs.filter((s) => av[s]).map((s) => [s === 'MODIS_SP' || s.endsWith('_SP') ? firms.SAT_INFO[sat].start : av[s].min, av[s].max])
        .map(([a, b]) => [a < firms.SAT_INFO[sat].start ? firms.SAT_INFO[sat].start : a, b]);
    }
    coverage = c;
  } catch { /* keep previous */ }
}
function operating(sat, d) {
  if (d < firms.SAT_INFO[sat].start) return false;
  if (!coverage || !coverage[sat] || !coverage[sat].length) return true;
  return coverage[sat].some(([a, b]) => d >= a && d <= b);
}
const coverageInfo = () => coverage;

// ---------------- public API ----------------
function ensureSriLanka() {
  if (datasets.has('lka')) return datasets.get('lka');
  const c = geo.findCountry('Sri Lanka');
  const ds = createDataset({ id: 'lka', name: 'Sri Lanka', bbox: snapBbox(c.bbox, 0.1) });
  if (cfg.DEMO) buildDemo(ds);
  else {
    loadDataset(ds);
    ds.status = ds.points.length ? 'ready' : 'idle';
    backfill(ds).catch((e) => ds.errors.push(e.message));
  }
  return ds;
}

const MAX_BACKFILL_DEG2 = 400; // ~ 4.5M km² near equator; larger areas: use archive import.

function datasetFor(aoi) {
  const candidates = [...datasets.values()].filter((d) => contains(d.bbox, aoi.bbox)).sort((a, b) => areaDeg(a.bbox) - areaDeg(b.bbox));
  if (candidates.length) return candidates[0];
  const bbox = snapBbox(aoi.bbox, aoi.kind === 'country' ? 0.5 : 0.25);
  const id = `r_${bbox.map((v) => v.toFixed(2)).join('_').replace(/[-.]/g, (c) => (c === '-' ? 'm' : 'p'))}`;
  if (datasets.has(id)) return datasets.get(id);
  const ds = createDataset({ id, name: aoi.label, bbox });
  if (cfg.DEMO) buildDemo(ds, aoi.kind === 'country' ? aoi.contains : null);
  else {
    loadDataset(ds);
    ds.status = ds.points.length ? 'ready' : 'idle';
    if (areaDeg(bbox) <= MAX_BACKFILL_DEG2) backfill(ds).catch((e) => ds.errors.push(e.message));
    else {
      ds.progress.message = 'Area too large for API backfill — showing recent NRT only. Import FIRMS archive CSVs for full history (see README).';
      pollLive(ds).catch(() => {});
    }
  }
  return ds;
}

function pointsIn(ds, aoi) {
  const [w, s, e, n] = aoi.bbox;
  return ds.points.filter((p) => p.lo >= w && p.lo <= e && p.la >= s && p.la <= n && aoi.contains(p.lo, p.la));
}

// Human-friendly backfill state: percentage, years covered, throttle pause and a time estimate.
function backfillInfo(ds) {
  const p = ds.progress;
  const t = firms.throttleInfo();
  const remaining = Math.max(0, p.total - p.done);
  // Observed pace this run (requests/min), falling back to the transaction budget (~42/min).
  const mins = (Date.now() - (p.startedAt || Date.now())) / 60000;
  const pace = mins > 3 && p.doneThisRun > 20 ? p.doneThisRun / mins : 40;
  const oldest = ds.points.length ? ds.points.reduce((a, q) => (q.d < a ? q.d : a), '9999') : null;
  return {
    percent: p.total ? Math.floor((p.done / p.total) * 100) : 0, done: p.done, total: p.total, remaining,
    oldest, target: cfg.HISTORY_START, paused: t.paused, resumeInSec: t.resumeInSec, transactions: t.transactions, transactionLimit: t.limit,
    etaMinutes: Math.ceil(remaining / Math.max(pace, 5)),
  };
}

function datasetInfo(ds) {
  return {
    id: ds.id, name: ds.name, bbox: ds.bbox, status: ds.status, progress: ds.progress, detections: ds.points.length,
    backfill: ds.status === 'backfilling' ? backfillInfo(ds) : null,
    updatedAt: ds.updatedAt, lastPoll: ds.lastPoll, demo: ds.demo, errors: ds.errors.slice(-5),
    firstDate: ds.points.length ? ds.points.reduce((a, p) => (p.d < a ? p.d : a), '9999') : null,
  };
}

// ---------------- global live view ----------------
const global = { points: [], updatedAt: null, byCountry: [], status: 'idle' };
async function refreshGlobal() {
  try {
    global.status = 'loading';
    let pts;
    if (cfg.DEMO) pts = demo.globalSnapshot(Date.now());
    else {
      const date = iso(Date.now() - 864e5);
      const parts = await Promise.all(['VIIRS_NOAA20_NRT', 'MODIS_NRT'].map((s) => firms.areaPoints(s, [-180, -90, 180, 90], 2, date, 0).catch(() => [])));
      pts = parts.flat();
    }
    const cutoff = Date.now() - 48 * 3600e3;
    pts = pts.filter((p) => tsOf(p) >= cutoff);
    const by = new Map();
    for (const p of pts) {
      const c = geo.isLand(p.lo, p.la);
      p.cn = c ? c.name : 'Ocean / unassigned';
      const ageH = (Date.now() - tsOf(p)) / 3600e3;
      const o = by.get(p.cn) || { country: p.cn, id: c ? c.id : null, last24h: 0, last48h: 0, modis: 0, viirs: 0, frp: 0, cells: new Set() };
      o.last48h++; if (ageH <= 24) o.last24h++;
      if (p.s === 'T' || p.s === 'A') o.modis++; else o.viirs++;
      o.frp += p.f || 0;
      o.cells.add(`${p.d}|${Math.floor(p.la * 100)}_${Math.floor(p.lo * 100)}`);
      by.set(p.cn, o);
    }
    global.byCountry = [...by.values()].map((o) => ({ country: o.country, id: o.id, last24h: o.last24h, last48h: o.last48h, modis: o.modis, viirs: o.viirs, fireCellDays: o.cells.size, totalFrp: Math.round(o.frp) }))
      .sort((a, b) => b.fireCellDays - a.fireCellDays);
    global.points = pts;
    global.updatedAt = new Date().toISOString();
    global.status = 'ready';
    events.emit('global', { updatedAt: global.updatedAt, count: pts.length });
  } catch (e) { global.status = 'error: ' + e.message; }
}

// ---------------- schedulers ----------------
function start() {
  refreshCoverage();
  setInterval(refreshCoverage, 6 * 3600e3);
  const lka = ensureSriLanka();
  refreshGlobal();
  if (cfg.DEMO) {
    setInterval(() => { for (const ds of datasets.values()) releaseDemo(ds); }, 60 * 1000);
    setInterval(refreshGlobal, 15 * 60 * 1000);
  } else {
    setInterval(() => { for (const ds of datasets.values()) pollLive(ds).catch(() => {}); }, cfg.POLL_MINUTES * 60 * 1000);
    if (cfg.GLOBAL_POLL_MINUTES > 0) setInterval(refreshGlobal, cfg.GLOBAL_POLL_MINUTES * 60 * 1000);
    setTimeout(() => pollLive(lka).catch(() => {}), 5000);
  }
}

module.exports = { priorFor, staticFor, operating, coverageInfo, events, datasets, start, datasetFor, pointsIn, datasetInfo, ensureSriLanka, global, refreshGlobal, addPoints, saveDataset, createDataset, snapBbox, tsOf };
