/**
 * Trajectory validation against closed-form solutions of Newtonian mechanics.
 * Note: the launcher releases objects at ≥ 1 cm above the ground; references
 * account for that exactly.
 */
import { describe, expect, it } from 'vitest';
import { env, GM, pointMass, R, run, sphericalBody, testBody } from './simhelpers';
import { relErr } from './helpers';
import { F, N_FIELDS } from '../src/physics/simulation';
import { BODIES } from '../src/physics/bodies';
import { wgs84NormalField } from '../src/physics/gravity/normal';
import { WGS84 } from '../src/physics/constants';
import { ExponentialAtmosphere } from '../src/physics/atmosphere/types';

const col = (res: { samples: Float64Array; count: number }, f: number) =>
  Array.from({ length: res.count }, (_, i) => res.samples[i * N_FIELDS + f]);

describe('Vacuum, non-rotating point-mass Earth', () => {
  it('radial fall time equals the exact Kepler radial solution (1e-9)', () => {
    for (const h of [100, 10_000, 1_000_000]) {
      const res = run(env(), testBody(), { mode: 'drop', heightAGL: h, vacuum: true, rotation: false });
      const r0 = R + h;
      const x = R / r0;
      const exact = Math.sqrt(r0 ** 3 / (2 * GM)) * (Math.sqrt(x * (1 - x)) + Math.acos(Math.sqrt(x)));
      expect(res.summary.outcome).toBe('impact');
      expect(relErr(res.summary.flightTime, exact)).toBeLessThan(1e-9);
      // energy conservation: v² = 2GM(1/R − 1/r0)
      expect(relErr(res.summary.impactSpeed, Math.sqrt(2 * GM * (1 / R - 1 / r0)))).toBeLessThan(1e-9);
    }
  });

  it('short throw matches the flat-Earth closed form (release height 1 cm) to 1e-5', () => {
    const g = GM / R ** 2;
    const v = 20, th = Math.PI / 4, h0 = 0.01;
    const res = run(env(), testBody(), { mode: 'throw', heightAGL: h0, speed: v, elevation: 45, azimuth: 0, vacuum: true, rotation: false });
    const vy = v * Math.sin(th), vx = v * Math.cos(th);
    const tFlat = (vy + Math.sqrt(vy * vy + 2 * g * h0)) / g;
    // remaining differences: Earth curvature & g(h) — both O(v²/(gR)) ≈ 6e-6
    expect(relErr(res.summary.flightTime, tFlat)).toBeLessThan(1e-5);
    expect(relErr(res.summary.range, vx * tFlat)).toBeLessThan(1e-5);
    expect(relErr(res.summary.maxAltitudeAGL, h0 + (vy * vy) / (2 * g))).toBeLessThan(1e-5);
  });

  it('long ballistic flight: range and time of flight equal the exact Kepler-ellipse solution (1e-9)', () => {
    const v = 4000, gam = (35 * Math.PI) / 180;
    const r0 = R + 0.01;
    const res = run(env(), testBody(), { mode: 'throw', heightAGL: 0.01, speed: v, elevation: 35, azimuth: 90, vacuum: true, rotation: false });
    const h = r0 * v * Math.cos(gam);
    const p = (h * h) / GM;
    const ecos = p / r0 - 1;
    const esin = (v * Math.sin(gam) * h) / GM;
    const e = Math.hypot(ecos, esin);
    const a = p / (1 - e * e);
    const nu0 = Math.atan2(esin, ecos); // ascending branch
    const nu1 = 2 * Math.PI - Math.acos((p / R - 1) / e); // descending branch at r = R
    const M = (nu: number) => {
      const E = 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nu / 2), Math.sqrt(1 + e) * Math.cos(nu / 2));
      return E - e * Math.sin(E);
    };
    let dM = M(nu1) - M(nu0);
    if (dM < 0) dM += 2 * Math.PI;
    const tof = dM / Math.sqrt(GM / a ** 3);
    expect(relErr(res.summary.range, (nu1 - nu0) * R)).toBeLessThan(1e-9);
    expect(relErr(res.summary.flightTime, tof)).toBeLessThan(1e-9);
    expect(relErr(res.summary.maxAltitudeMSL + R, a * (1 + e))).toBeLessThan(1e-10);
  });

  it('circular orbit: period 2π√(a³/μ), radius constant to 1e-9', () => {
    const h = 408_000;
    const a = R + h;
    const vc = Math.sqrt(GM / a);
    const T = 2 * Math.PI * Math.sqrt(a ** 3 / GM);
    const res = run(env(), testBody(), {
      mode: 'throw', heightAGL: h, speed: vc, elevation: 0, azimuth: 90, vacuum: true, rotation: false, maxTime: T, maxSamples: 100000,
    });
    expect(res.summary.outcome).toBe('orbit');
    for (const x of col(res, F.hMSL)) expect(Math.abs(x - h) / a).toBeLessThan(1e-9);
    const last = (res.count - 1) * N_FIELDS;
    const d = Math.hypot(res.samples[last + F.x] - res.launchECEF[0], res.samples[last + F.y] - res.launchECEF[1], res.samples[last + F.z] - res.launchECEF[2]);
    expect(d / (2 * Math.PI * a)).toBeLessThan(1e-10); // back at the start after one period
    expect(T / 60).toBeGreaterThan(92.5);
    expect(T / 60).toBeLessThan(92.8);
  });

  it('escape velocity √(2GM/R) separates bound and unbound vertical throws', () => {
    const vesc = Math.sqrt((2 * GM) / R);
    // at the equatorial radius 6378.137 km; the textbook 11.186 km/s uses the mean radius 6371.0 km
    expect(vesc).toBeCloseTo(11179.88, 1);
    expect(Math.sqrt((2 * GM) / 6371000)).toBeCloseTo(11186.14, 1);
    const up = run(env(), testBody(), { mode: 'throw', heightAGL: 0.01, speed: vesc * 1.001, elevation: 90, vacuum: true, rotation: false, maxTime: 1e8 });
    expect(up.summary.outcome).toBe('escaped');
    const back = run(env(), testBody(), { mode: 'throw', heightAGL: 0.01, speed: vesc * 0.99, elevation: 90, vacuum: true, rotation: false, maxTime: 1e8 });
    expect(back.summary.outcome).toBe('impact');
    // apogee from energy conservation
    const r0 = R + 0.01;
    const v0 = vesc * 0.99;
    const rMax = 1 / (1 / r0 - (v0 * v0) / (2 * GM));
    expect(relErr(back.summary.maxAltitudeMSL + R, rMax)).toBeLessThan(1e-8);
  });
});

