// Run with: npm test   (Node's built-in test runner, no dependencies)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harmonize } = require('../server/harmonize');
const { detectStatic } = require('../server/static');
const geo = require('../server/geo');
const { analyze } = require('../server/analytics');

// Deterministic pseudo-random generator so tests never flake.
function rng(seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }
const pad = (n) => String(n).padStart(2, '0');

/**
 * Build a synthetic record where, for every fire cell-day, MODIS sees it with probability pM and
 * VIIRS with probability pV, so the true VIIRS/MODIS cell-day ratio is pV/pM.
 */
function synthetic({ from = 2003, to = 2021, perMonth = 120, pM = 0.25, pV = 0.75, seed = 7 } = {}) {
  const r = rng(seed), pts = [];
  for (let y = from; y <= to; y++) for (let m = 1; m <= 12; m++) {
    const n = Math.round(perMonth * (1 + 0.8 * Math.sin((m / 12) * 2 * Math.PI)) + 1);
    for (let i = 0; i < n; i++) {
      const d = `${y}-${pad(m)}-${pad(1 + Math.floor(r() * 28))}`;
      const la = 7 + r() * 2, lo = 80 + r() * 1.5;
      if (r() < pM) pts.push({ la, lo, d, t: '0500', s: r() < 0.5 ? 'T' : 'A', c: 1, f: 10, dn: 'D', ty: 0 });
      if (y >= 2012 && r() < pV) {
        // several 375 m pixels per fire must still count as one cell-day
        for (let k = 0; k < 3; k++) pts.push({ la: la + k * 0.0005, lo, d, t: '0800', s: 'N', c: 1, f: 4, dn: 'D', ty: 0 });
      }
    }
  }
  return pts;
}

test('MODIS→VIIRS ratio is recovered and the series has no jump in 2012', () => {
  const pts = synthetic();
  const h = harmonize(pts, {});
  assert.ok(Math.abs(h.calibration.kV - 3) < 0.35, `kV=${h.calibration.kV}, expected ≈ 3`);
  const avg = (ys) => ys.reduce((a, y) => a + Object.entries(h.series).filter(([m]) => m.startsWith(String(y))).reduce((s, [, v]) => s + v.H, 0), 0) / ys.length;
  const before = avg([2009, 2010, 2011]), after = avg([2013, 2014, 2015]);
  assert.ok(Math.abs(after / before - 1) < 0.12, `annual mean changed by ${((after / before - 1) * 100).toFixed(1)}% across the sensor switch`);
});

test('out-of-sample validation reports small error on unseen years', () => {
  const v = harmonize(synthetic(), {}).calibration.validation;
  assert.ok(v, 'validation present');
  assert.ok(v.annualError < 0.1, `annual error ${v.annualError}`);
  assert.ok(Math.abs(v.bias) < 0.1, `bias ${v.bias}`);
});

test('per-detection weights add up to the harmonized monthly values', () => {
  const pts = synthetic({ from: 2010, to: 2013 });
  const h = harmonize(pts, {});
  const sums = {};
  for (const p of pts) { const m = p.d.slice(0, 7); sums[m] = (sums[m] || 0) + h.weightOf(p); }
  for (const [m, s] of Object.entries(h.series)) assert.ok(Math.abs((sums[m] || 0) - s.H) < 0.2, `${m}: weights ${sums[m]} vs H ${s.H}`);
});

test('reference switches to NOAA-20 on days S-NPP has no data', () => {
  const pts = [];
  for (let d = 1; d <= 28; d++) {
    const day = `2026-11-${pad(d)}`;
    for (let i = 0; i < 10; i++) {
      const la = 7 + i * 0.05;
      pts.push({ la, lo: 80.5, d: day, t: '0800', s: 'N20', c: 1, f: 3, dn: 'D', ty: 0 });
      if (d <= 2) pts.push({ la, lo: 80.5, d: day, t: '0810', s: 'N', c: 1, f: 3, dn: 'D', ty: 0 });
    }
  }
  const operating = (sat, d) => (sat === 'N' ? d <= '2026-11-02' : true);
  const h = harmonize(pts, { operating });
  assert.ok(h.series['2026-11'].H > 250, `November should count all 28 days, got ${h.series['2026-11'].H}`);
  assert.match(h.series['2026-11'].method, /NOAA-20/);
});

test('industrial heat source is flagged; a seasonal fire area is not', () => {
  const pts = [];
  for (let y = 2023; y <= 2025; y++) for (let m = 1; m <= 12; m++) for (let d = 1; d <= 20; d += 2) {
    pts.push({ la: 7.988, lo: 79.867, d: `${y}-${pad(m)}-${pad(d)}`, t: '0800', s: 'N', c: 1, f: 2 });     // kiln: all year
  }
  for (let y = 2023; y <= 2025; y++) for (let d = 1; d <= 25; d++) {
    pts.push({ la: 6.9, lo: 81.1, d: `${y}-08-${pad(d)}`, t: '0800', s: 'N', c: 1, f: 15 });                // grass fire: August only
  }
  const st = detectStatic(pts);
  assert.equal(st.sites.length, 1);
  assert.ok(st.isStatic({ la: 7.988, lo: 79.867 }));
  assert.ok(!st.isStatic({ la: 6.9, lo: 81.1 }));
});

test('areas of interest: circle, box and country polygons', () => {
  const c = geo.makeAOI({ kind: 'circle', lat: 8.45, lon: 80.0, radius_km: 25 });
  assert.ok(c.contains(80.0, 8.45));
  assert.ok(!c.contains(80.5, 8.45));
  const b = geo.makeAOI({ kind: 'bbox', bbox: '80,7,81,8' });
  assert.ok(b.contains(80.5, 7.5) && !b.contains(81.5, 7.5));
  const lk = geo.makeAOI({ kind: 'country', country: 'Sri Lanka' });
  assert.ok(lk.contains(80.77, 7.87));        // Sri Lanka centre
  assert.ok(!lk.contains(78.0, 10.0));        // Tamil Nadu, India
  assert.ok(Math.abs(lk.areaKm2 - 65600) < 4000, `area ${lk.areaKm2}`);
});

test('full analysis runs and produces a consistent calendar', () => {
  const pts = synthetic({ from: 2003, to: 2025 });
  const aoi = geo.makeAOI({ kind: 'bbox', bbox: '79.9,6.9,81.6,9.1' });
  const r = analyze(pts, aoi, { historyStart: '2003-01-01', now: new Date('2026-03-15T12:00:00Z') });
  assert.equal(r.calendar[0].year, 2003);
  const y2010 = r.calendar.find((c) => c.year === 2010);
  assert.equal(y2010.months.length, 12);
  assert.ok(y2010.total > 0);
  assert.ok(['Low', 'Normal', 'Elevated', 'High', 'Extreme', 'Unknown'].includes(r.nowcast.risk.level));
  assert.ok(r.outlook.months.length >= 6);
  assert.ok(r.outlook.skill && r.outlook.skill.skillScore >= -0.01, 'outlook should not be worse than climatology on its own hindcast');
});
