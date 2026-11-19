import { h, section, seg, slider, toggle, type Store } from './dom';
import { APPARATUS_BY_ID, apparatusFor, type ApparatusId } from '../physics/em/apparatus';
import { COOLING_LABEL, type CoolingTech } from '../physics/em/engineering';
import { LEV_MODES, type LevMode, type LevShape } from '../physics/em/levitation';
import { EM_MATERIALS, emMaterial } from '../physics/em/materials';
import { LEV_OBJECTS } from '../physics/em/objects';
import {
  MODE_HAS_FIELD, MODE_LABEL, MODE_SHORT, MODE_TAGLINE, levObjectFor, paramsFor, type LevScenario,
} from '../app/levscenario';

export interface LevPanelCallbacks {
  onSolve: () => void;
  onRunDynamics: () => void;
  onEarnshaw: () => void;
  onMyths: () => void;
  onBuildSheet: () => void;
  onValidation: () => void;
  onEquations: () => void;
}

const MODE_GROUPS: { label: string; modes: LevMode[] }[] = [
  { label: 'Cannot work statically', modes: ['electrostatic', 'permanentMagnet'] },
  { label: 'Stable with no help', modes: ['diamagnetic', 'superconductor'] },
  { label: 'Needs change or energy', modes: ['eddyCurrent', 'servo', 'spinStabilised'] },
  { label: 'Oscillating fields', modes: ['acoustic', 'optical'] },
  { label: 'Momentum & buoyancy', modes: ['aerodynamic', 'buoyancy'] },
];

export class LevPanel {
  readonly el: HTMLElement;
  private solveBtn = h('button', { class: 'btn-primary' }, '⚖  SOLVE') as HTMLButtonElement;
  private runBtn = h('button', { class: 'btn small' }, '▶ Release it (6-DOF)') as HTMLButtonElement;
  private progress = h('div');
  private modeTag = h('div', { class: 'hint mode-tagline' });
  private appSel = h('select', {}) as HTMLSelectElement;
  private appNote = h('div', { class: 'hint' });
  private paramBox = h('div');
  private objGrid = h('div', { class: 'objects lev-objects' });
  private objDesc = h('div', { class: 'obj-desc' });
  private customBox = h('div');
  private dynBox = h('div');
  private refreshers: (() => void)[] = [];
  private paramKey = '';
  private siteInfo = h('div', { class: 'info-card', style: 'margin-top:8px' }, 'Solving…');

  constructor(private store: Store<LevScenario>, private cb: LevPanelCallbacks) {
    this.el = document.getElementById('levpanel')!;
    this.el.classList.add('glass');
    this.build();
    store.subscribe(() => this.refresh());
  }

  private get s() {
    return this.store.state;
  }
  private set(p: Partial<LevScenario>) {
    this.store.set(p);
  }