describe('Rotating Earth', () => {
  const normalEnv = () => env({ body: { ...BODIES.earth, ocean: false }, field: wgs84NormalField(20) });

  it('Coriolis: a 100 m vacuum drop lands east by (1/3)·Ω·g·t³·cos φ', () => {
    for (const lat of [0, 30, 60]) {
      const res = run(normalEnv(), testBody(), { lat, lon: 10, mode: 'drop', heightAGL: 100, vacuum: true, rotation: true, gravityDegree: 20 });
      const last = (res.count - 1) * N_FIELDS;
      const east = res.samples[last + F.east];
      const t = res.summary.flightTime;
      const g = res.summary.localG;
      const expected = (1 / 3) * WGS84.omega * g * t ** 3 * Math.cos((lat * Math.PI) / 180);
      expect(east).toBeGreaterThan(0);
      expect(relErr(east, expected)).toBeLessThan(2e-3);
      expect(relErr(t, Math.sqrt((2 * 100) / g))).toBeLessThan(2e-5);
    }
  });

  it('Jacobi integral (energy in the rotating frame) is conserved over 3 orbits; residual shrinks with tolerance', () => {
    const e = { ...env({ field: wgs84NormalField(20) }), body: { ...BODIES.earth, ocean: false } };
    const cfg = { mode: 'throw' as const, heightAGL: 500_000, speed: 7200, elevation: 3, azimuth: 45, vacuum: true, rotation: true, gravityDegree: 20, maxTime: 3 * 5700 };
    const E = col(run(e, testBody(), cfg), F.energy);
    for (const x of E) expect(Math.abs((x - E[0]) / E[0])).toBeLessThan(5e-10);
    const E2 = col(run(e, testBody(), { ...cfg, rtol: 1e-12 }), F.energy);
    for (const x of E2) expect(Math.abs((x - E2[0]) / E2[0])).toBeLessThan(1e-11);
  });

  it('a drop at the pole has no Coriolis deflection', () => {
    const res = run(normalEnv(), testBody(), { lat: 90, lon: 0, mode: 'drop', heightAGL: 1000, vacuum: true, rotation: true, gravityDegree: 20 });
    const last = (res.count - 1) * N_FIELDS;
    expect(Math.hypot(res.samples[last + F.east], res.samples[last + F.north])).toBeLessThan(1e-6);
  });
});

