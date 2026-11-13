// MODIS <-> VIIRS hotspot harmonization.
//
// Why raw counts can't be compared: VIIRS I-band pixels are 375 m, MODIS pixels are 1 km at nadir
// (up to ~2 x 4.8 km at swath edge). One fire produces several VIIRS pixels but one MODIS pixel,
// VIIRS also sees smaller/cooler fires, and the satellite constellation changes over time
// (Terra only 2000-2002, +Aqua 2002, +S-NPP 2012, +NOAA-20 2018, +NOAA-21 2024).
//
// Method (applied per area of interest, so ratios reflect local fire types):
//  1. Quality filter: drop low-confidence detections (MODIS <30%, VIIRS "l") and non-vegetation
//     types (volcano / static industrial / offshore) when the archive provides them.
//  2. Common grid: snap every detection to a 0.01° (~1.1 km) cell and count unique
//     cell-days ("fire cell-days"). This removes most of the resolution/duplication bias, so
//     several 375 m VIIRS pixels on the same fire count once like the MODIS pixel does.
//  3. Constant constellation: one reference satellite per sensor. VIIRS reference = S-NPP
//     (NOAA-20 fills gaps after cross-calibration); MODIS = Terra+Aqua, with Terra-only months
//     (before Aqua) scaled by the Terra+Aqua / Terra ratio measured 2003-2011.
//  4. Cross-sensor calibration: during the overlap window (default 2012-02 → 2021-12, before
//     Terra's orbit drift) estimate k = VIIRS cell-days / MODIS cell-days for each calendar month,
//     shrunk toward the annual ratio (and toward a regional prior when local data are sparse).
//  5. Harmonized series (VIIRS-equivalent fire cell-days):
//       VIIRS era  → VIIRS reference cell-days
//       MODIS era  → k_month × MODIS cell-days
//     Each original detection carries a weight so that summing weights reproduces the series,
//     which is what the harmonized CSV export contains.
'use strict';
const cfg = require('./config');
const { SAT_INFO } = require('./firms');

const CELL = 0.01;
const AQUA_FULL = '2002-08';    // first full month with Aqua
const SNPP_FULL = '2012-02';    // first full month with S-NPP
const N20_FULL = '2018-05';
// Fallback only when a whole region has too little overlap to measure its own ratios.
const DEFAULT_PRIOR = { kV: 1.5, kTA: 1.8, source: 'default' };

const monthOf = (d) => d.slice(0, 7);
const cellId = (p) => `${Math.floor(p.la / CELL)}_${Math.floor(p.lo / CELL)}`;

function qualityOK(p, opts) {
  if (!opts.includeLow && p.c === 0) return false;
  if (p.ty != null && p.ty !== 0) return false;
  return true;
}

function emptyAgg() { return { T: new Map(), A: new Map(), N: new Map(), N20: new Map(), N21: new Map(), M: new Map(), V: new Map() }; }

// Build per-month and per-day cell-day sets.
function aggregate(points, opts) {
  const months = new Map(); // month -> {groups: {T,A,...} -> Map(cellDayKey -> count of points)}
  const days = new Map();   // day -> {T:Set, A:Set, M:Set, N:Set, N20:Set, N21:Set}
  const raw = new Map();    // month -> {MODIS, VIIRS, T, A, N, N20, N21} raw detection counts (unfiltered)
  for (const p of points) {
    const m = monthOf(p.d);
    let r = raw.get(m);
    if (!r) { r = { MODIS: 0, VIIRS: 0, T: 0, A: 0, N: 0, N20: 0, N21: 0 }; raw.set(m, r); }
    r[p.s]++; r[SAT_INFO[p.s].sensor]++;
    if (!qualityOK(p, opts)) continue;
    const key = `${p.d}|${cellId(p)}`;
    let g = months.get(m);
    if (!g) { g = emptyAgg(); months.set(m, g); }
    g[p.s].set(key, (g[p.s].get(key) || 0) + 1);
    const grp = SAT_INFO[p.s].sensor === 'MODIS' ? 'M' : 'V';
    g[grp].set(key, (g[grp].get(key) || 0) + 1);
    let dd = days.get(p.d);
    if (!dd) { dd = { T: new Set(), A: new Set(), M: new Set(), N: new Set(), N20: new Set(), N21: new Set() }; days.set(p.d, dd); }
    dd[p.s].add(key); if (grp === 'M') dd.M.add(key);
  }
  return { months, days, raw };
}

function shrinkRatio(num, den, priorK, lambda) {
  return (num + lambda * priorK) / (den + lambda);
}

