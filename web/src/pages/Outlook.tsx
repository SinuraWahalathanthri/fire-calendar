import type { Enso } from '../api/types';
import { useApp, useAnalysis } from '../state/AppState';
import { fmt, monthLabel, plainLevel } from '../lib/format';
import { SERIES } from '../lib/colors';
import { Card, ErrorBox, Fact, Loading, RiskBadge } from '../components/ui';
import { ChartBox, ChartLegend } from '../components/charts';

function EnsoCard({ e }: { e?: Enso }) {
  if (!e || !e.available) return <p className="muted">El Niño data unavailable right now.</p>;
  const effect = (v: number | null, label: string) => v == null ? null : (
    <li>{label}: {v > 0 ? <b>{fmt(v)}% more</b> : <b>{fmt(-v)}% less</b>} fire than usual</li>
  );
  const conclusion = e.used
    ? <>It is <b>included</b> in this outlook because it improved the test forecasts for this area.</>
    : e.sampleMonths < 60
      ? `Not used yet: needs at least five years of fire history here to judge (has ${Math.floor(e.sampleMonths / 12)}).`
      : 'Not used: for this area it did not improve the test forecasts, so it is left out.';
  return (
    <>
      <div className="row" style={{ gap: 12, alignItems: 'baseline' }}>
        <span className="enso-val">{e.oni != null && e.oni > 0 ? '+' : ''}{e.oni}</span><b>{e.phase || 'Neutral'}</b>
        <span className="small muted">ONI, NOAA (season centred on {monthLabel(e.oniMonth)})</span>
      </div>
      <ul className="tight">
        {effect(e.elNinoEffectPct, `In past El Niño months (${e.elNinoMonths})`)}
        {effect(e.laNinaEffectPct, `In past La Niña months (${e.laNinaMonths})`)}
      </ul>
      <p className="small">{conclusion}</p>
    </>
  );
}

type BandDs = { band?: boolean };

