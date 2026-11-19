import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { h } from './dom';
import { F, N_FIELDS, type SimResult } from '../physics/simulation';

export interface ChartRun {
  label: string;
  color: string;
  result: SimResult;
  vacuum: SimResult | null;
}

type Tab = 'alt' | 'speed' | 'accel' | 'mach' | 'thermal' | 'aero' | 'path';
const TABS: { id: Tab; label: string }[] = [
  { id: 'alt', label: 'Height' },
  { id: 'speed', label: 'Speed' },
  { id: 'accel', label: 'Acceleration & g' },
  { id: 'mach', label: 'Mach & dynamic pressure' },
  { id: 'aero', label: 'Drag: Cd · Re · Kn' },
  { id: 'thermal', label: 'Heating' },
  { id: 'path', label: 'Trajectory profile' },
];

const col = (r: SimResult, f: number) => Array.from({ length: r.count }, (_, i) => r.samples[i * N_FIELDS + f]);

export class Charts {
  private host: HTMLElement;
  private tabs: HTMLElement;
  private plot: uPlot | null = null;
  private tab: Tab = 'alt';
  private runs: ChartRun[] = [];
  private canvas: HTMLCanvasElement | null = null;
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

  setRuns(runs: ChartRun[]) {
    this.runs = runs;
    this.render();
  }

  private resize() {
    const w = this.host.clientWidth, hh = this.host.clientHeight;
    if (this.plot && w > 0 && hh > 0) this.plot.setSize({ width: w, height: hh - 26 });
    if (this.canvas) this.drawPath();
  }

