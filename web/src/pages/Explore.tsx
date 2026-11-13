import { useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import L from '../lib/leaflet';
import type { AOI, Analysis } from '../api/types';
import { aoiQuery, downloadExport, getHotspots, getRegions, saveBlob, type AnalyzeOptions } from '../api/client';
import { useApp, useAnalysis } from '../state/AppState';
import { fmt, pct, monthLabel, SAT_NAMES } from '../lib/format';
import { ageColor, RAMPS, DIVERGING, SERIES, type RampKey } from '../lib/colors';
import { Card, ErrorBox, Fact, Loading, RiskBadge, Segmented } from '../components/ui';
import { Calendar, type CalendarMode } from '../components/Calendar';
import { ChartBox, ChartLegend, SeasonChart } from '../components/charts';
import { MapView, FastLayer, AreaOutline, StaticSites, AgeLegend, escapeHTML } from '../components/MapView';
import { DrawControl } from '../components/DrawControl';
import { BackfillBanner } from '../components/BackfillBanner';

const today = new Date().toISOString().slice(0, 10);
const yNow = new Date().getUTCFullYear();
type Tab = 'calendar' | 'trends' | 'anomalies' | 'season' | 'sensors' | 'table';
function storedRamp(): RampKey { try { const r = localStorage.getItem('hfc.ramp'); return (r && r in RAMPS ? r : 'ember') as RampKey; } catch { return 'ember'; } }

function monthRange(m: string): [string, string] {
  const [y, mo] = m.split('-').map(Number);
  return [`${m}-01`, new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)];
}

