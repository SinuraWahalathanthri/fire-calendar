import { useState, type ReactNode } from 'react';
import type { Analysis } from '../api/types';
import { aoiQuery } from '../api/client';
import { useApp, useAnalysis, isSriLanka } from '../state/AppState';
import { fmt, pct, monthLabel, plainLevel } from '../lib/format';
import { SERIES } from '../lib/colors';
import { Delta, ErrorBox, Loading, RiskBadge } from '../components/ui';
import { Calendar } from '../components/Calendar';
import { ChartBox, ChartLegend, SeasonChart } from '../components/charts';

const today = new Date().toISOString().slice(0, 10);

/** Plain-language findings, built only from numbers the analysis actually returned. */
function findings(d: Analysis): ReactNode[] {
  const s = d.selection, n = d.nowcast, t = d.trend, top = d.records.topYears[0], next = d.outlook.months.find((m) => m.horizon === 1);
  const pa = (d.protectedAreas || []).filter((p) => p.last30d > 0);
  const e = d.outlook.enso;
  return [
    <><b>{fmt(s.harmonized)}</b> harmonized hotspots were recorded in {d.aoi.label} between {s.start} and {s.end} ({fmt(s.detections)} raw satellite detections: {fmt(s.viirs)} VIIRS, {fmt(s.modis)} MODIS).</>,
    <>{n.monthName} {n.month.slice(0, 4)} is on track for about <b>{fmt(n.projected)}</b> hotspots{n.vsMedianPct != null && `, ${plainLevel(n.vsMedianPct).long} (a typical ${n.monthName} has ${fmt(n.median)})`}. Status: <b>{n.risk.level}</b>.</>,
    d.fireSeason && <>The fire season normally runs <b>{d.fireSeason.start}–{d.fireSeason.end}</b>, holding {d.fireSeason.share}% of the year's activity, with the peak in <b>{d.peakMonth}</b>. Critical months: {d.seasonMonths.join(', ') || '—'}.</>,
    <>Year to date: <b>{fmt(d.ytd.value)}</b> harmonized hotspots, {pct(d.ytd.vsMedianPct)} against the usual for the same period.</>,
    top && <>The busiest year on record was <b>{top.year}</b> ({fmt(top.total)}); the busiest month was <b>{monthLabel(d.records.topMonths[0]?.month)}</b> ({fmt(d.records.topMonths[0]?.value)}).</>,
    t && <>Long-term trend: {pct(t.pctPerYear)} a year ({t.direction}, {t.significant ? 'statistically significant' : 'not statistically significant'}; Mann–Kendall p = {t.p.toFixed(3)}).</>,
    next && <>Outlook for {monthLabel(next.month)}: about <b>{fmt(next.forecast)}</b> hotspots (likely {fmt(next.low)}–{fmt(next.high)}), level <b>{next.risk.level}</b>.</>,
    <>Last 7 days: {fmt(d.activity.last7d)} detections; last 24 h: {fmt(d.activity.last24h)}.</>,
    pa.length > 0 && <>Fire detected inside {pa.length} protected area{pa.length > 1 ? 's' : ''} in the last 30 days: {pa.slice(0, 4).map((p) => `${p.name} (${p.last30d})`).join(', ')}.</>,
    e?.available && e.oni != null && <>ENSO: {e.phase} (ONI {e.oni > 0 ? '+' : ''}{e.oni}).{e.elNinoEffectPct != null && ` In past El Niño months this area had ${e.elNinoEffectPct >= 0 ? `${fmt(e.elNinoEffectPct)}% more` : `${fmt(-e.elNinoEffectPct)}% less`} fire than usual.`}</>,
    d.staticSources?.excludedDetections > 0 && <>{fmt(d.staticSources.excludedDetections)} detections from {d.staticSources.sites.length} industrial heat sources were excluded.</>,
  ].filter(Boolean);
}

export default function Reports() {
  const { aoi, setPickerOpen } = useApp();
  const [start, setStart] = useState(`${new Date().getUTCFullYear()}-01-01`);
  const [end, setEnd] = useState(today);
  const [range, setRange] = useState({ start, end });
  const { data: d, error, isFetching } = useAnalysis(aoi, range);
  const q = aoiQuery(aoi); q.set('start', range.start); q.set('end', range.end);

  return (
    <>
      <div className="page-head no-print">
        <div><h1>Situation report</h1><div className="sub">A one-page briefing to print or share: what is happening, how it compares with normal, what to expect, and the data behind it.</div></div>
      </div>
      <div className="card no-print">
        <div className="fields three" style={{ alignItems: 'end' }}>
          <label className="field">Area<button className="btn" type="button" style={{ justifyContent: 'space-between' }} onClick={() => setPickerOpen(true)}><span>{aoi.label}</span><span>Change</span></button></label>
          <label className="field">From<input className="input" type="date" min="2000-11-01" max={today} value={start} onChange={(e) => setStart(e.target.value)} /></label>
          <label className="field">To<input className="input" type="date" min="2000-11-01" max={today} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        <div className="row mt">
          <button className="btn primary" onClick={() => setRange({ start, end })}>{isFetching ? 'Preparing…' : 'Generate report'}</button>
          <button className="btn" disabled={!d} onClick={() => window.print()}>Print / save as PDF</button>
          <span className="spacer" />
          <span className="small muted">Downloads: <a href={`/api/v1/hotspots?${q}&format=csv`}>hotspots CSV</a> · <a href={`/api/v1/calendar?${aoiQuery(aoi)}&format=csv`}>calendar CSV</a> · <a href={`/api/v1/hotspots?${q}&format=geojson`}>GeoJSON</a></span>
        </div>
      </div>
      {error && <ErrorBox error={error} />}
      <div className="mt">{!d ? <Loading text="Preparing report…" /> : <Report d={d} sriLanka={isSriLanka(aoi)} />}</div>
    </>
  );
}

