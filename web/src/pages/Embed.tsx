import { useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { Analysis } from '../api/types';
import { api } from '../api/client';
import { fmt, pct, ago } from '../lib/format';
import { Fact, Loading, RiskBadge } from '../components/ui';
import { Calendar } from '../components/Calendar';

/** Compact live widget for intranet pages: /#/embed?district=Badulla (any API area parameters). */
export default function Embed() {
  const [params] = useSearchParams();
  const qs = useMemo(() => { const p = new URLSearchParams(params); if (![...p.keys()].length) p.set('country', 'Sri Lanka'); return p.toString(); }, [params]);
  const { data: d, error } = useQuery({ queryKey: ['embed', qs], queryFn: () => api<Analysis>(`/api/v1/analyze?${qs}`), refetchInterval: 5 * 60_000 });
  if (error) return <div className="callout warn" style={{ margin: 14 }}>{(error as Error).message}</div>;
  if (!d) return <Loading />;
  const n = d.nowcast, a = d.activity;
  return (
    <div className="embed-widget">
      <div className="row" style={{ justifyContent: 'space-between' }}><div><div className="eyebrow">Fire activity</div><h2>{d.aoi.label}</h2></div><RiskBadge risk={n.risk} /></div>
      {d.mode === 'demo' && <div className="callout warn small">Demo data</div>}
      <div className="embed-kpis">
        <Fact k="Last 24 h" v={fmt(a.last24h)} sub="detections" />
        <Fact k={`${n.monthName} vs usual`} v={pct(n.vsMedianPct)} sub={`on track for ${fmt(n.projected)}`} />
      </div>
      <Calendar calendar={d.calendar} compact years={10} legend={false} />
      <div className="small muted">Harmonized MODIS + VIIRS · NASA FIRMS · updated {ago(d.generatedAt)} · <Link to="/dashboard" target="_blank">Open full view</Link></div>
    </div>
  );
}
