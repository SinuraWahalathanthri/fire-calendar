'use strict';
const fs = require('fs');
const path = require('path');

// Minimal .env loader (no dependency).
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

module.exports = {
  PORT: num(process.env.PORT, 8080),
  HOST: process.env.HOST || '0.0.0.0',
  FIRMS_MAP_KEY: (process.env.FIRMS_MAP_KEY || '').trim(),
  FIRMS_BASE: process.env.FIRMS_BASE || 'https://firms.modaps.eosdis.nasa.gov',
  // Demo mode is forced when there is no MAP_KEY, or when DEMO=1.
  DEMO: process.env.DEMO === '1' || !(process.env.FIRMS_MAP_KEY || '').trim(),
  DATA_DIR: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  POLL_MINUTES: num(process.env.POLL_MINUTES, 15),
  GLOBAL_POLL_MINUTES: num(process.env.GLOBAL_POLL_MINUTES, 30),
  HISTORY_START: process.env.HISTORY_START || '2000-11-01',
  FIRMS_DAY_RANGE: num(process.env.FIRMS_DAY_RANGE, 5),
  FIRMS_CONCURRENCY: num(process.env.FIRMS_CONCURRENCY, 3),
  FIRMS_MAX_PER_10MIN: num(process.env.FIRMS_MAX_PER_10MIN, 450),
  // Comma-separated tokens that may create/delete alert rules. Empty = open (fine for local/intranet).
  API_TOKENS: (process.env.API_TOKENS || '').split(',').map((s) => s.trim()).filter(Boolean),
  DEFAULT_COUNTRY: process.env.DEFAULT_COUNTRY || 'Sri Lanka',
  // Calibration window for MODIS->VIIRS ratio. Terra drifted after 2022, so default ends 2021.
  CALIB_START: process.env.CALIB_START || '2012-02',
  CALIB_END: process.env.CALIB_END || '2021-12',
};
