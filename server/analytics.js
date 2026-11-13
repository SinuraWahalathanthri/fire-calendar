// Burning-activity analytics built on the harmonized series:
// calendar, climatology, anomalies, trends, critical periods, nowcast/outlook, district breakdown.
'use strict';
const { harmonize } = require('./harmonize');
const { SAT_INFO } = require('./firms');
const geo = require('./geo');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (dt) => `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-based
const r1 = (v) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10) / 10);

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
function stats(values) {
  const v = values.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(v.length - 1, 1));
  return { n: v.length, mean, sd, min: v[0], max: v[v.length - 1], p10: quantile(v, 0.1), p25: quantile(v, 0.25), median: quantile(v, 0.5), p75: quantile(v, 0.75), p90: quantile(v, 0.9) };
}
function pctRank(sorted, x) {
  if (!sorted.length) return null;
  let below = 0, eq = 0;
  for (const v of sorted) { if (v < x) below++; else if (v === x) eq++; }
  return (below + eq / 2) / sorted.length;
}

// Theil-Sen slope + Mann-Kendall test (normal approximation, no tie correction).
function trendTest(xs, ys) {
  const n = xs.length;
  if (n < 6) return null;
  const slopes = []; let S = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    slopes.push((ys[j] - ys[i]) / (xs[j] - xs[i]));
    S += Math.sign(ys[j] - ys[i]);
  }
  slopes.sort((a, b) => a - b);
  const slope = quantile(slopes, 0.5);
  const varS = (n * (n - 1) * (2 * n + 5)) / 18;
  const z = S > 0 ? (S - 1) / Math.sqrt(varS) : S < 0 ? (S + 1) / Math.sqrt(varS) : 0;
  const p = 2 * (1 - normCdf(Math.abs(z)));
  const med = quantile([...ys].sort((a, b) => a - b), 0.5);
  return { slopePerYear: slope, pctPerYear: med > 0 ? (slope / med) * 100 : null, z, p, significant: p < 0.05, direction: slope > 0 ? 'increasing' : slope < 0 ? 'decreasing' : 'flat' };
}
function normCdf(x) { // Abramowitz-Stegun
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

const RISK_LEVELS = [
  // Normal = middle half of past years, so the level agrees with "about usual" wording.
  { max: 0.25, level: 'Low', code: 1 },
  { max: 0.75, level: 'Normal', code: 2 },
  { max: 0.9, level: 'Elevated', code: 3 },
  { max: 0.97, level: 'High', code: 4 },
  { max: 1.01, level: 'Extreme', code: 5 },
];
const riskOf = (pr) => (pr == null ? { level: 'Unknown', code: 0 } : RISK_LEVELS.find((r) => pr < r.max));

function monthRange(from, to) {
  const out = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${pad(m)}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

/**
 * @param points  hotspots already clipped to the AOI (full history)
 * @param aoi     AOI object from geo.makeAOI
 * @param opts    { start, end, baseline:[y0,y1], now:Date, historyStart, prior, includeLow, districts:boolean }
 */
function analyze(points, aoi, opts = {}) {
  const now = opts.now || new Date();
  const today = isoDay(now);
  const curMonth = today.slice(0, 7);
  const curYear = now.getUTCFullYear();
  const histStart = (opts.historyStart || '2000-11-01').slice(0, 7);
  const h = harmonize(points, { prior: opts.prior, includeLow: opts.includeLow, operating: opts.operating });
  const months = monthRange(histStart, curMonth);
  const val = (m) => (h.series[m] ? h.series[m].H : 0);
  // Typical error of a MODIS-derived month, from the out-of-sample test (falls back to in-sample).
  const modisErr = h.calibration.validation?.monthlyMedianError ?? h.calibration.mape;

  const firstYear = Number(histStart.slice(0, 4));
  const baseline = opts.baseline || [Math.max(firstYear + 1, 2003), curYear - 1];
  // While history is still downloading, months before the oldest loaded data are *missing*,
  // not zero-fire months; the first loaded month may be partial, so skip it too.
  const covStart = opts.coverageStart ? opts.coverageStart.slice(0, 7) : null;
  const nextMonth = (m) => { let [y, mo] = m.split('-').map(Number); mo++; if (mo > 12) { mo = 1; y++; } return `${y}-${pad(mo)}`; };
  const dataStart = covStart && covStart >= histStart ? nextMonth(covStart) : histStart;
  const inBaseline = (m) => { const y = Number(m.slice(0, 4)); return y >= baseline[0] && y <= baseline[1] && m < curMonth && m >= dataStart; };

  // ---- Climatology per calendar month ----
  const clim = MONTHS.map((_, i) => {
    const vals = months.filter((m) => Number(m.slice(5)) === i + 1 && inBaseline(m)).map(val);
    const s = stats(vals);
    return s ? { ...s, sorted: vals.slice().sort((a, b) => a - b) } : null;
  });

  // ---- Calendar (years x months) with anomalies ----
  const years = [];
  for (let y = firstYear; y <= curYear; y++) years.push(y);
  const calendar = years.map((y) => ({
    year: y,
    months: MONTHS.map((_, i) => {
      const m = `${y}-${pad(i + 1)}`;
      if (m < histStart || m > curMonth || (covStart && m < covStart)) return null;
      const H = val(m), c = clim[i];
      const partial = m === curMonth;
      return {
        month: m, value: r1(H), partial,
        uncertaintyPct: modisErr != null && h.series[m] && /MODIS/.test(h.series[m].method) && !/VIIRS/.test(h.series[m].method) ? Math.round(modisErr * 100) : null, method: h.series[m] ? h.series[m].method : (m >= '2012-02' ? 'VIIRS S-NPP' : 'MODIS'),
        anomalyPct: c && c.mean > 0 && !partial ? r1(((H - c.mean) / c.mean) * 100) : null,
        z: c && c.sd > 0 && !partial ? Math.round(((H - c.mean) / c.sd) * 100) / 100 : null,
        pctRank: c && !partial ? r1(pctRank(c.sorted, H) * 100) : null,
      };
    }),
    total: covStart && `${y}-12` < covStart ? null : r1(MONTHS.reduce((a, _, i) => a + (`${y}-${pad(i + 1)}` <= curMonth ? val(`${y}-${pad(i + 1)}`) : 0), 0)),
    complete: y < curYear && `${y}-01` >= dataStart,
  }));

  // ---- Monthly time series (harmonized + per-sensor) ----
  const series = months.map((m) => {
    const s = h.series[m];
    return {
      month: m, harmonized: r1(val(m)), method: s ? s.method : null,
      modisRaw: s ? s.raw.MODIS : 0, viirsRaw: s ? s.raw.VIIRS : 0,
      modisCellDays: s ? s.cellDays.MODIS : 0, viirsCellDays: s ? s.cellDays.N || s.cellDays.N20 : 0,
      modisCalibrated: s ? s.modisCal : 0,
      climMean: clim[Number(m.slice(5)) - 1] ? r1(clim[Number(m.slice(5)) - 1].mean) : null,
    };
  });

  // ---- Annual totals & trend ----
  const annual = calendar.map((c) => ({ year: c.year, total: c.total, complete: c.complete }));
  const complete = annual.filter((a) => a.complete);
  const trend = trendTest(complete.map((a) => a.year), complete.map((a) => a.total));

  // YTD comparison (same Jan..today window in past years)
  const dayOfYear = Math.floor((Date.parse(today) - Date.UTC(curYear, 0, 1)) / 864e5);
  const ytdFor = (y) => {
    let sum = 0;
    for (const [d, v] of Object.entries(h.daily)) {
      if (d.slice(0, 4) !== String(y)) continue;
      const doy = Math.floor((Date.parse(d) - Date.UTC(y, 0, 1)) / 864e5);
      if (doy <= dayOfYear) sum += v;
    }
    return sum;
  };
  const ytd = ytdFor(curYear);
  const ytdHist = stats(complete.filter((a) => a.year >= baseline[0] && a.year <= baseline[1]).map((a) => ytdFor(a.year)));

  // ---- Seasonality & critical periods ----
  const seasonal = MONTHS.map((name, i) => ({
    month: name, median: r1(clim[i]?.median), mean: r1(clim[i]?.mean), p10: r1(clim[i]?.p10), p25: r1(clim[i]?.p25),
    p75: r1(clim[i]?.p75), p90: r1(clim[i]?.p90), max: r1(clim[i]?.max),
    current: `${curYear}-${pad(i + 1)}` <= curMonth ? r1(val(`${curYear}-${pad(i + 1)}`)) : null,
    previous: r1(val(`${curYear - 1}-${pad(i + 1)}`)),
  }));
  const meds = seasonal.map((s) => s.mean || 0);
  const avgMed = meds.reduce((a, b) => a + b, 0) / 12;
  const peakIdx = meds.indexOf(Math.max(...meds));
  const critical = meds.map((v, i) => ({ month: MONTHS[i], index: i, share: avgMed > 0 ? v / (avgMed * 12) : 0, critical: v >= 1.25 * avgMed && v > 0 }));
  const seasonMonths = critical.filter((c) => c.critical).map((c) => c.month);
  // Fire season = shortest set of consecutive months containing ~80% of the annual activity.
  const season = fireSeason(meds);

  // ---- Records ----
  const allMonthVals = months.filter((m) => m < curMonth).map((m) => ({ month: m, value: r1(val(m)) })).sort((a, b) => b.value - a.value);
  const topMonths = allMonthVals.slice(0, 5);
  const topYears = complete.slice().sort((a, b) => b.total - a.total).slice(0, 5);

  // ---- Nowcast: current month ----
  const dom = now.getUTCDate(), dim = daysInMonth(curYear, now.getUTCMonth() + 1);
  const mtd = val(curMonth);
  const cmi = now.getUTCMonth();
  // Typical share of a month's activity that occurs by this day-of-month, from history.
  let shareNum = 0, shareDen = 0;
  for (const m of months) {
    if (Number(m.slice(5)) !== cmi + 1 || !inBaseline(m)) continue;
    let upTo = 0, tot = 0;
    for (let d = 1; d <= daysInMonth(Number(m.slice(0, 4)), cmi + 1); d++) {
      const v = h.daily[`${m}-${pad(d)}`] || 0; tot += v; if (d <= dom) upTo += v;
    }
    shareNum += upTo; shareDen += tot;
  }
  const share = shareDen > 0 ? shareNum / shareDen : dom / dim;
  const cc = clim[cmi];
  const projected = share > 0.15 ? mtd / share : mtd + (cc ? cc.median * (1 - share) : 0);
  const projRank = cc ? pctRank(cc.sorted, projected) : null;
  const nowcast = {
    month: curMonth, monthName: MONTHS[cmi], dayOfMonth: dom, daysInMonth: dim,
    monthToDate: r1(mtd), typicalShareByToday: Math.round(share * 1000) / 1000, projected: r1(projected),
    median: r1(cc?.median), mean: r1(cc?.mean), p10: r1(cc?.p10), p90: r1(cc?.p90),
    vsMedianPct: cc && cc.median > 0 ? r1(((projected - cc.median) / cc.median) * 100) : null,
    mtdVsTypicalPct: cc && cc.mean * share > 0 ? r1(((mtd - cc.mean * share) / (cc.mean * share)) * 100) : null,
    percentile: projRank == null ? null : r1(projRank * 100),
    risk: riskOf(projRank),
  };

  // ---- Recent activity (raw detections & harmonized) ----
  const nowMs = now.getTime();
  const ageH = (p) => (nowMs - Date.UTC(+p.d.slice(0, 4), +p.d.slice(5, 7) - 1, +p.d.slice(8, 10), +p.t.slice(0, 2), +p.t.slice(2, 4))) / 3600e3;
  const recent = points.filter((p) => { const a = ageH(p); return a >= -1 && a <= 24 * 7; });
  const recentCount = (hrs, sensor) => recent.filter((p) => ageH(p) <= hrs && (!sensor || SAT_INFO[p.s].sensor === sensor)).length;
  const harmonizedDays = (n) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += h.daily[isoDay(new Date(nowMs - i * 864e5))] || 0;
    return r1(s);
  };
  const last7 = [];
  const perDay = {};
  for (const p of recent) perDay[p.d] = (perDay[p.d] || 0) + 1;
  for (let i = 6; i >= 0; i--) { const d = isoDay(new Date(nowMs - i * 864e5)); last7.push({ date: d, harmonized: r1(h.daily[d] || 0), detections: perDay[d] || 0 }); }
  const latest = points.reduce((a, p) => { const k = p.d + p.t; return k > a ? k : a; }, '');

  const activity = {
    last24h: recentCount(24), last48h: recentCount(48), last7d: recentCount(168),
    last24hModis: recentCount(24, 'MODIS'), last24hViirs: recentCount(24, 'VIIRS'),
    harmonizedToday: harmonizedDays(1), harmonized7d: harmonizedDays(7), last7days: last7,
    latestDetection: latest ? `${latest.slice(0, 10)}T${latest.slice(10, 12)}:${latest.slice(12, 14)}Z` : null,
    meanFrp24h: r1(avg(recent.filter((p) => ageH(p) <= 24).map((p) => p.f))),
  };

  // ---- Outlook ----
  const outlook = forecast(months, val, clim, curMonth, now, baseline, dataStart, mtd, projected, opts.oni || null, opts.phaseOf || (() => null));

  // ---- Selection statistics (user date range) ----
  const start = opts.start || `${histStart}-01`, end = opts.end || today;
  const sel = points.filter((p) => p.d >= start && p.d <= end);
  const bySat = {};
  for (const p of sel) bySat[p.s] = (bySat[p.s] || 0) + 1;
  let harmonizedSel = 0;
  for (const [d, v] of Object.entries(h.daily)) if (d >= start && d <= end) harmonizedSel += v;
  const frp = sel.map((p) => p.f).filter((f) => f > 0).sort((a, b) => a - b);
  const selection = {
    start, end, detections: sel.length, harmonized: r1(harmonizedSel),
    bySatellite: Object.fromEntries(Object.entries(bySat).map(([k, v]) => [SAT_INFO[k].name, v])),
    modis: sel.filter((p) => SAT_INFO[p.s].sensor === 'MODIS').length,
    viirs: sel.filter((p) => SAT_INFO[p.s].sensor === 'VIIRS').length,
    frp: frp.length ? { median: r1(quantile(frp, 0.5)), p90: r1(quantile(frp, 0.9)), max: r1(frp[frp.length - 1]), total: r1(frp.reduce((a, b) => a + b, 0)) } : null,
    nightShare: sel.length ? r1((sel.filter((p) => p.dn === 'N').length / sel.length) * 100) : null,
    highConfShare: sel.length ? r1((sel.filter((p) => p.c === 2).length / sel.length) * 100) : null,
    densityPer1000km2: aoi.areaKm2 ? r1((harmonizedSel / aoi.areaKm2) * 1000) : null,
    hotCells: hotCells(sel, h),
  };

  // ---- Map points (last 7 days, capped) ----
  const mapPoints = recent.slice().sort((a, b) => (b.d + b.t).localeCompare(a.d + a.t)).slice(0, 6000)
    .map((p) => [p.la, p.lo, p.s, Math.round(ageH(p) * 10) / 10, p.c, Math.round(p.f * 10) / 10, p.d, p.t]);

  const result = {
    aoi: { label: aoi.label, kind: aoi.kind, bbox: aoi.bbox.map((v) => Math.round(v * 1e4) / 1e4), areaKm2: Math.round(aoi.areaKm2), meta: aoi.meta, geojson: aoi.geojson },
    // Report the baseline years actually used (fewer while history is still downloading).
    generatedAt: now.toISOString(), baseline: [Math.max(baseline[0], Number(dataStart.slice(0, 4)) + (dataStart.slice(5) > '01' ? 1 : 0)), baseline[1]], historyStart: histStart, units: 'VIIRS-equivalent fire cell-days (harmonized hotspots)',
    calendar, series, annual, trend, seasonal, critical, seasonMonths, fireSeason: season, peakMonth: MONTHS[peakIdx],
    records: { topMonths, topYears },
    ytd: { value: r1(ytd), median: r1(ytdHist?.median), vsMedianPct: ytdHist && ytdHist.median > 0 ? r1(((ytd - ytdHist.median) / ytdHist.median) * 100) : null },
    nowcast, activity, outlook, selection, calibration: h.calibration, mapPoints,
  };
  if (opts.regionSet && opts.regionSet.regions) result.regions = regionBreakdown(points, h, opts.regionSet, now, curMonth, dataStart);
  else if (opts.regionSet) result.regions = { status: opts.regionSet.status };
  if (opts.districts) {
    // A district/province view still shows all 25 districts for context, so it needs island-wide points.
    const dp = opts.districtPoints;
    const hd = dp ? harmonize(dp, { operating: opts.operating, prior: opts.prior }) : h;
    result.districts = districtBreakdown(dp || points, hd, clim, now, curMonth);
    result.protectedAreas = protectedBreakdown(dp || points, hd, now, curMonth, dataStart);
  }
  return result;
}

const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

function fireSeason(meds) {
  const total = meds.reduce((a, b) => a + b, 0);
  if (!total) return null;
  for (let len = 1; len <= 12; len++) {
    let best = null;
    for (let s = 0; s < 12; s++) {
      let sum = 0;
      for (let k = 0; k < len; k++) sum += meds[(s + k) % 12];
      if (sum / total >= 0.7 && (!best || sum > best.sum)) best = { s, sum };
    }
    if (best) return { start: MONTHS[best.s], end: MONTHS[(best.s + len - 1) % 12], months: len, share: Math.round((best.sum / total) * 100) };
  }
  return null;
}

function hotCells(sel, h) {
  // Aggregate to 0.1° to surface persistent burning clusters within the selection.
  const m = new Map();
  for (const p of sel) {
    const w = h.weightOf(p);
    if (!w) continue;
    const k = `${Math.floor(p.la * 10)}_${Math.floor(p.lo * 10)}`;
    const o = m.get(k) || { lat: (Math.floor(p.la * 10) + 0.5) / 10, lon: (Math.floor(p.lo * 10) + 0.5) / 10, harmonized: 0, detections: 0 };
    o.harmonized += w; o.detections++;
    m.set(k, o);
  }
  return [...m.values()].sort((a, b) => b.harmonized - a.harmonized).slice(0, 10)
    .map((o) => ({ ...o, harmonized: r1(o.harmonized), district: districtName(o.lon, o.lat) }));
}

const distMemo = new Map();
function districtName(lon, lat) {
  // Sri Lanka extent prefilter + memo on a 0.01° grid keeps this cheap for large point sets.
  if (lon < 79.4 || lon > 82 || lat < 5.8 || lat > 10) return null;
  const key = `${Math.round(lat * 100)}_${Math.round(lon * 100)}`;
  if (distMemo.has(key)) return distMemo.get(key);
  const d = geo.loadDistricts().find((x) => lon >= x.bbox[0] && lon <= x.bbox[2] && lat >= x.bbox[1] && lat <= x.bbox[3] && geo.inPolys(lon, lat, x.polys));
  const name = d ? d.name : null;
  distMemo.set(key, name);
  return name;
}

// ---- Statistical outlook ----
// Forecast(month h ahead) = climatological median × exp(anomaly × 0.6^h) × trend factor,
// with an empirical P10-P90 band. Skill is measured by a rolling 1-month hindcast against a
// climatology-only forecast so users can see whether the persistence signal adds value.
function forecast(months, val, clim, curMonth, now, baseline, histStart, mtd, projected, oni, phaseOf) {
  const past = months.filter((m) => m < curMonth);
  const logAnom = (m) => {
    const c = clim[Number(m.slice(5)) - 1];
    return c && c.median != null ? Math.log((val(m) + 1) / (c.median + 1)) : 0;
  };
  const lastK = past.slice(-3);
  const anomaly = lastK.length ? lastK.reduce((a, m, i) => a + logAnom(m) * (i + 1), 0) / lastK.reduce((a, _, i) => a + i + 1, 0) : 0;
  // include current month's projection as the freshest signal
  const cc = clim[Number(curMonth.slice(5)) - 1];
  const curAnom = cc && cc.median != null ? Math.log((projected + 1) / (cc.median + 1)) : 0;
  const a0 = 0.5 * anomaly + 0.5 * curAnom;

  // trend factor from recent 10 complete years of annual totals (log space), capped
  const yrs = {};
  past.forEach((m) => { const y = m.slice(0, 4); yrs[y] = (yrs[y] || 0) + val(m); });
  const yKeys = Object.keys(yrs).filter((y) => past.filter((m) => m.startsWith(y)).length === 12).slice(-10);
  const tt = yKeys.length >= 6 ? trendTest(yKeys.map(Number), yKeys.map((y) => Math.log(yrs[y] + 1))) : null;
  const trendPerYear = tt ? Math.max(-0.1, Math.min(0.1, tt.slopePerYear)) : 0;
  const midBase = (baseline[0] + baseline[1]) / 2;

  // Rolling 1-month hindcast over the last 48 complete months. The persistence weight is chosen
  // from these hindcasts, so the outlook never does worse than plain climatology on record.
  const cases = [];
  for (const target of past.slice(-48)) {
    const ti = months.indexOf(target);
    const ty = Number(target.slice(0, 4)), tm = Number(target.slice(5));
    const hist = months.filter((x) => Number(x.slice(5)) === tm && Number(x.slice(0, 4)) < ty && x >= histStart).map(val).sort((a, b) => a - b);
    if (hist.length < 5) continue;
    const prev = months.slice(Math.max(0, ti - 3), ti);
    const an = prev.length ? prev.reduce((a, pm, i) => {
      const pmo = Number(pm.slice(5)), pyy = Number(pm.slice(0, 4));
      const ph = months.filter((x) => Number(x.slice(5)) === pmo && Number(x.slice(0, 4)) < pyy && x >= histStart).map(val).sort((p, q) => p - q);
      const pmed = ph.length ? quantile(ph, 0.5) : val(pm);
      return a + Math.log((val(pm) + 1) / (pmed + 1)) * (i + 1);
    }, 0) / prev.reduce((a, _, i) => a + i + 1, 0) : 0;
    cases.push({ month: target, med: quantile(hist, 0.5), lo: quantile(hist, 0.1), hi: quantile(hist, 0.9), an, obs: val(target) });
  }
  // ---- ENSO (El Niño / La Niña) sensitivity of this area ----
  // y = log-anomaly of a month, x = ONI three months earlier (what a forecaster would know).
  const lagMonth = (mm, lag) => { const [yy, mo] = mm.split('-').map(Number); const d = new Date(Date.UTC(yy, mo - 1 - lag, 1)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`; };
  const oniAt = (mm, lag) => (oni ? oni(lagMonth(mm, lag)) : null);
  const hcStart = cases.length ? cases[0].month : curMonth;
  let sxy = 0, sxx = 0, syy = 0, sx = 0, sy = 0, nE = 0;
  const elN = [], laN = [];
  for (const mm of past) {
    if (mm < histStart) continue;
    const x = oniAt(mm, 3);
    if (x == null) continue;
    const yv = logAnom(mm);
    if (mm < hcStart) { sxy += x * yv; sxx += x * x; syy += yv * yv; sx += x; sy += yv; nE++; }
    if (x >= 0.5) elN.push(yv); else if (x <= -0.5) laN.push(yv);
  }
  const beta = nE >= 36 && sxx > 0 ? Math.max(-0.6, Math.min(0.6, sxy / sxx)) : 0;
  const rE = nE >= 36 ? (nE * sxy - sx * sy) / Math.sqrt(Math.max(1e-9, (nE * sxx - sx * sx) * (nE * syy - sy * sy))) : null;
  const effect = (arr) => (arr.length >= 6 ? r1((Math.exp(arr.reduce((a, b) => a + b, 0) / arr.length) - 1) * 100) : null);
  for (const c of cases) c.oni = oniAt(c.month, 3) ?? 0;

  // Choose persistence weight and whether ENSO helps, by hindcast error.
  const predCase = (c, w, b) => c.med * Math.exp(c.an * w * 0.6 + b * c.oni);
  const mae = (w, b) => cases.reduce((a, c) => a + Math.abs(predCase(c, w, b) - c.obs), 0);
  const weights = [0, 0.25, 0.5, 0.75, 1];
  let wBest = 0.5, bBest = 0;
  if (cases.length >= 12) {
    let best = Infinity;
    for (const w of weights) for (const b of beta ? [0, beta] : [0]) { const e = mae(w, b); if (e < best - 1e-9) { best = e; wBest = w; bBest = b; } }
  }
  let maeModel = 0, maeClim = 0, inBand = 0;
  const hc = cases.map((c) => {
    const pred = predCase(c, wBest, bBest), f = pred / Math.max(c.med, 1e-9);
    maeModel += Math.abs(pred - c.obs); maeClim += Math.abs(c.med - c.obs);
    if (c.obs >= c.lo * f && c.obs <= c.hi * f) inBand++;
    return { month: c.month, forecast: r1(pred), climatology: r1(c.med), observed: r1(c.obs) };
  });
  const n = cases.length;
  // Latest ONI value known now, persisted forward with decay.
  let oniNow = null, oniNowMonth = null;
  for (let lag = 1; lag <= 4 && oniNow == null; lag++) { oniNow = oniAt(curMonth, lag); oniNowMonth = lagMonth(curMonth, lag); }

  const out = [];
  let [y, m] = curMonth.split('-').map(Number);
  for (let hz = 0; hz <= 6; hz++) {
    const mm = `${y}-${pad(m)}`;
    const c = clim[m - 1];
    if (c) {
      // Trend adjustment is deliberately capped (±15 %) — it nudges, it never dominates.
      const tf = Math.min(1.15, Math.max(0.85, Math.exp(trendPerYear * (y - midBase) * 0.5)));
      const ensoTerm = bBest && oniNow != null ? bBest * oniNow * Math.pow(0.85, hz) : 0;
      let af = Math.exp(a0 * wBest * Math.pow(0.6, hz) + ensoTerm);
      let pred = c.median * af * tf;
      // Current month: the nowcast (month-to-date scaled by the typical intra-month profile) is
      // better informed than any climatological guess, so the outlook uses it directly.
      if (hz === 0 && c.median > 0 && projected > 0) { pred = projected; af = projected / (c.median * tf); }
      out.push({
        month: mm, monthName: MONTHS[m - 1], horizon: hz, forecast: r1(pred), median: r1(c.median),
        low: r1(c.p10 * af * tf), high: r1(c.p90 * af * tf), observedToDate: hz === 0 ? r1(mtd) : null,
        risk: riskOf(pctRank(c.sorted, pred)),
        vsMedianPct: c.median > 0 ? r1(((pred - c.median) / c.median) * 100) : null,
      });
    }
    m++; if (m > 12) { m = 1; y++; }
  }

  return {
    method: 'Climatological median × recent-anomaly persistence × ENSO term (if it helps) × capped trend; weights chosen by hindcast',
    currentAnomaly: Math.round(a0 * 1000) / 1000, persistenceWeight: wBest, trendPerYearLog: Math.round(trendPerYear * 1000) / 1000,
    enso: {
      available: !!oni, used: bBest !== 0, oni: oniNow, oniMonth: oniNowMonth, phase: phaseOf(oniNow),
      sensitivity: Math.round(beta * 1000) / 1000, correlation: rE == null ? null : Math.round(rE * 100) / 100, sampleMonths: nE,
      elNinoEffectPct: effect(elN), laNinaEffectPct: effect(laN), elNinoMonths: elN.length, laNinaMonths: laN.length,
    },
    months: out,
    skill: n ? {
      months: n, maeModel: r1(maeModel / n), maeClimatology: r1(maeClim / n),
      skillScore: maeClim > 0 ? Math.round((1 - maeModel / maeClim) * 100) / 100 : null,
      bandCoverage: Math.round((inBand / n) * 100),
    } : null,
    hindcast: hc,
  };
}

