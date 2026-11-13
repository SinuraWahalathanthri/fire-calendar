import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AlertRule } from '../api/types';
import { api, aoiQuery, getAlerts, getStatus } from '../api/client';
import { useApp } from '../state/AppState';
import { ago } from '../lib/format';
import { Card } from '../components/ui';

const RULE_LABEL: Record<AlertRule['type'], string> = { new_hotspots: 'New hotspots', count_24h: '24 h count ≥', anomaly: 'Anomaly ≥', protected_area: 'Inside park / reserve' };

export default function Integrate() {
  const { aoi, toast } = useApp();
  const o = location.origin;
  const q = aoiQuery(aoi).toString();
  const embed = `<iframe src="${o}/#/embed?${q}"\n  width="420" height="520" style="border:0"\n  title="Fire activity"></iframe>`;
  const endpoints: [string, string, string][] = [
    ['GET', `/api/v1/live?${q}&hours=24`, 'Latest detections (json | geojson | csv) with district names.'],
    ['GET', `/api/v1/analyze?${q}`, 'Everything: calendar, anomalies, trend, nowcast, outlook, districts, parks.'],
    ['GET', `/api/v1/calendar?${q}&format=csv`, 'Harmonized monthly calendar with anomalies and per-sensor counts.'],
    ['GET', `/api/v1/hotspots?${q}&start=2024-01-01&end=2024-12-31&format=csv`, 'Every detection with harmonized weights (csv | geojson | json).'],
    ['GET', `/api/v1/outlook?${q}`, 'Current-month nowcast and 6-month outlook with its track record.'],
    ['GET', '/api/v1/districts?format=csv', 'Sri Lanka 25-district table.'],
    ['GET', '/api/v1/global?hours=24', 'Worldwide detections and country ranking.'],
    ['GET', '/api/v1/alerts', 'Alert rules and recent alerts.'],
    ['POST', '/api/v1/alerts', 'Create an alert rule (Bearer token if API_TOKENS is set).'],
    ['DEL', '/api/v1/alerts/{id}', 'Delete an alert rule.'],
    ['POST', '/api/v1/import?source=MODIS_SP', 'Load a FIRMS archive CSV (body = CSV).'],
    ['GET', '/api/status', 'Health, data freshness, NASA usage, El Niño index.'],
  ];
  return (
    <>
      <div className="page-head"><div><h1>Connect your systems</h1>
        <div className="sub">Everything on screen is also available as data: a JSON/CSV API, alert feeds in CAP 1.2, GeoJSON and RSS, webhooks, and an embeddable widget. Runs as one Node.js process or Docker container, no database.</div></div></div>
      <div className="grid g-3">
        <Card title="1 · Run it">
          <p className="small muted">On any server with Node.js 18+ or Docker.</p>
          <pre>{'docker build -t fire-calendar .\ndocker run -d -p 8080:8080 \\\n  -e FIRMS_MAP_KEY=your_key \\\n  -v fire-data:/app/data fire-calendar'}</pre>
          <p className="small mt">Free MAP_KEY: <a href="https://firms.modaps.eosdis.nasa.gov/api/map_key/" target="_blank" rel="noopener">firms.modaps.eosdis.nasa.gov/api/map_key</a>. Without a key the app runs on clearly labelled demo data.</p>
        </Card>
        <Card title="2 · Subscribe to alerts">
          <p className="small muted">Standard formats your systems already read.</p>
          <ul className="list small">
            <li><span className="method">CAP</span><a href="/api/v1/feeds/alerts.cap.xml" target="_blank">{o}/api/v1/feeds/alerts.cap.xml</a></li>
            <li><span className="method">GEO</span><a href="/api/v1/feeds/alerts.geojson" target="_blank">{o}/api/v1/feeds/alerts.geojson</a></li>
            <li><span className="method">RSS</span><a href="/api/v1/feeds/alerts.rss" target="_blank">{o}/api/v1/feeds/alerts.rss</a></li>
            <li><span className="method">SSE</span><code>{o}/api/stream</code></li>
          </ul>
        </Card>
        <Card title="3 · Embed">
          <p className="small muted">Drop a live widget into an intranet page or operations dashboard.</p>
          <pre>{embed}</pre>
          <div className="row mt">
            <button className="btn sm" onClick={() => navigator.clipboard?.writeText(embed).then(() => toast('Embed code copied'))}>Copy</button>
            <a className="btn sm" href={`/#/embed?${q}`} target="_blank" rel="noopener">Preview</a>
          </div>
        </Card>
      </div>
      <div className="grid g-main mt">
        <Card title="REST API" hint="JSON by default · CORS enabled · examples use the current area">
          {endpoints.map(([m, p, d]) => (
            <div key={m + p} className="endpoint"><span className={`method${m === 'POST' ? ' post' : m === 'DEL' ? ' del' : ''}`}>{m}</span><div><code style={{ wordBreak: 'break-all' }}>{p}</code><div className="small muted">{d}</div></div></div>
          ))}
          <p className="small muted mt">Area parameters: <code>country=</code>, <code>district=</code>, <code>province=</code>, <code>bbox=w,s,e,n</code>, <code>lat=&amp;lon=&amp;radius_km=</code>, or POST a GeoJSON polygon. Optional <code>baseline=2003-2022</code>.</p>
          <pre className="mt">{`# Last 24 h of hotspots in Monaragala as GeoJSON\ncurl "${o}/api/v1/live?district=Monaragala&format=geojson"\n\n# Python\nimport requests\nr = requests.get("${o}/api/v1/outlook", params={"country": "Sri Lanka"}).json()\nprint(r["nowcast"]["risk"]["level"], r["nowcast"]["vsMedianPct"])`}</pre>
        </Card>
        <div className="stack">
          <Rules />
          <NewRule />
          <Card title="Configuration">
            <table className="data small"><tbody>
              <tr><td><code>FIRMS_MAP_KEY</code></td><td>NASA FIRMS key, enables live data</td></tr>
              <tr><td><code>POLL_MINUTES</code></td><td>Near-real-time check interval (default 15)</td></tr>
              <tr><td><code>API_TOKENS</code></td><td>Comma-separated tokens for write endpoints</td></tr>
              <tr><td><code>HISTORY_START</code></td><td>Start of record (default 2000-11-01)</td></tr>
              <tr><td><code>CALIB_START / CALIB_END</code></td><td>MODIS↔VIIRS overlap window</td></tr>
              <tr><td><code>PORT</code>, <code>DATA_DIR</code></td><td>Server port, storage folder</td></tr>
            </tbody></table>
            <StatusLine />
          </Card>
        </div>
      </div>
    </>
  );
}

