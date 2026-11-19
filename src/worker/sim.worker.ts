/// <reference lib="webworker" />
/**
 * Simulation worker: owns the gravity model and terrain, runs scenarios off
 * the main thread and streams results back as transferable buffers.
 */
import { parseCoefficientFile, type SphericalHarmonicField } from '../physics/gravity/harmonics';
import { BODIES, bodyAtmosphere, bodyGravity, type BodyId } from '../physics/bodies';
import { FlatTerrain, GridGeoid, GridTerrain, SiteOverrideTerrain, ZERO_GEOID, type LocalGrid, type TerrainSampler } from '../physics/environment';
import { Simulation, type LaunchConfig, type SimResult } from '../physics/simulation';
import type { ObjectSpec } from '../physics/objects';
import type { WeatherOverrides } from '../physics/atmosphere/ussa1976';
import { parseElevationGrid, parseGravityGrid } from '../app/data';
import { runValidation } from '../validation/cases';
import { runEmValidation } from '../validation/emcases';
import { solveLevitation, type LevScenarioInput, type LevSolution } from '../physics/em/solve';
import { buildApparatus } from '../physics/em/apparatus';
import { dynamicsDefaults, forceModelFor, simulateLevitation } from '../physics/em/dynamics';
import { emMaterial } from '../physics/em/materials';

export interface ScenarioInput {
  body: BodyId;
  object: ObjectSpec;
  launch: LaunchConfig;
  weather: WeatherOverrides;
  /** surveyed ground height to enforce at the launch site [m] */
  groundOverride: number | null;
  /** compute comparison twins */
  twins: { vacuum: boolean; noRotation: boolean };
}

export type WorkerRequest =
  | { type: 'init'; egm: ArrayBuffer; gravityGrid: ArrayBuffer; elevationGrid: ArrayBuffer }
  | { type: 'locals'; grids: LocalGrid[] }
  | { type: 'run'; id: number; scenario: ScenarioInput }
  | { type: 'validate'; id: number }
  | { type: 'levitate'; id: number; scenario: LevScenarioInput }
  | { type: 'levDynamics'; id: number; request: LevDynamicsRequest }
  | { type: 'emValidate'; id: number };

export interface LevDynamicsRequest {
  scenario: LevScenarioInput;
  /** starting height [m]; defaults to the solved equilibrium */
  height: number | null;
  /** initial tilt of the body axis [deg] */
  tiltDeg: number;
  /** initial horizontal offset [m] */
  offset: number;
  spinRps: number;
  duration: number;
  /** air drag and rotational damping on or off */
  damping: boolean;
}

export interface LevResponse {
  type: 'levitation';
  id: number;
  solution: LevSolution;
}

export interface LevDynamicsResponse {
  type: 'levDynamics';
  id: number;
  run: { samples: Float64Array; count: number; outcome: string; duration: number; excursion: number; energyDrift: number; measuredFreq: { vertical: number; horizontal: number } };
}

export interface RunResponse {
  type: 'result';
  id: number;
  main: SimResult;
  vacuum: SimResult | null;
  noRotation: SimResult | null;
}

let egm: SphericalHarmonicField | null = null;
let earthTerrain: GridTerrain | null = null;
let geoid: GridGeoid | null = null;
const fields = new Map<BodyId, ReturnType<typeof bodyGravity>>();

const post = (msg: unknown, transfer: Transferable[] = []) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg, transfer);

function environment(s: ScenarioInput) {
  const body = BODIES[s.body];
  let terrain: TerrainSampler;
  let field;
  if (s.body === 'earth') {
    if (!egm || !earthTerrain || !geoid) throw new Error('Worker not initialised');
    field = egm;
    terrain = earthTerrain;
  } else {
    if (!fields.has(s.body)) fields.set(s.body, bodyGravity(s.body as Exclude<BodyId, 'earth'>));
    field = fields.get(s.body)!;
    terrain = new FlatTerrain(s.groundOverride ?? 0);
  }
  if (s.body === 'earth' && s.groundOverride !== null) terrain = new SiteOverrideTerrain(terrain, s.launch.lat, s.launch.lon, s.groundOverride);
  return {
    body,
    field,
    atmosphere: bodyAtmosphere(s.body, s.weather),
    terrain,
    geoid: s.body === 'earth' ? geoid! : ZERO_GEOID,
  };
}