function harmonize(points, opts = {}) {
  opts = { includeLow: false, calibStart: cfg.CALIB_START, calibEnd: cfg.CALIB_END, ...opts };
  opts.prior = opts.prior || DEFAULT_PRIOR;
  const { months, days, raw } = aggregate(points, opts);
  const cnt = (m, g) => (months.get(m) ? months.get(m)[g].size : 0);
  const allMonths = [...new Set([...months.keys(), ...raw.keys()])].sort();

  // --- Terra-only -> Terra+Aqua ratio (2003-2011) ---
  let sT = 0, sM = 0;
  const tByM = Array(12).fill(0), mByM = Array(12).fill(0);
  for (const m of allMonths) {
    if (m < '2003-01' || m > '2011-12') continue;
    const mi = Number(m.slice(5)) - 1;
    sT += cnt(m, 'T'); sM += cnt(m, 'M'); tByM[mi] += cnt(m, 'T'); mByM[mi] += cnt(m, 'M');
  }
  const kTA = shrinkRatio(sM, sT, opts.prior.kTA, 40);
  const kTA_m = tByM.map((t, i) => shrinkRatio(mByM[i], t, kTA, 25));

  // --- NOAA-20 -> S-NPP gap filler ---
  const op = opts.operating || ((sat, d) => d >= SAT_INFO[sat].start);
  let sN = 0, sN20 = 0;
  for (const [d, g] of days) if (op('N', d) && op('N20', d)) { sN += g.N.size; sN20 += g.N20.size; }
  const kN20 = shrinkRatio(sN, sN20, 1.0, 40);

  // --- VIIRS / MODIS calibration in the overlap window ---
  const vByM = Array(12).fill(0), mmByM = Array(12).fill(0);
  let sV = 0, sMM = 0;
  const pairs = [];
  for (const m of allMonths) {
    if (m < opts.calibStart || m > opts.calibEnd || m < SNPP_FULL) continue;
    const M = cnt(m, 'M'), V = cnt(m, 'N') || Math.round(cnt(m, 'N20') * kN20);
    const mi = Number(m.slice(5)) - 1;
    vByM[mi] += V; mmByM[mi] += M; sV += V; sMM += M;
    pairs.push({ month: m, modis: M, viirs: V });
  }
  const kV = shrinkRatio(sV, sMM, opts.prior.kV, 30);
  const kV_m = vByM.map((v, i) => shrinkRatio(v, mmByM[i], kV, 20));

  // Out-of-sample check: calibrate on the first half of the overlap, predict VIIRS from MODIS
  // on the second half, and score it. This is the honest accuracy number shown to users.
  const split = opts.validationSplit || '2016-12';
  const tr = pairs.filter((p) => p.month <= split), te = pairs.filter((p) => p.month > split);
  let validation = null;
  if (tr.length >= 24 && te.length >= 12) {
    const tv = Array(12).fill(0), tm = Array(12).fill(0);
    let a = 0, b = 0;
    for (const p of tr) { const i = Number(p.month.slice(5)) - 1; tv[i] += p.viirs; tm[i] += p.modis; a += p.viirs; b += p.modis; }
    const k0 = shrinkRatio(a, b, opts.prior.kV, 30);
    const km = tv.map((v, i) => shrinkRatio(v, tm[i], k0, 20));
    const pred = te.map((p) => ({ ...p, pred: km[Number(p.month.slice(5)) - 1] * p.modis }));
    const mErr = pred.filter((p) => p.viirs >= 10).map((p) => Math.abs(p.pred - p.viirs) / p.viirs);
    const yrs = {};
    for (const p of pred) { const y = p.month.slice(0, 4); yrs[y] = yrs[y] || { pred: 0, obs: 0 }; yrs[y].pred += p.pred; yrs[y].obs += p.viirs; }
    const yErr = Object.values(yrs).filter((y) => y.obs > 0).map((y) => Math.abs(y.pred - y.obs) / y.obs);
    const sp = pred.reduce((s, p) => s + p.pred, 0), so = pred.reduce((s, p) => s + p.viirs, 0);
    const xs = pred.map((p) => p.pred), ys = pred.map((p) => p.viirs);
    const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = ys.reduce((s, v) => s + v, 0) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
    const med = (arr) => { const s = arr.slice().sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : null; };
    validation = {
      train: [tr[0].month, tr[tr.length - 1].month], test: [te[0].month, te[te.length - 1].month], testMonths: te.length,
      monthlyMedianError: mErr.length ? round3(med(mErr)) : null,
      annualError: yErr.length ? round3(yErr.reduce((s, v) => s + v, 0) / yErr.length) : null,
      bias: so > 0 ? round3(sp / so - 1) : null,
      correlation: sxx && syy ? round3(sxy / Math.sqrt(sxx * syy)) : null,
      series: pred.map((p) => ({ month: p.month, predicted: Math.round(p.pred), observed: p.viirs, modis: p.modis })),
    };
  }

  // Fit diagnostics: log-log correlation and through-origin slope.
  const fit = pairs.filter((p) => p.modis > 0 && p.viirs > 0);
  let r2 = null, slope = null, mape = null;
  if (fit.length >= 6) {
    const xs = fit.map((p) => Math.log(p.modis)), ys = fit.map((p) => Math.log(p.viirs));
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxy = 0, sxx = 0, syy = 0;
    xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
    r2 = sxx && syy ? (sxy * sxy) / (sxx * syy) : null;
    slope = fit.reduce((a, p) => a + p.modis * p.viirs, 0) / fit.reduce((a, p) => a + p.modis * p.modis, 0);
    // Error of the calibrated MODIS series vs VIIRS truth in the overlap.
    const errs = pairs.filter((p) => p.viirs >= 5).map((p) => Math.abs(kV_m[Number(p.month.slice(5)) - 1] * p.modis - p.viirs) / p.viirs);
    mape = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null;
  }

  // --- Day-by-day reference selection ---
  // The reference satellite is chosen per day from mission/data coverage (not from whether fires
  // were seen): S-NPP → NOAA-20 (cal.) → NOAA-21 (cal.) → MODIS × k. This keeps the series
  // continuous when a satellite's feed stops (e.g. S-NPP NRT gaps) or begins mid-month.
  let bN = 0, bN21 = 0;
  for (const [d, g] of days) if (op('N', d) && op('N21', d)) { bN += g.N.size; bN21 += g.N21.size; }
  const kN21 = shrinkRatio(bN, bN21, kN20, 40);
  const LABEL = { N: 'VIIRS S-NPP', N20: 'VIIRS NOAA-20 (cal.)', N21: 'VIIRS NOAA-21 (cal.)', MA: 'MODIS T+A × k', MT: 'MODIS Terra × k' };
  function sourceOf(d) {
    const mi = Number(d.slice(5, 7)) - 1;
    if (op('N', d)) return { src: 'N', f: 1 };
    if (op('N20', d)) return { src: 'N20', f: kN20 };
    if (op('N21', d)) return { src: 'N21', f: kN21 };
    if (op('T', d) && op('A', d)) return { src: 'MA', f: kV_m[mi] };
    return { src: 'MT', f: kV_m[mi] * kTA_m[mi] };
  }
  const daySize = (g, src) => (src === 'MA' || src === 'MT' ? g.M.size : g[src].size);

  const daily = {};
  const monthH = new Map();
  for (const [d, g] of days) {
    const { src, f } = sourceOf(d);
    const v = daySize(g, src) * f;
    daily[d] = Math.round(v * 10) / 10;
    monthH.set(monthOf(d), (monthH.get(monthOf(d)) || 0) + v);
  }

  const todayIso = new Date().toISOString().slice(0, 10);
  const series = {};
  for (const m of allMonths) {
    const mi = Number(m.slice(5)) - 1;
    const [yy, mm] = m.split('-').map(Number);
    const dim = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
    const used = {};
    for (let dd = 1; dd <= dim; dd++) {
      const d = `${m}-${String(dd).padStart(2, '0')}`;
      if (d > todayIso) break;
      const s = sourceOf(d).src; used[s] = (used[s] || 0) + 1;
    }
    const order = Object.entries(used).sort((a, b) => b[1] - a[1]).map(([s]) => s);
    const M = cnt(m, 'M'), T = cnt(m, 'T'), A = cnt(m, 'A');
    const r = raw.get(m) || { MODIS: 0, VIIRS: 0, T: 0, A: 0, N: 0, N20: 0, N21: 0 };
    series[m] = {
      H: Math.round((monthH.get(m) || 0) * 10) / 10,
      method: order.map((s) => LABEL[s]).join(' + ') || LABEL.MA,
      cellDays: { T, A, MODIS: M, N: cnt(m, 'N'), N20: cnt(m, 'N20'), N21: cnt(m, 'N21'), VIIRS: cnt(m, 'V') },
      raw: r,
      modisCal: Math.round(kV_m[mi] * (m >= AQUA_FULL ? M : kTA_m[mi] * T) * 10) / 10,
    };
  }

  // Per-point weight: sum of weights within a month == harmonized monthly value.
  function weightOf(p) {
    if (!qualityOK(p, opts)) return 0;
    const g = months.get(monthOf(p.d));
    if (!g) return 0;
    const key = `${p.d}|${cellId(p)}`;
    const { src, f } = sourceOf(p.d);
    if (src === 'MA' || src === 'MT') return SAT_INFO[p.s].sensor === 'MODIS' && g.M.get(key) ? f / g.M.get(key) : 0;
    return p.s === src && g[src].get(key) ? f / g[src].get(key) : 0;
  }

  return {
    series, daily, weightOf, cellId,
    calibration: {
      kV: round3(kV), kV_month: kV_m.map(round3), kTA: round3(kTA), kTA_month: kTA_m.map(round3), kN20: round3(kN20), kN21: round3(kN21),
      window: [opts.calibStart, opts.calibEnd], overlapMonths: pairs.length, r2: r2 == null ? null : round3(r2),
      slope: slope == null ? null : round3(slope), mape: mape == null ? null : round3(mape), pairs,
      modisCellDaysInWindow: sMM, viirsCellDaysInWindow: sV, cellSizeDeg: CELL,
      priorUsed: sMM < 100, prior: opts.prior, validation,
    },
  };
}

const round3 = (v) => Math.round(v * 1000) / 1000;

module.exports = { harmonize, cellId, DEFAULT_PRIOR, SNPP_FULL, AQUA_FULL };
