import { BODIES, type BodyDef } from '../src/physics/bodies';
import { FlatTerrain, NO_WIND, ZERO_GEOID } from '../src/physics/environment';
import { Vacuum, type Atmosphere } from '../src/physics/atmosphere/types';
import type { GravityField } from '../src/physics/gravity/harmonics';
import { zonalField } from '../src/physics/gravity/harmonics';
import { DEFAULT_LAUNCH, Simulation, type LaunchConfig, type SimEnvironment } from '../src/physics/simulation';
import type { ObjectSpec } from '../src/physics/objects';
import { WGS84 } from '../src/physics/constants';

export const GM: number = WGS84.GM;
export const R: number = WGS84.a;

/** Spherical, non-rotating Earth with a point-mass field. */
export function sphericalBody(over: Partial<BodyDef> = {}): BodyDef {
  return { ...BODIES.earth, ellipsoid: { a: R, f: 0 }, omega: 0, ocean: false, ...over };
}

export function pointMass(gm: number = GM, r: number = R): GravityField {
  return zonalField('point mass', gm, r, { 2: 0 });
}

export function env(p: { body?: BodyDef; field?: GravityField; atmosphere?: Atmosphere; ground?: number } = {}): SimEnvironment {
  return {
    body: p.body ?? sphericalBody(),
    field: p.field ?? pointMass(),
    atmosphere: p.atmosphere ?? new Vacuum(),
    terrain: new FlatTerrain(p.ground ?? 0),
    geoid: ZERO_GEOID,
  };
}

/** Point-like test mass with a constant Cd. */
export function testBody(over: Partial<ObjectSpec> = {}): ObjectSpec {
  return {
    id: 'test', name: 'test', emoji: '', shape: 'custom', mass: 1, length: 0.1, area: 0.01, volume: 0,
    surfaceArea: 0.04, noseRadius: 0.05, drag: { kind: 'constant', cd0: 1 }, material: 'inert', addedMass: 0,
    inertiaFactor: 0.4, description: '', ...over,
  };
}

export function run(e: SimEnvironment, obj: ObjectSpec, cfg: Partial<LaunchConfig>) {
  return new Simulation(e, obj, { ...DEFAULT_LAUNCH, wind: NO_WIND, gravityDegree: 360, ...cfg }).run();
}
