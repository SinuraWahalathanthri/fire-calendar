import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DatasetInfo } from '../api/types';
import { useStatus } from '../state/AppState';
import { fmt, monthLabel, durationText } from '../lib/format';

const monthYear = (d: string | null | undefined) => (d ? monthLabel(d.slice(0, 7)) : '—');

/**
 * Progress of the one-time NASA FIRMS history download for an area. Polls status (every 30 s via
 * the shared status query), and offers to redraw charts with the data loaded so far.
 */
export function BackfillBanner({ dataset, areaLabel }: { dataset: DatasetInfo; areaLabel: string }) {
  const qc = useQueryClient();
  const status = useStatus();
  const live = status.data?.datasets.find((d) => d.id === dataset.id) || dataset;
  const wasLoading = useRef(dataset.status === 'backfilling');
  const [dismissed, setDismissed] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['analysis'] });

  useEffect(() => { if (live.status === 'backfilling') wasLoading.current = true; }, [live.status]);

  if (live.status !== 'backfilling') {
    if (!wasLoading.current || dismissed) return null;
    return (
      <div className="callout info bf">
        <div className="row"><b>✓ Fire history complete for {areaLabel}</b><span className="spacer" />
          <button className="btn sm primary" onClick={() => { setDismissed(true); refresh(); }}>Show full history</button></div>
        <div className="small">{fmt(live.detections)} detections from {monthYear(live.firstDate)} to today. Calendar, comparisons and outlook now use the full record.</div>
      </div>
    );
  }

  const b = live.backfill || { percent: 0, oldest: live.firstDate, target: '2000-11-01', etaMinutes: 0, paused: false, done: 0, total: 0 };
  const t0 = Date.parse(b.target), now = Date.now();
  const from = b.oldest ? Math.min(Math.max(Date.parse(b.oldest), t0), now) : now;
  const havePct = ((now - from) / (now - t0)) * 100;
  const yearsHave = (now - from) / (365.25 * 864e5);
  return (
    <div className="callout info bf" role="status" aria-live="polite">
      <div className="row"><b>Loading fire history: {b.percent}%</b><span className="small">· have {monthYear(b.oldest)} → today</span><span className="spacer" />
        <button className="btn sm" onClick={refresh} title="Redraw the charts with the data downloaded so far">Update charts</button></div>
      <div className="bf-track" aria-hidden="true"><span className="bf-have" style={{ left: `${(100 - havePct).toFixed(1)}%` }} /></div>
      <div className="bf-status small">
        <span className="bf-state live" aria-hidden="true" />
        {/* At NASA's request limit the download runs in bursts, so show pace and time left, not a countdown. */}
        <span>Downloading newest years first{b.paused ? ", at NASA's request limit (short pauses between batches)" : ''}{b.etaMinutes ? ` · about ${durationText(b.etaMinutes)} to go` : ''}.</span>
      </div>
      <details>
        <summary className="small">What can I rely on right now?</summary>
        <div className="bf-grid small">
          <div><b>Ready now</b><br />Live map, 24-hour and 7-day counts, alerts.</div>
          <div><b>Provisional until done</b><br />Calendar, comparisons with "usual", status level and outlook. They currently use {yearsHave < 1 ? 'less than a year' : `${yearsHave.toFixed(1)} years`} of history instead of 25+.</div>
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>{fmt(live.detections)} detections · {fmt(b.done)} of {fmt(b.total)} five-day downloads from NASA FIRMS, {monthYear(b.target)} onwards. Saved on the server, so this only happens once.</div>
      </details>
    </div>
  );
}
