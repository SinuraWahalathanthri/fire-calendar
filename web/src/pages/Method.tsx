import type { Analysis } from '../api/types';
import { useApp, useAnalysis } from '../state/AppState';
import { fmt, MONTHS } from '../lib/format';
import { SERIES } from '../lib/colors';
import { Card, ErrorBox, Fact, Loading } from '../components/ui';
import { ChartBox, ChartLegend } from '../components/charts';

export default function Method() {
  const { aoi } = useApp();
  const { data, error } = useAnalysis(aoi);
  return (
    <>
      <div className="page-head"><div><h1>Method</h1>
        <div className="sub">How detections from two generations of satellites are turned into one comparable record, and how well that works.</div></div></div>
      <div className="grid g-2">
        <Card title="The problem">
          <p>MODIS (Terra 2000–, Aqua 2002–) gives the long record, but its pixels are <b>1 km</b> at nadir and grow to ~2 × 4.8 km at the swath edge. VIIRS (S-NPP 2012–, NOAA-20 2018–, NOAA-21 2024–) has <b>375 m</b> pixels: it sees smaller and cooler fires, and one fire often lights up several VIIRS pixels. Raw counts therefore jump in 2012 for reasons that have nothing to do with fire, and again each time a satellite is added.</p>
          <div className="facts">
            <Fact k="MODIS pixel" v="1 km" sub="~1 km² at nadir" />
            <Fact k="VIIRS pixel" v="375 m" sub="~0.14 km²" />
            <Fact k="Overpasses (local time)" v={<span style={{ fontSize: 14 }}>10:30 / 13:30 + night</span>} sub="Terra · Aqua & VIIRS" />
          </div>
        </Card>
        <Card title="The approach, for each area">
          <div className="steps">
            <div className="step"><div><b>Quality filter.</b> Drop low-confidence detections (MODIS under 30%, VIIRS "low"), and remove industrial heat sources (see below).</div></div>
            <div className="step"><div><b>Common grid.</b> Snap every detection to a 0.01° (~1.1 km) cell and count <b>unique fire cell-days</b>. Several VIIRS pixels on one fire collapse to one, as with MODIS.</div></div>
            <div className="step"><div><b>One reference satellite per day.</b> VIIRS = S-NPP when it has data, otherwise NOAA-20 or NOAA-21 after cross-calibration; MODIS = Terra+Aqua, with Terra-only months (2000–02) scaled by the Terra+Aqua/Terra ratio of 2003–2011.</div></div>
            <div className="step"><div><b>Cross-calibrate.</b> Over 2012–2021 (before Terra's orbit drift), estimate <i>k</i> = VIIRS / MODIS cell-days for each calendar month. Small areas lean on the ratio measured for the wider region.</div></div>
            <div className="step"><div><b>Merge.</b> VIIRS-era months use VIIRS directly; MODIS-era months are k × MODIS. Each original detection carries a <code>harmonized_weight</code>, so exports add up to the calendar.</div></div>
          </div>
        </Card>
      </div>
      <Card className="mt" title={`Calibration for ${aoi.label}`} hint="change the area with the selector at the top">
        {error ? <ErrorBox error={error} /> : !data ? <Loading /> : <CalibrationCharts d={data} />}
      </Card>
      {data && <Validation d={data} />}
      <div className="grid g-2 mt">
        <Card title="Terms used">
          <table className="data"><tbody>
            <tr><td><b>Harmonized hotspots</b></td><td>VIIRS-equivalent fire cell-days: unique 0.01° cell × day with at least one detection.</td></tr>
            <tr><td><b>vs. usual (%)</b></td><td>(month − average of the same month in the comparison years) ÷ that average.</td></tr>
            <tr><td><b>Percentile</b></td><td>How the month ranks against the same month in the comparison years.</td></tr>
            <tr><td><b>Status level</b></td><td>Where the month (projected to month-end) ranks among the same month in past years: Low below the 25th percentile, Normal 25–75, Elevated 75–90, High 90–97, Extreme above 97.</td></tr>
            <tr><td><b>Critical month</b></td><td>Usual activity at least 1.25 × the average month.</td></tr>
            <tr><td><b>Fire season</b></td><td>Shortest run of consecutive months holding at least 70% of the year's fires.</td></tr>
            <tr><td><b>Trend</b></td><td>Theil–Sen slope of yearly totals with a Mann–Kendall significance test.</td></tr>
          </tbody></table>
        </Card>
        <Card title="Data sources and limitations">
          <ul>
            <li>NASA FIRMS active fire data: MODIS Collection 6.1 (MCD14) and VIIRS 375 m (VNP14IMG / VJ114IMG / VJ214IMG). Standard Processing archive for history, Near Real-Time for the latest ~2 months. <a href="https://www.earthdata.nasa.gov/data/tools/firms" target="_blank" rel="noopener">earthdata.nasa.gov/data/tools/firms</a></li>
            <li>El Niño / La Niña: NOAA CPC Oceanic Niño Index. Boundaries: Natural Earth, geoBoundaries, OpenStreetMap (districts, parks).</li>
            <li>Hotspots are heat anomalies: they include farm and waste burning, and miss fires under cloud or smoke, or small fires between overpasses.</li>
            <li>Calibration ratios are local; where an area has very little fire, the regional ratio dominates (flagged in Explore → Sensors).</li>
            <li>Terra's orbit has drifted since 2022 (earlier overpass), so the calibration window ends in 2021.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

function CalibrationCharts({ d }: { d: Analysis }) {
  const c = d.calibration;
  const maxX = Math.max(1, ...c.pairs.map((p) => p.modis));
  return (
    <div className="grid g-2">
      <div>
        <h3>Monthly cell-days in the overlap years (each dot = one month)</h3>
        <ChartLegend items={[{ label: 'Month', color: SERIES.harmonized, type: 'box' }, { label: `Fit: VIIRS = ${c.kV} × MODIS`, color: SERIES.ink }]} />
        <ChartBox type="scatter" height="tall" label="MODIS against VIIRS fire cell-days per month in the overlap years"
          data={{ datasets: [
            { label: 'Months', data: c.pairs.map((p) => ({ x: p.modis, y: p.viirs, m: p.month })), backgroundColor: 'rgba(42,120,214,.55)', borderColor: '#fff', borderWidth: 1, pointRadius: 4, pointHoverRadius: 6 },
            { type: 'line', label: 'Fit', data: [{ x: 0, y: 0 }, { x: maxX, y: maxX * c.kV }], borderColor: SERIES.ink, borderDash: [5, 4], pointRadius: 0 },
          ] } as never}
          options={{
            interaction: { mode: 'nearest', intersect: true },
            plugins: { tooltip: { mode: 'nearest', intersect: true, callbacks: { label: (x) => { const r = x.raw as { m?: string; x: number; y: number }; return r.m ? ` ${r.m}: MODIS ${r.x}, VIIRS ${r.y}` : ''; } } } },
            scales: { x: { type: 'linear', beginAtZero: true, title: { display: true, text: 'MODIS fire cell-days' }, grid: { display: true } }, y: { beginAtZero: true, title: { display: true, text: 'VIIRS fire cell-days' } } },
          }} />
      </div>
      <div>
        <h3>Calibration factor by month</h3>
        <ChartLegend items={[{ label: 'k (VIIRS / MODIS)', color: '#ec7a45', type: 'box' }]} />
        <ChartBox type="bar" label="VIIRS to MODIS ratio for each calendar month"
          data={{ labels: MONTHS, datasets: [{ label: 'k', data: c.kV_month, backgroundColor: '#ec7a45', maxBarThickness: 24 }] }}
          options={{ scales: { y: { beginAtZero: true }, x: { ticks: { maxRotation: 0 } } } }} />
        <div className="facts mt">
          <Fact k="Overall k" v={c.kV} />
          <Fact k="r² (log-log)" v={c.r2 ?? '—'} />
          <Fact k="Mean abs. error" v={c.mape != null ? `${fmt(c.mape * 100, 1)}%` : '—'} />
          <Fact k="NOAA-20 → S-NPP" v={c.kN20} />
        </div>
      </div>
    </div>
  );
}

function Validation({ d }: { d: Analysis }) {
  const v = d.calibration.validation, st = d.staticSources;
  return (
    <div className="grid g-2 mt">
      <Card title="Does it work? Test on unseen years">
        {v ? (
          <>
            <p className="small">Ratios fitted on <b>{v.train[0]} – {v.train[1]}</b> only, then used to predict VIIRS from MODIS for <b>{v.test[0]} – {v.test[1]}</b>, data the model never saw.</p>
            <ChartLegend items={[{ label: 'VIIRS (measured)', color: SERIES.ink }, { label: 'From MODIS (predicted)', color: SERIES.harmonized }]} />
            <ChartBox type="line" label="Measured VIIRS against values predicted from MODIS in the test years"
              data={{ labels: v.series.map((x) => x.month), datasets: [
                { label: 'VIIRS measured', data: v.series.map((x) => x.observed), borderColor: SERIES.ink },
                { label: 'Predicted from MODIS', data: v.series.map((x) => x.predicted), borderColor: SERIES.harmonized, borderDash: [5, 3] },
              ] }}
              options={{ scales: { y: { beginAtZero: true }, x: { ticks: { maxTicksLimit: 6, maxRotation: 0 } } } }} />
            <div className="facts mt">
              <Fact k="Typical monthly error" v={v.monthlyMedianError != null ? `${fmt(v.monthlyMedianError * 100, 1)}%` : '—'} />
              <Fact k="Yearly total error" v={v.annualError != null ? `${fmt(v.annualError * 100, 1)}%` : '—'} />
              <Fact k="Overall bias" v={v.bias != null ? `${v.bias > 0 ? '+' : ''}${fmt(v.bias * 100, 1)}%` : '—'} />
              <Fact k="Correlation" v={v.correlation ?? '—'} />
            </div>
          </>
        ) : (
          <p className="muted">Needs both MODIS and VIIRS data for 2012–2021 in this area.{d.dataset.status === 'backfilling' && ' The history is still downloading; this test appears once those years are loaded.'}</p>
        )}
        <p className="small muted mt">Calibration source for small areas: {d.calibration.prior?.source || 'default'}{d.calibration.prior?.kV ? ` (k = ${d.calibration.prior.kV})` : ''}.</p>
      </Card>
      <Card title="Industrial heat sources removed" hint={`${st?.sites?.length || 0} in this area`}>
        <p className="small">A ~1 km cell is treated as industrial when it shows heat on at least {st?.rules?.minDaysPerYear ?? 10} days a year, in at least {st?.rules?.minCalendarMonths ?? 6} different calendar months. Vegetation fires are seasonal and brief; kilns, refineries and power plants are not. Cells tagged "static source" in the FIRMS archive are removed too.</p>
        {st?.sites?.length ? (
          <>
            <table className="data compact-table">
              <thead><tr><th>Location</th><th className="num">Days with heat</th><th className="num">Per year</th><th className="num">Months</th></tr></thead>
              <tbody>{st.sites.slice(0, 8).map((x) => (
                <tr key={`${x.lat},${x.lon}`}><td className="tnum">{x.lat.toFixed(3)}, {x.lon.toFixed(3)}</td><td className="num">{fmt(x.detectionDays)}</td><td className="num">{fmt(x.daysPerYear)}</td><td className="num">{x.calendarMonths}/12</td></tr>
              ))}</tbody>
            </table>
            <p className="small muted mt">{fmt(st.excludedDetections)} detections excluded in total.</p>
          </>
        ) : <p className="muted">None found here.</p>}
      </Card>
    </div>
  );
}