// ---- First-level regions for any country (geoBoundaries ADM1) ----
function regionBreakdown(points, h, set, now, curMonth, dataStart) {
  const nowMs = now.getTime(), cy = now.getUTCFullYear(), cm = Number(curMonth.slice(5));
  const rows = new Map(set.regions.map((r) => [r.name, { name: r.name, id: r.id, areaKm2: Math.round(r.areaKm2), last24h: 0, last7d: 0, mtd: 0, monthly: {}, total: 0 }]));
  for (const p of points) {
    const reg = set.lookup(p.lo, p.la);
    if (!reg) continue;
    const r = rows.get(reg.name);
    const w = h.weightOf(p), m = p.d.slice(0, 7);
    if (w) { r.monthly[m] = (r.monthly[m] || 0) + w; if (m >= dataStart && +m.slice(0, 4) < cy) r.total += w; }
    if (m === curMonth) r.mtd += w;
    const age = (nowMs - Date.parse(`${p.d}T${p.t.slice(0, 2)}:${p.t.slice(2)}:00Z`)) / 3600e3;
    if (age >= -1 && age <= 24) r.last24h++;
    if (age >= -1 && age <= 168) r.last7d++;
  }
  const firstY = Number(dataStart.slice(0, 4)) + (dataStart.slice(5) > '01' ? 1 : 0);
  const nYears = Math.max(1, cy - firstY);
  return {
    iso: set.iso, source: 'geoBoundaries ADM1',
    rows: [...rows.values()].map((r) => {
      const same = [];
      for (let y = firstY; y < cy; y++) same.push(r.monthly[`${y}-${pad(cm)}`] || 0);
      const med = same.length ? quantile(same.sort((a, b) => a - b), 0.5) : null;
      const byCal = Array(12).fill(0);
      Object.entries(r.monthly).forEach(([m, v]) => { if (+m.slice(0, 4) >= firstY && +m.slice(0, 4) < cy) byCal[+m.slice(5) - 1] += v; });
      const peak = byCal.indexOf(Math.max(...byCal));
      return {
        district: r.name, province: '', id: r.id, areaKm2: r.areaKm2, last24h: r.last24h, last7d: r.last7d,
        monthToDate: r1(r.mtd), monthMedian: r1(med), vsMedianPct: med > 0 ? r1(((r.mtd - med) / med) * 100) : null,
        peakMonth: byCal[peak] > 0 ? MONTHS[peak] : null, annualAverage: r1(r.total / nYears),
        densityPer1000km2: r.areaKm2 ? r1((r.total / nYears / r.areaKm2) * 1000) : null,
      };
    }).sort((a, b) => b.last7d - a.last7d || b.monthToDate - a.monthToDate || b.annualAverage - a.annualAverage),
  };
}

