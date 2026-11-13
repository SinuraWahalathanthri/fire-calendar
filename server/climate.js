// Oceanic Niño Index (ONI) from NOAA CPC — the standard El Niño / La Niña indicator.
// Drought linked to ENSO drives fire activity in South Asia and many tropical regions, so the
// outlook uses it when (and only when) it improves the hindcast for the selected area.
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const URL_ONI = 'https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt';
const file = path.join(cfg.DATA_DIR, 'oni.json');
const SEAS = ['DJF', 'JFM', 'FMA', 'MAM', 'AMJ', 'MJJ', 'JJA', 'JAS', 'ASO', 'SON', 'OND', 'NDJ'];
let data = null; // { 'YYYY-MM': anomaly } keyed by the season's centre month
let fetchedAt = 0;

function parse(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Z]{3})\s+(\d{4})\s+[-\d.]+\s+([-\d.]+)$/);
    if (!m) continue;
    const i = SEAS.indexOf(m[1]);
    if (i < 0) continue;
    // centre month of DJF is Jan, JFM is Feb, ... NDJ is Dec
    out[`${m[2]}-${String(i + 1).padStart(2, '0')}`] = Number(m[3]);
  }
  return out;
}

async function refresh() {
  try {
    const res = await fetch(URL_ONI, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parse(await res.text());
    if (Object.keys(parsed).length > 100) {
      data = parsed; fetchedAt = Date.now();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ fetchedAt, data }));
    }
  } catch {
    if (!data && fs.existsSync(file)) { const j = JSON.parse(fs.readFileSync(file, 'utf8')); data = j.data; fetchedAt = j.fetchedAt; }
  }
}

function start() {
  if (fs.existsSync(file)) { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); data = j.data; fetchedAt = j.fetchedAt; } catch { /* ignore */ } }
  refresh();
  setInterval(refresh, 24 * 3600e3);
}

const oni = (month) => (data && data[month] != null ? data[month] : null);
function latest() {
  if (!data) return null;
  const k = Object.keys(data).sort().pop();
  return { month: k, value: data[k], phase: phaseOf(data[k]) };
}
const phaseOf = (v) => (v == null ? null : v >= 1.5 ? 'Strong El Niño' : v >= 0.5 ? 'El Niño' : v <= -1.5 ? 'Strong La Niña' : v <= -0.5 ? 'La Niña' : 'Neutral');

module.exports = { start, oni, latest, phaseOf, available: () => !!data, fetchedAt: () => fetchedAt };