  private build() {
    const brand = h('div', { class: 'brand' },
      h('div', { class: 'brand-logo lev' }),
      h('div', {}, h('div', { class: 'brand-name' }, 'LEVITATION'), h('div', { class: 'brand-tag' }, 'Ten ways to beat gravity — and one that is impossible')));

    /* mode */
    const modeBox = h('div', { class: 'mode-grid' });
    const modeTiles: { el: HTMLElement; mode: LevMode }[] = [];
    for (const group of MODE_GROUPS) {
      modeBox.append(h('div', { class: 'mode-group' }, group.label));
      const row = h('div', { class: 'mode-row' });
      for (const m of group.modes) {
        const t = h('button', { class: 'mode-tile', title: MODE_TAGLINE[m], onclick: () => this.pickMode(m) },
          h('span', { class: 'e' }, MODE_SHORT[m]), h('span', { class: 'n' }, MODE_LABEL[m]));
        row.append(t);
        modeTiles.push({ el: t, mode: m });
      }
      modeBox.append(row);
    }
    this.refreshers.push(() => {
      for (const t of modeTiles) t.el.classList.toggle('on', t.mode === this.s.mode);
      this.modeTag.textContent = MODE_TAGLINE[this.s.mode];
    });

    /* apparatus */
    this.appSel.addEventListener('change', () => this.set({ apparatus: this.appSel.value as ApparatusId }));
    this.refreshers.push(() => {
      const list = apparatusFor(this.s.mode);
      const want = list.map((a) => a.id).join(',');
      if (this.appSel.dataset.list !== want) {
        this.appSel.dataset.list = want;
        this.appSel.innerHTML = '';
        for (const a of list) this.appSel.append(h('option', { value: a.id }, a.name));
      }
      this.appSel.value = this.s.apparatus;
      const def = APPARATUS_BY_ID[this.s.apparatus];
      this.appNote.textContent = def.summary;
      this.buildParams();
    });

    /* objects */
    const tiles = [...LEV_OBJECTS.map((o) => ({ id: o.id, emoji: o.emoji, name: o.name })), { id: 'custom', emoji: '🛠️', name: 'Custom' }]
      .map((it) => {
        const t = h('div', { class: 'obj', title: it.name, onclick: () => this.set({ objectId: it.id }) },
          h('div', { class: 'e' }, it.emoji), h('div', { class: 'n' }, it.name));
        this.objGrid.append(t);
        return { t, id: it.id };
      });
    this.refreshers.push(() => {
      for (const x of tiles) x.t.classList.toggle('on', x.id === this.s.objectId);
      const o = levObjectFor(this.s);
      const mat = emMaterial(o.material);
      this.objDesc.innerHTML = `<b>${o.name}</b> — ${fmtMass(o.mass)}, ${fmtLen(o.size)}${o.shape === 'sphere' || o.shape === 'cube' ? '' : ` × ${fmtLen(o.thickness)}`}, ${mat.name}`
        + `<br>χ = ${mat.chi.toExponential(2)}${mat.chiAlt !== undefined ? ` / ${mat.chiAlt.toExponential(2)}` : ''}`
        + `${o.moment > 0 ? `, m = ${o.moment.toPrecision(3)} A·m²` : ''}`
        + `${o.charge > 0 ? `, q = ${(o.charge / 1.602176634e-19).toPrecision(3)} e` : ''}`
        + `<br>${o.description}`;
      this.customBox.style.display = this.s.objectId === 'custom' ? '' : 'none';
    });
    this.buildCustom();

    /* environment */
    const medium = h('select', { onchange: (e: Event) => this.set({ medium: (e.target as HTMLSelectElement).value }) },
      ...['air', 'vacuum', 'water', 'transformerOil'].map((id) => h('option', { value: id }, emMaterial(id).name))) as HTMLSelectElement;
    const temp = slider({ label: 'Temperature', min: 4.2, max: 400, value: this.s.temperature, step: 0.1, unit: 'K', onChange: (v) => this.set({ temperature: v }) });
    const cooling = h('select', { onchange: (e: Event) => this.set({ cooling: (e.target as HTMLSelectElement).value as CoolingTech }) },
      ...(['air', 'forcedAir', 'water', 'superconducting'] as CoolingTech[]).map((t) => h('option', { value: t }, COOLING_LABEL[t]))) as HTMLSelectElement;
    this.refreshers.push(() => {
      medium.value = this.s.medium;
      temp.set(this.s.temperature);
      cooling.value = this.s.cooling;
    });
    const env = h('div', {},
      this.siteInfo,
      h('div', { class: 'row' }, h('label', {}, 'Medium'), medium),
      temp.el,
      h('div', { class: 'row' }, h('label', {}, 'Magnet cooling'), cooling),
      h('div', { class: 'hint' }, 'The medium matters twice over: it sets the breakdown field for the electrostatic mode, and levitating a diamagnet in air is very slightly easier than in vacuum because air is itself weakly paramagnetic.'));

    /* dynamics */
    const spin = slider({ label: 'Spin rate', min: 0, max: 200, value: this.s.spinRps, step: 0.5, unit: 'rev/s', onChange: (v) => this.set({ spinRps: v }) });
    const tiltS = slider({ label: 'Initial tilt', min: 0, max: 20, value: this.s.tiltDeg, step: 0.1, unit: '°', onChange: (v) => this.set({ tiltDeg: v }) });
    const off = slider({ label: 'Initial offset', min: 0, max: 0.02, value: this.s.offset, step: 0.0001, unit: 'm', onChange: (v) => this.set({ offset: v }) });
    const dur = slider({ label: 'Run for', min: 0.5, max: 60, value: this.s.duration, step: 0.5, unit: 's', onChange: (v) => this.set({ duration: v }) });
    const damp = toggle('Air drag & spin decay', this.s.damping, (v) => this.set({ damping: v }));
    this.dynBox.append(spin.el, tiltS.el, off.el, dur.el, h('div', { class: 'row' }, damp.el),
      h('div', { class: 'row' }, this.runBtn),
      h('div', { class: 'hint' }, 'Full six-degree-of-freedom rigid-body motion: translation, rotation, magnetic torque and gyroscopic precession. With damping off, total energy is conserved to about one part in 10¹⁰ — which is the check that the force and the torque agree.'));
    this.refreshers.push(() => {
      spin.set(this.s.spinRps);
      tiltS.set(this.s.tiltDeg);
      off.set(this.s.offset);
      dur.set(this.s.duration);
      damp.set(this.s.damping);
      const has = MODE_HAS_FIELD[this.s.mode];
      this.dynBox.style.opacity = has ? '1' : '0.45';
      this.runBtn.disabled = !has;
      this.runBtn.title = has ? '' : 'This mode has no magnetic field to time-step; its solution is analytic.';
    });

    /* view */
    const showSeg = seg<'apparatus' | 'energy'>(
      [{ value: 'apparatus', label: '🔬 Apparatus' }, { value: 'energy', label: '⛰ Energy surface' }],
      this.s.show, (v) => this.set({ show: v }),
    );
    const lines = toggle('Field lines', this.s.fieldLines, (v) => this.set({ fieldLines: v }));
    const sliceT = toggle('|B| slice through the middle', this.s.fieldSlice, (v) => this.set({ fieldSlice: v }));
    const arrows = toggle('Net-force arrows', this.s.forceArrows, (v) => this.set({ forceArrows: v }));
    this.refreshers.push(() => {
      showSeg.set(this.s.show);
      lines.set(this.s.fieldLines);
      sliceT.set(this.s.fieldSlice);
      arrows.set(this.s.forceArrows);
    });
    const view = h('div', {}, showSeg.el, h('div', { style: 'height:8px' }),
      h('div', { class: 'row' }, lines.el), h('div', { class: 'row' }, sliceT.el), h('div', { class: 'row' }, arrows.el),
      h('div', { class: 'hint' }, 'Arrows show the net force on your object with gravity included, so green really does mean it would rise. On the energy surface, height is potential energy: a basin is a trap, a pass is a saddle.'));

    const footer = h('div', { class: 'row', style: 'flex-wrap:wrap' },
      h('button', { class: 'btn small', onclick: () => this.cb.onEarnshaw() }, '∂ Earnshaw'),
      h('button', { class: 'btn small', onclick: () => this.cb.onMyths() }, '🚫 Antigravity claims'),
      h('button', { class: 'btn small', onclick: () => this.cb.onBuildSheet() }, '🔧 Build sheet'),
      h('button', { class: 'btn small', onclick: () => this.cb.onEquations() }, '∑ Equations'),
      h('button', { class: 'btn small', onclick: () => this.cb.onValidation() }, '✔ Validation'));

    this.solveBtn.addEventListener('click', () => this.cb.onSolve());
    this.runBtn.addEventListener('click', () => this.cb.onRunDynamics());
    this.progress.className = 'progress';
    this.progress.append(h('div'));

    this.el.append(
      brand,
      section('Mode', h('div', {}, modeBox, this.modeTag)),
      section('Apparatus', h('div', {}, h('div', { class: 'row' }, this.appSel), this.appNote, this.paramBox)),
      section('Object', h('div', {}, this.objGrid, this.objDesc, this.customBox)),
      section('Environment', env, false),
      section('Release it', this.dynBox, false),
      section('View', view, false),
      footer,
      h('div', { class: 'sticky-run' }, this.solveBtn, this.progress),
    );
    this.refresh();
  }

