import * as THREE from 'three';
import { GlobeView, heatmapTexture, type HeatmapMode } from '../render/globe';
import { LocalView, type CameraMode, type RunVisual } from '../render/local';
import { loadPatch, type Patch } from '../render/tiles';
import { sunDirectionECEF, fmt } from '../render/coords';
import { SimClient } from '../worker/client';
import type { RunResponse, ScenarioInput } from '../worker/sim.worker';
import { Panel } from '../ui/panel';
import { LevPanel } from '../ui/levpanel';
import { LevView } from '../render/lev';
import { showBuildSheet, showEarnshaw, showEmValidation, showLevEquations, showLevReport, showMyths, verdictCard } from '../ui/emdocs';
import {
  DEFAULT_LEV_SCENARIO, MODE_HAS_FIELD, levInput, levObjectFor, paramsFor, type LevScenario,
} from './levscenario';
import { buildApparatus } from '../physics/em/apparatus';
import { CylinderMagnetSource, FieldAssembly } from '../physics/em/sources';
import { objectVolume } from '../physics/em/levitation';
import { MU0 } from '../physics/em/constants';
import { forceModelFor, netForceFn } from '../physics/em/dynamics';
import { emMaterial } from '../physics/em/materials';
import type { LevSolution } from '../physics/em/solve';
import type { LevDynamicsResponse } from '../worker/sim.worker';
import { Hud, summaryCard } from '../ui/hud';
import { Charts } from '../ui/charts';
import { LevCharts } from '../ui/levcharts';
import { showCredits, showEquations, showValidation } from '../ui/docs';
import { h, seg, Store, toast } from '../ui/dom';
import { DEFAULT_SCENARIO, RUN_COLORS, RUN_CSS, describe, objectFor, solarNoonISO, type Scenario } from './scenario';
import type { GravityGrids, ElevationGrids } from './data';
import { BODIES } from '../physics/bodies';
import { GridGeoid, GridTerrain, SiteOverrideTerrain, sampleGrid, overrideRadius, type TerrainSampler } from '../physics/environment';
import { parseCoefficientFile, type SphericalHarmonicField } from '../physics/gravity/harmonics';
import { geodeticToEcef, enuBasis } from '../physics/geodesy';
import { somigliana } from '../physics/gravity/normal';
import { ussa1976 } from '../physics/atmosphere/ussa1976';
import { bodyAtmosphere, bodyGravity } from '../physics/bodies';
import { F, N_FIELDS, type LaunchConfig } from '../physics/simulation';
import { cross, type Vec3 } from '../physics/vec3';
import type { Landmark } from '../data/landmarks';
import { LANDMARKS } from '../data/landmarks';

const DEG = Math.PI / 180;

interface ActiveRun {
  scenario: Scenario;
  response: RunResponse;
  color: number;
  css: string;
}

export class App {
  private renderer: THREE.WebGLRenderer;
  private globe: GlobeView;
  private local: LocalView;
  private view: 'globe' | 'local' | 'lev' = 'globe';
  private store = new Store<Scenario>({ ...DEFAULT_SCENARIO });
  private panel: Panel;
  private hud = new Hud();
  private charts: Charts;
  private client: SimClient;
  private egm: SphericalHarmonicField;
  private terrain: GridTerrain;
  private geoid: GridGeoid;
  private runs: ActiveRun[] = [];
  private slots: Scenario[] = [];
  private playing = false;
  private t = 0;
  private speed = 1;
  private autoSpeed = true;
  private clock = new THREE.Clock();
  private siteKey = '';
  /** loaded terrain patches (finest first) */
  sitePatches: Patch[] = [];
  private loadingSite: Promise<void> | null = null;
  private timeline!: { slider: HTMLInputElement; label: HTMLElement; play: HTMLButtonElement; speedSel: HTMLSelectElement };
  private viewSeg!: ReturnType<typeof seg<'globe' | 'local' | 'lev'>>;
  private camSel!: HTMLSelectElement;
  /** controls that only make sense on the globe */
  private globeOnly: HTMLElement[] = [];
  private legend = h('div', { class: 'map-legend glass' });
  private scale = 1;
  private summaryShown = false;
  private previewTimer = 0;
  private lev: LevView;
  private levPanel: LevPanel;
  private levStore = new Store<LevScenario>({ ...DEFAULT_LEV_SCENARIO });
  private levSolution: LevSolution | null = null;
  private levRun: LevDynamicsResponse['run'] | null = null;
  private levPlaying = false;
  private levT = 0;
  private levSolveTimer = 0;
  private levCharts!: LevCharts;
  private levChartHost!: HTMLElement;