// ---- Protected areas (national parks, sanctuaries, reserves) ----
function protectedBreakdown(points, h, now, curMonth, dataStart) {
  const nowMs = now.getTime();
  const rows = new Map();
  for (const p of points) {
    const pa = geo.protectedAreaAt(p.lo, p.la);
    if (!pa) continue;
    let r = rows.get(pa.name);
    if (!r) { r = { name: pa.name, designation: pa.designation, agency: pa.agency, areaKm2: pa.areaKm2, last24h: 0, last7d: 0, last30d: 0, monthToDate: 0, byYear: {}, latest: null, lat: (pa.bbox[1] + pa.bbox[3]) / 2, lon: (pa.bbox[0] + pa.bbox[2]) / 2 }; rows.set(pa.name, r); }
    const age = (nowMs - Date.parse(`${p.d}T${p.t.slice(0, 2)}:${p.t.slice(2)}:00Z`)) / 3600e3;
    if (age >= -1 && age <= 24) r.last24h++;
    if (age >= -1 && age <= 168) r.last7d++;
    if (age >= -1 && age <= 720) r.last30d++;
    const w = h.weightOf(p);
    if (p.d.slice(0, 7) === curMonth) r.monthToDate += w;
    const y = p.d.slice(0, 4); r.byYear[y] = (r.byYear[y] || 0) + w;
    if (!r.latest || p.d + p.t > r.latest) r.latest = p.d + p.t;
  }
  const cy = now.getUTCFullYear();
  const firstY = Number(dataStart.slice(0, 4)) + (dataStart.slice(5) > '01' ? 1 : 0);
  const nYears = Math.max(1, cy - firstY);
  return [...rows.values()].map((r) => {
    const full = Object.entries(r.byYear).filter(([y]) => +y >= firstY && +y < cy).reduce((a, [, v]) => a + v, 0);
    return {
      name: r.name, designation: r.designation, agency: r.agency, areaKm2: r.areaKm2, lat: Math.round(r.lat * 1000) / 1000, lon: Math.round(r.lon * 1000) / 1000,
      last24h: r.last24h, last7d: r.last7d, last30d: r.last30d, monthToDate: r1(r.monthToDate),
      annualAverage: r1(full / nYears), latestDetection: r.latest ? `${r.latest.slice(0, 10)} ${r.latest.slice(10, 12)}:${r.latest.slice(12)} UTC` : null,
    };
  }).sort((a, b) => b.last7d - a.last7d || b.last30d - a.last30d || b.annualAverage - a.annualAverage);
}

