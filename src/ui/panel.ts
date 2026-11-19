import { h, section, seg, slider, toggle, type Store } from './dom';
import type { Scenario } from '../app/scenario';
import { RUN_CSS, describe } from '../app/scenario';
import { PRESETS, MATERIALS, presetById } from '../physics/objects';
import { LANDMARKS, type Landmark } from '../data/landmarks';
import { loadPlaces, type Place } from '../app/data';
import type { BodyId } from '../physics/bodies';
import type { SpinMode } from '../physics/simulation';

export interface PanelCallbacks {
  onRun: () => void;
  onLocate: (lat: number, lon: number, name: string, landmark: Landmark | null) => void;
  onValidation: () => void;
  onEquations: () => void;
  onCredits: () => void;
  onSaveSlot: () => void;
  onRemoveSlot: (i: number) => void;
  onRunAll: () => void;
}

export interface SlotView {
  label: string;
}

export class Panel {
  readonly el: HTMLElement;
  private siteInfo = h('div', { class: 'info-card' }, 'Pick a place on the globe, search, or choose a landmark.');
  private runBtn = h('button', { class: 'btn-primary' }, '▶  SIMULATE') as HTMLButtonElement;
  private progress = h('div');
  private objDesc = h('div', { class: 'obj-desc' });
  private customBox = h('div');
  private throwBox = h('div');
  private dropBox = h('div');
  private chuteBox = h('div');
  private spinBox = h('div');
  private slotsBox = h('div', { class: 'compare-slots' });
  private latIn = h('input', { type: 'number', step: 'any' }) as HTMLInputElement;
  private lonIn = h('input', { type: 'number', step: 'any' }) as HTMLInputElement;
  private refreshers: (() => void)[] = [];

  constructor(private store: Store<Scenario>, private cb: PanelCallbacks) {
    this.el = document.getElementById('panel')!;
    this.el.classList.add('glass');
    this.build();
    store.subscribe(() => this.refresh());
  }

  private get s() {
    return this.store.state;
  }
  private set(p: Partial<Scenario>) {
    this.store.set(p);
  }