describe('Drag', () => {
  it('constant-Cd body in uniform air reaches v_t = √(2mg/(ρCdA)), lagging only by the predicted τ·v_t²/R', () => {
    const atm = new ExponentialAtmosphere(1.225, 1e12);
    const res = run(env({ atmosphere: atm }), testBody({ mass: 1, area: 0.01, drag: { kind: 'constant', cd0: 1 } }), {
      mode: 'drop', heightAGL: 2000, rotation: false,
    });
    const g = GM / R ** 2;
    const vt = Math.sqrt((2 * g) / (1.225 * 0.01));
    // g grows as the body descends (dg/g = 2 dh/R), so v_t rises at the rate v_t²/R per unit time·(1/v_t);
    // the speed relaxes with τ = v_t/(2g) and therefore lags by τ·v_t/R (relative).
    const lag = ((vt / (2 * g)) * vt) / R;
    const err = (vt - res.summary.impactSpeed) / vt;
    expect(Math.abs(err - lag) / lag).toBeLessThan(0.05);
  });

  it('constant-Cd fall matches the closed form v(t) = v_t tanh(g t / v_t)', () => {
    const atm = new ExponentialAtmosphere(1.225, 1e12);
    const h0 = 5000;
    const res = run(env({ atmosphere: atm }), testBody(), { mode: 'drop', heightAGL: h0, rotation: false, maxSamples: 100000 });
    const ts = col(res, F.t), vs = col(res, F.speed);
    const g = GM / (R + h0) ** 2;
    const vt = Math.sqrt((2 * g) / (1.225 * 0.01));
    let checked = 0;
    for (let i = 0; i < res.count; i += 20) {
      if (ts[i] > 3) break; // g changes by < 1.3e-5 over the first 3 s (≈ 40 m)
      expect(Math.abs(vs[i] - vt * Math.tanh((g * ts[i]) / vt))).toBeLessThan(5e-4);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('Allen–Eggers ballistic entry is reproduced exactly under its own assumptions (no gravity, flat planet)', () => {
    const H = 7200;
    const atm = new ExponentialAtmosphere(1.225, H);
    const VE = 7500, gamma = 30, h0 = 120_000, m = 1000, cdA = 1;
    const flat = sphericalBody({ ellipsoid: { a: 6.4e11, f: 0 } });
    const res = run(env({ atmosphere: atm, body: flat, field: pointMass(1, 6.4e11) }),
      testBody({ mass: m, area: cdA, drag: { kind: 'constant', cd0: 1 } }), {
        mode: 'throw', heightAGL: h0, speed: VE, elevation: -gamma, azimuth: 90, rotation: false, maxSamples: 200000,
      });
    const sinG = Math.sin((gamma * Math.PI) / 180);
    const sp = col(res, F.speed), gl = col(res, F.gLoad);
    // test body is non-ablating ("inert"); an iron body would lose mass and decelerate faster
    let iMax = 0;
    gl.forEach((v, i) => { if (v > gl[iMax]) iMax = i; });
    const aMax = gl[iMax] * 9.80665;
    expect(relErr(aMax, (VE ** 2 * sinG) / (2 * Math.E * H))).toBeLessThan(1e-4);
    expect(relErr(sp[iMax], VE / Math.sqrt(Math.E))).toBeLessThan(1e-3);
  });

  it('drag-only flight on the real-size Earth: V(s) = V_E·exp(−(C_D A/2m)·∫ρ ds) along the exact straight path', () => {
    // with gravity switched off the path is a straight line, so the solution is exact for any planet shape
    const H = 7200;
    const atm = new ExponentialAtmosphere(1.225, H);
    const VE = 7500, m = 1000, cdA = 1;
    const body = sphericalBody();
    for (const [rtol, tol] of [[1e-10, 5e-9], [1e-12, 1e-10]]) {
    const res = run(env({ atmosphere: atm, body, field: pointMass(1e-30) }), testBody({ mass: m, area: cdA, drag: { kind: 'constant', cd0: 1 } }), {
      mode: 'throw', heightAGL: 120_000, speed: VE, elevation: -30, azimuth: 90, rotation: false, maxSamples: 200000, rtol,
    });
    const r0 = res.launchECEF;
    const last = (res.count - 1) * N_FIELDS;
    const dir = [res.samples[last + F.x] - r0[0], res.samples[last + F.y] - r0[1], res.samples[last + F.z] - r0[2]];
    const L = Math.hypot(dir[0], dir[1], dir[2]);
    const u = dir.map((d) => d / L);
    const rho = (s: number) => atm.at(Math.hypot(r0[0] + s * u[0], r0[1] + s * u[1], r0[2] + s * u[2]) - R).rho;
    // cumulative Simpson integral on a 5 m grid
    const ds = 5, n = Math.ceil(L / ds) + 2;
    const cum = new Float64Array(n);
    for (let i = 1; i < n; i++) {
      const a = (i - 1) * ds;
      cum[i] = cum[i - 1] + (ds / 6) * (rho(a) + 4 * rho(a + ds / 2) + rho(a + ds));
    }
    const integral = (s: number) => {
      const i = Math.min(Math.floor(s / ds), n - 2);
      const a = i * ds;
      const rest = s - a;
      return cum[i] + (rest / 6) * (rho(a) + 4 * rho(a + rest / 2) + rho(s));
    };
    let checked = 0;
    for (let i = 0; i < res.count; i += 10) {
      const o = i * N_FIELDS;
      const s = Math.hypot(res.samples[o + F.x] - r0[0], res.samples[o + F.y] - r0[1], res.samples[o + F.z] - r0[2]);
      const Vexact = VE * Math.exp((-cdA / (2 * m)) * integral(s));
      if (Vexact < 1) break;
      // entry phase: residual = integration + dense-output error, shrinks with rtol.
      // slow tail (V < 1 % V_E, near sea level): limited by the 1 µm absolute position tolerance,
      // dV/V = (C_D A ρ / 2m)·δs ≈ 6e-4 /m × 1e-6 m.
      expect(relErr(res.samples[o + F.speed], Vexact)).toBeLessThan(Vexact > 0.01 * VE ? tol : 3e-9);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
    }
  });

  it('with real gravity and curvature the same entry deviates from Allen–Eggers by the expected few %', () => {
    const atm = new ExponentialAtmosphere(1.225, 7200);
    const res = run(env({ atmosphere: atm }), testBody({ mass: 1000, area: 1, drag: { kind: 'constant', cd0: 1 } }), {
      mode: 'throw', heightAGL: 120_000, speed: 7500, elevation: -30, azimuth: 90, rotation: false, maxSamples: 200000,
    });
    const ratio = (res.summary.maxGLoad * 9.80665) / ((7500 ** 2 * 0.5) / (2 * Math.E * 7200));
    // the path steepens (~1.3° from curvature, plus the gravity turn): peak deceleration is a few % higher
    expect(ratio).toBeGreaterThan(1.02);
    expect(ratio).toBeLessThan(1.07);
  });
});

describe('sanity', () => {
  it('point mass helper', () => {
    expect(pointMass().GM).toBe(GM);
  });
});

describe('Coriolis isolation', () => {
  it('switching off only the Coriolis term leaves the drop vertical along the plumb line', () => {
    const e = env({ body: { ...BODIES.earth, ocean: false }, field: wgs84NormalField(20) });
    const noCor = run(e, testBody(), { lat: 45, lon: 10, mode: 'drop', heightAGL: 100, vacuum: true, rotation: true, coriolis: false, gravityDegree: 20 });
    const last = (noCor.count - 1) * N_FIELDS;
    // the normal-field plumb line is the ellipsoid normal (to < 1e-7 rad): no horizontal drift
    expect(Math.hypot(noCor.samples[last + F.east], noCor.samples[last + F.north])).toBeLessThan(2e-5);
  });
});
