import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler, Tooltip,
  BarController, LineController, ScatterController, type ChartData, type ChartOptions, type ChartType,
} from 'chart.js';
import { Chart } from 'react-chartjs-2';
import type { SeasonalMonth } from '../api/types';
import { MONTHS, fmt } from '../lib/format';
import { SERIES } from '../lib/colors';

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Filler, Tooltip, BarController, LineController, ScatterController);

// Global look. Only individual properties are changed: replacing whole default objects (e.g.
// `animation`) strips Chart.js's internal interpolators and breaks updates.
const D = ChartJS.defaults;
D.font.family = 'system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif';
D.font.size = 12;
D.color = '#52514e';
D.borderColor = SERIES.grid;
if (D.animation) D.animation.duration = 300;
D.maintainAspectRatio = false;
// The Legend plugin is deliberately not registered: accessible HTML legends are rendered instead.
Object.assign(D.plugins.tooltip, {
  backgroundColor: '#ffffff', titleColor: '#0b0b0b', bodyColor: '#52514e', footerColor: '#52514e', borderColor: '#e1e0d9', borderWidth: 1,
  padding: 10, cornerRadius: 8, boxPadding: 4, usePointStyle: true, mode: 'index', intersect: false,
});
D.interaction.mode = 'index';
D.interaction.intersect = false;
D.elements.line.borderWidth = 2;
D.elements.point.radius = 0;
D.elements.point.hoverRadius = 5;
D.elements.bar.borderRadius = 3;

/** Applies the shared axis styling (recessive grid, no vertical gridlines). */
function styleScales(options: Record<string, unknown>): Record<string, unknown> {
  const scales = (options.scales || {}) as Record<string, Record<string, unknown>>;
  for (const k of Object.keys(scales)) {
    const s = scales[k];
    s.grid = { color: SERIES.grid, drawTicks: false, ...(k === 'x' ? { display: false } : {}), ...((s.grid as object) || {}) };
    s.border = { color: SERIES.axis, ...((s.border as object) || {}) };
    s.ticks = { padding: 6, ...((s.ticks as object) || {}) };
  }
  return options;
}

export function ChartBox<T extends ChartType>({ type, data, options, height = 'normal', label }: {
  type: T; data: ChartData<T>; options?: ChartOptions<T>; height?: 'short' | 'normal' | 'tall'; label?: string;
}) {
  return (
    <div className={`chart${height === 'normal' ? '' : ` ${height}`}`} role="img" aria-label={label}>
      <Chart type={type} data={data as ChartData<ChartType>} options={styleScales({ ...((options || {}) as Record<string, unknown>) }) as ChartOptions<ChartType>} />
    </div>
  );
}

export interface LegendItem { label: string; color: string; type?: 'box' | 'band' }
export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="chart-legend">
      {items.map((i) => <span key={i.label}><i className={i.type || ''} style={{ background: i.color }} />{i.label}</span>)}
    </div>
  );
}

type BandDataset = { band?: boolean };

/**
 * This year's months as bars against the usual range for each month. Shared by the dashboard,
 * Explore and the report so they always match.
 */
export function SeasonChart({ seasonal, previous = false, animate = true }: { seasonal: SeasonalMonth[]; previous?: boolean; animate?: boolean }) {
  const y = new Date().getUTCFullYear();
  const curM = new Date().getUTCMonth();
  const s = seasonal;
  const hasHistory = s.some((m) => (m.p90 || 0) > 0);
  const datasets: Record<string, unknown>[] = [];
  if (hasHistory) {
    datasets.push({ type: 'line', label: 'Usual high', data: s.map((m) => m.p90), borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, backgroundColor: 'rgba(42,120,214,0.13)', fill: '+1', cubicInterpolationMode: 'monotone', order: 5, band: true });
    datasets.push({ type: 'line', label: 'Usual low', data: s.map((m) => m.p10), borderWidth: 0, pointRadius: 0, pointHoverRadius: 0, fill: false, cubicInterpolationMode: 'monotone', order: 5, band: true });
    datasets.push({ type: 'line', label: 'Median', data: s.map((m) => m.median), borderColor: SERIES.ink, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, cubicInterpolationMode: 'monotone', order: 2 });
  }
  if (previous) datasets.push({ type: 'line', label: String(y - 1), data: s.map((m) => m.previous), borderColor: SERIES.viirs, borderWidth: 2, pointRadius: 2.5, cubicInterpolationMode: 'monotone', order: 1 });
  datasets.push({
    type: 'bar', label: String(y), data: s.map((m, i) => (i <= curM ? m.current : null)), order: 3, maxBarThickness: 26, borderRadius: 3,
    // The current (incomplete) month is lighter so it is not read as a finished value.
    backgroundColor: s.map((_, i) => (i === curM ? 'rgba(42,120,214,0.45)' : SERIES.harmonized)),
  });
  return (
    <ChartBox
      type="bar"
      label={`Harmonized hotspots per month in ${y} compared with the usual range`}
      data={{ labels: MONTHS, datasets } as unknown as ChartData<'bar'>}
      options={{
        animation: animate ? undefined : false,
        scales: {
          y: { beginAtZero: true, ticks: { maxTicksLimit: 6, precision: 0 } },
          x: { ticks: { maxRotation: 0, autoSkip: false } },
        },
        plugins: {
          tooltip: {
            filter: (item) => !(item.dataset as BandDataset).band,
            callbacks: {
              title: (items) => MONTHS[items[0].dataIndex],
              label: (item) => ` ${item.dataset.label}: ${fmt(item.raw as number)}${item.dataset.type === 'bar' && item.dataIndex === curM ? ' (so far)' : ''}`,
              footer: (items) => { const m = s[items[0].dataIndex]; return hasHistory && m.p10 != null ? `Usual range ${fmt(m.p10)}–${fmt(m.p90)}` : ''; },
            },
          },
        },
      }}
    />
  );
}
