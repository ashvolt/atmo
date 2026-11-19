import { describe, expect, it } from 'vitest';
import { buildApparatus } from '../src/physics/em/apparatus';
import { levObject } from '../src/physics/em/objects';
import { LF, N_LEV_FIELDS, dominantFrequency, dynamicsDefaults, simulateLevitation } from '../src/physics/em/dynamics';
import { adiabaticDipolePotential, analyseStability, inducedPotential, verticalEquilibria } from '../src/physics/em/levitation';

const G = 9.80665;

/** the stable trap height of the standard Levitron setup */
function levitronTrap() {
  const app = buildApparatus('levitronBase');
  const top = levObject('levitronTop');
  const model = adiabaticDipolePotential(app.field, top.moment, top.mass, G);
  const z = verticalEquilibria(model, 0.002, 0.09, 400)
    .filter((zz) => analyseStability(model.at([0, 0, zz]).hess, top.mass).stable)
    .pop()!;
  return { app, top, z, freqs: analyseStability(model.at([0, 0, z]).hess, top.mass).frequencies };
}

/**
 * A Levitron run. The tolerances here are chosen to keep the suite quick
 * while leaving every assertion meaningful: the outcome tests only need the
 * trajectory to be qualitatively right, so they run at 1e-8, while the
 * energy-conservation test — the one that actually probes whether the force
 * and torque agree — keeps a tight tolerance over a shorter span.
 */
function run(spinRps: number, tiltRad: number, duration = 4, rtol = 1e-8) {
  const { app, top, z } = levitronTrap();
  const spec = {
    ...dynamicsDefaults(app.field, top, { kind: 'dipole' as const, moment: top.moment }, G, app.scale),
    rotDamping: 0, airDensity: 0, rtol,
  };
  return simulateLevitation(spec, { position: [0, 0, z], velocity: [0, 0, 0], axis: [0, 0, 1], spinRps, tiltRad }, duration, 800);
}

