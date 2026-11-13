import type { RegionRow } from '../api/types';
import { fmt } from '../lib/format';
import { Delta } from './ui';

/**
 * Districts / provinces table. In an active week it ranks by recent detections; in a quiet week
 * it ranks by normal-year burning and shows each area's peak month, which is what matters for
 * preparedness.
 */
export function RegionTable({ rows, title, note, kindLabel, selected, onSelect }: {
  rows: RegionRow[]; title: string; note?: React.ReactNode; kindLabel: string; selected?: string; onSelect?: (name: string) => void;
}) {
  const anyRecent = rows.some((r) => r.last7d > 0);
  const top = (anyRecent ? rows : rows.slice().sort((a, b) => (b.annualAverage || 0) - (a.annualAverage || 0))).slice(0, 8);
  const max = Math.max(1, ...top.map((r) => (anyRecent ? r.last7d : r.annualAverage) || 0));
  const bar = (v: number) => (
    <td><div className="bar-cell"><span className="bar" style={{ width: `${((v || 0) / max) * 70}px` }} /><span className="tnum">{fmt(v)}</span></div></td>
  );
  return (
    <>
      <div className="card-head"><h2>{title}</h2><span className="hint">{anyRecent ? 'ranked by detections, last 7 days' : 'quiet week · ranked by normal-year burning'}</span></div>
      <div className="table-wrap">
        <table className="data compact-table">
          <thead>
            <tr><th>{kindLabel}</th>
              {anyRecent
                ? <><th>Last 7 days</th><th className="num" title="Harmonized hotspots so far this month">This month</th><th className="num">vs. usual</th><th className="hide-sm">Peak</th></>
                : <><th>Usual per year</th><th>Peak month</th><th className="num hide-sm">This month</th></>}
            </tr>
          </thead>
          <tbody>
            {top.map((r) => (
              <tr key={r.district} className={onSelect ? 'clickable' : undefined} tabIndex={onSelect ? 0 : undefined}
                style={selected === r.district ? { background: 'var(--brand-wash)' } : undefined}
                onClick={onSelect ? () => onSelect(r.district) : undefined}
                onKeyDown={onSelect ? (e) => { if (e.key === 'Enter') onSelect(r.district); } : undefined}>
                <td><b>{r.district}</b>{r.province && <div className="small muted">{r.province}</div>}</td>
                {anyRecent ? (
                  <>{bar(r.last7d)}<td className="num">{fmt(r.monthToDate)}</td><td className="num"><Delta value={r.vsMedianPct} /></td><td className="hide-sm">{r.peakMonth || '—'}</td></>
                ) : (
                  <>{bar(r.annualAverage)}<td>{r.peakMonth || '—'}</td><td className="num hide-sm">{fmt(r.monthToDate)}</td></>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <div className="small muted mt">{note}</div>}
    </>
  );
}