  /** apparatus parameter sliders, rebuilt when the apparatus changes */
  private buildParams() {
    const def = APPARATUS_BY_ID[this.s.apparatus];
    if (this.paramKey === def.id) return;
    this.paramKey = def.id;
    this.paramBox.innerHTML = '';
    const current = paramsFor(this.s);
    for (const p of def.params) {
      const ctl = slider({
        label: p.label, min: p.min, max: p.max, value: current[p.key], step: p.step, unit: p.unit, log: p.log,
        onChange: (v) => {
          const next = { ...this.s.params, [def.id]: { ...(this.s.params[def.id] ?? {}), [p.key]: v } };
          this.set({ params: next });
        },
      });
      this.paramBox.append(ctl.el);
      if (p.hint) this.paramBox.append(h('div', { class: 'hint tight' }, p.hint));
    }
  }

  private buildCustom() {
    const c = () => this.s.custom;
    const patch = (p: Partial<LevScenario['custom']>) => this.set({ custom: { ...c(), ...p } });
    const shape = h('select', { onchange: (e: Event) => patch({ shape: (e.target as HTMLSelectElement).value as LevShape }) },
      ...(['sphere', 'cube', 'disk', 'plate', 'cylinder'] as LevShape[]).map((v) => h('option', { value: v }, v))) as HTMLSelectElement;
    const mat = h('select', { onchange: (e: Event) => patch({ material: (e.target as HTMLSelectElement).value }) },
      ...EM_MATERIALS.map((m) => h('option', { value: m.id }, m.name))) as HTMLSelectElement;
    const size = slider({ label: 'Size', min: 1e-7, max: 2, value: c().size, log: true, unit: 'm', onChange: (v) => patch({ size: v }) });
    const thick = slider({ label: 'Thickness', min: 1e-7, max: 2, value: c().thickness, log: true, unit: 'm', onChange: (v) => patch({ thickness: v }) });
    const massIn = h('input', { type: 'number', step: 'any', placeholder: 'from material', onchange: (e: Event) => {
      const v = (e.target as HTMLInputElement).value;
      patch({ massOverride: v === '' ? null : Number(v) });
    } }) as HTMLInputElement;
    const moment = slider({ label: 'Magnetic moment', min: 0, max: 20, value: c().moment, step: 0.001, unit: 'A·m²', onChange: (v) => patch({ moment: v }) });
    const charge = h('input', { type: 'number', step: 'any', placeholder: '0', onchange: (e: Event) => patch({ charge: Number((e.target as HTMLInputElement).value) || 0 }) }) as HTMLInputElement;
    const info = h('div', { class: 'hint' });
    this.customBox.append(
      h('div', { class: 'row' }, h('label', {}, 'Shape'), shape),
      h('div', { class: 'row' }, h('label', {}, 'Material'), mat),
      size.el, thick.el,
      h('div', { class: 'row' }, h('label', {}, 'Mass (kg)'), massIn),
      moment.el,
      h('div', { class: 'row' }, h('label', {}, 'Charge (C)'), charge),
      info,
    );
    this.refreshers.push(() => {
      shape.value = c().shape;
      mat.value = c().material;
      size.set(c().size);
      thick.set(c().thickness);
      moment.set(c().moment);
      if (document.activeElement !== massIn) massIn.value = c().massOverride === null ? '' : String(c().massOverride);
      if (document.activeElement !== charge) charge.value = String(c().charge || '');
      const o = levObjectFor(this.s);
      const m = emMaterial(c().material);
      info.innerHTML = `Mass ${fmtMass(o.mass)} · density ${m.density} kg/m³ · χ = ${m.chi.toExponential(2)}`
        + `${m.sc ? ` · superconducting below ${m.sc.Tc} K` : ''}${m.pm ? ` · Br = ${m.pm.Br} T` : ''}`;
    });
  }

