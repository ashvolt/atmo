import uPlot from 'uplot';
import { h } from './dom';
import { LF, N_LEV_FIELDS } from '../physics/em/dynamics';

export interface LevRunData {
  samples: Float64Array;
  count: number;
  duration: number;
}

type Tab = 'motion' | 'attitude' | 'field' | 'energy';

const TABS: { id: Tab; label: string }[] = [
  { id: 'motion', label: 'Height & excursion' },
  { id: 'attitude', label: 'Tilt & spin' },
  { id: 'field', label: 'Field & force' },
  { id: 'energy', label: 'Energy conservation' },
];

/**
 * Charts for a six-degree-of-freedom levitation run.
 *
 * The energy tab is the interesting one: with damping switched off the total
 * energy must be flat, and any visible drift would mean the force and the
 * torque disagree. It is a correctness display as much as a result.
 */
export class LevCharts {
  private host: HTMLElement;
  private tabs: HTMLElement;
  private plot: uPlot | null = null;
  private tab: Tab = 'motion';
  private run: LevRunData | null = null;
  private cursorT = 0;
  onSeek: ((t: number) => void) | null = null;

  constructor(root: HTMLElement) {
    this.tabs = h('div', { class: 'chart-tabs' });
    this.host = h('div', { class: 'chart-host' });
    root.append(this.tabs, this.host);
    for (const t of TABS) {
      const b = h('button', { onclick: () => { this.tab = t.id; this.render(); } }, t.label);
      b.dataset.id = t.id;
      this.tabs.append(b);
    }
    new ResizeObserver(() => this.resize()).observe(this.host);
  }

  get root() {
    return this.tabs.parentElement!;
  }

  setRun(run: LevRunData | null) {
    this.run = run;
    this.render();
  }

  setCursor(t: number) {
    this.cursorT = t;
    this.plot?.redraw(false, false);
  }

  private resize() {
    const w = this.host.clientWidth, hh = this.host.clientHeight;
    if (this.plot && w > 0 && hh > 0) this.plot.setSize({ width: w, height: hh - 26 });
  }

  private col(f: number, map: (v: number) => number = (v) => v): number[] {
    const r = this.run!;
    return Array.from({ length: r.count }, (_, i) => map(r.samples[i * N_LEV_FIELDS + f]));
  }

  private render() {
    for (const b of this.tabs.children) (b as HTMLElement).classList.toggle('on', (b as HTMLElement).dataset.id === this.tab);
    this.plot?.destroy();
    this.plot = null;
    this.host.innerHTML = '';
    if (!this.run || this.run.count < 2) return;
    const t = this.col(LF.t);
    const series: { label: string; stroke: string; values: number[]; scale?: string; dash?: number[] }[] = [];
    const axes: uPlot.Axis[] = [{ stroke: '#8b9ab5', grid: { stroke: 'rgba(140,180,255,0.07)' }, ticks: { stroke: 'rgba(140,180,255,0.1)' }, values: (_u, v) => v.map((x) => `${+x.toFixed(2)} s`) }];
    const scales: uPlot.Scales = { x: { time: false } };
    const axis = (scale: string, label: string, side = 3) => {
      axes.push({ scale, label, side, stroke: '#8b9ab5', grid: { show: side === 3, stroke: 'rgba(140,180,255,0.07)' }, ticks: { stroke: 'rgba(140,180,255,0.1)' }, size: 64, labelSize: 14, labelFont: '11px Inter', font: '10px JetBrains Mono' });
      scales[scale] = {};
    };
    switch (this.tab) {
      case 'motion':
        axis('y', 'height [mm]');
        axis('r', 'horizontal offset [mm]', 1);
        series.push({ label: 'height', stroke: '#5cc8ff', values: this.col(LF.z, (v) => v * 1000), scale: 'y' });
        series.push({ label: 'x', stroke: '#ffb547', values: this.col(LF.x, (v) => v * 1000), scale: 'r', dash: [4, 3] });
        series.push({ label: 'y', stroke: '#c084fc', values: this.col(LF.y, (v) => v * 1000), scale: 'r', dash: [2, 3] });
        break;
      case 'attitude':
        axis('y', 'tilt from vertical [°]');
        axis('r', 'spin [rev/s]', 1);
        series.push({ label: 'tilt', stroke: '#ffb547', values: this.col(LF.tilt), scale: 'y' });
        series.push({ label: 'spin', stroke: '#4ade80', values: this.col(LF.spinRps), scale: 'r', dash: [4, 3] });
        series.push({ label: 'precession', stroke: '#c084fc', values: this.col(LF.precessHz), scale: 'r', dash: [2, 3] });
        break;
      case 'field':
        axis('y', '|B| at the object [mT]');
        axis('r', 'net force [mN]', 1);
        series.push({ label: '|B|', stroke: '#5cc8ff', values: this.col(LF.bmag, (v) => v * 1000), scale: 'y' });
        series.push({ label: 'force', stroke: '#f87171', values: this.col(LF.force, (v) => v * 1000), scale: 'r', dash: [4, 3] });
        break;
      case 'energy': {
        axis('y', 'total energy drift [parts in 10⁹]');
        const e = this.col(LF.energy);
        const e0 = e[0] || 1;
        series.push({ label: 'drift', stroke: '#4ade80', values: e.map((v) => ((v - e0) / Math.abs(e0)) * 1e9), scale: 'y' });
        break;
      }
    }
    const self = this;
    const opts: uPlot.Options = {
      width: this.host.clientWidth || 600,
      height: Math.max((this.host.clientHeight || 160) - 26, 80),
      scales, axes,
      legend: { live: true },
      cursor: { drag: { x: true, y: false }, points: { size: 6 } },
      series: [{ label: 't', value: (_u, v) => (v == null ? '' : `${+v.toFixed(3)} s`) },
        ...series.map((s) => ({ label: s.label, stroke: s.stroke, width: 2, dash: s.dash, scale: s.scale, points: { show: false } }))],
      hooks: {
        ready: [(u) => {
          u.over.addEventListener('click', () => {
            const x = u.cursor.left;
            if (x !== undefined && x >= 0) self.onSeek?.(u.posToVal(x, 'x'));
          });
        }],
        draw: [(u) => {
          const x = u.valToPos(self.cursorT, 'x', true);
          const ctx = u.ctx;
          ctx.save();
          ctx.strokeStyle = 'rgba(255,196,107,0.9)';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, u.bbox.top);
          ctx.lineTo(x, u.bbox.top + u.bbox.height);
          ctx.stroke();
          ctx.restore();
        }],
      },
    };
    this.plot = new uPlot(opts, [t, ...series.map((s) => s.values)] as uPlot.AlignedData, this.host);
  }
}