export default function Explore() {
  const { aoi, setAOI, setPickerOpen, toast } = useApp();
  const [params] = useSearchParams();
  const fromMonth = params.get('month');
  const initial = fromMonth ? monthRange(fromMonth) : ['', today];
  // Draft form values vs. applied options: the analysis only re-runs when the user applies.
  const [start, setStart] = useState(initial[0]);
  const [end, setEnd] = useState(initial[1]);
  const [bFrom, setBFrom] = useState('');
  const [bTo, setBTo] = useState('');
  const [includeStatic, setIncludeStatic] = useState(false);
  const [ramp, setRampState] = useState<RampKey>(storedRamp);
  const [applied, setApplied] = useState<AnalyzeOptions>({ start: initial[0] || undefined, end: initial[1] || undefined });
  const [preset, setPreset] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('calendar');
  const { data, error, isFetching } = useAnalysis(aoi, applied);

  const apply = (s = start, e = end, inc = includeStatic) => {
    const baseline: [number, number] | undefined = bFrom && bTo ? [Math.min(+bFrom, +bTo), Math.max(+bFrom, +bTo)] : undefined;
    setApplied({ start: s || undefined, end: e || undefined, baseline, includeStatic: inc || undefined });
  };
  const usePreset = (p: string) => {
    const now = new Date();
    const s = p === 'all' ? '2000-11-01' : p === 'ytd' ? `${now.getUTCFullYear()}-01-01` : p === '5y' ? `${now.getUTCFullYear() - 5}-01-01`
      : new Date(Date.now() - +p * 864e5).toISOString().slice(0, 10);
    setStart(s); setEnd(today); setPreset(p); apply(s, today);
  };
  const setRamp = (r: RampKey) => { setRampState(r); try { localStorage.setItem('hfc.ramp', r); } catch { /* ignore */ } };

  return (
    <>
      <div className="page-head"><div><h1>Explore</h1><div className="sub">Any place on Earth: pick it from the list, draw it, or type coordinates.</div></div></div>
      <div className="grid g-side">
        <aside className="card stack side-panel" aria-label="Analysis settings">
          <AreaPanel aoi={aoi} setAOI={setAOI} openPicker={() => setPickerOpen(true)} toast={toast} />
          <div>
            <h2 style={{ marginBottom: 8 }}>2 · Period</h2>
            <div className="chips">
              {[['30', 'Last 30 days'], ['ytd', 'This year'], ['365', 'Last 12 months'], ['5y', 'Last 5 years'], ['all', 'All (2000–now)']].map(([k, l]) => (
                <button key={k} className="chip" aria-pressed={preset === k} onClick={() => usePreset(k)}>{l}</button>
              ))}
            </div>
            <div className="fields two mt">
              <label className="field">From<input className="input" type="date" min="2000-11-01" max={today} value={start} onChange={(e) => setStart(e.target.value)} /></label>
              <label className="field">To<input className="input" type="date" min="2000-11-01" max={today} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
            </div>
            <div className="fields two mt">
              <label className="field">Normal years from<input className="input" type="number" min={2001} max={yNow - 1} placeholder="2003" value={bFrom} onChange={(e) => setBFrom(e.target.value)} /></label>
              <label className="field">to<input className="input" type="number" min={2001} max={yNow - 1} placeholder={String(yNow - 1)} value={bTo} onChange={(e) => setBTo(e.target.value)} /></label>
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>These years define "usual" for comparisons and percentiles.</p>
          </div>
          <div>
            <h2 style={{ marginBottom: 8 }}>3 · Display</h2>
            <label className="row small" style={{ marginBottom: 8 }}><input type="checkbox" checked={includeStatic} onChange={(e) => { setIncludeStatic(e.target.checked); apply(start, end, e.target.checked); }} /> Count industrial heat sources too</label>
            <label className="field">Colour ramp
              <select className="input" value={ramp} onChange={(e) => setRamp(e.target.value as RampKey)}>
                {(Object.keys(RAMPS) as RampKey[]).map((k) => <option key={k} value={k}>{RAMPS[k].name}</option>)}
              </select>
            </label>
          </div>
          <button className="btn primary" onClick={() => apply()}>Update analysis</button>
        </aside>

        <div className="stack">
          <Card flush title={aoi.label} hint={data ? `${fmt(data.aoi.areaKm2)} km² · ${data.mode === 'demo' ? 'demo data' : 'NASA FIRMS'}${isFetching ? ' · updating…' : ''}` : undefined}>
            <MapView label="Selected area with detections from the last 7 days" legend={<AgeLegend extra={<div><i style={{ background: 'transparent', border: '2px solid #2a78d6', borderRadius: 2 }} />Hot cells (most burning)</div>} />}>
              <DrawControl onArea={setAOI} />
              {data && <ExploreLayers d={data} />}
            </MapView>
          </Card>
          {error && <ErrorBox error={error} />}
          {data?.dataset.status === 'backfilling' && <BackfillBanner dataset={data.dataset} areaLabel={aoi.label || ''} />}
          {data && <Summary d={data} />}
          <section className="card">
            <div className="tabs" role="tablist">
              {([['calendar', 'Calendar'], ['trends', 'Trends'], ['anomalies', 'Anomalies'], ['season', 'Seasonality'], ['sensors', 'Sensors'], ['table', 'Data']] as [Tab, string][]).map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
              ))}
            </div>
            {!data ? <Loading text="Harmonizing MODIS + VIIRS detections…" /> : (
              <>
                {tab === 'calendar' && <CalendarTab d={data} ramp={ramp} toast={toast} />}
                {tab === 'trends' && <TrendsTab d={data} />}
                {tab === 'anomalies' && <AnomaliesTab d={data} />}
                {tab === 'season' && <SeasonTab d={data} />}
                {tab === 'sensors' && <SensorsTab d={data} />}
                {tab === 'table' && <DataTab d={data} aoi={aoi} start={applied.start} end={applied.end} />}
              </>
            )}
          </section>
          <Card title="Downloads" hint="for the selected area and period">
            <Downloads aoi={aoi} data={data} start={applied.start} end={applied.end} />
            <p className="small muted mt">The hotspot CSV keeps every original MODIS/VIIRS detection and adds <code>harmonized_weight</code>: adding it up by month gives the harmonized calendar, so the sensor a detection came from no longer matters for counts.</p>
          </Card>
        </div>
      </div>
    </>
  );
}