  private pickMode(mode: LevMode) {
    const list = apparatusFor(mode);
    const keep = list.some((a) => a.id === this.s.apparatus);
    const patch: Partial<LevScenario> = { mode };
    if (!keep) patch.apparatus = list[0].id;
    // pick an object the mode can actually act on
    const o = levObjectFor(this.s);
    if ((mode === 'permanentMagnet' || mode === 'spinStabilised' || mode === 'superconductor') && o.moment <= 0) {
      patch.objectId = mode === 'spinStabilised' ? 'levitronTop' : 'magnetDisc';
    }
    if (mode === 'diamagnetic' && emMaterial(o.material).chi >= 0) patch.objectId = 'graphiteFlake';
    if (mode === 'eddyCurrent' && !emMaterial(o.material).resistivity) patch.objectId = 'alDisc';
    if (mode === 'servo' && emMaterial(o.material).chi < 1) patch.objectId = 'steelBall';
    if (mode === 'acoustic' && o.size > 0.005) patch.objectId = 'psBead';
    if (mode === 'optical' && o.size > 1e-4) patch.objectId = 'psBeadMicro';
    if (mode === 'aerodynamic') patch.objectId = 'quadcopter';
    if (mode === 'buoyancy') patch.objectId = 'payload';
    if (mode === 'electrostatic' && o.charge <= 0) patch.objectId = 'oilDrop';
    this.store.set(patch);
  }

  /** where the levitation is happening, and the gravity it has to beat */
  setSite(html: string) {
    this.siteInfo.innerHTML = html;
  }

  setRunning(running: boolean, label = '⚖  SOLVE') {
    this.solveBtn.disabled = running;
    this.solveBtn.textContent = running ? 'Solving…' : label;
  }
  setDynRunning(running: boolean) {
    this.runBtn.disabled = running || !MODE_HAS_FIELD[this.s.mode];
    this.runBtn.textContent = running ? 'Integrating…' : '▶ Release it (6-DOF)';
  }
  setProgress(f: number) {
    (this.progress.firstChild as HTMLElement).style.width = `${Math.round(f * 100)}%`;
  }

  private refresh() {
    for (const r of this.refreshers) r();
  }
}

void LEV_MODES;

const fmtMass = (m: number) =>
  m >= 1 ? `${+m.toPrecision(4)} kg`
    : m >= 1e-3 ? `${+(m * 1000).toPrecision(3)} g`
      : m >= 1e-6 ? `${+(m * 1e6).toPrecision(3)} mg`
        : m >= 1e-9 ? `${+(m * 1e9).toPrecision(3)} µg`
          : `${m.toExponential(2)} kg`;

const fmtLen = (l: number) =>
  l >= 1 ? `${+l.toPrecision(3)} m`
    : l >= 0.01 ? `${+(l * 100).toPrecision(3)} cm`
      : l >= 1e-4 ? `${+(l * 1000).toPrecision(3)} mm`
        : l >= 1e-7 ? `${+(l * 1e6).toPrecision(3)} µm`
          : `${+(l * 1e9).toPrecision(3)} nm`;
