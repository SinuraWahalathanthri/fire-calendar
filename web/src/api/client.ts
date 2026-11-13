import type { AOI, Analysis, Status, Regions, GlobalSummary, AlertRule, Alert, HotspotRow } from './types';

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((body && (body as { error?: string }).error) || String(body) || res.statusText);
  return body as T;
}

export interface AnalyzeOptions { start?: string; end?: string; baseline?: [number, number]; includeStatic?: boolean }

export function analyze(aoi: AOI, opts: AnalyzeOptions = {}) {
  return api<Analysis>('/api/analyze', { method: 'POST', body: JSON.stringify({ aoi, ...opts }) });
}

/** Query-string form of an AOI, for GET links (downloads, API examples, embed). */
export function aoiQuery(a: AOI): URLSearchParams {
  const p = new URLSearchParams();
  if (a.kind === 'country' && a.country) p.set('country', a.country);
  else if (a.kind === 'district' && a.district) p.set('district', a.district);
  else if (a.kind === 'province' && a.province) p.set('province', a.province);
  else if (a.kind === 'bbox' && a.bbox) p.set('bbox', ([] as (number | string)[]).concat(a.bbox).join(','));
  else if (a.kind === 'circle') { p.set('lat', String(a.lat)); p.set('lon', String(a.lon)); p.set('radius_km', String(a.radius_km)); }
  else p.set('aoi', JSON.stringify({ kind: a.kind, geometry: a.geometry, label: a.label }));
  return p;
}

export const getStatus = () => api<Status>('/api/status');
export const getRegions = () => api<Regions>('/api/regions');
export const getGlobal = (hours: number) => api<GlobalSummary>(`/api/v1/global?hours=${hours}`);
export const getAlerts = (limit = 50) => api<{ rules: AlertRule[]; recent: Alert[] }>(`/api/v1/alerts?limit=${limit}`);

export function getHotspots(aoi: AOI, start?: string, end?: string) {
  if (aoi.kind === 'polygon') {
    return api<{ aoi: string; count: number; hotspots: HotspotRow[] }>('/api/v1/hotspots?format=json', { method: 'POST', body: JSON.stringify({ aoi, start, end }) });
  }
  const q = aoiQuery(aoi);
  if (start) q.set('start', start);
  if (end) q.set('end', end);
  q.set('format', 'json');
  return api<{ aoi: string; count: number; hotspots: HotspotRow[] }>(`/api/v1/hotspots?${q}`);
}

/** Download a server export; polygons go by POST because they don't fit in a URL. */
export async function downloadExport(aoi: AOI, format: 'csv' | 'geojson', start?: string, end?: string) {
  let res: Response;
  if (aoi.kind === 'polygon') {
    res = await fetch(`/api/v1/hotspots?format=${format}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ aoi, start, end }) });
  } else {
    const q = aoiQuery(aoi);
    if (start) q.set('start', start);
    if (end) q.set('end', end);
    q.set('format', format);
    res = await fetch(`/api/v1/hotspots?${q}`);
  }
  saveBlob(await res.blob(), `hotspots.${format}`);
}

export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
