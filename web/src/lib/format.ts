export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const nf0 = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

export const fmt = (v: number | null | undefined, d = 0): string =>
  v == null || !Number.isFinite(+v) ? '—' : (d ? nf1 : nf0).format(v);

export const fmtCompact = (v: number | null | undefined): string =>
  v == null ? '—' : Math.abs(v) >= 10000 ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : fmt(v);

export const pct = (v: number | null | undefined, signed = true): string =>
  v == null ? '—' : `${signed && v > 0 ? '+' : ''}${nf0.format(v)}%`;

export function ago(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** Plain-language comparison with "usual" for headline numbers. */
export function plainLevel(p: number | null | undefined): { short: string; long: string } {
  if (p == null || !Number.isFinite(p)) return { short: '—', long: 'no comparison available' };
  if (p >= 100) return { short: `${(1 + p / 100).toFixed(1)}× usual`, long: `${(1 + p / 100).toFixed(1)} times the usual amount` };
  if (p >= 15) return { short: `${Math.round(p)}% above`, long: `${Math.round(p)}% more than usual` };
  if (p > -15) return { short: 'About usual', long: 'close to the usual amount' };
  if (p > -80) return { short: `${Math.round(-p)}% below`, long: `${Math.round(-p)}% less than usual` };
  return { short: 'Far below', long: 'far less than usual' };
}

export const monthLabel = (m: string | null | undefined): string => (m ? `${MONTHS[+m.slice(5, 7) - 1]} ${m.slice(0, 4)}` : '—');
export const dayName = (d: string) => DAYS[new Date(`${d}T00:00:00Z`).getUTCDay()];
export const durationText = (min: number) => (min < 60 ? `${Math.max(1, Math.round(min))} min` : `${Math.floor(min / 60)} h ${Math.round(min % 60)} min`);
export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export const SAT_NAMES: Record<string, string> = { T: 'MODIS Terra', A: 'MODIS Aqua', N: 'VIIRS S-NPP', N20: 'VIIRS NOAA-20', N21: 'VIIRS NOAA-21' };