function AreaPanel({ aoi, setAOI, openPicker, toast }: { aoi: AOI; setAOI: (a: AOI) => void; openPicker: () => void; toast: (t: string, b?: string) => void }) {
  const [mode, setMode] = useState<'place' | 'draw' | 'coords'>('place');
  const [coordMode, setCoordMode] = useState<'point' | 'bbox'>('point');
  const [pt, setPt] = useState({ lat: '7.8731', lon: '80.7718', r: '25' });
  const [bb, setBb] = useState({ w: '80.0', e: '81.0', s: '7.5', n: '8.5' });
  const { data: regions } = useQuery({ queryKey: ['regions'], queryFn: getRegions, staleTime: Infinity });
  const applyCoords = () => {
    if (coordMode === 'point') {
      const lat = +pt.lat, lon = +pt.lon, r = +pt.r;
      if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && r > 0)) return toast('Check the coordinates', 'Latitude −90…90, longitude −180…180, radius above 0');
      setAOI({ kind: 'circle', lat, lon, radius_km: r });
    } else {
      const b = [bb.w, bb.s, bb.e, bb.n].map(Number);
      if (b.some((v) => !Number.isFinite(v)) || b[0] >= b[2] || b[1] >= b[3]) return toast('Check the box', 'West < East and South < North');
      setAOI({ kind: 'bbox', bbox: b });
    }
  };
  return (
    <div>
      <h2 style={{ marginBottom: 8 }}>1 · Area</h2>
      <div className="tabs" role="tablist" style={{ marginBottom: 10 }}>
        {(['place', 'draw', 'coords'] as const).map((m) => <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>{m === 'place' ? 'Place' : m === 'draw' ? 'Draw' : 'Coordinates'}</button>)}
      </div>
      {mode === 'place' && (
        <>
          <button className="btn" style={{ width: '100%', justifyContent: 'space-between' }} onClick={openPicker}><span>{aoi.label}</span><span>Change</span></button>
          <div className="chips mt">
            {regions && ['Sri Lanka', ...regions.sriLanka.provinces.map((p) => `${p} Province`)].map((n) => (
              <button key={n} className="chip" onClick={() => setAOI(n === 'Sri Lanka' ? { kind: 'country', country: n, label: n } : { kind: 'province', province: n.replace(' Province', ''), label: n })}>{n}</button>
            ))}
          </div>
        </>
      )}
      {mode === 'draw' && <p className="small muted">Use the tools on the map (top-left) to draw a <b>rectangle</b>, <b>polygon</b> or <b>circle</b>. The analysis runs as soon as you finish the shape.</p>}
      {mode === 'coords' && (
        <>
          <Segmented label="Coordinate type" value={coordMode} onChange={setCoordMode} options={[{ value: 'point', label: 'Point + radius' }, { value: 'bbox', label: 'Bounding box' }]} />
          {coordMode === 'point' ? (
            <div className="fields three mt">
              <label className="field">Latitude<input className="input" type="number" step="0.0001" value={pt.lat} onChange={(e) => setPt({ ...pt, lat: e.target.value })} /></label>
              <label className="field">Longitude<input className="input" type="number" step="0.0001" value={pt.lon} onChange={(e) => setPt({ ...pt, lon: e.target.value })} /></label>
              <label className="field">Radius km<input className="input" type="number" min={1} max={1000} value={pt.r} onChange={(e) => setPt({ ...pt, r: e.target.value })} /></label>
            </div>
          ) : (
            <div className="fields two mt">
              {(['w', 'e', 's', 'n'] as const).map((k) => (
                <label key={k} className="field">{{ w: 'West', e: 'East', s: 'South', n: 'North' }[k]}<input className="input" type="number" step="0.01" value={bb[k]} onChange={(e) => setBb({ ...bb, [k]: e.target.value })} /></label>
              ))}
            </div>
          )}
          <div className="row mt">
            <button className="btn" type="button" onClick={() => navigator.geolocation?.getCurrentPosition((p) => setPt({ ...pt, lat: p.coords.latitude.toFixed(4), lon: p.coords.longitude.toFixed(4) }), () => toast('Location unavailable'))}>Use my location</button>
            <span className="spacer" /><button className="btn primary" type="button" onClick={applyCoords}>Apply</button>
          </div>
        </>
      )}
    </div>
  );
}