  constructor(
    private canvas: HTMLCanvasElement,
    egmBuf: ArrayBuffer,
    private grav: GravityGrids,
    private elev: ElevationGrids,
    gravBuf: ArrayBuffer,
    elevBuf: ArrayBuffer,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    this.globe = new GlobeView(canvas, aniso);
    this.local = new LocalView(canvas, aniso);
    this.lev = new LevView(canvas);
    this.globe.setGeoidGrid(grav.geoid);
    this.egm = parseCoefficientFile('EGM2008', egmBuf.slice(0));
    this.terrain = new GridTerrain(elev.elevation, elev.ocean);
    this.geoid = new GridGeoid(grav.geoid);
    this.client = new SimClient(egmBuf, gravBuf, elevBuf);

    this.panel = new Panel(this.store, {
      onRun: () => this.runCurrent(),
      onLocate: (lat, lon, name, lm) => this.locate(lat, lon, name, lm),
      onValidation: () => showValidation((p) => this.client.validate(p)),
      onEquations: () => showEquations(this.currentRow(), this.runs[0] ? objectFor(this.runs[0].scenario) : null, this.store.state.body),
      onCredits: () => showCredits(),
      onSaveSlot: () => {
        if (this.slots.length >= 4) return toast('All 4 comparison slots are full');
        this.slots.push({ ...this.store.state });
        this.panel.setSlots(this.slots);
        toast(`Saved to slot ${'ABCD'[this.slots.length - 1]}: ${describe(this.store.state)}`);
      },
      onRemoveSlot: (i) => {
        this.slots.splice(i, 1);
        this.panel.setSlots(this.slots);
      },
      onRunAll: () => this.runAll(),
    });
    this.panel.setSlots(this.slots);
    this.levPanel = new LevPanel(this.levStore, {
      onSolve: () => this.solveLev(),
      onRunDynamics: () => this.runLevDynamics(),
      onEarnshaw: () => showEarnshaw(this.levSolution),
      onMyths: () => showMyths(),
      onBuildSheet: () => (this.levSolution ? showBuildSheet(this.levSolution) : toast('Solve a scenario first.')),
      onValidation: () => showEmValidation((p) => this.client.emValidate(p)),
      onEquations: () => showLevEquations(this.levSolution),
    });
    this.levStore.subscribe((_s, changed) => this.onLevChange(changed));
    this.charts = new Charts(document.getElementById('charts')!);
    this.levChartHost = h('div', { class: 'lev-charts', style: 'display:none;flex:1;min-height:0;flex-direction:column;margin-top:6px' });
    document.getElementById('bottom')!.append(this.levChartHost);
    this.levCharts = new LevCharts(this.levChartHost);
    this.levCharts.onSeek = (t) => this.levSeek(t);
    this.charts.onSeek = (t) => this.seek(t);
    this.buildTopbar();
    this.buildTimeline();
    document.getElementById('app')!.append(this.legend);

    this.local.onAim = (az, el, speed) => {
      this.store.set({ azimuth: +az.toFixed(1), elevation: +el.toFixed(1), speed: +speed.toPrecision(4) });
    };
    this.local.onScale = (s) => (this.scale = s);
    this.store.subscribe((s, changed) => this.onScenarioChange(s, changed));
    this.bindGlobeInput();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.applySun();
    this.globe.camera.position.set(4200, 6500, 14500);
    const s = this.store.state;
    this.locate(s.lat, s.lon, s.siteName, LANDMARKS.find((l) => l.id === s.landmarkId) ?? null, 2.8);
    this.setView('globe');
    this.renderer.setAnimationLoop(() => this.frame());
    if (import.meta.env.DEV) (window as unknown as { __atmo: unknown }).__atmo = this;
  }

  /** dev/test helper: apply a landmark by id and optionally patch the scenario */
  debugLandmark(id: string, patch: Partial<Scenario> = {}) {
    const l = LANDMARKS.find((x) => x.id === id);
    if (l) this.panel.applyLandmark(l);
    this.store.set(patch);
  }
  debugRun() {
    return this.runCurrent();
  }
  debugSeek(frac: number, play = false) {
    this.seek(frac * this.duration);
    this.playing = play;
    this.syncPlay();
  }

  /* ------------------------------------------------------------------ UI */

  private buildTopbar() {
    const top = document.getElementById('topbar')!;
    this.viewSeg = seg<'globe' | 'local' | 'lev'>([
      { value: 'globe', label: '🌐 Globe' },
      { value: 'local', label: '⛰ Site 3D' },
      { value: 'lev', label: '🧲 Levitation', title: 'Ten ways to balance gravity — and why antigravity is not one of them' },
    ], this.view, (v) => this.setView(v));
    const heat = h('select', { class: 'glass', style: 'width:auto;padding:7px 10px', onchange: (e: Event) => this.setHeatmap((e.target as HTMLSelectElement).value as HeatmapMode) },
      h('option', { value: 'off' }, 'Map: satellite'),
      h('option', { value: 'anomaly' }, 'Map: gravity anomaly'),
      h('option', { value: 'gravity' }, 'Map: surface gravity |g|'),
      h('option', { value: 'geoid' }, 'Map: geoid height'));
    const geo = h('select', { class: 'glass', style: 'width:auto;padding:7px 10px', title: 'Exaggerate the geoid — the “gravity potato”', onchange: (e: Event) => this.globe.setGeoidExaggeration(Number((e.target as HTMLSelectElement).value)) },
      h('option', { value: 0 }, 'Shape: true ellipsoid'),
      h('option', { value: 7000 }, 'Shape: geoid ×7 000'),
      h('option', { value: 15000 }, 'Shape: geoid ×15 000'));
    this.camSel = h('select', { class: 'glass', style: 'width:auto;padding:7px 10px', onchange: (e: Event) => this.local.setCameraMode((e.target as HTMLSelectElement).value as CameraMode) },
      h('option', { value: 'follow' }, '🎥 Chase camera'),
      h('option', { value: 'side' }, '🎥 Side view (whole path)'),
      h('option', { value: 'ground' }, '🎥 Ground observer'),
      h('option', { value: 'top' }, '🎥 Top-down'),
      h('option', { value: 'free' }, '🎥 Free camera')) as HTMLSelectElement;
    this.globeOnly = [heat, geo];
    const panelBtn = h('button', { class: 'btn glass panel-toggle', onclick: () => document.getElementById('panel')!.classList.toggle('mobile-hidden') }, '☰');
    document.getElementById('app')!.append(panelBtn);
    top.append(this.viewSeg.el, heat, geo, this.camSel, h('div', { class: 'spacer' }),
      h('button', { class: 'btn glass', onclick: () => (this.view === 'lev'
        ? showLevEquations(this.levSolution)
        : showEquations(this.currentRow(), this.runs[0] ? objectFor(this.runs[0].scenario) : null, this.store.state.body)) }, '∑ Equations'),
      h('button', { class: 'btn glass', onclick: () => (this.view === 'lev'
        ? showEmValidation((p) => this.client.emValidate(p))
        : showValidation((p) => this.client.validate(p))) }, '✔ Validation'));
  }