  private build() {
    const brand = h('div', { class: 'brand' }, h('div', { class: 'brand-logo' }), h('div', {}, h('div', { class: 'brand-name' }, 'ATMO'), h('div', { class: 'brand-tag' }, 'Real-physics gravity laboratory')));

    // world
    const world = seg<BodyId>(
      [{ value: 'earth', label: '🌍 Earth' }, { value: 'moon', label: '🌕 Moon' }, { value: 'mars', label: '🔴 Mars' }, { value: 'jupiter', label: '🪐 Jupiter' }],
      this.s.body,
      (b) => {
        const lm = LANDMARKS.find((l) => l.body === b)!;
        this.applyLandmark(lm);
      },
    );
    this.refreshers.push(() => world.set(this.s.body));

    // location
    const search = this.buildSearch();
    const lmSel = h('select', {}) as HTMLSelectElement;
    const fillLm = () => {
      lmSel.innerHTML = '';
      lmSel.append(h('option', { value: '' }, '— Landmarks & famous sites —'));
      for (const l of LANDMARKS.filter((x) => x.body === this.s.body)) lmSel.append(h('option', { value: l.id }, l.name));
      lmSel.value = this.s.landmarkId ?? '';
    };
    lmSel.addEventListener('change', () => {
      const l = LANDMARKS.find((x) => x.id === lmSel.value);
      if (l) this.applyLandmark(l);
    });
    this.refreshers.push(fillLm);
    const go = h('button', { class: 'btn small', onclick: () => {
      const lat = Math.max(-90, Math.min(90, Number(this.latIn.value)));
      const lon = ((((Number(this.lonIn.value) + 180) % 360) + 360) % 360) - 180;
      if (Number.isFinite(lat) && Number.isFinite(lon)) this.cb.onLocate(lat, lon, `${lat.toFixed(4)}, ${lon.toFixed(4)}`, null);
    } }, 'Go');
    const location = h('div', {},
      this.s.body === 'earth' ? search : h('div'),
      h('div', { class: 'row' }, lmSel),
      h('div', { class: 'row' }, h('label', {}, 'Lat / Lon'), this.latIn, this.lonIn, go),
      h('div', { class: 'hint' }, 'Tip: click anywhere on the globe to choose a launch site.'),
      this.siteInfo,
    );
    this.refreshers.push(() => {
      if (document.activeElement !== this.latIn) this.latIn.value = this.s.lat.toFixed(5);
      if (document.activeElement !== this.lonIn) this.lonIn.value = this.s.lon.toFixed(5);
      search.style.display = this.s.body === 'earth' ? '' : 'none';
    });

    // mode
    const mode = seg<'drop' | 'throw'>([{ value: 'drop', label: '⬇  Drop from height' }, { value: 'throw', label: '↗  Throw / launch' }], this.s.mode, (m) =>
      this.set({ mode: m, heightAGL: m === 'throw' ? 1.8 : this.s.landmarkId ? LANDMARKS.find((l) => l.id === this.s.landmarkId)?.dropHeight ?? 100 : 100 }),
    );
    this.refreshers.push(() => mode.set(this.s.mode));

    // objects
    const grid = h('div', { class: 'objects' });
    const items = [...PRESETS.map((p) => ({ id: p.id, emoji: p.emoji, name: p.name })), { id: 'custom', emoji: '🛠️', name: 'Custom' }];
    const tiles = items.map((it) => {
      const t = h('div', { class: 'obj', title: it.name, onclick: () => this.set({ objectId: it.id, parachute: it.id !== 'custom' && !!presetById(it.id).parachute }) }, h('div', { class: 'e' }, it.emoji), h('div', { class: 'n' }, it.name));
      grid.append(t);
      return { t, id: it.id };
    });
    this.refreshers.push(() => {
      tiles.forEach((x) => x.t.classList.toggle('on', x.id === this.s.objectId));
      const o = this.s.objectId === 'custom' ? null : presetById(this.s.objectId);
      this.objDesc.innerHTML = o
        ? `<b>${o.name}</b> — ${fmtMass(o.mass)}, ⌀ ${fmtLen(o.length)}, A = ${o.area.toPrecision(3)} m², ${MATERIALS[o.material]?.name ?? ''}<br>${o.description}`
        : 'Build your own: shape, size, mass and material. Leave Cd empty to use the shape’s measured drag curve.';
      this.customBox.style.display = this.s.objectId === 'custom' ? '' : 'none';
    });
    this.buildCustom();

    // launch parameters
    const height = slider({ label: 'Release height', min: 0.01, max: 2_000_000, value: this.s.heightAGL, log: true, unit: 'm AGL', onChange: (v) => this.set({ heightAGL: v }) });
    this.refreshers.push(() => height.set(this.s.heightAGL));
    const speed = slider({ label: 'Speed (vs ground)', min: 0.1, max: 60_000, value: this.s.speed, log: true, unit: 'm/s', onChange: (v) => this.set({ speed: v }) });
    const elev = slider({ label: 'Elevation angle', min: -90, max: 90, value: this.s.elevation, step: 0.1, unit: '°', onChange: (v) => this.set({ elevation: v }) });
    const az = slider({ label: 'Azimuth', min: 0, max: 360, value: this.s.azimuth, step: 0.5, unit: '° N→E', onChange: (v) => this.set({ azimuth: v }) });
    const speedPresets = h('div', { class: 'row' }, h('label', {}, 'Speed presets'),
      h('select', { onchange: (e: Event) => { const v = Number((e.target as HTMLSelectElement).value); if (v) this.set({ speed: v }); } },
        h('option', { value: '' }, 'choose…'),
        ...([[8, 'Gentle toss 8 m/s'], [25, 'Strong throw 25 m/s'], [44.7, 'Home-run exit 100 mph'], [74.7, 'Pro golf drive 167 mph'], [343, 'Speed of sound'], [1000, 'Rifle bullet 1 km/s'], [7800, 'Low-Earth orbit 7.8 km/s'], [11200, 'Escape ~11.2 km/s']] as [number, string][]).map(([v, l]) => h('option', { value: v }, l))));
    this.throwBox.append(speed.el, elev.el, az.el, speedPresets, h('div', { class: 'hint' }, 'In the 3-D site view you can also drag the arrow handle to aim.'));
    this.refreshers.push(() => { speed.set(this.s.speed); elev.set(this.s.elevation); az.set(this.s.azimuth); this.throwBox.style.display = this.s.mode === 'throw' ? '' : 'none'; });

    const spinSel = h('select', { onchange: (e: Event) => this.set({ spinMode: (e.target as HTMLSelectElement).value as SpinMode }) },
      ...([['none', 'No spin'], ['backspin', 'Backspin (lift)'], ['topspin', 'Topspin (dip)'], ['curveLeft', 'Side-spin: curve left'], ['curveRight', 'Side-spin: curve right'], ['rifle', 'Rifle spin (no Magnus)']] as [SpinMode, string][]).map(([v, l]) => h('option', { value: v }, l))) as HTMLSelectElement;
    const rpm = slider({ label: 'Spin rate', min: 0, max: 12000, value: this.s.spinRpm, step: 10, unit: 'rpm', onChange: (v) => this.set({ spinRpm: v }) });
    this.spinBox.append(h('div', { class: 'row' }, h('label', {}, 'Spin (Magnus)'), spinSel), rpm.el);
    this.refreshers.push(() => {
      spinSel.value = this.s.spinMode;
      rpm.set(this.s.spinRpm);
      const o = this.s.objectId === 'custom' ? null : presetById(this.s.objectId);
      const ball = !o || o.drag.kind === 'sphere' || o.drag.kind === 'roughSphere';
      this.spinBox.style.display = this.s.mode === 'throw' && ball ? '' : 'none';
    });

    const chuteT = toggle('Deploy parachute', this.s.parachute, (v) => this.set({ parachute: v }));
    const deploy = slider({ label: 'Deploy at', min: 50, max: 10000, value: this.s.deployAGL, log: true, unit: 'm AGL', onChange: (v) => this.set({ deployAGL: v }) });
    this.chuteBox.append(h('div', { class: 'row' }, chuteT.el), deploy.el);
    this.refreshers.push(() => {
      chuteT.set(this.s.parachute);
      deploy.set(this.s.deployAGL);
      const o = this.s.objectId === 'custom' ? null : presetById(this.s.objectId);
      this.chuteBox.style.display = o?.parachute ? '' : 'none';
    });
    this.dropBox.append(height.el);

    // environment
    const air = toggle('Atmosphere (off = vacuum)', !this.s.vacuum, (v) => this.set({ vacuum: !v }));
    const rot = toggle('Planet rotation (Coriolis + centrifugal)', this.s.rotation, (v) => this.set({ rotation: v }));
    const water = toggle('Follow into the ocean (buoyancy, sinking)', this.s.water, (v) => this.set({ water: v }));
    const temp = slider({ label: 'Sea-level temp.', min: -60, max: 50, value: 15 + this.s.weather.dT, step: 0.5, unit: '°C', onChange: (v) => this.set({ weather: { ...this.s.weather, dT: v - 15 } }) });
    const pres = slider({ label: 'Sea-level press.', min: 870, max: 1085, value: this.s.weather.pMSL / 100, step: 0.5, unit: 'hPa', onChange: (v) => this.set({ weather: { ...this.s.weather, pMSL: v * 100 } }) });
    const hum = slider({ label: 'Humidity', min: 0, max: 100, value: this.s.weather.RH * 100, step: 1, unit: '%', onChange: (v) => this.set({ weather: { ...this.s.weather, RH: v / 100 } }) });
    const ws = slider({ label: 'Surface wind', min: 0, max: 40, value: this.s.wind.surfaceSpeed, step: 0.5, unit: 'm/s', onChange: (v) => this.set({ wind: { ...this.s.wind, surfaceSpeed: v } }) });
    const wd = slider({ label: '  from', min: 0, max: 360, value: this.s.wind.surfaceFrom, step: 1, unit: '°', onChange: (v) => this.set({ wind: { ...this.s.wind, surfaceFrom: v } }) });
    const js = slider({ label: 'Jet stream', min: 0, max: 100, value: this.s.wind.jetSpeed, step: 1, unit: 'm/s', onChange: (v) => this.set({ wind: { ...this.s.wind, jetSpeed: v } }) });
    const jd = slider({ label: '  from', min: 0, max: 360, value: this.s.wind.jetFrom, step: 1, unit: '°', onChange: (v) => this.set({ wind: { ...this.s.wind, jetFrom: v } }) });
    const dt = h('input', { type: 'datetime-local', onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value; if (v) this.set({ date: new Date(v + 'Z').toISOString(), sunMode: 'custom' }); } }) as HTMLInputElement;
    const noonT = toggle('Sun at local noon (auto)', this.s.sunMode === 'noon', (v) => this.set({ sunMode: v ? 'noon' : 'custom' }));
    const weatherBox = h('div', {}, temp.el, pres.el, hum.el);
    this.refreshers.push(() => {
      air.set(!this.s.vacuum); rot.set(this.s.rotation); water.set(this.s.water);
      temp.set(15 + this.s.weather.dT); pres.set(this.s.weather.pMSL / 100); hum.set(this.s.weather.RH * 100);
      ws.set(this.s.wind.surfaceSpeed); wd.set(this.s.wind.surfaceFrom); js.set(this.s.wind.jetSpeed); jd.set(this.s.wind.jetFrom);
      weatherBox.style.display = this.s.body === 'earth' && !this.s.vacuum ? '' : 'none';
      if (document.activeElement !== dt) dt.value = this.s.date.slice(0, 16);
      noonT.set(this.s.sunMode === 'noon');
    });
    const env = h('div', {},
      h('div', { class: 'row' }, air.el), h('div', { class: 'row' }, rot.el), h('div', { class: 'row' }, water.el),
      weatherBox, ws.el, wd.el, js.el, jd.el,
      h('div', { class: 'row' }, h('label', {}, 'Date/time (UTC)'), dt),
      h('div', { class: 'row' }, noonT.el),
      h('div', { class: 'hint' }, 'Weather re-integrates the hydrostatic equation of the U.S. Standard Atmosphere; the Sun position (lighting) uses the date/time.'));

