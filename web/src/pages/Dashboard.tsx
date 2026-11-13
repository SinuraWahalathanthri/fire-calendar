import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import L from '../lib/leaflet';
import type { Analysis, MapPoint } from '../api/types';
import { getAlerts } from '../api/client';
import { useApp, useAnalysis, isSriLanka } from '../state/AppState';
import { fmt, pct, ago, plainLevel, monthLabel, dayName, SAT_NAMES } from '../lib/format';
import { ageColor, SERIES } from '../lib/colors';
import { Card, Delta, ErrorBox, Fact, Loading, RiskBadge, Segmented } from '../components/ui';
import { Calendar, type CalendarMode } from '../components/Calendar';
import { ChartLegend, SeasonChart } from '../components/charts';
import { MapView, FastLayer, AreaOutline, StaticSites, ParksLayer, AgeLegend } from '../components/MapView';
import { BackfillBanner } from '../components/BackfillBanner';
import { RegionTable } from '../components/RegionTable';

export default function Dashboard() {
  const { aoi, setAOI, setPickerOpen } = useApp();
  const { data, error, isLoading } = useAnalysis(aoi);
  const sl = isSriLanka(aoi);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{aoi.label}</h1>
          <div className="sub">
            {data ? <>{data.mode === 'demo' && <b>Demo data · </b>}Last satellite detection {data.activity.latestDetection ? ago(data.activity.latestDetection) : '—'} · checked {ago(data.dataset.lastPoll || data.dataset.updatedAt)}</> : ' '}
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setPickerOpen(true)}>Change area</button>
          <Link className="btn primary" to="/reports">Situation report</Link>
        </div>
      </div>
      {error && <ErrorBox error={error} />}
      {data?.dataset.status === 'backfilling' && <BackfillBanner key={data.dataset.id} dataset={data.dataset} areaLabel={aoi.label || ''} />}
      {isLoading || !data ? (
        <section className="grid g-4">{[1, 2, 3, 4].map((i) => <div key={i} className="card"><div className="skeleton" style={{ height: 96 }} /></div>)}</section>
      ) : (
        <>
          <Kpis d={data} />
          <section className="grid g-main mt">
            <LiveMap d={data} sriLanka={sl} />
            <CalendarCard d={data} />
          </section>
          <section className="grid g-2 mt">
            <Card title={`${new Date().getUTCFullYear()} against a normal year`} hint={data.fireSeason ? `Main season ${data.fireSeason.start}–${data.fireSeason.end}` : undefined}>
              <ChartLegend items={[
                { label: String(new Date().getUTCFullYear()), color: SERIES.harmonized, type: 'box' },
                { label: 'Typical month (median)', color: SERIES.ink },
                { label: 'Normal range', color: SERIES.harmonized, type: 'band' },
              ]} />
              <SeasonChart seasonal={data.seasonal} />
            </Card>
            <section className="card"><SideTable d={data} sriLanka={sl} onDistrict={(name) => setAOI({ kind: 'district', district: name, label: `${name} District` })} selected={aoi.district} /></section>
          </section>
          <section className="grid g-2 mt">
            {sl && data.protectedAreas ? <ParksCard d={data} /> : <FactsCard d={data} />}
            <AlertsCard />
          </section>
        </>
      )}
    </>
  );
}

function Kpis({ d }: { d: Analysis }) {
  const a = d.activity, n = d.nowcast;
  const next = d.outlook.months.find((m) => m.horizon === 1);
  const max = Math.max(1, ...a.last7days.map((x) => x.detections));
  return (
    <section className="grid g-4" aria-label="Current situation">
      <div className="card kpi">
        <div className="label">Detections in the last 24 hours</div>
        <div className="value">{fmt(a.last24h)}</div>
        <div className="foot">{a.last24h === 0 ? 'No active fire seen by satellites today.' : `VIIRS ${fmt(a.last24hViirs)} · MODIS ${fmt(a.last24hModis)}${a.meanFrp24h ? ` · avg intensity ${fmt(a.meanFrp24h, 1)} MW` : ''}`}</div>
      </div>
      <div className="card kpi">
        <div className="label">Last 7 days</div>
        <div className="value">{fmt(a.last7d)}<small>detections</small></div>
        <div className="spark" role="img" aria-label="Detections per day for the last 7 days">
          {a.last7days.map((x) => <span key={x.date} style={{ height: `${x.detections ? Math.max(8, (x.detections / max) * 100) : 3}%` }} title={`${dayName(x.date)} ${x.date}: ${fmt(x.detections)}`} />)}
        </div>
        <div className="spark-days">{a.last7days.map((x) => <span key={x.date}>{dayName(x.date)[0]}</span>)}</div>
      </div>
      <div className="card kpi">
        <div className="label">{n.monthName} so far</div>
        <div className="value">{n.vsMedianPct == null ? '—' : plainLevel(n.vsMedianPct).short}</div>
        <div className="foot">{n.median != null ? `On track for about ${fmt(n.projected)} hotspots; a typical ${n.monthName} has ${fmt(n.median)}.` : 'Not enough history yet.'}</div>
        <div><RiskBadge risk={n.risk} /></div>
      </div>
      <div className="card kpi">
        <div className="label">Outlook for {next ? next.monthName : 'next month'}</div>
        <div className="value">{next && next.vsMedianPct != null ? plainLevel(next.vsMedianPct).short : '—'}</div>
        <div className="foot">{next ? `Likely ${fmt(next.low)}–${fmt(next.high)} hotspots (typical ${fmt(next.median)}).` : ''}{d.outlook.enso?.used ? ` Includes ${d.outlook.enso.phase} effect.` : ''}</div>
        <div><RiskBadge risk={next?.risk} /> <Link className="small" to="/outlook" style={{ marginLeft: 6 }}>How this is made</Link></div>
      </div>
    </section>
  );
}

