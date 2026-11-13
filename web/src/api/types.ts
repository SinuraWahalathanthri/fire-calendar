// Types for the Node API (server/analytics.js, server/index.js). One place to see every field
// the UI relies on — change the server, update here, and TypeScript shows what breaks.

export type AOIKind = 'country' | 'district' | 'province' | 'bbox' | 'circle' | 'polygon';
export interface AOI {
  kind: AOIKind;
  label?: string;
  country?: string;
  district?: string;
  province?: string;
  bbox?: number[] | string;
  lat?: number;
  lon?: number;
  radius_km?: number;
  geometry?: GeoJSON.Geometry;
}

export interface Risk { level: 'Low' | 'Normal' | 'Elevated' | 'High' | 'Extreme' | 'Unknown'; code: 0 | 1 | 2 | 3 | 4 | 5; max?: number }

export interface CalendarMonth {
  month: string; value: number | null; partial: boolean; method: string;
  anomalyPct: number | null; z: number | null; pctRank: number | null; uncertaintyPct: number | null;
}
export interface CalendarYear { year: number; months: (CalendarMonth | null)[]; total: number | null; complete: boolean }

export interface SeriesPoint {
  month: string; harmonized: number; method: string | null; modisRaw: number; viirsRaw: number;
  modisCellDays: number; viirsCellDays: number; modisCalibrated: number; climMean: number | null;
}
export interface SeasonalMonth {
  month: string; median: number | null; mean: number | null; p10: number | null; p25: number | null;
  p75: number | null; p90: number | null; max: number | null; current: number | null; previous: number | null;
}
export interface Trend { slopePerYear: number; pctPerYear: number | null; z: number; p: number; significant: boolean; direction: string }

export interface Nowcast {
  month: string; monthName: string; dayOfMonth: number; daysInMonth: number; monthToDate: number;
  typicalShareByToday: number; projected: number; median: number | null; mean: number | null;
  p10: number | null; p90: number | null; vsMedianPct: number | null; percentile: number | null; risk: Risk;
}
export interface OutlookMonth {
  month: string; monthName: string; horizon: number; forecast: number; median: number; low: number; high: number;
  observedToDate: number | null; risk: Risk; vsMedianPct: number | null;
}
export interface Enso {
  available: boolean; used: boolean; oni: number | null; oniMonth: string | null; phase: string | null;
  sensitivity: number; correlation: number | null; sampleMonths: number;
  elNinoEffectPct: number | null; laNinaEffectPct: number | null; elNinoMonths: number; laNinaMonths: number;
}
export interface Outlook {
  method: string; currentAnomaly: number; persistenceWeight: number; trendPerYearLog: number; enso?: Enso;
  months: OutlookMonth[];
  skill: { months: number; maeModel: number; maeClimatology: number; skillScore: number | null; bandCoverage: number } | null;
  hindcast: { month: string; forecast: number; climatology: number; observed: number }[];
}
export interface Activity {
  last24h: number; last48h: number; last7d: number; last24hModis: number; last24hViirs: number;
  harmonizedToday: number; harmonized7d: number; latestDetection: string | null; meanFrp24h: number | null;
  last7days: { date: string; harmonized: number; detections: number }[];
}
export interface HotCell { lat: number; lon: number; harmonized: number; detections: number; district: string | null }
export interface Selection {
  start: string; end: string; detections: number; harmonized: number; bySatellite: Record<string, number>;
  modis: number; viirs: number; frp: { median: number; p90: number; max: number; total: number } | null;
  nightShare: number | null; highConfShare: number | null; densityPer1000km2: number | null; hotCells: HotCell[];
}
export interface Validation {
  train: [string, string]; test: [string, string]; testMonths: number; monthlyMedianError: number | null;
  annualError: number | null; bias: number | null; correlation: number | null;
  series: { month: string; predicted: number; observed: number; modis: number }[];
}
export interface Calibration {
  kV: number; kV_month: number[]; kTA: number; kTA_month: number[]; kN20: number; kN21?: number;
  window: [string, string]; overlapMonths: number; r2: number | null; slope: number | null; mape: number | null;
  pairs: { month: string; modis: number; viirs: number }[]; modisCellDaysInWindow: number; viirsCellDaysInWindow: number;
  cellSizeDeg: number; priorUsed: boolean; prior?: { kV: number; kTA: number; source: string }; validation: Validation | null;
}
export interface RegionRow {
  district: string; province: string; id: string; areaKm2: number; last24h: number; last7d: number;
  monthToDate: number; monthMedian: number | null; vsMedianPct: number | null; peakMonth: string | null;
  annualAverage: number; densityPer1000km2: number | null; monthlyProfile?: number[];
}
export interface ProtectedArea {
  name: string; designation: string; agency: string; areaKm2: number; lat: number; lon: number;
  last24h: number; last7d: number; last30d: number; monthToDate: number; annualAverage: number; latestDetection: string | null;
}
export interface StaticSite {
  lat: number; lon: number; detectionDays: number; daysPerYear: number; calendarMonths: number;
  detections: number; meanFrp: number; first: string; last: string; reason: string;
}
export interface Backfill {
  percent: number; done: number; total: number; remaining: number; oldest: string | null; target: string;
  paused: boolean; resumeInSec: number; transactions: number; transactionLimit: number; etaMinutes: number;
}
export interface DatasetInfo {
  id: string; name: string; bbox: number[]; status: 'idle' | 'ready' | 'backfilling'; detections: number;
  progress: { done: number; total: number; message: string }; backfill: Backfill | null;
  updatedAt: string | null; lastPoll: string | null; demo: boolean; errors: string[]; firstDate: string | null;
}
/** [lat, lon, satellite, ageHours, confidence, frp, date, time] */
export type MapPoint = [number, number, string, number, number, number, string, string];