function ExploreLayers({ d }: { d: Analysis }) {
  return (
    <>
      <AreaOutline geojson={d.aoi.geojson} accent />
      <StaticSites sites={d.staticSources?.sites} />
      <FastLayer items={d.mapPoints} make={(p, renderer) => L.circleMarker([p[0], p[1]], { renderer, radius: 4, weight: 1, color: '#fff', fillColor: ageColor(p[3]), fillOpacity: 0.9 })
        .bindPopup(`<b>${SAT_NAMES[p[2]] || p[2]}</b><br>${p[6]} ${p[7].slice(0, 2)}:${p[7].slice(2)} UTC<br>Intensity ${fmt(p[5], 1)} MW`)} />
      <FastLayer items={d.selection.hotCells} make={(c) => L.rectangle([[c.lat - 0.05, c.lon - 0.05], [c.lat + 0.05, c.lon + 0.05]], { color: '#2a78d6', weight: 2, fill: false })
        .bindPopup(`<b>Hot cell</b><br>${fmt(c.harmonized, 1)} harmonized hotspots in the period${c.district ? `<br>${escapeHTML(c.district)} District` : ''}`)} />
    </>
  );
}

function Summary({ d }: { d: Analysis }) {
  const s = d.selection, n = d.nowcast, st = d.staticSources;
  return (
    <Card title={`${s.start} to ${s.end}`} hint={<span title="One harmonized hotspot = a ~1 km grid cell with fire on a given day, in VIIRS-equivalent units">What is a harmonized hotspot?</span>}>
      <div className="facts">
        <Fact k="Harmonized hotspots" v={fmt(s.harmonized)} />
        <Fact k="Raw detections" v={fmt(s.detections)} sub={`VIIRS ${fmt(s.viirs)} · MODIS ${fmt(s.modis)}`} />
        <Fact k="Per 1,000 km²" v={fmt(s.densityPer1000km2, 1)} />
        <Fact k="Median intensity" v={s.frp ? `${fmt(s.frp.median, 1)} MW` : '—'} />
        <Fact k="At night" v={s.nightShare == null ? '—' : `${fmt(s.nightShare)}%`} />
        <Fact k={`${n.monthName} status`} v={<span style={{ fontSize: 14 }}><RiskBadge risk={n.risk} /></span>} />
      </div>
      {st?.excludedDetections > 0 && (
        <p className="small muted mt">{fmt(st.excludedDetections)} detections from {st.sites.length} industrial heat source{st.sites.length === 1 ? '' : 's'} (kilns, refineries, power plants) are left out of every figure. Tick "Count industrial heat sources too" to include them.</p>
      )}
    </Card>
  );
}

function CalendarTab({ d, ramp, toast }: { d: Analysis; ramp: RampKey; toast: (t: string, b?: string) => void }) {
  const [mode, setMode] = useState<CalendarMode>('count');
  const [nums, setNums] = useState(true);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <Segmented label="Calendar view" value={mode} onChange={setMode} options={[{ value: 'count', label: 'Hotspots' }, { value: 'anomaly', label: 'vs. usual' }]} />
        <label className="row small"><input type="checkbox" checked={nums} onChange={(e) => setNums(e.target.checked)} /> Show values</label>
        <span className="spacer" /><span className="small muted">Rows = years · columns = months · last column = year total (* = incomplete)</span>
      </div>
      <Calendar calendar={d.calendar} mode={mode} ramp={ramp} numbers={nums}
        onCell={(m) => toast(monthLabel(m.month), `${fmt(m.value, 1)} harmonized hotspots${m.anomalyPct != null ? ` · ${pct(m.anomalyPct)} vs usual` : ''}`)} />
      <p className="small muted mt">The line between 2011 and 2012 marks the switch from MODIS (2000–2011, rescaled to VIIRS level) to VIIRS (2012 on). Because values are harmonized, colours compare fairly across the whole record.</p>
    </>
  );
}