function transfer(r: SimResult | null): Transferable[] {
  return r ? [r.samples.buffer] : [];
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      egm = parseCoefficientFile('EGM2008', msg.egm);
      const g = parseGravityGrid(msg.gravityGrid);
      const e = parseElevationGrid(msg.elevationGrid);
      geoid = new GridGeoid(g.geoid);
      earthTerrain = new GridTerrain(e.elevation, e.ocean);
      post({ type: 'ready' });
      return;
    }
    if (msg.type === 'locals') {
      earthTerrain?.setLocals(msg.grids);
      return;
    }
    if (msg.type === 'run') {
      const s = msg.scenario;
      const env = environment(s);
      const main = new Simulation(env, s.object, s.launch).run((f) => post({ type: 'progress', id: msg.id, frac: f }));
      const vacuum = s.twins.vacuum && !s.launch.vacuum ? new Simulation(env, s.object, { ...s.launch, vacuum: true, maxSamples: 3000 }).run() : null;
      // Coriolis twin: same centrifugal (plumb line) but no Coriolis force — isolates the Coriolis deflection
      const noRotation = s.twins.noRotation && s.launch.rotation ? new Simulation(env, s.object, { ...s.launch, coriolis: false, maxSamples: 3000 }).run() : null;
      const res: RunResponse = { type: 'result', id: msg.id, main, vacuum, noRotation };
      post(res, [...transfer(main), ...transfer(vacuum), ...transfer(noRotation)]);
      return;
    }
    if (msg.type === 'validate') {
      if (!egm) throw new Error('Worker not initialised');
      const results = runValidation(egm, (f) => post({ type: 'progress', id: msg.id, frac: f }));
      post({ type: 'validation', id: msg.id, results });
      return;
    }
    if (msg.type === 'levitate') {
      const solution = solveLevitation(msg.scenario);
      const res: LevResponse = { type: 'levitation', id: msg.id, solution };
      post(res, solution.profile ? [solution.profile.z.buffer, solution.profile.U.buffer, solution.profile.Fz.buffer, solution.profile.B.buffer, solution.profile.kMin.buffer] : []);
      return;
    }
    if (msg.type === 'levDynamics') {
      const r = msg.request;
      const app = buildApparatus(r.scenario.apparatus, r.scenario.params);
      const o = r.scenario.object;
      const mat = emMaterial(o.material);
      const solution = solveLevitation(r.scenario);
      const height = r.height ?? solution.equilibriumHeight ?? app.startHeight;
      const force = forceModelFor(r.scenario.mode, o, mat, app);
      const spec = dynamicsDefaults(app.field, o, force, r.scenario.g, app.scale);
      if (!r.damping) {
        spec.airDensity = 0;
        spec.rotDamping = 0;
      }
      const run = simulateLevitation(spec, {
        position: [r.offset, 0, height], velocity: [0, 0, 0], axis: [0, 0, 1],
        spinRps: r.spinRps, tiltRad: (r.tiltDeg * Math.PI) / 180,
      }, r.duration, 3000);
      const res: LevDynamicsResponse = { type: 'levDynamics', id: msg.id, run };
      post(res, [run.samples.buffer]);
      return;
    }
    if (msg.type === 'emValidate') {
      const results = runEmValidation((f) => post({ type: 'progress', id: msg.id, frac: f }));
      post({ type: 'validation', id: msg.id, results });
      return;
    }
  } catch (err) {
    post({ type: 'error', id: 'id' in msg ? msg.id : -1, message: err instanceof Error ? `${err.message}\n${err.stack}` : String(err) });
  }
};
