import { useMemo, useState, type MouseEvent } from 'react';
import type { CalendarMonth, CalendarYear } from '../api/types';
import { MONTHS, fmt, fmtCompact, pct, monthLabel } from '../lib/format';
import { RAMPS, DIVERGING, quantileBreaks, classify, textOn, type RampKey } from '../lib/colors';

export type CalendarMode = 'count' | 'anomaly';

interface Props {
  calendar: CalendarYear[];
  mode?: CalendarMode;
  ramp?: RampKey;
  years?: number;           // show only the most recent N years
  numbers?: boolean;        // print values in cells
  compact?: boolean;        // tiny cells, no totals (embed widget)
  legend?: boolean;
  onCell?: (m: CalendarMonth) => void;
}

const isModisOnly = (method: string) => /MODIS/.test(method) && !/VIIRS/.test(method);

/** Years × months heatmap. Most recent year on top; colours comparable across the whole record. */
export function Calendar({ calendar, mode = 'count', ramp = 'ember', years, numbers = true, compact = false, legend = true, onCell }: Props) {
  const [tip, setTip] = useState<{ m: CalendarMonth; x: number; y: number } | null>(null);
  const r = RAMPS[ramp] || RAMPS.ember;
  const rows = useMemo(() => (years ? calendar.slice(-years) : calendar).slice().reverse(), [calendar, years]);
  const breaks = useMemo(
    () => quantileBreaks(rows.flatMap((y) => y.months.filter((m): m is CalendarMonth => !!m && !m.partial).map((m) => m.value || 0)), r.colors.length - 1),
    [rows, r.colors.length],
  );

  const colorFor = (m: CalendarMonth): string | null => {
    if (mode === 'anomaly') return m.anomalyPct == null ? null : DIVERGING.colors[classify(m.anomalyPct, DIVERGING.breaks)];
    if (!m.value) return '#f7f6f2';
    return r.colors[Math.min(r.colors.length - 1, classify(m.value, breaks) + 1)];
  };
  const showNum = numbers && !compact;
  const move = (e: MouseEvent, m: CalendarMonth) => {
    const x = Math.min(e.clientX + 14, window.innerWidth - 230);
    const y = e.clientY + 140 > window.innerHeight ? e.clientY - 130 : e.clientY + 16;
    setTip({ m, x, y });
  };

  return (
    <>
      <div className="cal-wrap">
        <table className={`cal${compact ? ' compact' : ''}`} role="grid" aria-label="Fire calendar: harmonized hotspots per month">
          <thead>
            <tr><th />{MONTHS.map((m) => <th key={m} scope="col">{compact ? m[0] : m}</th>)}{!compact && <th scope="col" style={{ textAlign: 'right' }}>Year</th>}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              // The rule above 2011 marks where the record switches from calibrated MODIS to VIIRS.
              <tr key={row.year} className={row.year === 2011 && !compact ? 'era-break' : undefined}
                title={row.year === 2011 && !compact ? 'Below this line: MODIS rescaled to VIIRS level' : undefined}>
                <th className="yr" scope="row">{row.year}</th>
                {row.months.map((m, i) => {
                  if (!m) return <td key={i} className="empty" aria-label="no data" />;
                  const c = colorFor(m);
                  if (!c) return <td key={i} className={`empty${m.partial ? ' partial' : ''}`} title={`${MONTHS[i]} ${row.year}: ${fmt(m.value)} (in progress)`} />;
                  const label = mode === 'anomaly' ? (m.anomalyPct == null ? '' : pct(m.anomalyPct)) : fmtCompact(m.value);
                  return (
                    <td key={i} className={m.partial ? 'partial' : undefined}
                      style={{ background: c, color: textOn(c), cursor: onCell ? 'pointer' : undefined }}
                      aria-label={`${MONTHS[i]} ${row.year}: ${fmt(m.value)} hotspots${m.anomalyPct != null ? `, ${pct(m.anomalyPct)} vs average` : ''}`}
                      onMouseEnter={(e) => move(e, m)} onMouseMove={(e) => move(e, m)} onMouseLeave={() => setTip(null)}
                      onClick={onCell ? () => onCell(m) : undefined}>
                      {showNum ? label : ''}
                    </td>
                  );
                })}
                {!compact && <td className="tot">{fmtCompact(row.total)}{row.complete || row.total == null ? '' : '*'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {legend && !compact && (
        <div className="mt">
          {mode === 'anomaly' ? (
            <div className="legend-ramp"><span>Quieter</span><div className="sw">{DIVERGING.colors.map((c) => <span key={c} style={{ background: c }} />)}</div><span>Busier than usual</span><span className="muted">(grey = within ±10%)</span></div>
          ) : (
            <div className="legend-ramp"><span>Fewer</span>
              <div className="sw"><span style={{ background: '#f7f6f2', border: '1px solid #e1e0d9' }} />{r.colors.slice(1).map((c, i) => <span key={c} style={{ background: c }} title={`≥ ${fmt([0, ...breaks][i])}`} />)}</div>
              <span>More hotspots</span>{breaks.length > 0 && <span className="muted">({fmt(breaks[0])} → {fmt(breaks[breaks.length - 1])}+)</span>}
            </div>
          )}
        </div>
      )}
      {tip && (
        <div role="tooltip" className="cal-tip" style={{ left: tip.x, top: tip.y }}>
          <strong>{monthLabel(tip.m.month)}{tip.m.partial ? ' (so far)' : ''}</strong>
          <div className="tip-row"><span>Harmonized hotspots</span><b>{fmt(tip.m.value, 1)}</b></div>
          {tip.m.anomalyPct != null && <div className="tip-row"><span>vs usual</span><b>{pct(tip.m.anomalyPct)}</b></div>}
          {tip.m.pctRank != null && <div className="tip-row"><span>Busier than</span><b>{fmt(tip.m.pctRank)}% of years</b></div>}
          <div className="muted small">
            {isModisOnly(tip.m.method)
              ? `Estimated from MODIS, rescaled to VIIRS level${tip.m.uncertaintyPct != null ? ` (typical error ±${tip.m.uncertaintyPct}%)` : ''}`
              : `Measured by ${tip.m.method}`}
          </div>
        </div>
      )}
    </>
  );
}