function pointPopup(p: MapPoint) {
  const [la, lo, s, age, c, f, d, t] = p;
  return `<b>${age < 1 ? 'Under 1 hour' : `${Math.round(age)} hours`} ago</b><br>${SAT_NAMES[s] || s} · ${d} ${t.slice(0, 2)}:${t.slice(2)} UTC<br>Intensity ${fmt(f, 1)} MW · ${['low', 'nominal', 'high'][c]} confidence<br><span style="color:#7a7873">${la.toFixed(4)}, ${lo.toFixed(4)}</span>`;
}

function LiveMap({ d, sriLanka }: { d: Analysis; sriLanka: boolean }) {
  const [hours, setHours] = useState(24);
  const [parks, setParks] = useState(true);
  const pts = useMemo(() => d.mapPoints.filter((p) => p[3] <= hours).reverse(), [d.mapPoints, hours]);
  const span = hours === 168 ? '7 days' : `${hours} h`;
  return (
    <Card flush title={<>Where fires are now <span className="hint">{pts.length ? `${fmt(pts.length)} in ${span}` : `none in ${span}`}</span></>}
      actions={<div className="row">
        {sriLanka && <label className="row small"><input type="checkbox" checked={parks} onChange={(e) => setParks(e.target.checked)} /> Parks &amp; reserves</label>}
        <Segmented label="Time window" value={hours} onChange={setHours} options={[{ value: 24, label: '24 h' }, { value: 48, label: '48 h' }, { value: 168, label: '7 days' }]} />
      </div>}>
      <MapView label="Map of recent fire detections" legend={<AgeLegend parks={sriLanka && parks} />}>
        {sriLanka && parks && <ParksLayer />}
        <AreaOutline geojson={d.aoi.geojson} />
        <StaticSites sites={d.staticSources?.sites} />
        <FastLayer items={pts} make={(p, renderer) => L.circleMarker([p[0], p[1]], { renderer, radius: Math.min(9, 3.5 + Math.sqrt(p[5]) / 2), color: '#ffffff', weight: 1, fillColor: ageColor(p[3]), fillOpacity: 0.92 }).bindPopup(pointPopup(p))} />
      </MapView>
    </Card>
  );
}

function CalendarCard({ d }: { d: Analysis }) {
  const [mode, setMode] = useState<CalendarMode>('count');
  const nav = useNavigate();
  return (
    <Card title="Fire calendar" actions={<Segmented label="Calendar view" value={mode} onChange={setMode} options={[{ value: 'count', label: 'Hotspots' }, { value: 'anomaly', label: 'vs. usual' }]} />}>
      <Calendar calendar={d.calendar} mode={mode} years={12} numbers={false} onCell={(m) => nav(`/explore?month=${m.month}`)} />
      <div className="row mt small muted"><span>Each cell is one month. Dashed = this month so far.</span><span className="spacer" /><Link to="/explore">All years →</Link></div>
    </Card>
  );
}