export default function Outlook() {
  const { aoi, setPickerOpen } = useApp();
  const { data: d, error } = useAnalysis(aoi);
  return (
    <>
      <div className="page-head">
        <div><h1>Outlook · {aoi.label}</h1><div className="sub">How this month is tracking, and what the next six months usually bring.</div></div>
        <button className="btn" onClick={() => setPickerOpen(true)}>Change area</button>
      </div>
      {error && <ErrorBox error={error} />}
      {!d ? <Loading /> : (() => {
        const n = d.nowcast, o = d.outlook, sk = o.skill, m = o.months, hc = o.hindcast;
        return (
          <>
            {d.dataset.status === 'backfilling' && <div className="callout warn" style={{ marginBottom: 16 }}>Fire history is still downloading, so "usual" is based on the years loaded so far. Numbers will settle once it finishes.</div>}
            <div className="grid g-3">
              <div className="card kpi"><div className="label">{n.monthName} so far (day {n.dayOfMonth} of {n.daysInMonth})</div><div className="value">{fmt(n.monthToDate)}<small>hotspots</small></div>
                <div className="foot">By this date a normal {n.monthName} has had {fmt(n.typicalShareByToday * 100)}% of its fires.</div></div>
              <div className="card kpi"><div className="label">Expected by end of {n.monthName}</div><div className="value">{fmt(n.projected)}</div>
                <div className="foot">{n.median != null ? `${plainLevel(n.vsMedianPct).long} · normal range ${fmt(n.p10)}–${fmt(n.p90)}` : ''}</div></div>
              <div className="card kpi"><div className="label">Status</div><div style={{ margin: '6px 0' }}><RiskBadge risk={n.risk} big /></div>
                <div className="foot">{n.percentile != null ? `Higher than ${fmt(n.percentile)}% of past ${n.monthName}s.` : 'Not enough history yet.'}</div></div>
            </div>
            <Card className="mt" title="Next six months" hint="harmonized hotspots per month">
              <ChartLegend items={[{ label: 'Expected', color: SERIES.harmonized }, { label: 'Likely range', color: SERIES.harmonized, type: 'band' }, { label: 'Typical month', color: SERIES.ink }, { label: 'So far this month', color: '#ec7a45', type: 'box' }]} />
              <ChartBox type="bar" height="tall" label="Expected harmonized hotspots for the next six months with likely range"
                data={{ labels: m.map((x) => monthLabel(x.month)), datasets: [
                  { type: 'line', label: 'High', data: m.map((x) => x.high), borderWidth: 0, pointRadius: 0, backgroundColor: SERIES.band, fill: '+1', order: 4, band: true },
                  { type: 'line', label: 'Low', data: m.map((x) => x.low), borderWidth: 0, pointRadius: 0, order: 4, band: true },
                  { type: 'line', label: 'Typical', data: m.map((x) => x.median), borderColor: SERIES.ink, borderDash: [5, 4], order: 2 },
                  { type: 'line', label: 'Expected', data: m.map((x) => x.forecast), borderColor: SERIES.harmonized, pointRadius: 4, pointBackgroundColor: SERIES.harmonized, order: 1 },
                  { type: 'bar', label: 'So far', data: m.map((x) => x.observedToDate), backgroundColor: '#ec7a45', maxBarThickness: 28, order: 3 },
                ] } as never}
                options={{
                  scales: { y: { beginAtZero: true }, x: { ticks: { maxRotation: 0 } } },
                  plugins: { tooltip: { filter: (i) => !(i.dataset as BandDs).band, callbacks: { footer: (items) => { const x = m[items[0].dataIndex]; return `Likely ${fmt(x.low)}–${fmt(x.high)}`; } } } },
                }} />
              <div className="table-wrap mt">
                <table className="data">
                  <thead><tr><th>Month</th><th className="num">Expected</th><th className="num">Likely range</th><th className="num">Typical</th><th>Compared with usual</th><th>Level</th></tr></thead>
                  <tbody>{m.map((x) => (
                    <tr key={x.month}><td><b>{monthLabel(x.month)}</b>{x.horizon === 0 && <span className="small muted"> (now)</span>}</td>
                      <td className="num">{fmt(x.forecast)}</td><td className="num">{fmt(x.low)}–{fmt(x.high)}</td><td className="num">{fmt(x.median)}</td>
                      <td>{x.vsMedianPct == null ? '—' : plainLevel(x.vsMedianPct).short}</td><td><RiskBadge risk={x.risk} /></td></tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
            <div className="grid g-3 mt">
              <Card title="El Niño / La Niña"><EnsoCard e={o.enso} /></Card>
              <Card title="Track record" hint="forecast made one month ahead">
                {sk ? (
                  <>
                    <div className="facts">
                      <Fact k={'Better than "assume normal"'} v={sk.skillScore != null && sk.skillScore > 0 ? `${fmt(sk.skillScore * 100)}%` : 'No'} />
                      <Fact k="Inside the likely range" v={`${sk.bandCoverage}%`} sub="aim ≈ 80%" />
                    </div>
                    <p className="small muted mt">Tested on the last {sk.months} months, each forecast using only data available before that month.</p>
                  </>
                ) : <p className="muted">Needs at least five years of history.</p>}
              </Card>
              <Card title="How it works">
                <p className="small">Start from the typical amount for each month. Shift it up or down by how unusual the last three months were (the effect fades month by month), and by El Niño or La Niña if that helps here. Each weight is picked by testing on past years for this area.</p>
                <p className="small muted">Fire history only, no weather forecast. Use it to plan readiness alongside Department of Meteorology forecasts.</p>
              </Card>
            </div>
            <Card className="mt" title="Past forecasts vs. what happened">
              <ChartLegend items={[{ label: 'What happened', color: SERIES.ink }, { label: 'Forecast', color: SERIES.harmonized }, { label: 'Assume normal', color: '#86b6ef' }]} />
              <ChartBox type="line" label="Past one-month-ahead forecasts compared with observed values"
                data={{ labels: hc.map((x) => monthLabel(x.month)), datasets: [
                  { label: 'What happened', data: hc.map((x) => x.observed), borderColor: SERIES.ink },
                  { label: 'Forecast', data: hc.map((x) => x.forecast), borderColor: SERIES.harmonized },
                  { label: 'Assume normal', data: hc.map((x) => x.climatology), borderColor: '#86b6ef', borderDash: [4, 3] },
                ] }}
                options={{ scales: { y: { beginAtZero: true }, x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } } } }} />
            </Card>
          </>
        );
      })()}
    </>
  );
}