function StatusLine() {
  const { data: s } = useQuery({ queryKey: ['status-integrate'], queryFn: getStatus });
  if (!s) return null;
  return <p className="small muted mt">Mode: {s.mode} · NASA requests: {s.firms.requests} (from cache {s.firms.cacheHits}) · started {ago(s.startedAt)}</p>;
}

function Rules() {
  const qc = useQueryClient();
  const { toast } = useApp();
  const { data } = useQuery({ queryKey: ['alerts', 'rules'], queryFn: () => getAlerts(1) });
  const del = async (id: string) => {
    if (!confirm('Delete this alert rule?')) return;
    const token = (document.getElementById('ruleToken') as HTMLInputElement | null)?.value;
    try {
      await api(`/api/v1/alerts/${id}`, { method: 'DELETE', headers: token ? { Authorization: `Bearer ${token}` } : {} });
      qc.invalidateQueries({ queryKey: ['alerts'] });
    } catch (e) { toast('Could not delete', (e as Error).message); }
  };
  return (
    <Card title="Alert rules" hint={data ? `${data.rules.length} active` : undefined}>
      <ul className="list">
        {!data && <li className="muted">Loading…</li>}
        {data?.rules.map((x) => (
          <li key={x.id}>
            <div style={{ flex: 1 }}><b>{x.name}</b>
              <div className="small muted">{RULE_LABEL[x.type]} {x.type === 'new_hotspots' || x.type === 'protected_area' ? '' : x.threshold}{x.type === 'anomaly' ? '%' : ''} · min confidence {['all', 'nominal', 'high'][x.minConfidence]}{x.webhook ? ' · webhook ✓' : ''}</div></div>
            <button className="btn sm ghost" aria-label={`Delete rule ${x.name}`} onClick={() => del(x.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function NewRule() {
  const { aoi, toast } = useApp();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: `${aoi.label} — new hotspots`, type: 'new_hotspots', threshold: '1', minConfidence: '1', token: '', webhook: '' });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/api/v1/alerts', {
        method: 'POST', headers: f.token ? { Authorization: `Bearer ${f.token}` } : {},
        body: JSON.stringify({ name: f.name, type: f.type, threshold: +f.threshold, minConfidence: +f.minConfidence, webhook: f.webhook, aoi }),
      });
      toast('Alert rule created', f.name);
      qc.invalidateQueries({ queryKey: ['alerts'] });
    } catch (err) { toast('Could not create rule', (err as Error).message); }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title={`New rule for “${aoi.label}”`}>
      <form className="fields" onSubmit={submit}>
        <label className="field">Name<input className="input" required value={f.name} onChange={set('name')} /></label>
        <div className="fields two">
          <label className="field">Trigger
            <select className="input" value={f.type} onChange={set('type')}>
              <option value="new_hotspots">New hotspots (each check)</option>
              <option value="count_24h">Detections in 24 h ≥ threshold</option>
              <option value="anomaly">Month projected ≥ X % above usual</option>
              <option value="protected_area">Hotspot inside a park or reserve (Sri Lanka)</option>
            </select></label>
          <label className="field">Threshold<input className="input" type="number" min={0} value={f.threshold} onChange={set('threshold')} /></label>
        </div>
        <div className="fields two">
          <label className="field">Min. confidence
            <select className="input" value={f.minConfidence} onChange={set('minConfidence')}><option value="1">Nominal + high</option><option value="2">High only</option><option value="0">All</option></select></label>
          <label className="field">API token (if required)<input id="ruleToken" className="input" type="password" autoComplete="off" value={f.token} onChange={set('token')} /></label>
        </div>
        <label className="field">Webhook URL (optional, receives a JSON POST)<input className="input" type="url" placeholder="https://ops.example.gov.lk/hooks/fire" value={f.webhook} onChange={set('webhook')} /></label>
        <button className="btn primary" type="submit">Create rule</button>
      </form>
    </Card>
  );
}