function TrendsTab({ d }: { d: Analysis }) {
  const t = d.trend, s = d.series;
  const roll = s.map((_, i) => (i < 11 ? null : s.slice(i - 11, i + 1).reduce((a, x) => a + x.harmonized, 0) / 12));
  const yearTick = (labels: string[]) => (v: string | number) => labels[+v]?.slice(0, 4);
  const labels = s.map((x) => x.month);
  return (
    <>
      <div className="grid g-2">
        <div><h3>Harmonized hotspots per month</h3>
          <ChartLegend items={[{ label: 'Monthly', color: SERIES.harmonized }, { label: '12-month average', color: SERIES.ink }]} />
          <ChartBox type="line" label="Monthly harmonized hotspots" data={{ labels, datasets: [
            { label: 'Monthly', data: s.map((x) => x.harmonized), borderColor: SERIES.harmonized, borderWidth: 1.5 },
            { label: '12-month average', data: roll, borderColor: SERIES.ink },
          ] }} options={{ scales: { x: { ticks: { maxTicksLimit: 10, maxRotation: 0, callback: yearTick(labels) } }, y: { beginAtZero: true } } }} />
        </div>
        <div><h3>Totals per year</h3>
          <ChartLegend items={[{ label: 'Complete year', color: '#ec7a45', type: 'box' }, { label: 'Year so far / partly loaded', color: '#f9bc98', type: 'box' }]} />
          <ChartBox type="bar" label="Harmonized hotspots per year" data={{ labels: d.annual.map((a) => a.year), datasets: [
            { label: 'Harmonized hotspots', data: d.annual.map((a) => a.total), backgroundColor: d.annual.map((a) => (a.complete ? '#ec7a45' : '#f9bc98')), maxBarThickness: 22 },
          ] }} options={{ scales: { y: { beginAtZero: true }, x: { ticks: { maxTicksLimit: 14, maxRotation: 0 } } } }} />
        </div>
      </div>
      <div className="callout mt">
        {t ? <>Long-term trend (complete years): <b>{t.slopePerYear > 0 ? '+' : ''}{fmt(t.slopePerYear, 1)} hotspots a year ({pct(t.pctPerYear)} a year)</b>, {t.direction}. {t.significant ? <b>Statistically significant</b> : 'Not statistically significant'} (Mann–Kendall p = {t.p.toFixed(3)}).</> : 'Not enough complete years for a trend test.'}
        {' '}This year so far: <b>{fmt(d.ytd.value)}</b>, against {fmt(d.ytd.median)} usually by this date ({pct(d.ytd.vsMedianPct)}).
      </div>
    </>
  );
}

function AnomaliesTab({ d }: { d: Analysis }) {
  const cells = useMemo(() => d.calendar.flatMap((y) => y.months).filter((m): m is NonNullable<typeof m> => !!m && m.anomalyPct != null).slice(-36), [d.calendar]);
  return (
    <>
      <p className="muted">Each month compared with the {d.baseline[0]}–{d.baseline[1]} average for the same month. Blue = quieter than usual, red = busier, grey = within ±10%.</p>
      <Calendar calendar={d.calendar} mode="anomaly" />
      <h3 className="mt">Last 36 months</h3>
      <ChartLegend items={[{ label: 'Busier than usual', color: DIVERGING.colors[7], type: 'box' }, { label: 'Quieter than usual', color: DIVERGING.colors[1], type: 'box' }]} />
      <ChartBox type="bar" label="Percent difference from usual, last 36 months" data={{ labels: cells.map((m) => monthLabel(m.month)), datasets: [
        { label: '% vs usual', data: cells.map((m) => m.anomalyPct), backgroundColor: cells.map((m) => ((m.anomalyPct || 0) >= 0 ? DIVERGING.colors[7] : DIVERGING.colors[1])), maxBarThickness: 18 },
      ] }} options={{ scales: { y: { ticks: { callback: (v) => `${v}%` } }, x: { ticks: { maxTicksLimit: 12, maxRotation: 0 } } }, plugins: { tooltip: { callbacks: { label: (c) => ` ${pct(c.raw as number)} vs usual` } } } }} />
    </>
  );
}

