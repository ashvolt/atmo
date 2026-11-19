/**
 * Validation cases runnable inside the app (the full suite lives in tests/ and
 * runs with `npm test`). Each case compares the model against a closed-form
 * solution or a published measurement.
 */
import { BODIES, bodyAtmosphere, bodyGravity } from '../physics/bodies';
import { WGS84 } from '../physics/constants';
import { EarthAtmosphere, ussa1976 } from '../physics/atmosphere/ussa1976';
import { ExponentialAtmosphere, Vacuum } from '../physics/atmosphere/types';
import { FlatTerrain, NO_WIND, ZERO_GEOID } from '../physics/environment';
import { geodeticToEcef } from '../physics/geodesy';
import { zonalField, type GravityField } from '../physics/gravity/harmonics';
import { somigliana, wgs84NormalField } from '../physics/gravity/normal';
import { presetById, type ObjectSpec } from '../physics/objects';
import { DEFAULT_LAUNCH, F, N_FIELDS, Simulation, type LaunchConfig, type SimEnvironment } from '../physics/simulation';
import { GUNN_KINZER } from '../physics/aero/drag';

export interface ValidationResult {
  group: string;
  name: string;
  reference: string;
  source: string;
  expected: number;
  actual: number;
  unit: string;
  /** relative or absolute error, as described by `errorKind` */
  error: number;
  errorKind: 'relative' | 'absolute';
  tolerance: number;
  pass: boolean;
  note?: string;
  /**
   * Which report tab the case belongs to: a comparison against a closed-form
   * solution, or against a published measurement. Keeping them apart makes it
   * obvious which kind of error a failure is.
   */
  kind?: 'analytic' | 'measured';
}

const R = WGS84.a;
const GM = WGS84.GM as number;
const point = (): GravityField => zonalField('pm', GM, R, { 2: 0 });
const sphere = () => ({ ...BODIES.earth, ellipsoid: { a: R, f: 0 }, omega: 0, ocean: false });
const ideal = (over: Partial<ObjectSpec> = {}): ObjectSpec => ({
  id: 'ideal', name: 'ideal', emoji: '', shape: 'custom', mass: 1, length: 0.1, area: 0.01, volume: 0, surfaceArea: 0.04,
  noseRadius: 0.05, drag: { kind: 'constant', cd0: 1 }, material: 'inert', addedMass: 0, inertiaFactor: 0.4, description: '', ...over,
});
function sim(env: SimEnvironment, o: ObjectSpec, c: Partial<LaunchConfig>) {
  return new Simulation(env, o, { ...DEFAULT_LAUNCH, wind: NO_WIND, gravityDegree: 72, ...c }).run();
}
const envOf = (p: Partial<SimEnvironment> & { ground?: number }): SimEnvironment => ({
  body: p.body ?? sphere(), field: p.field ?? point(), atmosphere: p.atmosphere ?? new Vacuum(),
  terrain: new FlatTerrain(p.ground ?? 0), geoid: ZERO_GEOID,
});

function rel(group: string, name: string, reference: string, source: string, expected: number, actual: number, unit: string, tol: number, note?: string): ValidationResult {
  const error = Math.abs(actual - expected) / Math.abs(expected);
  return { group, name, reference, source, expected, actual, unit, error, errorKind: 'relative', tolerance: tol, pass: error <= tol, note };
}
function abs(group: string, name: string, reference: string, source: string, expected: number, actual: number, unit: string, tol: number, note?: string): ValidationResult {
  const error = Math.abs(actual - expected);
  return { group, name, reference, source, expected, actual, unit, error, errorKind: 'absolute', tolerance: tol, pass: error <= tol, note };
}

