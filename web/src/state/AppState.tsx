import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type { AOI } from '../api/types';
import { analyze, getStatus, type AnalyzeOptions } from '../api/client';

const DEFAULT_AOI: AOI = { kind: 'country', country: 'Sri Lanka', label: 'Sri Lanka' };

export function aoiLabel(a: AOI): string {
  if (a.label) return a.label;
  if (a.kind === 'country') return a.country || 'Country';
  if (a.kind === 'district') return `${a.district} District`;
  if (a.kind === 'province') return `${a.province} Province`;
  if (a.kind === 'circle') return `${a.radius_km} km around ${Number(a.lat).toFixed(2)}, ${Number(a.lon).toFixed(2)}`;
  if (a.kind === 'bbox') return 'Custom box';
  return 'Custom area';
}
export const isSriLanka = (a: AOI) => (a.kind === 'country' && /sri lanka/i.test(a.country || '')) || a.kind === 'district' || a.kind === 'province';

function readStored<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}

interface Toast { id: number; title: string; body?: string }
interface AppState {
  aoi: AOI;
  setAOI: (a: AOI) => void;
  pickerOpen: boolean;
  setPickerOpen: (v: boolean) => void;
  toast: (title: string, body?: string, ms?: number) => void;
  toasts: Toast[];
}
const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [aoi, setAoiState] = useState<AOI>(() => readStored('hfc.aoi', DEFAULT_AOI));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const setAOI = useCallback((a: AOI) => {
    const v = { ...a, label: a.label || aoiLabel(a) };
    setAoiState(v);
    try { localStorage.setItem('hfc.aoi', JSON.stringify(v)); } catch { /* private mode */ }
  }, []);
  const toast = useCallback((title: string, body?: string, ms = 6000) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, title, body }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms);
  }, []);

  const value = useMemo(() => ({ aoi, setAOI, pickerOpen, setPickerOpen, toast, toasts }), [aoi, setAOI, pickerOpen, toast, toasts]);
  return <Ctx.Provider value={value}>{children}<LiveStream /></Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp outside provider');
  return v;
}

/** Analysis for an area. Cached per (area, options); refreshed automatically when new hotspots arrive. */
export function useAnalysis(aoi: AOI, opts: AnalyzeOptions = {}) {
  return useQuery({
    queryKey: ['analysis', aoi, opts],
    queryFn: () => analyze(aoi, opts),
    staleTime: 45_000,
    placeholderData: keepPreviousData,
  });
}

export function useStatus() {
  return useQuery({ queryKey: ['status'], queryFn: getStatus, refetchInterval: 30_000, staleTime: 10_000 });
}

/** Server-Sent Events: new detections, alerts and world updates push straight into the UI. */
function LiveStream() {
  const qc = useQueryClient();
  const { toast } = useApp();
  useEffect(() => {
    if (!('EventSource' in window)) return;
    const es = new EventSource('/api/stream');
    es.addEventListener('hotspots', (e) => {
      const d = JSON.parse((e as MessageEvent).data);
      qc.invalidateQueries({ queryKey: ['analysis'] });
      if (d.dataset === 'lka' && d.count) toast(`${d.count} new detection${d.count > 1 ? 's' : ''}`, 'Sri Lanka · satellite near-real-time feed', 5000);
    });
    es.addEventListener('alert', (e) => {
      const a = JSON.parse((e as MessageEvent).data);
      qc.invalidateQueries({ queryKey: ['alerts'] });
      toast(`Alert · ${a.severity}`, a.message, 9000);
    });
    es.addEventListener('global', () => qc.invalidateQueries({ queryKey: ['global'] }));
    return () => es.close();
  }, [qc, toast]);
  return null;
}
