import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import L from '../lib/leaflet';
import { getGlobal } from '../api/client';
import { useApp } from '../state/AppState';
import { fmt, ago } from '../lib/format';
import { Card, ErrorBox, Loading, Segmented } from '../components/ui';
import { MapView, FastLayer } from '../components/MapView';

export default function World() {
  const [hours, setHours] = useState<24 | 48>(24);
  const [q, setQ] = useState('');
  const { setAOI } = useApp();
  const nav = useNavigate();
  const { data, error } = useQuery({ queryKey: ['global', hours], queryFn: () => getGlobal(hours), refetchInterval: (q) => (q.state.data && !q.state.data.updatedAt ? 10_000 : 5 * 60_000) });
  const key = hours === 48 ? 'last48h' : 'last24h';
  const rows = useMemo(() => (data?.countries || [])
    .filter((c) => c.id && (!q || c.country.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b[key] - a[key]).slice(0, 120), [data, q, key]);
  const max = Math.max(1, ...rows.map((r) => r[key]));
  const open = (country: string) => { setAOI({ kind: 'country', country, label: country }); nav('/dashboard'); };

  return (
    <>
      <div className="page-head">
        <div><h1>World</h1>
          <div className="sub">{data && data.status === 'loading' && !data.updatedAt ? 'Fetching worldwide detections from NASA FIRMS… this takes a minute after the server starts.' : data ? <>{fmt(data.total)} detections in the last {hours} h · updated {ago(data.updatedAt)}{data.mode === 'demo' ? <> · <b>demo data</b></> : ' · NASA FIRMS near-real-time'}</> : 'Satellite fire detections worldwide.'}</div></div>
        <Segmented label="Time window" value={hours} onChange={setHours} options={[{ value: 24, label: 'Last 24 h' }, { value: 48, label: 'Last 48 h' }]} />
      </div>
      {error && <ErrorBox error={error} />}
      <div className="grid g-main">
        <Card flush>
          <MapView label="Worldwide fire detections" center={[10, 20]} zoom={2} minZoom={2} size="tall"
            legend={<><b>Detections</b><div><i style={{ background: '#ec7a45' }} />VIIRS (375 m)</div><div><i style={{ background: '#1baf7a' }} />MODIS (1 km)</div><div className="small">Size = fire intensity</div></>}>
            {data && <FastLayer items={data.points} make={([la, lo, viirs, f], renderer) => L.circleMarker([la, lo], { renderer, radius: Math.min(5, 1.5 + Math.sqrt(f || 1) / 4), stroke: false, fillColor: viirs ? '#ec7a45' : '#1baf7a', fillOpacity: 0.75, interactive: false })} />}
          </MapView>
        </Card>
        <Card title="Countries by activity" hint="fire cell-days (same for any sensor)">
          <input type="search" className="input" placeholder="Filter countries…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
          {!data ? <Loading /> : (
            <div className="table-wrap" style={{ maxHeight: 470 }}>
              <table className="data">
                <thead><tr><th>#</th><th>Country</th><th>Detections</th><th className="num">VIIRS / MODIS</th><th /></tr></thead>
                <tbody>{rows.length ? rows.map((r, i) => (
                  <tr key={r.country}><td className="muted">{i + 1}</td><td><b>{r.country}</b></td>
                    <td><div className="bar-cell"><span className="bar" style={{ width: `${(r[key] / max) * 80}px` }} /><span className="tnum">{fmt(r[key])}</span></div></td>
                    <td className="num small muted">{fmt(r.viirs)} / {fmt(r.modis)}</td>
                    <td><button className="btn sm" onClick={() => open(r.country)}>Analyse</button></td></tr>
                )) : <tr><td colSpan={5} className="muted">No countries match</td></tr>}</tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      <div className="callout info mt"><b>Analyse</b> opens a country's dashboard. Province/state boundaries come from geoBoundaries; the first time a country is opened, its fire history downloads in the background (Sri Lanka-sized countries take about an hour, very large ones need the FIRMS archive import).</div>
    </>
  );
}
