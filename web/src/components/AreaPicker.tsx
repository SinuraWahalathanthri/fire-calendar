import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { AOI } from '../api/types';
import { getRegions } from '../api/client';
import { useApp } from '../state/AppState';

interface Item { group: string; label: string; sub: string; aoi: AOI }
const QUICK = ['Sri Lanka', 'Uva Province', 'Anuradhapura District', 'Monaragala District', 'India', 'Australia', 'Brazil', 'Indonesia'];

/** Search-as-you-type area chooser: countries, Sri Lanka provinces/districts, parks. Keyboard friendly. */
export function AreaPicker() {
  const { pickerOpen, setPickerOpen, setAOI } = useApp();
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const { data: r } = useQuery({ queryKey: ['regions'], queryFn: getRegions, staleTime: Infinity, enabled: pickerOpen });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (pickerOpen && !d.open) { d.showModal(); setQ(''); setSel(0); }
    if (!pickerOpen && d.open) d.close();
  }, [pickerOpen]);

  const items = useMemo<Item[]>(() => !r ? [] : [
    { group: 'Country', label: 'Sri Lanka', sub: 'Whole island · 25 districts', aoi: { kind: 'country', country: 'Sri Lanka' } },
    ...r.sriLanka.provinces.map((p): Item => ({ group: 'Province', label: `${p} Province`, sub: 'Sri Lanka', aoi: { kind: 'province', province: p } })),
    ...r.sriLanka.districts.map((d): Item => ({ group: 'District', label: `${d.name} District`, sub: `${d.province} Province`, aoi: { kind: 'district', district: d.name } })),
    ...r.hotZones.map((z): Item => ({ group: 'Park / fire-prone area', label: z.name, sub: `${z.radius_km} km radius`, aoi: { kind: 'circle', lat: z.lat, lon: z.lon, radius_km: z.radius_km, label: z.name } })),
    ...r.countries.filter((c) => c.name !== 'Sri Lanka').map((c): Item => ({ group: 'Country', label: c.name, sub: 'Country', aoi: { kind: 'country', country: c.name } })),
  ], [r]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? items.filter((i) => i.label.toLowerCase().includes(s) || i.sub.toLowerCase().includes(s)) : items).slice(0, 80);
  }, [items, q]);

  const choose = (i: Item) => { setAOI({ ...i.aoi, label: i.label }); setPickerOpen(false); };

  return (
    <dialog ref={ref} className="dialog" aria-labelledby="aoiDialogTitle" onClose={() => setPickerOpen(false)}>
      <div className="dialog-inner">
        <div className="dialog-head">
          <h2 id="aoiDialogTitle">Choose an area</h2>
          <button className="icon-btn" aria-label="Close" onClick={() => setPickerOpen(false)}>✕</button>
        </div>
        <input type="search" className="input" autoFocus autoComplete="off" value={q}
          placeholder="Search a country, Sri Lanka district, province or park…"
          onChange={(e) => { setQ(e.target.value); setSel(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(shown.length - 1, s + 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
            else if (e.key === 'Enter' && shown[sel]) { e.preventDefault(); choose(shown[sel]); }
          }} />
        <div className="aoi-quick">
          {QUICK.map((name) => <button key={name} type="button" className="chip" onClick={() => { const it = items.find((i) => i.label === name); if (it) choose(it); }}>{name}</button>)}
        </div>
        <ul className="aoi-results" role="listbox">
          {!r && <li>Loading…</li>}
          {r && !shown.length && <li>No matches</li>}
          {shown.map((i, k) => (
            <li key={`${i.group}-${i.label}`} role="option" aria-selected={k === sel} onMouseEnter={() => setSel(k)} onClick={() => choose(i)}>
              <span>{i.label}</span><small>{i.group} · {i.sub}</small>
            </li>
          ))}
        </ul>
        <p className="muted small">Need your own shape or coordinates? Use <Link to="/explore" onClick={() => setPickerOpen(false)}>Explore → Draw / Coordinates</Link>.</p>
      </div>
    </dialog>
  );
}