function SeasonTab({ d }: { d: Analysis }) {
  const s = d.seasonal, y = new Date().getUTCFullYear();
  return (
    <div className="grid g-2">
      <div>
        <ChartLegend items={[{ label: String(y), color: SERIES.harmonized, type: 'box' }, { label: String(y - 1), color: SERIES.viirs }, { label: 'Typical month', color: SERIES.ink }, { label: 'Normal range', color: SERIES.harmonized, type: 'band' }]} />
        <div className="chart-tall-wrap"><SeasonChart seasonal={s} previous /></div>
      </div>
      <div>
        <h3>Critical months</h3>
        <p className="small muted">Share of a normal year's burning in each month. Months at least 1.25× the average month are flagged.</p>
        <table className="data">
          <thead><tr><th>Month</th><th>Share of year</th><th className="num">Typical</th><th className="num">Highest</th><th /></tr></thead>
          <tbody>{d.critical.map((c, i) => (
            <tr key={c.month}><td>{c.month}</td>
              <td><div className="bar-cell"><span className="bar" style={{ width: `${c.share * 300}px`, background: c.critical ? '#b4461a' : '#f49a6b' }} />{fmt(c.share * 100)}%</div></td>
              <td className="num">{fmt(s[i].median)}</td><td className="num">{fmt(s[i].max)}</td><td>{c.critical ? <b>Critical</b> : ''}</td></tr>
          ))}</tbody>
        </table>
        {d.fireSeason && <p className="small mt">Main season: <b>{d.fireSeason.start} – {d.fireSeason.end}</b> ({d.fireSeason.months} months hold {d.fireSeason.share}% of the year's fires). Peak: <b>{d.peakMonth}</b>.</p>}
      </div>
    </div>
  );
}

function SensorsTab({ d }: { d: Analysis }) {
  const c = d.calibration, s = d.series;
  const labels = s.map((x) => x.month);
  return (
    <>
      <p className="muted">Raw counts jump when VIIRS arrives (2012) and again as NOAA-20 and NOAA-21 join, because more and sharper sensors see more small fires. The harmonized series puts everything on one scale.</p>
      <ChartLegend items={[{ label: 'MODIS raw detections', color: SERIES.modis }, { label: 'VIIRS raw detections', color: SERIES.viirs }, { label: 'Harmonized series', color: SERIES.harmonized }]} />
      <ChartBox type="line" height="tall" label="Raw MODIS and VIIRS detections compared with the harmonized series" data={{ labels, datasets: [
        { label: 'MODIS raw', data: s.map((x) => x.modisRaw), borderColor: SERIES.modis, borderWidth: 1.5 },
        { label: 'VIIRS raw', data: s.map((x) => x.viirsRaw || null), borderColor: SERIES.viirs, borderWidth: 1.5 },
        { label: 'Harmonized', data: s.map((x) => x.harmonized), borderColor: SERIES.harmonized, borderWidth: 2.5 },
      ] }} options={{ scales: { x: { ticks: { maxTicksLimit: 10, maxRotation: 0, callback: (v) => labels[+v]?.slice(0, 4) } }, y: { beginAtZero: true } } }} />
      <div className="facts mt">
        <Fact k="VIIRS / MODIS ratio k" v={c.kV} sub={`by month ${Math.min(...c.kV_month)}–${Math.max(...c.kV_month)}`} />
        <Fact k="Overlap months" v={c.overlapMonths} sub={`${c.window[0]} → ${c.window[1]}`} />
        <Fact k="Fit r² (log-log)" v={c.r2 ?? '—'} />
        <Fact k="Calibration error" v={c.mape != null ? `${fmt(c.mape * 100, 1)}%` : '—'} sub="mean absolute % error" />
        <Fact k="Terra-only → Terra+Aqua" v={c.kTA} />
      </div>
      {c.priorUsed && <div className="callout warn mt">Few overlapping detections here, so the calibration leans on the regional ratio ({c.prior?.source}).</div>}
      <p className="small mt"><Link to="/method">How the harmonization works →</Link></p>
    </>
  );
}

function DataTab({ d, aoi, start, end }: { d: Analysis; aoi: AOI; start?: string; end?: string }) {
  const { data, error } = useQuery({ queryKey: ['hotspots', aoi, start, end], queryFn: () => getHotspots(aoi, start, end), staleTime: 60_000 });
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading text="Loading detections…" />;
  const rows = data.hotspots.slice(-300).reverse();
  return (
    <>
      <div className="grid g-2" style={{ marginBottom: 16 }}>
        <div><h3>Hot cells (0.1°)</h3>
          <table className="data"><thead><tr><th>Location</th><th>District</th><th className="num">Harmonized</th><th className="num">Detections</th></tr></thead>
            <tbody>{d.selection.hotCells.length ? d.selection.hotCells.map((c) => (
              <tr key={`${c.lat},${c.lon}`}><td className="tnum">{c.lat.toFixed(2)}, {c.lon.toFixed(2)}</td><td>{c.district || '—'}</td><td className="num">{fmt(c.harmonized, 1)}</td><td className="num">{fmt(c.detections)}</td></tr>
            )) : <tr><td colSpan={4} className="muted">None in period</td></tr>}</tbody>
          </table>
        </div>
        <div><h3>By satellite</h3>
          <table className="data"><tbody>{Object.entries(d.selection.bySatellite).map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{fmt(v)}</td></tr>)}</tbody></table>
        </div>
      </div>
      <h3>Most recent {fmt(rows.length)} of {fmt(data.count)} detections</h3>
      <div className="table-wrap" style={{ maxHeight: 420 }}>
        <table className="data">
          <thead><tr><th>Date</th><th>UTC</th><th>Satellite</th><th>Lat</th><th>Lon</th><th>Conf.</th><th className="num">MW</th><th className="num">Weight</th><th>District</th></tr></thead>
          <tbody>{rows.length ? rows.map((x, i) => (
            <tr key={i}><td>{x.acq_date}</td><td>{x.acq_time}</td><td>{x.satellite} <span className="muted small">{x.sensor}</span></td><td className="tnum">{x.latitude}</td><td className="tnum">{x.longitude}</td>
              <td>{x.confidence_class}</td><td className="num">{fmt(x.frp_mw, 1)}</td><td className="num">{x.harmonized_weight}</td><td>{x.district}</td></tr>
          )) : <tr><td colSpan={9} className="muted">No detections in this period</td></tr>}</tbody>
        </table>
      </div>
    </>
  );
}

function Downloads({ aoi, data, start, end }: { aoi: AOI; data?: Analysis; start?: string; end?: string }) {
  return (
    <div className="row">
      <button className="btn primary" onClick={() => downloadExport(aoi, 'csv', start, end)}>Hotspots CSV (harmonized)</button>
      <a className="btn" href={`/api/v1/calendar?${aoiQuery(aoi)}&format=csv`} download>Monthly calendar CSV</a>
      <button className="btn" onClick={() => downloadExport(aoi, 'geojson', start, end)}>GeoJSON</button>
      <button className="btn" disabled={!data} onClick={() => data && saveBlob(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), 'analysis.json')}>Full analysis JSON</button>
      <Link className="btn ghost" to="/reports">Printable report →</Link>
    </div>
  );
}