  private buildTimeline() {
    const root = document.getElementById('timeline')!;
    const play = h('button', { class: 'btn small', onclick: () => this.togglePlay() }, '⏸') as HTMLButtonElement;
    const restart = h('button', { class: 'btn small', onclick: () => {
      if (this.view === 'lev') { this.levSeek(0); this.levPlaying = true; } else { this.seek(0); this.playing = true; }
      this.syncPlay();
    } }, '⟲');
    const slider = h('input', { type: 'range', min: 0, max: 10000, step: 1, class: 'grow', style: 'flex:1' }) as HTMLInputElement;
    slider.addEventListener('input', () => {
      if (this.view === 'lev') this.levSeek((+slider.value / 10000) * this.lev.duration);
      else this.seek((+slider.value / 10000) * this.duration);
    });
    const speedSel = h('select', { style: 'width:auto', onchange: (e: Event) => {
      const v = (e.target as HTMLSelectElement).value;
      this.autoSpeed = v === 'auto';
      if (!this.autoSpeed) this.speed = Number(v);
      else this.pickAutoSpeed();
    } }, h('option', { value: 'auto' }, 'auto'), ...[0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 100, 300, 1000, 5000].map((v) => h('option', { value: v }, `${v}×`))) as HTMLSelectElement;
    const label = h('span', { class: 't' });
    const min = h('button', { class: 'btn small', title: 'Show/hide charts', onclick: () => document.getElementById('bottom')!.classList.toggle('min') }, '▤');
    root.append(play, restart, slider, label, speedSel, min);
    this.timeline = { slider, label, play, speedSel };
  }

  private setHeatmap(mode: HeatmapMode) {
    if (mode === 'off') {
      this.globe.setHeatmap('off');
      this.legend.classList.remove('show');
      return;
    }
    const grid = mode === 'anomaly' ? this.grav.disturbance : mode === 'geoid' ? this.grav.geoid : this.grav.surfaceG;
    const { texture, legend } = heatmapTexture(grid, mode);
    this.globe.setHeatmap(mode, texture, 0.82);
    this.legend.innerHTML = `<div>${legend.title}</div><div class="bar" style="background:${legend.gradient}"></div><div class="ticks"><span>${legend.min}</span><span>${legend.unit}</span><span>${legend.max}</span></div>`;
    this.legend.classList.add('show');
    if (this.view !== 'globe') this.setView('globe');
  }

  private setView(v: 'globe' | 'local' | 'lev') {
    this.view = v;
    this.viewSeg.set(v);
    this.globe.controls.enabled = v === 'globe';
    this.local.controls.enabled = v === 'local';
    this.local.active = v === 'local';
    this.lev.controls.enabled = v === 'lev';
    this.lev.active = v === 'lev';
    this.camSel.style.display = v === 'local' ? '' : 'none';
    for (const el of this.globeOnly) el.style.display = v === 'lev' ? 'none' : '';
    document.getElementById('levpanel')!.classList.toggle('show', v === 'lev');
    document.getElementById('panel')!.classList.toggle('hidden', v === 'lev');
    document.getElementById('bottom')!.classList.toggle('hidden', v === 'lev' && !this.levRun);
    document.getElementById('charts')!.style.display = v === 'lev' ? 'none' : '';
    this.levChartHost.style.display = v === 'lev' && this.levRun ? 'flex' : 'none';
    document.getElementById('hud')!.classList.toggle('hidden', v === 'lev');
    if (v === 'lev') {
      this.applyLevScene();
      if (!this.levSolution) this.solveLev();
      else this.showLevVerdict(this.levSolution);
    }
    if (v === 'local') this.ensureSite().catch((e) => toast(`Could not build the site: ${e.message}`, true));
    if (v === 'globe') this.legend.classList.toggle('show', this.legend.innerHTML !== '' && (document.querySelector('#topbar select') as HTMLSelectElement)?.value !== 'off');
    else this.legend.classList.remove('show');
    if (v !== 'lev') document.getElementById('summary')!.classList.remove('show');
  }

  /* ------------------------------------------------------------ levitation */

  /**
   * Exact local gravity at the chosen site. The levitation requirement is
   * proportional to g, so the field needed to float a frog really is 0.35 %
   * lower on a mountain in Peru than at the pole — small, real, and computed
   * from the same EGM2008 model the ballistics uses.
   */
  private localGravity(): number {
    const s = this.store.state;
    if (s.body !== 'earth') {
      const field = bodyGravity(s.body);
      const ell = BODIES[s.body].ellipsoid;
      const r = geodeticToEcef(s.lat * DEG, s.lon * DEG, 0, ell);
      const a = field.accel(r);
      const w2 = BODIES[s.body].omega ** 2;
      return Math.hypot(a[0] + w2 * r[0], a[1] + w2 * r[1], a[2]);
    }
    const ground = Math.max(this.terrain.elevation(s.lat, s.lon), 0);
    const r = geodeticToEcef(s.lat * DEG, s.lon * DEG, ground + this.geoid.undulation(s.lat, s.lon), BODIES.earth.ellipsoid);
    const a = this.egm.accel(r);
    const w2 = BODIES.earth.omega ** 2;
    return Math.hypot(a[0] + w2 * r[0], a[1] + w2 * r[1], a[2]);
  }

  private onLevChange(changed: Set<keyof LevScenario>) {
    const visual: (keyof LevScenario)[] = ['fieldLines', 'fieldSlice', 'forceArrows', 'apparatus', 'params', 'objectId', 'custom', 'mode'];
    const physical: (keyof LevScenario)[] = ['apparatus', 'params', 'objectId', 'custom', 'mode', 'medium', 'temperature', 'cooling'];
    if (changed.has('show')) this.lev.setShow(this.levStore.state.show);
    if (visual.some((k) => changed.has(k)) && this.view === 'lev') this.applyLevScene();
    if (physical.some((k) => changed.has(k))) {
      this.levRun = null;
      this.lev.setRun(null);
      this.levCharts.setRun(null);
      if (this.view === 'lev') document.getElementById('bottom')!.classList.add('hidden');
      clearTimeout(this.levSolveTimer);
      this.levSolveTimer = window.setTimeout(() => {
        if (this.view === 'lev') this.solveLev(true);
      }, 200);
    }
  }

