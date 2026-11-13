// Persistent (static) heat sources: cement kilns, refineries, power stations, gas flares, landfills.
//
// FIRMS's archive tags some of these (type = 2), but the near-real-time feed does not, so they
// would otherwise be counted as fires every week and trigger false alerts. We flag a ~1 km cell
// as static when its detections are frequent AND spread through the year — vegetation fires are
// seasonal and short-lived, industrial heat is not.
'use strict';

const CELL = 0.01;
const RULES = { minDays: 15, minDaysPerYear: 10, minCalendarMonths: 6, minDistinctMonths: 8 };

const key = (la, lo) => `${Math.floor(la / CELL)}_${Math.floor(lo / CELL)}`;

function detectStatic(points, rules = RULES) {
  const cells = new Map();
  for (const p of points) {
    const k = key(p.la, p.lo);
    let c = cells.get(k);
    if (!c) { c = { days: new Set(), months: new Set(), cal: new Set(), first: p.d, last: p.d, n: 0, frp: 0, la: 0, lo: 0, typed: 0 }; cells.set(k, c); }
    c.days.add(p.d); c.months.add(p.d.slice(0, 7)); c.cal.add(p.d.slice(5, 7));
    if (p.d < c.first) c.first = p.d;
    if (p.d > c.last) c.last = p.d;
    c.n++; c.frp += p.f || 0; c.la += p.la; c.lo += p.lo;
    if (p.ty === 2) c.typed++;
  }
  const flagged = new Map();
  for (const [k, c] of cells) {
    const spanYears = Math.max(1, (Date.parse(c.last) - Date.parse(c.first)) / (365.25 * 864e5));
    const perYear = c.days.size / spanYears;
    const byRule = c.days.size >= rules.minDays && perYear >= rules.minDaysPerYear && c.cal.size >= rules.minCalendarMonths && c.months.size >= rules.minDistinctMonths;
    const byType = c.typed >= 3; // FIRMS archive says "static land source"
    if (byRule || byType) {
      flagged.set(k, {
        lat: Math.round((c.la / c.n) * 1e4) / 1e4, lon: Math.round((c.lo / c.n) * 1e4) / 1e4,
        detectionDays: c.days.size, daysPerYear: Math.round(perYear * 10) / 10, calendarMonths: c.cal.size,
        detections: c.n, meanFrp: Math.round((c.frp / c.n) * 10) / 10, first: c.first, last: c.last,
        reason: byType && !byRule ? 'Tagged as static source in the FIRMS archive' : `Heat on ${c.days.size} days (${Math.round(perYear)}/yr) in ${c.cal.size} different calendar months`,
      });
    }
  }
  // Mask flagged cells plus their 8 neighbours (MODIS 1 km pixels wander around the true site).
  const mask = new Set();
  for (const k of flagged.keys()) {
    const [r, c] = k.split('_').map(Number);
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) mask.add(`${r + dr}_${c + dc}`);
  }
  return {
    sites: [...flagged.values()].sort((a, b) => b.detectionDays - a.detectionDays),
    isStatic: (p) => mask.has(key(p.la, p.lo)),
    maskedCells: mask.size, rules,
  };
}

module.exports = { detectStatic, RULES };