    // numerics
    const deg = slider({ label: 'Gravity degree', min: 2, max: 360, value: this.s.gravityDegree, step: 1, unit: 'n', onChange: (v) => this.set({ gravityDegree: Math.round(v) }) });
    const tol = h('select', { onchange: (e: Event) => this.set({ rtol: Number((e.target as HTMLSelectElement).value) }) },
      ...[1e-6, 1e-8, 1e-10, 1e-12].map((v) => h('option', { value: v }, `rtol ${v.toExponential(0)}`))) as HTMLSelectElement;
    const tmax = slider({ label: 'Max sim time', min: 0.01, max: 72, value: this.s.maxTimeHours, log: true, unit: 'h', onChange: (v) => this.set({ maxTimeHours: v }) });
    this.refreshers.push(() => { deg.set(this.s.gravityDegree); tol.value = String(this.s.rtol); tmax.set(this.s.maxTimeHours); });
    const numerics = h('div', {}, deg.el, h('div', { class: 'row' }, h('label', {}, 'Integrator'), tol), tmax.el,
      h('div', { class: 'hint' }, 'Adaptive Dormand–Prince RK5(4) with dense output and event location. Earth gravity: EGM2008 spherical harmonics to the chosen degree (360 ≈ 55 km resolution; above ~150 long runs get slow).'));