  /** rebuild the apparatus, object and field visuals from the scenario */
  private applyLevScene() {
    const s = this.levStore.state;
    const app = buildApparatus(s.apparatus, paramsFor(s));
    const obj = levObjectFor(s);
    this.lev.setApparatus(app, app.field);
    this.lev.setObject(obj);
    // The superconducting mode has no sources in the apparatus: what is worth
    // drawing is the floating magnet's own field together with the image
    // dipole that B⊥ = 0 on the superconductor's surface demands. That image
    // is the whole mechanism, so it should be visible.
    let display = app.field;
    let floor: number | undefined;
    let seeds: Vec3[] | undefined;
    if (s.mode === 'superconductor' && obj.moment > 0) {
      const hEq = this.levSolution?.equilibriumHeight ?? app.startHeight;
      const r = Math.max(obj.size / 2, 1e-3);
      const t = Math.max(obj.thickness, 1e-3);
      const Br = (obj.moment * MU0) / Math.max(objectVolume(obj), 1e-12);
      // the real magnet, not a point dipole: a dipole singularity would throw
      // a starburst of field lines across the whole scene
      display = new FieldAssembly([
        new CylinderMagnetSource('floater', [0, 0, hEq], [0, 0, 1], r, t, Br),
        new CylinderMagnetSource('image', [0, 0, -hEq], [0, 0, 1], r, t, -Br),
      ]);
      floor = 0;
      seeds = [];
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        seeds.push([r * 0.65 * Math.cos(a), r * 0.65 * Math.sin(a), hEq + t * 0.6]);
        seeds.push([r * 1.25 * Math.cos(a), r * 1.25 * Math.sin(a), hEq]);
      }
    }
    this.lev.setDisplayField(display);
    const hasField = MODE_HAS_FIELD[s.mode] && display.sources.length > 0;
    this.lev.setFieldLines(s.fieldLines && hasField, seeds, floor);
    if (s.mode === 'acoustic') {
      this.lev.setAcousticField(s.fieldSlice, {
        cavity: app.extras.cavity, wavelength: app.extras.wavelength, aperture: app.extras.aperture,
      });
    } else {
      this.lev.setFieldSlice(s.fieldSlice && hasField);
    }
    if (s.forceArrows && hasField) {
      const force = forceModelFor(s.mode, obj, emMaterial(obj.material), app);
      this.lev.setForceArrows(true, netForceFn(app.field, force, obj.mass, this.localGravity()));
    } else {
      this.lev.setForceArrows(false, null);
    }
    // the servo magnet grips from above, so the object hangs a gap below its
    // pole faces rather than sitting at a solved equilibrium height
    const objHalf = (obj.shape === 'sphere' || obj.shape === 'cube' ? obj.size : obj.thickness) / 2;
    const height = s.mode === 'servo'
      ? (app.extras.poleZ ?? 0) - app.extras.gap - objHalf
      : this.levSolution?.equilibriumHeight ?? app.startHeight;
    this.lev.setObjectHeight(height);
    if (this.levSolution) this.lev.setEnergy(this.levSolution);
    this.lev.setShow(s.show);
    this.lev.refit();
  }

  private async solveLev(quiet = false) {
    const s = this.levStore.state;
    if (!quiet) this.levPanel.setRunning(true);
    try {
      await this.client.ready;
      const g = this.localGravity();
      const sol = await this.client.levitate(levInput(s, g, BODIES[this.store.state.body].name, this.store.state.siteName));
      this.levSolution = sol;
      this.levPanel.setSite(`<b>${this.store.state.siteName}</b><div class="kv" style="margin-top:4px">`
        + `<span>World</span><span>${BODIES[this.store.state.body].name}</span>`
        + `<span>Local gravity</span><span>${g.toFixed(5)} m/s²</span>`
        + `<span>vs standard</span><span>${(g / 9.80665).toFixed(5)} g₀</span></div>`
        + `<div class="hint">Every requirement here scales with the local g, taken from EGM2008 at this site. Move the launch site on the globe and the field needed changes with it.</div>`);
      this.showLevVerdict(sol);
      if (this.view === 'lev') {
        this.lev.setEnergy(sol);
        if (s.mode !== 'servo') {
          this.lev.setObjectHeight(sol.equilibriumHeight ?? buildApparatus(s.apparatus, paramsFor(s)).startHeight);
          // the solved height can be well outside the apparatus, so re-frame
          this.lev.refit();
        }
      }
    } catch (e) {
      toast(`Levitation solve failed: ${(e as Error).message.split('\n')[0]}`, true, 8000);
      console.error(e);
    } finally {
      if (!quiet) this.levPanel.setRunning(false);
    }
  }

  private showLevVerdict(sol: LevSolution) {
    const el = document.getElementById('summary')!;
    el.classList.add('glass');
    el.innerHTML = `${verdictCard(sol)}<div class="row" style="margin-top:10px"><button class="btn small" id="lev-more">Full report</button><button class="btn small" id="lev-build">Build sheet</button></div>`;
    el.classList.toggle('show', this.view === 'lev');
    document.getElementById('lev-more')?.addEventListener('click', () => showLevReport(sol));
    document.getElementById('lev-build')?.addEventListener('click', () => showBuildSheet(sol));
  }

  private async runLevDynamics() {
    const s = this.levStore.state;
    if (!MODE_HAS_FIELD[s.mode]) {
      toast('This mode has no magnetic field to time-step — its solution is analytic.');
      return;
    }
    this.levPanel.setDynRunning(true);
    try {
      await this.client.ready;
      const g = this.localGravity();
      const run = await this.client.levDynamics({
        scenario: levInput(s, g, BODIES[this.store.state.body].name, this.store.state.siteName),
        height: null, tiltDeg: s.tiltDeg, offset: s.offset, spinRps: s.spinRps,
        duration: s.duration, damping: s.damping,
      });
      this.levRun = run;
      this.lev.setRun(run);
      this.levCharts.setRun(run);
      document.getElementById('bottom')!.classList.remove('hidden');
      document.getElementById('bottom')!.classList.add('show', 'glass');
      document.getElementById('charts')!.style.display = 'none';
      this.levChartHost.style.display = 'flex';
      this.levT = 0;
      this.levPlaying = true;
      this.lev.setTime(0);
      this.syncPlay();
      const outcome = run.outcome === 'levitating'
        ? `Still up after ${run.duration.toFixed(1)} s — it stayed within ${(run.excursion * 1000).toFixed(2)} mm`
        : run.outcome === 'fell' ? `Fell after ${run.duration.toFixed(2)} s`
          : run.outcome === 'flipped' ? `Tipped over after ${run.duration.toFixed(2)} s`
            : `Escaped after ${run.duration.toFixed(2)} s`;
      toast(`${outcome}. Energy conserved to ${run.energyDrift.toExponential(1)}.`, run.outcome !== 'levitating', 7000);
    } catch (e) {
      toast(`Run failed: ${(e as Error).message.split('\n')[0]}`, true, 8000);
    } finally {
      this.levPanel.setDynRunning(false);
    }
  }

  /** dev/test hooks for the levitation view */
  debugLev(patch: Partial<LevScenario> = {}) {
    this.levStore.set(patch);
    this.setView('lev');
    return this.solveLev();
  }
  debugLevRun() {
    return this.runLevDynamics();
  }
  debugLevShow(show: 'apparatus' | 'energy') {
    this.levStore.set({ show });
  }
  get debugLevSolution() {
    return this.levSolution;
  }

  private bindGlobeInput() {
    const hover = document.getElementById('hover-info')!;
    hover.classList.add('glass');
    let down: { x: number; y: number } | null = null;
    const ndcOf = (e: MouseEvent) => {
      const r = this.canvas.getBoundingClientRect();
      return new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    this.canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    this.canvas.addEventListener('pointerup', (e) => {
      if (this.view !== 'globe' || !down) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      const p = this.globe.pick(ndcOf(e));
      if (p) {
        const near = this.nearestPlaceName(p.lat, p.lon);
        this.store.set({ lat: p.lat, lon: p.lon, siteName: near, landmarkId: null, groundOverride: null });
        this.locate(p.lat, p.lon, near, null, 1.6, false);
      }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.view !== 'globe') { hover.classList.remove('show'); return; }
      const p = this.globe.pick(ndcOf(e));
      if (!p) { hover.classList.remove('show'); return; }
      hover.style.left = `${e.clientX + 16}px`;
      hover.style.top = `${e.clientY + 12}px`;
      hover.classList.add('show');
      hover.innerHTML = this.surfaceInfoHtml(p.lat, p.lon, true);
    });
    this.canvas.addEventListener('pointerleave', () => hover.classList.remove('show'));
  }

  private nearestPlaceName(lat: number, lon: number) {
    return `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? 'E' : 'W'}`;
  }

  /** Surface gravity & geodesy readout (grids for hover, exact field for the site card). */
  private surfaceInfoHtml(lat: number, lon: number, quick: boolean, groundOverride: number | null = null): string {
    const body = this.store.state.body;
    if (body !== 'earth') {
      const field = bodyGravity(body);
      const ell = BODIES[body].ellipsoid;
      const r = geodeticToEcef(lat * DEG, lon * DEG, groundOverride ?? 0, ell);
      const a = field.accel(r);
      const w2 = BODIES[body].omega ** 2;
      const g = Math.hypot(a[0] + w2 * r[0], a[1] + w2 * r[1], a[2]);
      const atm = bodyAtmosphere(body).at(groundOverride ?? 0);
      return `<div class="kv"><span>Location</span><span>${fmt.latlon(lat, lon)}</span><span>Gravity |g|</span><span>${g.toFixed(4)} m/s²</span><span>vs Earth</span><span>${(g / 9.80665).toFixed(3)} g₀</span><span>Air density</span><span>${atm.rho ? atm.rho.toPrecision(3) + ' kg/m³' : 'vacuum'}</span></div>`;
    }
    const elev = groundOverride ?? this.terrain.elevation(lat, lon);
    const ocean = groundOverride === null && this.terrain.isOcean(lat, lon);
    const surface = ocean ? 0 : elev;
    const N = this.geoid.undulation(lat, lon);
    let g: number;
    if (quick) {
      // ellipsoid value + free-air gradient (−0.3086 mGal/m) to the surface height
      g = sampleGrid(this.grav.surfaceG, lat, lon) - 3.086e-6 * (surface + N);
    } else {
      const r = geodeticToEcef(lat * DEG, lon * DEG, surface + N, BODIES.earth.ellipsoid);
      const a = this.egm.accel(r);
      const w2 = BODIES.earth.omega ** 2;
      g = Math.hypot(a[0] + w2 * r[0], a[1] + w2 * r[1], a[2]);
    }
    const dg = sampleGrid(this.grav.disturbance, lat, lon);
    const rho = ussa1976(surface).rho;
    return `<div class="kv">
      <span>Location</span><span>${fmt.latlon(lat, lon)}</span>
      <span>${ocean ? 'Sea depth' : 'Elevation'}</span><span>${ocean ? `${(-elev).toFixed(0)} m` : `${elev.toFixed(0)} m`}</span>
      <span>Local gravity |g|</span><span>${g.toFixed(quick ? 5 : 6)} m/s²</span>
      <span>Normal (WGS 84)</span><span>${somigliana(lat * DEG).toFixed(5)} m/s²</span>
      <span>Gravity anomaly</span><span>${dg >= 0 ? '+' : ''}${dg.toFixed(1)} mGal</span>
      <span>Geoid height N</span><span>${N.toFixed(2)} m</span>
      <span>Air density</span><span>${rho.toFixed(4)} kg/m³</span></div>`;
  }

  private locate(lat: number, lon: number, name: string, lm: Landmark | null, flyDur = 2.2, setStore = true) {
    const s = this.store.state;
    if (setStore && !lm) this.store.set({ lat, lon, siteName: name, landmarkId: null, groundOverride: null });
    if (lm && this.globe && s.body !== lm.body) {
      // handled by onScenarioChange (body switch)
    }
    if (this.store.state.sunMode === 'noon') this.store.set({ date: solarNoonISO(lon) });
    const body = this.store.state.body;
    const alt = body === 'jupiter' ? 60000 : body === 'earth' ? 1800 : 900;
    this.globe.flyTo(lat, lon, alt, flyDur);
    const g = this.store.state.groundOverride;
    this.globe.setLaunch(lat, lon, (g ?? (body === 'earth' ? Math.max(this.terrain.elevation(lat, lon), 0) : 0)) + (body === 'earth' ? this.geoid.undulation(lat, lon) : 0));
    this.globe.setImpact(null);
    this.panel.setSiteInfo(`<b>${name}</b>${lm ? `<div class="hint">${lm.note}</div>` : ''}` + this.surfaceInfoHtml(lat, lon, false, this.store.state.groundOverride));
    this.siteKey = '';
    if (this.view === 'local') this.ensureSite().catch((e) => toast(e.message, true));
  }

  private onScenarioChange(s: Scenario, changed: Set<keyof Scenario>) {
    if (changed.has('body')) {
      this.applySun();
      this.globe.buildPlanet(s.body);
      this.globe.clearTrajectories();
      this.siteKey = '';
    }
    if (changed.has('sunMode') && s.sunMode === 'noon') this.store.set({ date: solarNoonISO(s.lon) });
    if (changed.has('date')) this.applySun();
    if (this.view === 'local' && (changed.has('mode') || changed.has('heightAGL') || changed.has('azimuth') || changed.has('elevation') || changed.has('speed'))) {
      this.local.setLaunch(s.mode, s.heightAGL, s.azimuth, s.elevation, s.speed);
      if (!this.playing) this.local.setAimParams(s.azimuth, s.elevation, s.speed);
    }
    if (s.mode === 'throw' && this.view === 'local') this.schedulePreview();
    else this.local.setPreview(null);
  }

  private applySun() {
    const s = this.store.state;
    let sun = sunDirectionECEF(new Date(s.date));
    if (s.body !== 'earth') {
      // other worlds: an afternoon Sun at 35° elevation from the south-west (their solar ephemeris is not modelled)
      const el = 35 * DEG, az = 225 * DEG;
      const { e, n, u } = enuBasis(s.lat * DEG, s.lon * DEG);
      const d = [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)];
      sun = [e[0] * d[0] + n[0] * d[1] + u[0] * d[2], e[1] * d[0] + n[1] * d[1] + u[1] * d[2], e[2] * d[0] + n[2] * d[1] + u[2] * d[2]];
    }
    this.globe.setSun(sun);
    this.local.setSun(sun);
  }

  private resize() {
    const w = window.innerWidth, hgt = window.innerHeight;
    this.renderer.setSize(w, hgt, false);
    this.globe.setSize(w, hgt);
    this.local.setSize(w, hgt);
    this.lev.setSize(w, hgt);
  }

  /* ------------------------------------------------------------------ site */

  private siteGround(): { ground: number; N: number; terrain: TerrainSampler } {
    const s = this.store.state;
    if (s.body !== 'earth') return { ground: s.groundOverride ?? 0, N: 0, terrain: this.terrain };
    let t: TerrainSampler = this.terrain;
    if (s.groundOverride !== null) t = new SiteOverrideTerrain(this.terrain, s.lat, s.lon, s.groundOverride);
    const ground = t.isOcean(s.lat, s.lon) ? 0 : t.elevation(s.lat, s.lon);
    return { ground, N: this.geoid.undulation(s.lat, s.lon), terrain: t };
  }

  private ensureSite(): Promise<void> {
    const s = this.store.state;
    const key = `${s.body}:${s.lat.toFixed(6)}:${s.lon.toFixed(6)}:${s.groundOverride}`;
    if (key === this.siteKey && this.loadingSite) return this.loadingSite;
    this.siteKey = key;
    this.loadingSite = (async () => {
      this.applySun();
      if (s.body === 'earth' && Math.abs(s.lat) < 84.5) {
        toast('Loading terrain & satellite imagery for the site…', false, 6000);
        let fOuter = 0, fInner = 0;
        const prog = () => this.panel.setProgress((fOuter + fInner) / 2);
        const [outer, inner] = await Promise.all([
          loadPatch({ lat: s.lat, lon: s.lon, z: 11, n: 5, globalElevation: this.elev.elevation, globalOcean: this.elev.ocean, onProgress: (f) => { fOuter = f; prog(); } }),
          loadPatch({ lat: s.lat, lon: s.lon, z: 14, n: 4, globalElevation: this.elev.elevation, globalOcean: this.elev.ocean, onProgress: (f) => { fInner = f; prog(); } }),
        ]);
        if (key !== this.siteKey) return;
        this.sitePatches = [inner, outer];
        this.terrain.setLocals([inner.grid, outer.grid]);
        this.client.setLocals([inner.grid, outer.grid]);
        const { ground, N } = this.siteGround();
        this.local.setSite({ body: s.body, lat: s.lat, lon: s.lon, groundMSL: ground, geoidN: N, groundOverride: s.groundOverride, overrideRadius: s.groundOverride === null ? 40 : overrideRadius(s.groundOverride, this.terrain.elevation(s.lat, s.lon)) });
        this.local.setGroundGrids([inner.grid, outer.grid]);
        this.applySun();
        this.local.buildRegional(this.elev.elevation, this.elev.ocean, { latS: outer.latS, latN: outer.latN, lonW: outer.lonW, lonE: outer.lonE });
        this.local.addPatch(outer, { segments: 256, sink: -3, hole: inner, water: true });
        this.local.addPatch(inner, { segments: 256, sink: 0, water: false });
        this.panel.setSiteInfo(`<b>${s.siteName}</b>${s.landmarkId ? `<div class="hint">${LANDMARKS.find((l) => l.id === s.landmarkId)?.note ?? ''}</div>` : ''}` + this.surfaceInfoHtml(s.lat, s.lon, false, s.groundOverride));
        if (!inner.elevationOk || !outer.imageryOk) toast('Some web tiles were unavailable — using the offline global grid / tinted terrain there.', false, 5000);
        this.panel.setProgress(0);
      } else {
        this.terrain.setLocals([]);
        this.client.setLocals([]);
        const { ground, N } = this.siteGround();
        this.local.setSite({ body: s.body, lat: s.lat, lon: s.lon, groundMSL: ground, geoidN: N, groundOverride: s.body === 'earth' ? s.groundOverride : null, overrideRadius: 40 });
        this.applySun();
      }
      this.local.setLaunch(s.mode, s.heightAGL, s.azimuth, s.elevation, s.speed);
      if (!this.runs.length) this.local.frameLaunch(s.heightAGL, objectFor(s).length);
      if (s.mode === 'throw') this.schedulePreview();
    })();
    return this.loadingSite;
  }

  /* ------------------------------------------------------------------ simulation */

  private launchConfig(s: Scenario, quick = false): LaunchConfig {
    const obj = objectFor(s);
    return {
      lat: s.lat, lon: s.lon, mode: s.mode, heightAGL: s.heightAGL, speed: s.speed, elevation: s.elevation, azimuth: s.azimuth,
      spinRpm: s.spinRpm, spinMode: s.spinMode, deployAGL: s.parachute && obj.parachute ? s.deployAGL : null,
      vacuum: s.vacuum, wind: s.wind, rotation: s.rotation, water: s.water,
      gravityDegree: quick ? Math.min(s.gravityDegree, 24) : s.gravityDegree,
      maxTime: quick ? Math.min(s.maxTimeHours * 3600, 3 * 3600) : s.maxTimeHours * 3600,
      rtol: quick ? 1e-7 : s.rtol,
      maxSamples: quick ? 700 : 8000,
    };
  }

  private input(s: Scenario, quick = false): ScenarioInput {
    return {
      body: s.body, object: objectFor(s), launch: this.launchConfig(s, quick), weather: s.weather,
      groundOverride: s.groundOverride, twins: { vacuum: !quick, noRotation: !quick && s.body === 'earth' },
    };
  }

  private schedulePreview() {
    clearTimeout(this.previewTimer);
    this.previewTimer = window.setTimeout(async () => {
      const s = this.store.state;
      if (s.mode !== 'throw' || this.view !== 'local') return;
      try {
        await this.client.ready;
        const res = await this.client.preview(this.input(s, true));
        if (res && this.store.state.mode === 'throw') this.local.setPreview(res.main);
      } catch { /* preview is best-effort */ }
    }, 120);
  }

  private async runCurrent() {
    await this.runScenarios([{ ...this.store.state }]);
  }

  private async runAll() {
    if (!this.slots.length) return toast('Add setups to the comparison slots first (Compare runs → ＋ Add current setup).');
    await this.runScenarios(this.slots.map((s) => ({ ...s })));
  }

  private async runScenarios(list: Scenario[]) {
    this.panel.setRunning(true);
    try {
      await this.client.ready;
      // the 3-D site is built around the first scenario
      const first = list[0];
      if (first.lat !== this.store.state.lat || first.lon !== this.store.state.lon || first.body !== this.store.state.body) this.store.set({ ...first });
      await this.ensureSite();
      const out: ActiveRun[] = [];
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        const res = await this.client.run(this.input(s), (f) => this.panel.setProgress((i + f) / list.length));
        out.push({ scenario: s, response: res, color: list.length === 1 ? RUN_COLORS[0] : RUN_COLORS[i], css: list.length === 1 ? RUN_CSS[0] : RUN_CSS[i] });
      }
      this.panel.setProgress(0);
      this.showRuns(out);
    } catch (e) {
      toast(`Simulation failed: ${(e as Error).message.split('\n')[0]}`, true, 8000);
      console.error(e);
    } finally {
      this.panel.setRunning(false);
    }
  }

  private spinAxisENU(s: Scenario): Vec3 | null {
    if (s.spinMode === 'none' || s.spinRpm <= 0) return null;
    const el = s.elevation * DEG, az = s.azimuth * DEG;
    const v: Vec3 = s.mode === 'throw' ? [Math.cos(el) * Math.sin(az), Math.cos(el) * Math.cos(az), Math.sin(el)] : [Math.sin(az), Math.cos(az), 0];
    const up: Vec3 = [0, 0, 1];
    switch (s.spinMode) {
      case 'backspin': return cross(v, up);
      case 'topspin': return cross(up, v);
      case 'curveLeft': return up;
      case 'curveRight': return [0, 0, -1];
      default: return v;
    }
  }

  private showRuns(list: ActiveRun[]) {
    this.runs = list;
    const vis: RunVisual[] = list.map((r, i) => ({
      key: `${i}:${Date.now()}`, result: r.response.main, object: objectFor(r.scenario), color: r.color, primary: i === 0, spinAxisENU: this.spinAxisENU(r.scenario),
    }));
    // twins as faint extra runs (primary only)
    this.local.setRuns(vis);
    this.local.setPreview(null);
    // globe trajectories
    this.globe.clearTrajectories();
    list.forEach((r, i) => {
      const m = r.response.main;
      const pts = new Float32Array(m.count * 3);
      for (let k = 0; k < m.count; k++) {
        pts[k * 3] = m.samples[k * N_FIELDS + F.x];
        pts[k * 3 + 1] = m.samples[k * N_FIELDS + F.y];
        pts[k * 3 + 2] = m.samples[k * N_FIELDS + F.z];
      }
      this.globe.setTrajectory(`run${i}`, pts, r.color, 2.5);
    });
    const p = list[0].response.main.summary;
    if (p.outcome === 'impact' || p.outcome === 'seabed' || p.outcome === 'floating') this.globe.setImpact(p.impactLat, p.impactLon, 0);
    this.charts.setRuns(list.map((r, i) => ({
      label: list.length > 1 ? 'ABCD'[i] : objectFor(r.scenario).name, color: r.css, result: r.response.main, vacuum: r.response.vacuum,
    })));
    document.getElementById('bottom')!.classList.add('show', 'glass');
    this.hud.show(true);
    this.summaryShown = false;
    document.getElementById('summary')!.classList.remove('show');
    this.setView('local');
    this.t = 0;
    this.playing = true;
    if (this.autoSpeed) this.pickAutoSpeed();
    this.camSel.value = p.range > 3000 ? 'side' : 'follow';
    this.local.setTime(0);
    this.local.setCameraMode(this.camSel.value as CameraMode);
    if (this.camSel.value === 'follow') this.local.frameLaunch(Math.max(list[0].scenario.heightAGL, 0.01), objectFor(list[0].scenario).length);
    this.local.setTime(0);
    this.syncPlay();
  }

  private get duration() {
    return this.local.duration;
  }

  private pickAutoSpeed() {
    const d = this.duration;
    // short events in real time, long ones compressed to ~25 s of playback
    this.speed = d <= 12 ? 1 : d / 25;
    this.timeline.speedSel.value = 'auto';
  }

  private togglePlay() {
    if (this.view === 'lev') {
      if (this.levT >= this.lev.duration) this.levT = 0;
      this.levPlaying = !this.levPlaying;
      this.syncPlay();
      return;
    }
    if (this.t >= this.duration) this.t = 0;
    this.playing = !this.playing;
    this.syncPlay();
  }

  private levSeek(t: number) {
    this.levT = Math.min(Math.max(t, 0), this.lev.duration);
    this.lev.setTime(this.levT);
    this.levCharts.setCursor(this.levT);
  }
  private syncPlay() {
    const playing = this.view === 'lev' ? this.levPlaying : this.playing;
    this.timeline.play.textContent = playing ? '⏸' : '▶';
  }

  private seek(t: number) {
    this.t = Math.min(Math.max(t, 0), this.duration);
    this.local.setTime(this.t);
  }

  private currentRow(): Float64Array | null {
    return this.runs.length ? this.local.sampleAt(0, this.t) : null;
  }

  /* ------------------------------------------------------------------ loop */

  private frame() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.runs.length) {
      this.local.hideAim = this.t > 0;
      if (this.playing) {
        this.t += dt * this.speed;
        if (this.t >= this.duration) {
          this.t = this.duration;
          this.playing = false;
          this.syncPlay();
        }
        this.local.setTime(this.t);
      }
      const row = this.currentRow();
      if (row) {
        const r0 = this.runs[0];
        this.hud.update(row, r0.response.main.summary, objectFor(r0.scenario), this.scale);
        this.globe.setObjectPosition([row[F.x], row[F.y], row[F.z]]);
      }
      this.timeline.slider.value = String(this.duration ? Math.round((this.t / this.duration) * 10000) : 0);
      this.timeline.label.textContent = `${fmt.time(this.t)} / ${fmt.time(this.duration)}  ·  ${this.speed >= 10 ? Math.round(this.speed) : +this.speed.toFixed(2)}×`;
      this.charts.setCursor(this.t);
      if (!this.summaryShown && this.t >= this.duration && this.duration > 0) this.showSummary();
    }
    if (this.view === 'lev') {
      if (this.levRun) {
        if (this.levPlaying) {
          this.levT += dt;
          if (this.levT >= this.lev.duration) {
            this.levT = this.lev.duration;
            this.levPlaying = false;
            this.syncPlay();
          }
          this.lev.setTime(this.levT);
          this.levCharts.setCursor(this.levT);
        }
        const d = this.lev.duration;
        this.timeline.slider.value = String(d ? Math.round((this.levT / d) * 10000) : 0);
        this.timeline.label.textContent = `${this.levT.toFixed(2)} s / ${d.toFixed(2)} s · ${this.levRun.outcome}`;
      }
      this.lev.update(dt);
      this.lev.render(this.renderer);
    } else if (this.view === 'globe') {
      this.globe.update(dt);
      this.globe.render(this.renderer);
    } else {
      this.local.update(dt);
      this.local.render(this.renderer);
    }
  }

  private showSummary() {
    this.summaryShown = true;
    const r = this.runs[0];
    const main = r.response.main;
    let noRot: { dx: number; dir: string } | null = null;
    if (r.response.noRotation) {
      const a = (main.count - 1) * N_FIELDS, b = (r.response.noRotation.count - 1) * N_FIELDS;
      const de = main.samples[a + F.east] - r.response.noRotation.samples[b + F.east];
      const dn = main.samples[a + F.north] - r.response.noRotation.samples[b + F.north];
      const dir = `${Math.abs(dn) > 0.25 * Math.abs(de) ? (dn > 0 ? 'N' : 'S') : ''}${Math.abs(de) > 0.25 * Math.abs(dn) ? (de > 0 ? 'E' : 'W') : ''}`;
      noRot = { dx: Math.hypot(de, dn), dir: `towards ${dir}` };
    }
    const el = document.getElementById('summary')!;
    el.classList.add('glass');
    let html = summaryCard(main.summary, r.response.vacuum?.summary ?? null, noRot, objectFor(r.scenario));
    if (this.runs.length > 1) {
      html += `<div style="margin-top:10px;border-top:1px solid var(--line);padding-top:8px" class="kv">${this.runs
        .map((x, i) => `<span style="color:${x.css}">${'ABCD'[i]} ${objectFor(x.scenario).emoji}</span><span>${fmt.time(x.response.main.summary.flightTime)} · ${fmt.speed(x.response.main.summary.impactSpeed)} · ${fmt.len(x.response.main.summary.range)}</span>`)
        .join('')}</div>`;
    }
    el.innerHTML = html;
    el.classList.add('show');
  }
}