describe('6-DOF rigid-body dynamics', () => {
  it('conserves energy with damping off', () => {
    const r = run(25, 0.01, 2.5, 1e-10);
    expect(r.energyDrift).toBeLessThan(1e-7);
  });

  it('keeps the quaternion normalised', () => {
    const r = run(25, 0.01, 2);
    for (let i = 0; i < r.count; i++) {
      const o = i * N_LEV_FIELDS;
      const n = Math.hypot(r.samples[o + LF.q0], r.samples[o + LF.q1], r.samples[o + LF.q2], r.samples[o + LF.q3]);
      expect(Math.abs(n - 1)).toBeLessThan(1e-9);
    }
  });

  it('conserves the spin component about the symmetry axis', () => {
    // τ·ê₃ = (m×B)·ê₃ = 0 for a moment along ê₃, so ω_z is a constant of motion
    const r = run(25, 0.02, 2);
    const first = r.samples[LF.spinRps];
    for (let i = 0; i < r.count; i++) {
      expect(Math.abs(r.samples[i * N_LEV_FIELDS + LF.spinRps] - first) / first).toBeLessThan(1e-8);
    }
  });

  it('a Levitron spinning too slowly topples', () => {
    const r = run(10, 0.002, 3);
    expect(r.outcome).toBe('flipped');
    expect(r.duration).toBeLessThan(2);
  });

  it('a Levitron inside the spin window stays up', () => {
    for (const rps of [20, 40]) {
      const r = run(rps, 0, 4);
      expect(r.outcome).toBe('levitating');
      expect(r.excursion).toBeLessThan(0.005);
    }
  });

  it('the measured oscillation frequency is close to the adiabatic prediction', () => {
    const { app, top, z, freqs } = levitronTrap();
    const spec = {
      ...dynamicsDefaults(app.field, top, { kind: 'dipole' as const, moment: top.moment }, G, app.scale),
      rotDamping: 0, airDensity: 0, rtol: 1e-9,
    };
    // displace it vertically and watch it ring for several periods
    const r = simulateLevitation(spec, { position: [0, 0, z + 1e-4], velocity: [0, 0, 0], axis: [0, 0, 1], spinRps: 28, tiltRad: 0 }, 8, 900);
    expect(r.outcome).toBe('levitating');
    const predicted = freqs[2];
    // The prediction comes from U = +m|B|, which assumes the moment tracks the
    // field perfectly. The 6-DOF run does not assume that, so the two agree
    // only to the accuracy of the adiabatic approximation itself — tens of
    // per cent at a realistic spin rate, and that gap is the physics, not an
    // error. The useful statement is that they agree in order and sign.
    expect(r.measuredFreq.vertical).toBeGreaterThan(predicted * 0.6);
    expect(r.measuredFreq.vertical).toBeLessThan(predicted * 1.6);
  });

  it('an isotropic diamagnet settles into its trap and stays', () => {
    const app = buildApparatus('checkerboard');
    const flake = levObject('graphiteFlake');
    const mat = { chiAxis: -4.5e-4, chiPerp: -4.5e-4, volume: 1e-7 };
    const model = inducedPotential(app.field, mat.chiAxis, mat.volume, flake.mass, G);
    const z = verticalEquilibria(model, 1e-4, 0.03)
      .filter((zz) => analyseStability(model.at([0, 0, zz]).hess, flake.mass).stable)[0];
    expect(z).toBeGreaterThan(0);
    const spec = {
      ...dynamicsDefaults(app.field, flake, { kind: 'induced' as const, ...mat }, G, app.scale),
      rotDamping: 1e-12,
    };
    const r = simulateLevitation(spec, { position: [0, 0, z], velocity: [0, 0, 0], axis: [0, 0, 1], spinRps: 0, tiltRad: 0 }, 2, 400);
    expect(r.outcome).toBe('levitating');
    expect(r.excursion).toBeLessThan(0.002);
  });

  it('an anisotropic flake turns its hard axis across the field', () => {
    // KNOWN LIMITATION, asserted rather than hidden. For a *small* body the
    // torque (V/μ₀)(χ∥−χ⊥)(B·ê₃)(ê₃×B) is exact, and with χ∥ < χ⊥ < 0 it
    // drives the c-axis perpendicular to B — so a point-model graphite flake
    // ends up edge-on. Real flakes lie flat, because a thin plate in a
    // strongly inhomogeneous field is held by the field varying *across* the
    // flake, which a single-point model cannot represent.
    const app = buildApparatus('checkerboard');
    const flake = levObject('graphiteFlake');
    const mat = { chiAxis: -4.5e-4, chiPerp: -8.5e-5, volume: 1e-7 };
    const spec = {
      ...dynamicsDefaults(app.field, flake, { kind: 'induced' as const, ...mat }, G, app.scale),
      rotDamping: 1e-12,
    };
    const r = simulateLevitation(spec, { position: [0, 0, 0.0011], velocity: [0, 0, 0], axis: [0, 0, 1], spinRps: 0, tiltRad: 0.02 }, 2, 400);
    expect(r.outcome).toBe('flipped');
  });

  it('a fixed dipole over a magnet always escapes — Earnshaw in motion', () => {
    const app = buildApparatus('magnetPair');
    const cube = levObject('magnetCube');
    const spec = {
      ...dynamicsDefaults(app.field, cube, { kind: 'dipole' as const, moment: cube.moment }, G, app.scale),
      rotDamping: 0, airDensity: 0,
    };
    // released at rest with no spin: the moment cannot track the field, so the
    // lateral instability of U = −m·B takes over
    const r = simulateLevitation(spec, { position: [1e-4, 0, 0.107], velocity: [0, 0, 0], axis: [0, 0, 1], spinRps: 0, tiltRad: 0.001 }, 5, 500);
    expect(r.outcome).not.toBe('levitating');
  });

  it('zero-crossing frequency estimation is accurate on a known signal', () => {
    const t: number[] = [], v: number[] = [];
    for (let i = 0; i < 500; i++) {
      const tt = (i / 499) * 5;
      t.push(tt);
      v.push(3 + 2 * Math.sin(2 * Math.PI * 2.5 * tt));
    }
    expect(Math.abs(dominantFrequency(t, v) - 2.5)).toBeLessThan(0.02);
    expect(dominantFrequency([0, 1], [0, 1])).toBe(0);
  });
});
