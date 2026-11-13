// Alert rules for government / emergency integration.
// Each rule watches an AOI; when triggered it is logged, pushed over SSE, POSTed to an optional
// webhook, and published in CAP 1.2 (Common Alerting Protocol), GeoJSON and RSS feeds.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const geo = require('./geo');
const store = require('./store');

const file = path.join(cfg.DATA_DIR, 'alerts.json');
const state = { rules: [], log: [] };
const aoiCache = new Map();
const listeners = new Set();

function load() {
  if (fs.existsSync(file)) {
    try { Object.assign(state, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { /* ignore corrupt file */ }
  }
  if (!state.rules.length) {
    state.rules.push(
      { id: 'lka-new-high', name: 'Sri Lanka — new high-confidence hotspot', aoi: { kind: 'country', country: 'Sri Lanka' }, type: 'new_hotspots', threshold: 1, minConfidence: 2, webhook: '', active: true, createdAt: new Date().toISOString() },
      { id: 'lka-surge', name: 'Sri Lanka — 24 h surge (≥ 40 detections)', aoi: { kind: 'country', country: 'Sri Lanka' }, type: 'count_24h', threshold: 40, minConfidence: 1, webhook: '', active: true, createdAt: new Date().toISOString() },
    );
    save();
  }
  // Added in v1.1: alert when a hotspot falls inside a national park, sanctuary or reserve.
  if (!state.rules.some((r) => r.id === 'lka-protected')) {
    state.rules.push({ id: 'lka-protected', name: 'Sri Lanka — hotspot inside a protected area', aoi: { kind: 'country', country: 'Sri Lanka' }, type: 'protected_area', threshold: 1, minConfidence: 1, webhook: '', active: true, createdAt: new Date().toISOString() });
    save();
  }
}
function save() { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(state, null, 1)); }

function aoiFor(rule) {
  const k = JSON.stringify(rule.aoi);
  if (!aoiCache.has(k)) aoiCache.set(k, geo.makeAOI(rule.aoi));
  return aoiCache.get(k);
}

function validateRule(r) {
  const rule = {
    id: crypto.randomUUID(), name: String(r.name || 'Untitled rule').slice(0, 120), aoi: r.aoi,
    type: ['new_hotspots', 'count_24h', 'anomaly', 'protected_area'].includes(r.type) ? r.type : 'new_hotspots',
    threshold: Math.max(0, Number(r.threshold) || 1), minConfidence: [0, 1, 2].includes(Number(r.minConfidence)) ? Number(r.minConfidence) : 1,
    webhook: r.webhook ? String(r.webhook) : '', active: r.active !== false, createdAt: new Date().toISOString(),
  };
  if (rule.webhook && !/^https?:\/\//i.test(rule.webhook)) throw new Error('Webhook must be an http(s) URL');
  geo.makeAOI(rule.aoi); // throws if invalid
  return rule;
}

function addRule(r) { const rule = validateRule(r); state.rules.push(rule); save(); return rule; }
function deleteRule(id) { const n = state.rules.length; state.rules = state.rules.filter((r) => r.id !== id); save(); return n !== state.rules.length; }

function fire(rule, info) {
  const last = state.log.find((a) => a.ruleId === rule.id);
  const cooldownMs = rule.type === 'new_hotspots' || rule.type === 'protected_area' ? 10 * 60e3 : rule.type === 'count_24h' ? 6 * 3600e3 : 24 * 3600e3;
  if (last && Date.now() - Date.parse(last.time) < cooldownMs && rule.type !== 'new_hotspots' && rule.type !== 'protected_area') return;
  const aoi = aoiFor(rule);
  const severity = info.count >= 50 || info.anomalyPct >= 150 ? 'Severe' : info.count >= 10 || info.anomalyPct >= 75 ? 'Moderate' : 'Minor';
  const alert = {
    id: crypto.randomUUID(), ruleId: rule.id, ruleName: rule.name, type: rule.type, time: new Date().toISOString(),
    area: aoi.label, bbox: aoi.bbox, severity, demo: cfg.DEMO, ...info,
  };
  state.log.unshift(alert);
  state.log = state.log.slice(0, 500);
  save();
  for (const fn of listeners) fn(alert);
  if (rule.webhook) {
    fetch(rule.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(alert), signal: AbortSignal.timeout(8000) })
      .then((r) => { alert.webhookStatus = r.status; })
      .catch((e) => { alert.webhookStatus = `error: ${e.message}`; });
  }
}

function onHotspots({ dataset, points }) {
  const ds = store.datasets.get(dataset);
  const st = ds ? store.staticFor(ds) : null;
  if (st) points = points.filter((p) => !st.isStatic(p)); // never alert on factories / flares
  for (const rule of state.rules) {
    if (!rule.active || (rule.type !== 'new_hotspots' && rule.type !== 'protected_area')) continue;
    let aoi;
    try { aoi = aoiFor(rule); } catch { continue; }
    let hits = points.filter((p) => p.c >= rule.minConfidence && aoi.contains(p.lo, p.la));
    if (rule.type === 'protected_area') {
      hits = hits.filter((p) => geo.protectedAreaAt(p.lo, p.la));
      if (!hits.length) continue;
      const byPA = {};
      for (const p of hits) { const pa = geo.protectedAreaAt(p.lo, p.la); (byPA[pa.name] = byPA[pa.name] || { pa, n: 0 }).n++; }
      const parts = Object.values(byPA).sort((a, b) => b.n - a.n);
      fire(rule, {
        count: hits.length, protectedAreas: parts.map((x) => ({ name: x.pa.name, agency: x.pa.agency, detections: x.n })),
        message: `${hits.length} hotspot${hits.length > 1 ? 's' : ''} inside ${parts.map((x) => x.pa.name).slice(0, 3).join(', ')}${parts.length > 3 ? ' and others' : ''}`,
        hotspots: hits.slice(0, 50).map((p) => ({ lat: p.la, lon: p.lo, date: p.d, time: p.t, satellite: p.s, confidence: p.c, frp: p.f, protectedArea: geo.protectedAreaAt(p.lo, p.la).name })),
      });
      continue;
    }
    if (hits.length >= Math.max(1, rule.threshold)) {
      fire(rule, {
        count: hits.length,
        message: `${hits.length} new hotspot${hits.length > 1 ? 's' : ''} detected in ${aoi.label}`,
        hotspots: hits.slice(0, 50).map((p) => ({ lat: p.la, lon: p.lo, date: p.d, time: p.t, satellite: p.s, confidence: p.c, frp: p.f })),
      });
    }
  }
}

function periodic() {
  const now = Date.now();
  for (const rule of state.rules) {
    if (!rule.active || rule.type === 'new_hotspots') continue;
    let aoi; try { aoi = aoiFor(rule); } catch { continue; }
    const ds = store.datasetFor(aoi);
    if (rule.type === 'count_24h') {
      const st = store.staticFor(ds);
      const pts = store.pointsIn(ds, aoi).filter((p) => !st.isStatic(p) && p.c >= rule.minConfidence && now - store.tsOf(p) <= 24 * 3600e3);
      if (pts.length >= rule.threshold) fire(rule, { count: pts.length, message: `${pts.length} hotspots in the last 24 h in ${aoi.label} (threshold ${rule.threshold})` });
    } else if (rule.type === 'anomaly') {
      const { analyze } = require('./analytics');
      const st = store.staticFor(ds);
      const r = analyze(store.pointsIn(ds, aoi).filter((p) => !st.isStatic(p)), aoi, { historyStart: cfg.HISTORY_START, operating: store.operating });
      const pct = r.nowcast.vsMedianPct;
      if (pct != null && pct >= rule.threshold) fire(rule, { count: Math.round(r.nowcast.monthToDate), anomalyPct: pct, message: `${r.nowcast.monthName} burning projected ${pct}% above the historical median in ${aoi.label}` });
    }
  }
}

function start() {
  load();
  store.events.on('hotspots', onHotspots);
  setTimeout(periodic, 20000);
  setInterval(periodic, 15 * 60e3);
}

// ---------- Feeds ----------
const esc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

function capFeed(baseUrl) {
  const items = state.log.slice(0, 50).map((a) => {
    const [w, s, e, n] = a.bbox;
    const poly = `${s},${w} ${s},${e} ${n},${e} ${n},${w} ${s},${w}`;
    return `  <alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
    <identifier>${esc(a.id)}</identifier>
    <sender>hotspot-calendar@${esc(new URL(baseUrl).host)}</sender>
    <sent>${a.time.replace(/\.\d+Z$/, '+00:00')}</sent>
    <status>${a.demo ? 'Exercise' : 'Actual'}</status>
    <msgType>Alert</msgType>
    <scope>Public</scope>
    <info>
      <language>en</language>
      <category>Fire</category>
      <event>Satellite-detected active fire</event>
      <urgency>${a.type === 'new_hotspots' ? 'Immediate' : 'Expected'}</urgency>
      <severity>${a.severity}</severity>
      <certainty>Observed</certainty>
      <senderName>Harmonized Fire Calendar (NASA FIRMS MODIS/VIIRS)</senderName>
      <headline>${esc(a.message)}</headline>
      <description>${esc(a.message)}. Rule: ${esc(a.ruleName)}.${a.demo ? ' DEMO DATA — exercise only.' : ''}</description>
      <web>${esc(baseUrl)}/#/explore</web>
      <area>
        <areaDesc>${esc(a.area)}</areaDesc>
        <polygon>${poly}</polygon>
      </area>
    </info>
  </alert>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<alerts generated="${new Date().toISOString()}">\n${items}\n</alerts>\n`;
}

function geojsonFeed() {
  return {
    type: 'FeatureCollection', generated: new Date().toISOString(),
    features: state.log.slice(0, 100).flatMap((a) => (a.hotspots && a.hotspots.length ? a.hotspots : [{ lat: (a.bbox[1] + a.bbox[3]) / 2, lon: (a.bbox[0] + a.bbox[2]) / 2 }])
      .map((h) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [h.lon, h.lat] }, properties: { alertId: a.id, rule: a.ruleName, severity: a.severity, time: a.time, message: a.message, ...h } }))),
  };
}

function rssFeed(baseUrl) {
  const items = state.log.slice(0, 50).map((a) => `<item><title>${esc(`[${a.severity}] ${a.message}`)}</title><guid isPermaLink="false">${a.id}</guid><pubDate>${new Date(a.time).toUTCString()}</pubDate><description>${esc(a.ruleName)}</description><link>${esc(baseUrl)}/#/dashboard</link></item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Fire hotspot alerts</title><link>${esc(baseUrl)}</link><description>Satellite hotspot alerts (NASA FIRMS, harmonized MODIS/VIIRS)</description>${items}</channel></rss>`;
}

module.exports = { start, state, addRule, deleteRule, capFeed, geojsonFeed, rssFeed, listeners, periodic };
