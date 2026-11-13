import { useState, type ReactNode } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { useApp, useStatus } from '../state/AppState';
import { ago } from '../lib/format';
import { AreaPicker } from './AreaPicker';

const NAV = [
  ['/dashboard', 'Dashboard'], ['/explore', 'Explore'], ['/global', 'World'], ['/outlook', 'Outlook'],
  ['/reports', 'Reports'], ['/method', 'Method'], ['/integrate', 'Integrate'],
] as const;

function LivePill() {
  const { data, isError } = useStatus();
  if (isError) return <span className="live-pill" title="Server unreachable"><span className="dot" /><span id="liveText">Offline</span></span>;
  if (!data) return <span className="live-pill"><span className="dot" /><span id="liveText">Connecting…</span></span>;
  const p = data.primary;
  const text = data.mode === 'demo' ? 'Demo feed'
    : p.status === 'backfilling' ? `Loading history ${p.backfill?.percent ?? 0}%`
      : `Live · ${ago(p.lastPoll || p.updatedAt)}`;
  return (
    <span className={`live-pill ${data.mode === 'live' ? 'ok' : 'demo'}`}
      title={`${data.mode === 'demo' ? 'Synthetic demo data' : 'NASA FIRMS near-real-time'}, checked every ${data.pollMinutes} min. Last check: ${p.lastPoll || 'pending'}`}>
      <span className="dot" /><span id="liveText">{text}</span>
    </span>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { aoi, setPickerOpen, toasts } = useApp();
  const { data: status } = useStatus();
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
      <a className="skip" href="#view">Skip to content</a>
      <header className="topbar">
        <Link className="brand" to="/dashboard" aria-label="Fire Calendar home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="28" height="28"><rect width="32" height="32" rx="8" fill="#c2410c" /><path d="M16 6c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-3-1-6 1-9z" fill="#fff" /></svg>
          </span>
          <span className="brand-text"><strong>Fire Calendar</strong><small>Harmonized MODIS + VIIRS</small></span>
        </Link>
        <nav className={`nav${menuOpen ? ' open' : ''}`} aria-label="Main">
          {NAV.map(([to, label]) => <NavLink key={to} to={to} onClick={() => setMenuOpen(false)}>{label}</NavLink>)}
        </nav>
        <div className="topbar-right">
          <button className="aoi-chip" type="button" aria-haspopup="dialog" title="Change area" onClick={() => setPickerOpen(true)}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z" fill="currentColor" /></svg>
            <span>{aoi.label}</span>
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M7 10l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
          </button>
          <LivePill />
          <button className="menu-btn" aria-label="Open menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
            <svg viewBox="0 0 24 24" width="22" height="22"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" /></svg>
          </button>
        </div>
      </header>
      {status?.mode === 'demo' && (
        <div className="demo-banner">
          <strong>Demo data.</strong> No NASA FIRMS MAP_KEY is set, so the hotspots shown are <em>synthetic</em> and only demonstrate the method.
          Add <code>FIRMS_MAP_KEY</code> to <code>.env</code> for live NASA data. <Link to="/integrate">How</Link>
        </div>
      )}
      <main id="view" tabIndex={-1}>{children}</main>
      <footer className="footer">
        <div>Data: NASA FIRMS, MODIS Collection 6.1 (Terra, Aqua) and VIIRS 375 m (S-NPP, NOAA-20, NOAA-21) active fire products.
          Boundaries: Natural Earth, geoBoundaries, OpenStreetMap. A hotspot is a heat anomaly; not every detection is a wildfire.</div>
        <div><a href="https://www.earthdata.nasa.gov/data/tools/firms" target="_blank" rel="noopener">About FIRMS</a> · <Link to="/method">Method</Link> · <Link to="/integrate">API</Link></div>
      </footer>
      <AreaPicker />
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className="toast" role="status"><strong>{t.title}</strong>{t.body && <div className="muted">{t.body}</div>}</div>)}
      </div>
    </>
  );
}
