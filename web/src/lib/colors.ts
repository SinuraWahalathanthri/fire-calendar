// Colour system. Sequential ramps are one hue light→dark; the diverging ramp is two hues with a
// neutral grey midpoint; series colours follow a fixed order validated for colour-vision deficiency.

export type RampKey = 'ember' | 'blue' | 'cividis' | 'gray';
export const RAMPS: Record<RampKey, { name: string; colors: string[] }> = {
  ember: { name: 'Ember (orange)', colors: ['#fdeee4', '#fcd9c4', '#f9bc98', '#f49a6b', '#ec7a45', '#d65f2b', '#b4461a', '#8c3311', '#62230a'] },
  blue: { name: 'Blue', colors: ['#cde2fb', '#b7d3f6', '#9ec5f4', '#6da7ec', '#3987e5', '#2a78d6', '#1c5cab', '#104281', '#0d366b'] },
  cividis: { name: 'Cividis (colour-vision safe)', colors: ['#fee838', '#e1cc55', '#c3b369', '#a69d75', '#8a8678', '#707173', '#575d6d', '#3b496c', '#00224e'] },
  gray: { name: 'Grayscale (print)', colors: ['#f2f2f2', '#dcdcdc', '#c4c4c4', '#a8a8a8', '#8c8c8c', '#6f6f6f', '#525252', '#363636', '#1a1a1a'] },
};
export const DIVERGING = { colors: ['#104281', '#2a78d6', '#86b6ef', '#cde2fb', '#f0efec', '#f9d0cc', '#ee8c86', '#d84a46', '#a8282a'], breaks: [-75, -50, -25, -10, 10, 25, 50, 100] };
export const SERIES = { harmonized: '#2a78d6', viirs: '#eb6834', modis: '#1baf7a', ink: '#52514e', grid: '#e1e0d9', axis: '#c3c2b7', band: 'rgba(42,120,214,0.14)' };

/** Ordinal age ramp (ember): newest = darkest. */
export const AGE_CLASSES = [
  { max: 6, color: '#b4461a', label: '< 6 hours' },
  { max: 24, color: '#ec7a45', label: '6–24 hours' },
  { max: 72, color: '#f9bc98', label: '1–3 days' },
  { max: 1e9, color: '#d9d6cc', label: '3–7 days' },
];
export const ageColor = (hrs: number) => (AGE_CLASSES.find((c) => hrs <= c.max) || AGE_CLASSES[3]).color;

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export const textOn = (hex: string) => (luminance(hex) > 0.36 ? '#0b0b0b' : '#ffffff');

export function quantileBreaks(values: number[], k: number): number[] {
  const v = values.filter((x) => x != null && x > 0).sort((a, b) => a - b);
  if (!v.length) return [];
  const out: number[] = [];
  for (let i = 1; i < k; i++) out.push(v[Math.min(v.length - 1, Math.floor((i / k) * v.length))]);
  return [...new Set(out)];
}
export function classify(v: number, breaks: number[]) { let i = 0; while (i < breaks.length && v >= breaks[i]) i++; return i; }