function Report({ d, sriLanka }: { d: Analysis; sriLanka: boolean }) {
  const s = d.selection, n = d.nowcast;
  const districts = sriLanka && d.districts ? d.districts.slice(0, 10) : null;
  return (
    <article className="report">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div><div className="eyebrow">Fire situation report</div><h1>{d.aoi.label}</h1></div>
        <div><RiskBadge risk={n.risk} big /></div>
      </div>
      <div className="meta">
        <div><span>Period analysed</span>{s.start} → {s.end}</div>
        <div><span>Generated</span>{new Date(d.generatedAt).toLocaleString()}</div>
        <div><span>Area</span>{fmt(d.aoi.areaKm2)} km²</div>
        <div><span>Compared with</span>{d.baseline[0]}–{d.baseline[1]}</div>
        <div><span>Data</span>{d.mode === 'demo' ? <b>SYNTHETIC DEMO DATA</b> : 'NASA FIRMS MODIS C6.1 + VIIRS 375 m'}</div>
        <div><span>Units</span>Harmonized hotspots (VIIRS-equivalent fire cell-days)</div>
      </div>
      {d.mode === 'demo' && <div className="callout warn">This report was generated from synthetic demonstration data and must not be used for decisions.</div>}
      {d.dataset.status === 'backfilling' && <div className="callout warn">Fire history was still downloading when this report was made; comparisons use {d.baseline[0]}–{d.baseline[1]} only.</div>}
      <h2>Key findings</h2>
      <ul className="findings">{findings(d).map((f, i) => <li key={i}>{f}</li>)}</ul>
      <h2>Fire calendar</h2>
      <Calendar calendar={d.calendar} mode="count" numbers />
      <h2>This year against a normal year</h2>
      <ChartLegend items={[{ label: 'This year', color: SERIES.harmonized, type: 'box' }, { label: 'Typical month', color: SERIES.ink }, { label: 'Normal range', color: SERIES.harmonized, type: 'band' }]} />
      <SeasonChart seasonal={d.seasonal} animate={false} />
      <h2>Totals per year</h2>
      <ChartBox type="bar" height="short" label="Harmonized hotspots per year" data={{ labels: d.annual.map((a) => a.year), datasets: [
        { label: 'Harmonized hotspots', data: d.annual.map((a) => a.total), backgroundColor: d.annual.map((a) => (a.complete ? '#ec7a45' : '#f9bc98')), maxBarThickness: 20 },
      ] }} options={{ animation: false, scales: { y: { beginAtZero: true }, x: { ticks: { maxRotation: 0 } } } }} />
      <h2>Outlook</h2>
      <table className="data">
        <thead><tr><th>Month</th><th className="num">Expected</th><th className="num">Likely range</th><th className="num">Typical</th><th>Level</th></tr></thead>
        <tbody>{d.outlook.months.map((m) => (
          <tr key={m.month}><td>{monthLabel(m.month)}{m.horizon === 0 && ' (in progress)'}</td><td className="num">{fmt(m.forecast)}</td><td className="num">{fmt(m.low)}–{fmt(m.high)}</td><td className="num">{fmt(m.median)}</td><td><RiskBadge risk={m.risk} /></td></tr>
        ))}</tbody>
      </table>
      {districts && (
        <>
          <h2>Districts</h2>
          <table className="data">
            <thead><tr><th>District</th><th>Province</th><th className="num">Last 7 d</th><th className="num">This month</th><th className="num">vs usual</th><th>Peak month</th><th className="num">Avg / yr</th></tr></thead>
            <tbody>{districts.map((r) => (
              <tr key={r.district}><td><b>{r.district}</b></td><td>{r.province}</td><td className="num">{fmt(r.last7d)}</td><td className="num">{fmt(r.monthToDate)}</td><td className="num"><Delta value={r.vsMedianPct} /></td><td>{r.peakMonth || '—'}</td><td className="num">{fmt(r.annualAverage)}</td></tr>
            ))}</tbody>
          </table>
        </>
      )}
      <h2>Hot cells in the period</h2>
      <table className="data">
        <thead><tr><th>Centre (lat, lon)</th><th>District</th><th className="num">Harmonized hotspots</th><th className="num">Detections</th></tr></thead>
        <tbody>{s.hotCells.length ? s.hotCells.map((c) => (
          <tr key={`${c.lat},${c.lon}`}><td className="tnum">{c.lat.toFixed(2)}, {c.lon.toFixed(2)}</td><td>{c.district || '—'}</td><td className="num">{fmt(c.harmonized, 1)}</td><td className="num">{fmt(c.detections)}</td></tr>
        )) : <tr><td colSpan={4} className="muted">None</td></tr>}</tbody>
      </table>
      <h2>Method</h2>
      <p className="small">MODIS (Terra/Aqua, 1 km) and VIIRS (S-NPP, NOAA-20, NOAA-21, 375 m) detections are filtered for confidence, industrial heat sources are removed, and the rest are gridded to 0.01° cells and counted as unique fire cell-days. MODIS-era months are rescaled to VIIRS level with per-month factors (k = {d.calibration.kV}, r² = {d.calibration.r2 ?? '—'}) estimated over {d.calibration.window[0]}–{d.calibration.window[1]}{d.calibration.validation?.annualError != null && `, tested on unseen years with ${fmt(d.calibration.validation.annualError * 100, 1)}% annual error`}. A hotspot is a heat anomaly and may not be a wildfire; confirm on the ground.</p>
      <p className="small muted">Source: NASA FIRMS (Fire Information for Resource Management System), LANCE / Earthdata. Generated by Fire Calendar.</p>
    </article>
  );
}