    // compare
    const compare = h('div', {}, this.slotsBox, h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => this.cb.onSaveSlot() }, '＋ Add current setup'),
      h('button', { class: 'btn small', onclick: () => this.cb.onRunAll() }, '▶ Run all & compare')),
      h('div', { class: 'hint' }, 'Up to 4 setups run side by side: different objects, places, planets, or air vs vacuum. In 3-D they are overlaid from a common origin.'));

    const footer = h('div', { class: 'row', style: 'flex-wrap:wrap' },
      h('button', { class: 'btn small', onclick: () => this.cb.onValidation() }, '✔ Validation report'),
      h('button', { class: 'btn small', onclick: () => this.cb.onEquations() }, '∑ Physics & equations'),
      h('button', { class: 'btn small', onclick: () => this.cb.onCredits() }, 'ⓘ Data & credits'));

    this.runBtn.addEventListener('click', () => this.cb.onRun());
    this.progress.className = 'progress';
    this.progress.append(h('div'));

    this.el.append(
      brand,
      section('World', world.el),
      section('Launch site', location),
      section('Experiment', h('div', {}, mode.el, h('div', { style: 'height:8px' }), this.dropBox, this.throwBox, this.spinBox, this.chuteBox)),
      section('Object', h('div', {}, grid, this.objDesc, this.customBox)),
      section('Environment', env, false),
      section('Numerics', numerics, false),
      section('Compare runs', compare, false),
      footer,
      h('div', { class: 'sticky-run' }, this.runBtn, this.progress),
    );
    this.refresh();
  }

  private buildCustom() {
    const c = () => this.s.custom;
    const shape = h('select', { onchange: (e: Event) => this.set({ custom: { ...c(), shape: (e.target as HTMLSelectElement).value as never } }) },
      ...['sphere', 'cube', 'disk', 'cylinder'].map((v) => h('option', { value: v }, v))) as HTMLSelectElement;
    const mat = h('select', { onchange: (e: Event) => {
      const m = MATERIALS[(e.target as HTMLSelectElement).value];
      const vol = volumeOf(c().shape, c().size);
      this.set({ custom: { ...c(), material: m.id, mass: +(m.density * vol).toPrecision(4) } });
    } }, ...Object.values(MATERIALS).map((m) => h('option', { value: m.id }, m.name))) as HTMLSelectElement;
    const size = slider({ label: 'Size (diameter)', min: 0.001, max: 20, value: c().size, log: true, unit: 'm', onChange: (v) => this.set({ custom: { ...c(), size: v } }) });
    const mass = slider({ label: 'Mass', min: 1e-5, max: 100000, value: c().mass, log: true, unit: 'kg', onChange: (v) => this.set({ custom: { ...c(), mass: v } }) });
    const cd = h('input', { type: 'number', step: 'any', placeholder: 'auto', onchange: (e: Event) => { const v = (e.target as HTMLInputElement).value; this.set({ custom: { ...c(), cd: v === '' ? null : Number(v) } }); } }) as HTMLInputElement;
    const dens = h('div', { class: 'hint' });
    this.customBox.append(
      h('div', { class: 'row' }, h('label', {}, 'Shape'), shape),
      h('div', { class: 'row' }, h('label', {}, 'Material'), mat),
      size.el, mass.el,
      h('div', { class: 'row' }, h('label', {}, 'Fixed Cd'), cd),
      dens,
    );
    this.refreshers.push(() => {
      shape.value = c().shape; mat.value = c().material; size.set(c().size); mass.set(c().mass);
      if (document.activeElement !== cd) cd.value = c().cd === null ? '' : String(c().cd);
      const rho = c().mass / volumeOf(c().shape, c().size);
      dens.textContent = `Bulk density ${rho.toPrecision(3)} kg/m³ (${rho < 1025 ? 'floats in sea water' : 'sinks in sea water'})`;
    });
  }

  private buildSearch(): HTMLElement {
    const input = h('input', { type: 'text', placeholder: '🔍  Search a city or landmark… (offline list)' }) as HTMLInputElement;
    const results = h('div', { class: 'search-results' });
    let places: Place[] = [];
    let sel = 0;
    let items: { name: string; sub: string; lat: number; lon: number; lm: Landmark | null }[] = [];
    const render = () => {
      results.innerHTML = '';
      items.forEach((it, i) => {
        const d = h('div', { class: i === sel ? 'sel' : '', onmousedown: (e: Event) => { e.preventDefault(); pick(i); } }, h('span', {}, it.name), h('small', {}, it.sub));
        results.append(d);
      });
      results.classList.toggle('open', items.length > 0);
    };
    const pick = (i: number) => {
      const it = items[i];
      if (!it) return;
      input.value = it.name;
      results.classList.remove('open');
      if (it.lm) this.applyLandmark(it.lm);
      else this.cb.onLocate(it.lat, it.lon, it.name, null);
    };
    input.addEventListener('focus', () => { loadPlaces().then((p) => (places = p)); });
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      sel = 0;
      if (q.length < 2) { items = []; render(); return; }
      const lm = LANDMARKS.filter((l) => l.body === 'earth' && l.name.toLowerCase().includes(q)).slice(0, 5)
        .map((l) => ({ name: l.name, sub: 'landmark', lat: l.lat, lon: l.lon, lm: l }));
      const pl: typeof items = [];
      for (const p of places) {
        if (p[0].toLowerCase().startsWith(q)) pl.push({ name: p[0], sub: `${p[1]} · ${p[4] >= 1e6 ? (p[4] / 1e6).toFixed(1) + 'M' : Math.round(p[4] / 1e3) + 'k'}`, lat: p[2], lon: p[3], lm: null });
        if (pl.length >= 12) break;
      }
      items = [...lm, ...pl];
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); render(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
      if (e.key === 'Enter') pick(sel);
      if (e.key === 'Escape') results.classList.remove('open');
    });
    input.addEventListener('blur', () => setTimeout(() => results.classList.remove('open'), 150));
    return h('div', { class: 'search row' }, h('div', { class: 'grow', style: 'position:relative' }, input, results));
  }

  applyLandmark(l: Landmark) {
    const p = l.preset ?? {};
    const patch: Partial<Scenario> = {
      body: l.body, lat: l.lat, lon: l.lon, siteName: l.name, landmarkId: l.id, groundOverride: l.ground,
      mode: p.mode ?? 'drop', heightAGL: p.mode === 'throw' ? l.dropHeight : l.dropHeight,
    };
    if (p.object) patch.objectId = p.object;
    if (p.speed !== undefined) patch.speed = p.speed;
    if (p.elevation !== undefined) patch.elevation = p.elevation;
    if (p.azimuth !== undefined) patch.azimuth = p.azimuth;
    if (p.deployAGL !== undefined) { patch.deployAGL = p.deployAGL; patch.parachute = true; }
    if (l.body !== 'earth' && !p.object) patch.objectId = this.s.objectId;
    this.store.set(patch);
    this.cb.onLocate(l.lat, l.lon, l.name, l);
  }

  setSiteInfo(html: string) {
    this.siteInfo.innerHTML = html;
  }
  setRunning(running: boolean, label = '▶  SIMULATE') {
    this.runBtn.disabled = running;
    this.runBtn.textContent = running ? 'Computing…' : label;
  }
  setProgress(f: number) {
    (this.progress.firstChild as HTMLElement).style.width = `${Math.round(f * 100)}%`;
  }
  setSlots(slots: Scenario[]) {
    this.slotsBox.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const s = slots[i];
      this.slotsBox.append(s
        ? h('div', { class: 'slot' }, h('span', { class: 'dot', style: `background:${RUN_CSS[i]}` }), h('span', { class: 'lbl', title: describe(s) }, describe(s)), h('button', { class: 'btn small', onclick: () => this.cb.onRemoveSlot(i) }, '✕'))
        : h('div', { class: 'slot empty' }, h('span', { class: 'dot', style: `background:${RUN_CSS[i]}55` }), `Slot ${'ABCD'[i]} — empty`));
    }
  }

  private refresh() {
    for (const r of this.refreshers) r();
  }
}

function volumeOf(shape: string, d: number) {
  switch (shape) {
    case 'cube': return d ** 3;
    case 'disk': return (Math.PI * d * d) / 4 * (d / 10);
    case 'cylinder': return (Math.PI * d * d) / 4 * 2 * d;
    default: return (Math.PI / 6) * d ** 3;
  }
}
const fmtMass = (m: number) => (m >= 1 ? `${+m.toPrecision(4)} kg` : m >= 1e-3 ? `${+(m * 1000).toPrecision(3)} g` : `${+(m * 1e6).toPrecision(3)} mg`);
const fmtLen = (l: number) => (l >= 1 ? `${+l.toPrecision(3)} m` : l >= 0.01 ? `${+(l * 100).toPrecision(3)} cm` : `${+(l * 1000).toPrecision(3)} mm`);