function SideTable({ d, sriLanka, onDistrict, selected }: { d: Analysis; sriLanka: boolean; onDistrict: (n: string) => void; selected?: string }) {
  const qc = useQueryClient();
  const regions = d.regions;
  const loadingRegions = !!regions && 'status' in regions && regions.status === 'loading';
  useEffect(() => {
    // Boundaries for a new country are fetched in the background; re-ask shortly.
    if (!loadingRegions) return;
    const t = setTimeout(() => qc.invalidateQueries({ queryKey: ['analysis'] }), 6000);
    return () => clearTimeout(t);
  }, [loadingRegions, qc]);

  if (sriLanka && d.districts) {
    return <RegionTable rows={d.districts} title="Districts" kindLabel="District" selected={selected} onSelect={onDistrict}
      note={<>Click a district to open it. <a href="/api/v1/districts?format=csv">All 25 districts (CSV)</a></>} />;
  }
  if (regions && 'rows' in regions) {
    return <RegionTable rows={regions.rows} title="Provinces / states" kindLabel="Region" note={`${regions.rows.length} first-level regions · boundaries: geoBoundaries`} />;
  }
  if (loadingRegions) return <><div className="card-head"><h2>Provinces / states</h2></div><Loading text="Fetching boundaries for this country…" /></>;
  return (
    <>
      <div className="card-head"><h2>Busiest months on record</h2></div>
      <table className="data"><thead><tr><th>Month</th><th className="num">Hotspots</th><th className="num">vs. usual</th></tr></thead>
        <tbody>{d.records.topMonths.map((m) => {
          const c = d.calendar.flatMap((y) => y.months).find((x) => x && x.month === m.month);
          return <tr key={m.month}><td>{monthLabel(m.month)}</td><td className="num">{fmt(m.value)}</td><td className="num"><Delta value={c?.anomalyPct} /></td></tr>;
        })}</tbody>
      </table>
    </>
  );
}

function ParksCard({ d }: { d: Analysis }) {
  const pa = d.protectedAreas || [];
  const burning = pa.filter((p) => p.last30d > 0);
  const historic = pa.filter((p) => !p.last30d).sort((a, b) => b.annualAverage - a.annualAverage);
  const rows = [...burning, ...historic].slice(0, Math.max(6, Math.min(burning.length, 10)));
  return (
    <Card title="Parks & reserves" hint={burning.length ? `${burning.length} with fire in the last 30 days` : 'no fire in the last 30 days'}>
      {rows.length ? (
        <table className="data compact-table">
          <thead><tr><th>Area</th><th className="num">7 d</th><th className="num">30 d</th><th className="num hide-sm">Avg / yr</th></tr></thead>
          <tbody>{rows.map((p) => (
            <tr key={p.name}><td><b>{p.name}</b><div className="small muted">{p.agency || p.designation}</div></td>
              <td className="num">{fmt(p.last7d)}</td><td className="num">{fmt(p.last30d)}</td><td className="num hide-sm">{fmt(p.annualAverage)}</td></tr>
          ))}</tbody>
        </table>
      ) : <p className="muted">No detections inside mapped parks or reserves.</p>}
      <div className="small muted mt">{burning.length < rows.length ? 'Below the active ones: areas that burn most in a normal year. ' : ''}Boundaries from OpenStreetMap; a few gazetted areas are not mapped yet.</div>
    </Card>
  );
}

function FactsCard({ d }: { d: Analysis }) {
  const t = d.trend, top = d.records.topYears[0], tm = d.records.topMonths[0];
  return (
    <Card title="Fire history at a glance" hint={`compared with ${d.baseline[0]}–${d.baseline[1]}`}>
      <div className="facts">
        <Fact k="Main fire season" v={d.fireSeason ? `${d.fireSeason.start} – ${d.fireSeason.end}` : '—'} />
        <Fact k="Peak month" v={d.peakMonth || '—'} />
        <Fact k="Busiest year" v={top ? String(top.year) : '—'} />
        <Fact k="Busiest month" v={tm ? monthLabel(tm.month) : '—'} />
        <Fact k="This year so far" v={d.ytd.vsMedianPct == null ? '—' : plainLevel(d.ytd.vsMedianPct).short} />
        <Fact k="Long-term trend" v={t ? `${pct(t.pctPerYear)} a year${t.significant ? '' : ' (not significant)'}` : '—'} />
      </div>
    </Card>
  );
}

function AlertsCard() {
  const { data, isError } = useQuery({ queryKey: ['alerts', 6], queryFn: () => getAlerts(6), refetchInterval: 60_000 });
  const col: Record<string, string> = { Severe: '#d03b3b', Moderate: '#ec835a', Minor: '#fab219' };
  return (
    <Card title="Alerts" actions={<Link className="small" to="/integrate">Alert rules →</Link>}>
      <ul className="list">
        {isError && <li className="muted">Alerts unavailable</li>}
        {!data && !isError && <li className="muted">Loading…</li>}
        {data && !data.recent.length && <li className="muted">Nothing yet. You'll be alerted here, and on any connected system, when a new detection matches one of the {data.rules.length} rules.</li>}
        {data?.recent.map((a) => (
          <li key={a.id}><span className="sev" style={{ background: col[a.severity] || '#c3c2b7' }} aria-hidden="true" />
            <div><b>{a.severity}</b> · {a.message}<div className="small muted">{ago(a.time)}</div></div></li>
        ))}
      </ul>
    </Card>
  );
}