// ---- Sri Lanka district breakdown ----
function districtBreakdown(points, h, clim, now, curMonth) {
  const ds = geo.loadDistricts();
  const nowMs = now.getTime();
  const res = new Map(ds.map((d) => [d.name, { district: d.name, province: d.province, id: d.id, areaKm2: Math.round(d.areaKm2), last24h: 0, last7d: 0, mtd: 0, monthly: {}, total: 0 }]));
  for (const p of points) {
    if (p._dist === undefined) p._dist = districtName(p.lo, p.la);
    if (!p._dist) continue;
    const r = res.get(p._dist);
    const w = h.weightOf(p);
    const m = p.d.slice(0, 7);
    if (w) { r.monthly[m] = (r.monthly[m] || 0) + w; r.total += w; }
    if (m === curMonth) r.mtd += w;
    const age = (nowMs - Date.parse(`${p.d}T${p.t.slice(0, 2)}:${p.t.slice(2)}:00Z`)) / 3600e3;
    if (age <= 24 && age >= -1) r.last24h++;
    if (age <= 168 && age >= -1) r.last7d++;
  }
  const cm = Number(curMonth.slice(5));
  const cy = Number(curMonth.slice(0, 4));
  return [...res.values()].map((r) => {
    const sameMonth = Object.entries(r.monthly).filter(([m]) => Number(m.slice(5)) === cm && Number(m.slice(0, 4)) < cy).map(([, v]) => v);
    while (sameMonth.length < Math.max(cy - 2003, 0)) sameMonth.push(0);
    const med = quantile(sameMonth.sort((a, b) => a - b), 0.5);
    const byCal = Array(12).fill(0);
    Object.entries(r.monthly).forEach(([m, v]) => { if (Number(m.slice(0, 4)) < cy) byCal[Number(m.slice(5)) - 1] += v; });
    const peak = byCal.indexOf(Math.max(...byCal));
    const years = Math.max(1, cy - 2001);
    return {
      district: r.district, province: r.province, id: r.id, areaKm2: r.areaKm2,
      last24h: r.last24h, last7d: r.last7d, monthToDate: r1(r.mtd), monthMedian: r1(med),
      vsMedianPct: med > 0 ? r1(((r.mtd - med) / med) * 100) : null,
      peakMonth: byCal[peak] > 0 ? MONTHS[peak] : null,
      annualAverage: r1(r.total / years), densityPer1000km2: r1((r.total / years / r.areaKm2) * 1000),
      monthlyProfile: byCal.map((v) => r1(v / years)),
    };
  }).sort((a, b) => b.last7d - a.last7d || b.monthToDate - a.monthToDate);
}

module.exports = { analyze, MONTHS, stats, quantile, isoDay, districtName };