export interface Analysis {
  aoi: { label: string; kind: AOIKind; bbox: number[]; areaKm2: number; meta: Record<string, unknown>; geojson: GeoJSON.Feature };
  generatedAt: string; baseline: [number, number]; historyStart: string; units: string;
  calendar: CalendarYear[]; series: SeriesPoint[]; annual: { year: number; total: number | null; complete: boolean }[];
  trend: Trend | null; seasonal: SeasonalMonth[];
  critical: { month: string; index: number; share: number; critical: boolean }[];
  seasonMonths: string[]; fireSeason: { start: string; end: string; months: number; share: number } | null; peakMonth: string;
  records: { topMonths: { month: string; value: number }[]; topYears: { year: number; total: number; complete: boolean }[] };
  ytd: { value: number; median: number | null; vsMedianPct: number | null };
  nowcast: Nowcast; activity: Activity; outlook: Outlook; selection: Selection; calibration: Calibration;
  mapPoints: MapPoint[];
  districts?: RegionRow[]; protectedAreas?: ProtectedArea[];
  regions?: { iso: string; source: string; rows: RegionRow[] } | { status: string };
  dataset: DatasetInfo;
  staticSources: { excludedDetections: number; sites: StaticSite[]; rules?: Record<string, number>; included?: boolean };
  mode: 'demo' | 'live';
}

export interface Status {
  name: string; version: string; mode: 'demo' | 'live'; startedAt: string; serverTime: string; pollMinutes: number;
  firms: { configured: boolean; requests: number; cacheHits: number; errors: number; transactions?: number; paused?: boolean };
  datasets: DatasetInfo[]; primary: DatasetInfo; enso: { month: string; value: number; phase: string } | null;
}

export interface Regions {
  sriLanka: { districts: { id: string; name: string; province: string; bbox: number[]; areaKm2: number }[]; provinces: string[] };
  countries: { id: string; name: string; bbox: number[] }[];
  hotZones: { name: string; lat: number; lon: number; radius_km: number }[];
}

export interface GlobalSummary {
  updatedAt: string | null; status: string; mode: 'demo' | 'live'; hours: number; total: number;
  countries: { country: string; id: string | null; last24h: number; last48h: number; modis: number; viirs: number; fireCellDays: number; totalFrp: number }[];
  points: [number, number, 0 | 1, number][];
}

export interface AlertRule {
  id: string; name: string; aoi: AOI; type: 'new_hotspots' | 'count_24h' | 'anomaly' | 'protected_area';
  threshold: number; minConfidence: 0 | 1 | 2; webhook: string; active: boolean; createdAt: string;
}
export interface Alert { id: string; ruleId: string; ruleName: string; type: string; time: string; area: string; severity: 'Minor' | 'Moderate' | 'Severe'; message: string }

export interface HotspotRow {
  latitude: number; longitude: number; acq_date: string; acq_time: string; satellite: string; sensor: string;
  confidence_raw: string; confidence_class: string; frp_mw: number; brightness_k: number; daynight: string;
  processing: string; grid_cell_0_01deg: string; used_in_harmonized_series: 0 | 1; harmonized_weight: number;
  series_method: string; static_source: 0 | 1; district: string;
}
