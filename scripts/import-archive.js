#!/usr/bin/env node
// Import FIRMS archive CSVs (https://firms.modaps.eosdis.nasa.gov/download/) into a dataset.
// Use this for large regions or very long histories instead of the API backfill.
//
//   node scripts/import-archive.js --source MODIS_SP  fire_archive_M-C61_12345.csv
//   node scripts/import-archive.js --source VIIRS_SNPP_SP fire_archive_SV-C2_12345.csv
//   node scripts/import-archive.js --source VIIRS_NOAA20_SP --dataset lka fire_archive_J1V-C2_12345.csv
//
// The running server picks the data up on restart (datasets are stored in data/datasets/<id>.json).
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : d; };
const source = opt('--source', 'MODIS_SP');
const datasetId = opt('--dataset', 'lka');
process.env.DEMO = '0';
const cfg = require('../server/config');
const firms = require('../server/firms');

if (!firms.SOURCES[source]) { console.error(`--source must be one of ${Object.keys(firms.SOURCES).join(', ')}`); process.exit(1); }
if (!args.length) { console.error('Usage: node scripts/import-archive.js --source MODIS_SP [--dataset lka] file1.csv [file2.csv ...]'); process.exit(1); }

const file = path.join(cfg.DATA_DIR, 'datasets', `${datasetId}.json`);
fs.mkdirSync(path.dirname(file), { recursive: true });
const ds = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { id: datasetId, name: datasetId, bbox: datasetId === 'lka' ? [79.5, 5.9, 81.9, 9.9] : null, coverage: {}, points: [] };
const keys = new Set(ds.points.map((p) => `${p[4]}|${p[0]}|${p[1]}|${p[2]}|${p[3]}`));

(async () => {
  let added = 0, read = 0;
  for (const f of args) {
    const rl = readline.createInterface({ input: fs.createReadStream(f) });
    let head = null;
    for await (const line of rl) {
      if (!head) { head = line.split(',').map((s) => s.trim()); continue; }
      const v = line.split(','); const row = {}; head.forEach((h, i) => { row[h] = v[i]; });
      const p = firms.normalizeRow(source, row); read++;
      if (!p) continue;
      if (ds.bbox && (p.lo < ds.bbox[0] || p.lo > ds.bbox[2] || p.la < ds.bbox[1] || p.la > ds.bbox[3])) continue;
      const k = `${p.s}|${p.la}|${p.lo}|${p.d}|${p.t}`;
      if (keys.has(k)) continue;
      keys.add(k);
      ds.points.push([p.la, p.lo, p.d, p.t, p.s, p.c, p.cr, p.f, p.b, p.dn, p.ty, p.src]);
      added++;
    }
    console.log(`${f}: done`);
  }
  fs.writeFileSync(file, JSON.stringify(ds));
  console.log(`Read ${read} rows, added ${added} new detections to dataset "${datasetId}" (${ds.points.length} total) → ${file}`);
})();