export function runValidation(earthField: GravityField, progress?: (f: number) => void): ValidationResult[] {
  const out: ValidationResult[] = [];
  const cases: (() => void)[] = [
    () => {
      out.push(abs('Gravity', 'Normal gravity at the equator', 'γe = 9.780 325 3359 m/s²', 'NIMA TR8350.2', WGS84.gammaE, somigliana(0), 'm/s²', 1e-12));
      const f = wgs84NormalField(20);
      const r = geodeticToEcef(45 * (Math.PI / 180), 0, 0, WGS84);
      const a = f.accel(r);
      const g = Math.hypot(a[0] + WGS84.omega ** 2 * r[0], a[1] + WGS84.omega ** 2 * r[1], a[2]);
      out.push(abs('Gravity', 'Spherical-harmonic normal field vs Somigliana (45°)', 'closed form', 'Heiskanen & Moritz 1967', somigliana(Math.PI / 4), g, 'm/s²', 2e-9));
    },
    () => {
      const r = geodeticToEcef(0, 0, 0, WGS84);
      const T = earthField.potential(r) - wgs84NormalField(20).potential(r);
      out.push(abs('Gravity', 'EGM2008 geoid height at 0°N 0°E', 'N = 17.16 m', 'EGM2008 (Pavlis et al. 2012)', 17.16, T / somigliana(0) - 0.41, 'm', 1.0, 'Degree-360 truncation explains the residual'));
    },
    () => {
      out.push(rel('Atmosphere', 'Sea-level density', 'ρ0 = 1.2250 kg/m³', 'USSA-1976', 1.225, ussa1976(0).rho, 'kg/m³', 2e-5));
      out.push(rel('Atmosphere', 'Pressure at 11 km geopotential', 'p = 22 632.06 Pa', 'USSA-1976 Table 4', 22632.06, ussa1976((6356766 * 11000) / (6356766 - 11000)).p, 'Pa', 2e-6));
      out.push(rel('Atmosphere', 'Density at 400 km', 'ρ = 2.803e-12 kg/m³', 'USSA-1976 Table I', 2.803e-12, ussa1976(400000).rho, 'kg/m³', 1e-6));
    },
    () => {
      const h = 1_000_000;
      const res = sim(envOf({}), ideal(), { mode: 'drop', heightAGL: h, vacuum: true, rotation: false });
      const r0 = R + h, x = R / r0;
      const exact = Math.sqrt(r0 ** 3 / (2 * GM)) * (Math.sqrt(x * (1 - x)) + Math.acos(Math.sqrt(x)));
      out.push(rel('Mechanics', 'Fall time from 1000 km (vacuum, point mass)', 'Kepler radial solution', 'exact', exact, res.summary.flightTime, 's', 1e-9));
    },
    () => {
      const v = 4000, gam = (35 * Math.PI) / 180, r0 = R + 0.01;
      const res = sim(envOf({}), ideal(), { mode: 'throw', heightAGL: 0.01, speed: v, elevation: 35, azimuth: 90, vacuum: true, rotation: false });
      const hh = r0 * v * Math.cos(gam), p = (hh * hh) / GM, ec = p / r0 - 1, es = (v * Math.sin(gam) * hh) / GM, e = Math.hypot(ec, es);
      const nu0 = Math.atan2(es, ec), nu1 = 2 * Math.PI - Math.acos((p / R - 1) / e);
      out.push(rel('Mechanics', 'Ballistic range, 4 km/s at 35° (vacuum)', 'Kepler ellipse', 'exact', (nu1 - nu0) * R, res.summary.range, 'm', 1e-9));
    },
    () => {
      const lat = 45;
      const res = sim(envOf({ body: { ...BODIES.earth, ocean: false }, field: wgs84NormalField(20) }), ideal(), { lat, mode: 'drop', heightAGL: 100, vacuum: true, rotation: true, gravityDegree: 20 });
      const last = (res.count - 1) * N_FIELDS;
      const t = res.summary.flightTime;
      const exp = (1 / 3) * WGS84.omega * res.summary.localG * t ** 3 * Math.cos((lat * Math.PI) / 180);
      out.push(rel('Mechanics', 'Coriolis eastward deflection, 100 m drop at 45°', 'Δx = ⅓ Ω g t³ cos φ', 'Landau & Lifshitz §39', exp, res.samples[last + F.east], 'm', 2e-3));
    },
    () => {
      const atm = new ExponentialAtmosphere(1.225, 1e12);
      const res = sim(envOf({ atmosphere: atm }), ideal(), { mode: 'drop', heightAGL: 2000, rotation: false });
      const g = GM / R ** 2;
      out.push(rel('Aerodynamics', 'Terminal velocity, constant Cd', 'vt = √(2mg/ρCdA)', 'exact', Math.sqrt((2 * g) / (1.225 * 0.01)), res.summary.impactSpeed, 'm/s', 3e-5, 'Residual = lag from g increasing during descent'));
    },
    () => {
      const lab = new EarthAtmosphere({ dT: 5, pMSL: 101300, RH: 0 });
      const e = { ...envOf({ atmosphere: lab, field: earthField }), body: { ...BODIES.earth, ocean: false } };
      const [dmm, v] = GUNN_KINZER[14];
      const r = dmm / 2000;
      const o: ObjectSpec = { ...presetById('raindrop'), mass: 998.2 * (4 / 3) * Math.PI * r ** 3, length: 2 * r, area: Math.PI * r * r, volume: (4 / 3) * Math.PI * r ** 3, surfaceArea: 4 * Math.PI * r * r, noseRadius: r };
      const res = sim(e, o, { lat: 38.9, mode: 'drop', heightAGL: 60, rotation: false });
      out.push(rel('Aerodynamics', `Raindrop ${dmm} mm terminal velocity`, `${v} m/s`, 'Gunn & Kinzer 1949', v, res.summary.impactSpeed, 'm/s', 0.01));
    },
    () => {
      const e = { ...envOf({ atmosphere: new EarthAtmosphere(), field: earthField, ground: 1100 }), body: { ...BODIES.earth, ocean: false } };
      const res = sim(e, presetById('stratos'), { lat: 33.39, lon: -104.52, mode: 'drop', heightAGL: 38969.4 - 1100, deployAGL: 2566.8 - 1100 });
      out.push(rel('Real events', 'Red Bull Stratos peak speed', '377.1 m/s', 'FAI record 2012', 377.1, res.summary.maxSpeed, 'm/s', 0.01, 'Calibration point (drag area fitted)'));
      out.push(rel('Real events', 'Red Bull Stratos peak Mach number', 'Mach 1.25', 'FAI record 2012', 1.25, res.summary.maxMach, '', 0.02, 'Independent check of the speed-of-sound profile'));
      out.push(rel('Real events', 'Red Bull Stratos freefall time', '259 s', 'FAI record 2012', 259, res.summary.chuteDeployTime ?? 0, 's', 0.25, 'KNOWN LIMITATION: −20 % — real posture changes (spin, stabilisation) are not modelled'));
    },
    () => {
      const e = { ...envOf({ atmosphere: new EarthAtmosphere({ dT: 6.85, pMSL: 101325, RH: 0.5 }), field: earthField }), body: { ...BODIES.earth, ocean: false } };
      const res = sim(e, presetById('baseball'), { lat: 40, lon: -74, mode: 'throw', heightAGL: 1, speed: 44.704, elevation: 28, azimuth: 0, spinRpm: 2000, spinMode: 'backspin', gravityDegree: 36 });
      out.push(rel('Real events', 'Home run: 100 mph, 28°, 2000 rpm', '≈ 405 ft', 'Statcast / Nathan', 405, res.summary.range / 0.3048, 'ft', 0.05));
      const golf = sim(e, presetById('golf'), { lat: 40, lon: -74, mode: 'throw', heightAGL: 0.02, speed: 74.66, elevation: 10.9, azimuth: 0, spinRpm: 2686, spinMode: 'backspin', gravityDegree: 36 });
      out.push(rel('Real events', 'PGA Tour average drive carry', '275 yd', 'TrackMan tour averages', 275, golf.summary.range / 0.9144, 'yd', 0.05));
      out.push(rel('Real events', 'PGA Tour average drive apex', '32 yd', 'TrackMan tour averages', 32, golf.summary.maxAltitudeAGL / 0.9144, 'yd', 0.45, 'KNOWN LIMITATION: +33 % — Smits–Smith lift is high at launch'));
    },
    () => {
      const moon = { body: BODIES.moon, field: bodyGravity('moon'), atmosphere: bodyAtmosphere('moon'), terrain: new FlatTerrain(0), geoid: ZERO_GEOID };
      const a = sim(moon, { ...presetById('rock'), mass: 1.32 }, { lat: 26.13, lon: 3.63, mode: 'drop', heightAGL: 1.6, gravityDegree: 4 });
      const b = sim(moon, presetById('feather'), { lat: 26.13, lon: 3.63, mode: 'drop', heightAGL: 1.6, gravityDegree: 4 });
      out.push(abs('Real events', 'Apollo 15: hammer vs feather landing time difference', '0 s', 'Apollo 15 (1971)', 0, a.summary.flightTime - b.summary.flightTime, 's', 1e-9));
    },
  ];
  cases.forEach((c, i) => {
    c();
    progress?.((i + 1) / cases.length);
  });
  return out;
}