  private render() {
    for (const b of this.tabs.children) (b as HTMLElement).classList.toggle('on', (b as HTMLElement).dataset.id === this.tab);
    this.plot?.destroy();
    this.plot = null;
    this.host.innerHTML = '';
    this.canvas = null;
    if (!this.runs.length) return;
    if (this.tab === 'path') {
      this.canvas = h('canvas') as HTMLCanvasElement;
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      this.host.append(this.canvas);
      this.drawPath();
      return;
    }
    // union x axis: use the primary run's time base; others interpolated onto it
    const tMax = Math.max(...this.runs.map((r) => r.result.samples[(r.result.count - 1) * N_FIELDS + F.t]));
    const n = 1500;
    const xs = Array.from({ length: n }, (_, i) => (tMax * i) / (n - 1));
    const interp = (r: SimResult, f: number, map: (v: number) => number = (v) => v) => {
      const ts = col(r, F.t), vs = col(r, f);
      let j = 0;
      return xs.map((x) => {
        if (x > ts[ts.length - 1] + 1e-9) return null;
        while (j < ts.length - 2 && ts[j + 1] < x) j++;
        const w = ts[j + 1] > ts[j] ? (x - ts[j]) / (ts[j + 1] - ts[j]) : 0;
        return map(vs[j] * (1 - Math.min(Math.max(w, 0), 1)) + vs[j + 1 < vs.length ? j + 1 : j] * Math.min(Math.max(w, 0), 1));
      });
    };
    type S = { label: string; stroke: string; dash?: number[]; scale?: string; values: (number | null)[]; width?: number };
    const series: S[] = [];
    const axes: uPlot.Axis[] = [{ stroke: '#8b9ab5', grid: { stroke: 'rgba(140,180,255,0.07)' }, ticks: { stroke: 'rgba(140,180,255,0.1)' }, values: (_u, v) => v.map((x) => fmtT(x)) }];
    const scales: uPlot.Scales = { x: { time: false } };
    const axis = (scale: string, label: string, side = 3, log = false) => {
      axes.push({ scale, label, side, stroke: '#8b9ab5', grid: { show: side === 3, stroke: 'rgba(140,180,255,0.07)' }, ticks: { stroke: 'rgba(140,180,255,0.1)' }, size: 62, labelSize: 14, labelFont: '11px Inter', font: '10px JetBrains Mono' });
      scales[scale] = log ? { distr: 3 } : {};
    };
    const per = (f: number, label: string, scale = 'y', map?: (v: number) => number, vacuum = false, dash?: number[]) => {
      for (const r of this.runs) {
        series.push({ label: `${label} · ${r.label}`, stroke: r.color, values: interp(r.result, f, map), scale, dash, width: 2 });
        if (vacuum && r.vacuum) series.push({ label: `${label} (vacuum) · ${r.label}`, stroke: r.color + '88', values: interp(r.vacuum, f, map), scale, dash: [6, 5], width: 1.4 });
      }
    };
    const pos = (v: number) => (v > 0 ? v : null as unknown as number);
    switch (this.tab) {
      case 'alt': axis('y', 'height above ground [m]'); per(F.hAGL, 'height', 'y', undefined, true); break;
      case 'speed': axis('y', 'speed [m/s]'); per(F.speed, 'speed', 'y', undefined, true); per(F.vUp, 'vertical', 'y', undefined, false, [2, 3]); break;
      case 'accel': axis('y', 'felt load [g]'); axis('g', 'local gravity [m/s²]', 1); per(F.gLoad, 'load', 'y'); per(F.gLocal, '|g|', 'g', undefined, false, [4, 3]); break;
      case 'mach': axis('y', 'Mach'); axis('q', 'dynamic pressure [Pa]', 1); per(F.mach, 'Mach', 'y'); per(F.qDyn, 'q', 'q', undefined, false, [4, 3]); break;
      case 'aero': axis('y', 'Cd'); axis('r', 'Re, Kn (log)', 1, true); per(F.cd, 'Cd', 'y'); per(F.re, 'Re', 'r', pos, false, [4, 3]); per(F.kn, 'Kn', 'r', (v) => (v > 0 && v < 1e20 ? v : (null as unknown as number)), false, [1, 3]); break;
      case 'thermal': axis('y', 'surface temperature [°C]'); axis('h', 'stagnation heat flux [kW/m²] (log)', 1, true); per(F.Tw, 'T', 'y', (v) => v - 273.15); per(F.qStag, 'q̇', 'h', (v) => (v > 1e-3 ? v / 1000 : (null as unknown as number)), false, [4, 3]); break;
    }
    const data: uPlot.AlignedData = [xs, ...series.map((s) => s.values)] as uPlot.AlignedData;
    const self = this;
    const opts: uPlot.Options = {
      width: this.host.clientWidth || 600,
      height: Math.max((this.host.clientHeight || 160) - 26, 80),
      scales,
      axes,
      legend: { live: true },
      cursor: { drag: { x: true, y: false }, points: { size: 6 } },
      series: [{ label: 't', value: (_u, v) => (v == null ? '' : fmtT(v)) }, ...series.map((s) => ({ label: s.label, stroke: s.stroke, width: s.width, dash: s.dash, scale: s.scale, spanGaps: false, points: { show: false } }))],
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
    this.plot = new uPlot(opts, data, this.host);
  }

  setCursor(t: number) {
    this.cursorT = t;
    if (this.plot) this.plot.redraw(false, false);
    else if (this.canvas) this.drawPath();
  }

  /** Downrange–height profile on a 1:1 or stretched canvas. */
  private drawPath() {
    const c = this.canvas!;
    const dpr = window.devicePixelRatio || 1;
    const W = this.host.clientWidth, H = this.host.clientHeight;
    c.width = W * dpr;
    c.height = H * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, W, H);
    let xmax = 1, ymax = 1, ymin = 0;
    for (const r of this.runs) for (let i = 0; i < r.result.count; i++) {
      xmax = Math.max(xmax, r.result.samples[i * N_FIELDS + F.downrange]);
      ymax = Math.max(ymax, r.result.samples[i * N_FIELDS + F.hAGL]);
      ymin = Math.min(ymin, r.result.samples[i * N_FIELDS + F.hAGL]);
    }
    const pad = { l: 64, r: 16, t: 12, b: 26 };
    const sx = (W - pad.l - pad.r) / xmax, sy = (H - pad.t - pad.b) / (ymax - ymin);
    const X = (v: number) => pad.l + v * sx, Y = (v: number) => H - pad.b - (v - ymin) * sy;
    g.strokeStyle = 'rgba(140,180,255,0.15)';
    g.fillStyle = '#8b9ab5';
    g.font = '10px JetBrains Mono';
    for (let k = 0; k <= 5; k++) {
      const xv = (xmax * k) / 5, yv = ymin + ((ymax - ymin) * k) / 5;
      g.beginPath(); g.moveTo(X(xv), pad.t); g.lineTo(X(xv), H - pad.b); g.stroke();
      g.beginPath(); g.moveTo(pad.l, Y(yv)); g.lineTo(W - pad.r, Y(yv)); g.stroke();
      g.fillText(fmtL(xv), X(xv) - 14, H - 8);
      g.fillText(fmtL(yv), 4, Y(yv) + 3);
    }
    g.fillStyle = 'rgba(181,157,122,0.25)';
    g.fillRect(pad.l, Y(0), W - pad.l - pad.r, H - pad.b - Y(0));
    for (const r of this.runs) {
      for (const [res, dash] of [[r.vacuum, [6, 5]], [r.result, []]] as [SimResult | null, number[]][]) {
        if (!res) continue;
        g.strokeStyle = dash.length ? r.color + '88' : r.color;
        g.lineWidth = dash.length ? 1.3 : 2.2;
        g.setLineDash(dash);
        g.beginPath();
        for (let i = 0; i < res.count; i++) {
          const o = i * N_FIELDS;
          const x = X(res.samples[o + F.downrange]), y = Y(res.samples[o + F.hAGL]);
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.stroke();
        g.setLineDash([]);
      }
      // cursor dot
      const res = r.result;
      let i = 0;
      while (i < res.count - 1 && res.samples[(i + 1) * N_FIELDS + F.t] <= this.cursorT) i++;
      g.fillStyle = r.color;
      g.beginPath();
      g.arc(X(res.samples[i * N_FIELDS + F.downrange]), Y(res.samples[i * N_FIELDS + F.hAGL]), 4, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#8b9ab5';
    g.fillText('downrange →', W - 90, H - 8);
  }
}

function fmtT(t: number) {
  if (t < 120) return `${+t.toFixed(t < 10 ? 2 : 1)} s`;
  if (t < 7200) return `${(t / 60).toFixed(1)} min`;
  return `${(t / 3600).toFixed(2)} h`;
}
function fmtL(v: number) {
  const a = Math.abs(v);
  if (a >= 1e4) return `${(v / 1000).toFixed(0)} km`;
  if (a >= 1000) return `${(v / 1000).toFixed(1)} km`;
  return `${v.toFixed(a < 10 ? 1 : 0)} m`;
}
