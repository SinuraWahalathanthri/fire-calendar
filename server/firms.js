// NASA FIRMS (Fire Information for Resource Management System) API client.
// Docs: https://firms.modaps.eosdis.nasa.gov/api/  (MAP_KEY from https://firms.modaps.eosdis.nasa.gov/api/map_key/)
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

// Satellite codes used internally across the app.
const SAT = { TERRA: 'T', AQUA: 'A', SNPP: 'N', NOAA20: 'N20', NOAA21: 'N21' };
const SAT_INFO = {
  T: { sensor: 'MODIS', name: 'MODIS Terra', start: '2000-11-01' },
  A: { sensor: 'MODIS', name: 'MODIS Aqua', start: '2002-07-04' },
  N: { sensor: 'VIIRS', name: 'VIIRS S-NPP', start: '2012-01-20' },
  N20: { sensor: 'VIIRS', name: 'VIIRS NOAA-20', start: '2018-04-01' },
  N21: { sensor: 'VIIRS', name: 'VIIRS NOAA-21', start: '2024-01-17' },
};

// FIRMS source ids -> which satellites they can contain.
const SOURCES = {
  MODIS_SP: { sensor: 'MODIS' }, MODIS_NRT: { sensor: 'MODIS' },
  VIIRS_SNPP_SP: { sensor: 'VIIRS', sat: 'N' }, VIIRS_SNPP_NRT: { sensor: 'VIIRS', sat: 'N' },
  VIIRS_NOAA20_SP: { sensor: 'VIIRS', sat: 'N20' }, VIIRS_NOAA20_NRT: { sensor: 'VIIRS', sat: 'N20' },
  VIIRS_NOAA21_NRT: { sensor: 'VIIRS', sat: 'N21' },
};

const cacheDir = path.join(cfg.DATA_DIR, 'cache', 'firms');
fs.mkdirSync(cacheDir, { recursive: true });

// ---- rate limiting (FIRMS allows 5000 transactions / 10 minutes per key) ----
const stamps = [];
let active = 0;
const queue = [];
// Lower number = served first. The primary region (Sri Lanka) uses 0 so other countries a
// user opens never slow down its live feed or history download.
function schedule(fn, priority = 1) {
  return new Promise((resolve, reject) => {
    const job = { fn, resolve, reject, priority };
    let i = queue.length;
    while (i > 0 && queue[i - 1].priority > priority) i--;
    queue.splice(i, 0, job);
    pump();
  });
}
// FIRMS charges several "transactions" per request (≈10 for a country-sized box), so besides a
// request cap we watch the key's real usage and pause before reaching the limit.
const TX_LIMIT_SAFE = 4200;
const usage = { current: 0, limit: 5000, checkedAt: 0, pausedUntil: 0 };
let pumpTimer = null;
async function checkUsage() {
  if (!cfg.FIRMS_MAP_KEY || Date.now() - usage.checkedAt < 15000) return;
  usage.checkedAt = Date.now();
  try {
    const r = await fetch(`${cfg.FIRMS_BASE}/mapserver/mapkey_status/?MAP_KEY=${cfg.FIRMS_MAP_KEY}`, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    usage.current = Number(j.current_transactions) || 0;
    usage.limit = Number(j.transaction_limit) || 5000;
    if (usage.current >= TX_LIMIT_SAFE) usage.pausedUntil = Date.now() + 60000;
  } catch { /* ignore */ }
}
function pump() {
  const now = Date.now();
  while (stamps.length && now - stamps[0] > 600000) stamps.shift();
  if (queue.length) checkUsage();
  const paused = now < usage.pausedUntil;
  while (!paused && active < cfg.FIRMS_CONCURRENCY && queue.length && stamps.length < cfg.FIRMS_MAX_PER_10MIN) {
    const job = queue.shift();
    active++; stamps.push(Date.now());
    job.fn().then(job.resolve, job.reject).finally(() => { active--; pump(); });
  }
  if (queue.length && !pumpTimer) pumpTimer = setTimeout(() => { pumpTimer = null; pump(); }, paused ? 10000 : 3000);
}

const stats = { requests: 0, cacheHits: 0, errors: 0, lastError: null, lastSuccess: null };

async function getText(url, attempt = 0) {
  stats.requests++;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'harmonized-fire-calendar/1.0' }, signal: AbortSignal.timeout(60000) });
  } catch (e) {
    if (attempt < 2) { await new Promise((r) => setTimeout(r, 3000 * (attempt + 1))); return getText(url, attempt + 1); }
    throw e;
  }
  if (res.status >= 500 && attempt < 2) { await new Promise((r) => setTimeout(r, 3000 * (attempt + 1))); return getText(url, attempt + 1); }
  const text = await res.text();
  if (/Exceed/i.test(text) && attempt < 12) {
    // Rate-limited: pause the whole queue and retry this request later.
    usage.pausedUntil = Date.now() + 90000;
    await new Promise((r) => setTimeout(r, 95000));
    return getText(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`FIRMS HTTP ${res.status}: ${text.slice(0, 200)}`);
  if (/^(Invalid|Error|Exceeding)/i.test(text.trim())) throw new Error(`FIRMS: ${text.trim().slice(0, 200)}`);
  return text;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const v = l.split(',');
    const o = {};
    head.forEach((h, i) => { o[h] = v[i]; });
    return o;
  });
}

