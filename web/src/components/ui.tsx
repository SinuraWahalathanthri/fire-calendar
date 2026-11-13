// Small presentational pieces used across pages.
import type { ReactNode } from 'react';
import type { Risk } from '../api/types';
import { pct } from '../lib/format';

const RISK_ICON: Record<number, ReactNode> = {
  0: <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  1: <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2" />,
  2: <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="2" />,
  3: <><path d="M8 2l6.5 12h-13z" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M8 6.5v3.5M8 12v.5" stroke="currentColor" strokeWidth="1.8" /></>,
  4: <><path d="M8 1.5l6.5 12.5h-13z" fill="currentColor" /><path d="M8 6v4M8 11.6v.6" stroke="#fff" strokeWidth="1.8" /></>,
  5: <path d="M8 1c1 3 5 4.5 5 8.5a5 5 0 0 1-10 0c0-2 1.2-3.4 2-4 0 1.5.8 2.3 1.6 2.3C6.6 5.6 6.3 3.2 8 1z" fill="currentColor" />,
};

/** Status always carries an icon and a word, never colour alone. */
export function RiskBadge({ risk, big = false }: { risk?: Risk | null; big?: boolean }) {
  const code = risk?.code ?? 0;
  const size = big ? 18 : 14;
  return (
    <span className={`risk risk-${code}${big ? ' big' : ''}`}>
      <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">{RISK_ICON[code]}</svg>
      {risk?.level || 'Unknown'}
    </span>
  );
}

/** More fire = worse, so "up" is styled as a warning; the arrow carries direction for colour-blind users. */
export function Delta({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="muted">—</span>;
  const up = value > 0;
  return <span className={`delta ${up ? 'up' : 'down'}`}>{up ? '▲' : value < 0 ? '▼' : '■'} {pct(value)}</span>;
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return <div className="loading"><span className="spinner" />{text}</div>;
}

export function Card({ title, hint, actions, children, className = '', flush = false }: {
  title?: ReactNode; hint?: ReactNode; actions?: ReactNode; children?: ReactNode; className?: string; flush?: boolean;
}) {
  return (
    <section className={`card${flush ? ' flush' : ''} ${className}`}>
      {(title || actions || hint) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {hint && !actions && <span className="hint">{hint}</span>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Fact({ k, v, sub }: { k: ReactNode; v: ReactNode; sub?: ReactNode }) {
  return <div className="fact"><div className="k">{k}</div><div className="v">{v}</div>{sub && <div className="small muted">{sub}</div>}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  return <div className="callout warn">Could not load data: {error instanceof Error ? error.message : String(error)}</div>;
}