function normConfidence(sensor, raw) {
  if (raw == null || raw === '') return 1;
  const s = String(raw).trim().toLowerCase();
  if (sensor === 'MODIS') {
    const n = Number(s);
    if (Number.isFinite(n)) return n < 30 ? 0 : n < 80 ? 1 : 2;
  }
  return s.startsWith('l') ? 0 : s.startsWith('h') ? 2 : 1;
}

function satFromRow(source, row) {
  const meta = SOURCES[source] || {};
  if (meta.sat) return meta.sat;
  const s = String(row.satellite || '').trim();
  if (/^(T|Terra)$/i.test(s)) return 'T';
  if (/^(A|Aqua)$/i.test(s)) return 'A';
  if (/^N21|NOAA-?21/i.test(s)) return 'N21';
  if (/^N20|^1$|NOAA-?20/i.test(s)) return 'N20';
  if (/^N$|NPP/i.test(s)) return 'N';
  return meta.sensor === 'VIIRS' ? 'N' : 'A';
}

// Normalized hotspot record used everywhere in the app.
function normalizeRow(source, row) {
  const sat = satFromRow(source, row);
  const sensor = SAT_INFO[sat].sensor;
  const lat = Number(row.latitude), lon = Number(row.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    la: Math.round(lat * 1e5) / 1e5,
    lo: Math.round(lon * 1e5) / 1e5,
    d: row.acq_date,
    t: String(row.acq_time || '0000').padStart(4, '0'),
    s: sat,
    c: normConfidence(sensor, row.confidence),
    cr: row.confidence,
    f: Number(row.frp) || 0,
    b: Number(row.brightness || row.bright_ti4) || 0,
    sc: Number(row.scan) || 1,
    dn: row.daynight || 'D',
    ty: row.type != null && row.type !== '' ? Number(row.type) : null,
    src: /_SP$/.test(source) ? 'SP' : 'NRT',
  };
}

const r2 = (v) => Math.round(v * 100) / 100;
function bboxKey(b) { return b.map((v) => r2(v).toFixed(2)).join(','); }

async function area(source, bbox, dayRange, date, priority = 1) {
  if (!cfg.FIRMS_MAP_KEY) throw new Error('FIRMS_MAP_KEY not configured');
  const key = `${source}_${bboxKey(bbox).replace(/,/g, '_')}_${date}_${dayRange}.csv`;
  const file = path.join(cacheDir, key);
  // Standard-processing (SP) results never change, NRT older than ~10 days is stable too.
  const ageDays = (Date.now() - Date.parse(date)) / 864e5;
  const cacheable = /_SP$/.test(source) || ageDays > 14;
  if (cacheable && fs.existsSync(file)) { stats.cacheHits++; return parseCSV(fs.readFileSync(file, 'utf8')); }
  const url = `${cfg.FIRMS_BASE}/api/area/csv/${cfg.FIRMS_MAP_KEY}/${source}/${bboxKey(bbox)}/${dayRange}/${date}`;
  try {
    const text = await schedule(() => getText(url), priority);
    if (cacheable) fs.writeFileSync(file, text);
    stats.lastSuccess = new Date().toISOString();
    return parseCSV(text);
  } catch (e) {
    stats.errors++; stats.lastError = e.message.replace(cfg.FIRMS_MAP_KEY, '***');
    throw e;
  }
}

async function areaPoints(source, bbox, dayRange, date, priority = 1) {
  const rows = await area(source, bbox, dayRange, date, priority);
  return rows.map((r) => normalizeRow(source, r)).filter(Boolean);
}

let availCache = null;
async function availability() {
  if (!cfg.FIRMS_MAP_KEY) return null;
  if (availCache && Date.now() - availCache.at < 6 * 3600e3) return availCache.data;
  const text = await schedule(() => getText(`${cfg.FIRMS_BASE}/api/data_availability/csv/${cfg.FIRMS_MAP_KEY}/all`));
  const data = {};
  for (const r of parseCSV(text)) data[r.data_id] = { min: r.min_date, max: r.max_date };
  availCache = { at: Date.now(), data };
  return data;
}

async function mapKeyStatus() {
  if (!cfg.FIRMS_MAP_KEY) return null;
  try {
    const res = await fetch(`${cfg.FIRMS_BASE}/mapserver/mapkey_status/?MAP_KEY=${cfg.FIRMS_MAP_KEY}`);
    return await res.json();
  } catch { return null; }
}

// When paused, transactions free up as our oldest requests age out of FIRMS's rolling 10-minute window.
function throttleInfo() {
  const now = Date.now();
  const paused = now < usage.pausedUntil || usage.current >= TX_LIMIT_SAFE;
  let resumeInSec = 0;
  if (paused) {
    const ageOut = stamps.length ? stamps[0] + 600000 - now : 60000;
    resumeInSec = Math.max(15, Math.round(Math.max(usage.pausedUntil - now, Math.min(ageOut, 600000)) / 1000));
  }
  return { paused, resumeInSec, transactions: usage.current, limit: usage.limit };
}

module.exports = { throttleInfo, usage, SAT, SAT_INFO, SOURCES, area, areaPoints, availability, mapKeyStatus, normalizeRow, parseCSV, stats, bboxKey };
