/**
 * Six-degree-of-freedom rigid-body dynamics in a magnetic field.
 *
 * Translation alone cannot describe a Levitron: the top floats only because
 * its moment precesses, which is a rotational effect. So the state carries
 * position, velocity, an orientation quaternion and the body-frame angular
 * velocity, and the moment is carried along by the orientation rather than
 * assumed to follow the field.
 *
 *   (m) v̇ = ∇(m·B) + χ-force − mg ẑ − drag
 *   I ω̇ = τ + (I_⊥ − I_s)·(gyroscopic terms)      [Euler, body frame]
 *   q̇ = ½ q ⊗ (0, ω_body)
 *
 * Integrated with the same validated Dormand–Prince 5(4) used for ballistics,
 * so step control, dense output and event location are shared code. With
 * damping switched off the total energy (kinetic + rotational + magnetic +
 * gravitational) is conserved, which is the test that the torque and force
 * terms are mutually consistent.
 */
import { DormandPrince, findRoot } from '../integrator';
import { MU0 } from './constants';
import type { FieldAssembly } from './sources';
import type { LevMode, LevObject } from './levitation';
import { demagFactor, eddySpherePolarisability, inertia, objectAspect, objectArea, objectVolume } from './levitation';
import type { EMMaterial } from './materials';
import type { Vec3 } from '../vec3';

/** state layout: 13 variables */
const S = { x: 0, y: 1, z: 2, vx: 3, vy: 4, vz: 5, q0: 6, q1: 7, q2: 8, q3: 9, wx: 10, wy: 11, wz: 12 } as const;
export const N_STATE = 13;

/** sample layout written out for the UI */
export const LF = {
  t: 0, x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6,
  q0: 7, q1: 8, q2: 9, q3: 10, wx: 11, wy: 12, wz: 13,
  bmag: 14, spinRps: 15, tilt: 16, energy: 17, height: 18, speed: 19, force: 20, precessHz: 21,
} as const;
export const N_LEV_FIELDS = 22;

export type LevForceModel =
  | { kind: 'dipole'; moment: number }
  | { kind: 'induced'; chiAxis: number; chiPerp: number; volume: number }
  | { kind: 'eddy'; polarisabilityRe: number };

export interface DynamicsSpec {
  field: FieldAssembly;
  object: LevObject;
  force: LevForceModel;
  g: number;
  /** air density for drag [kg/m³]; 0 for vacuum */
  airDensity: number;
  dragCd: number;
  /** rotational damping coefficient [N·m·s] — air friction on a spinning top */
  rotDamping: number;
  /** stop if the object falls below this height [m] */
  floor: number;
  /** stop if it strays further than this from the origin [m] */
  escapeRadius: number;
  rtol: number;
}

export type LevOutcome = 'levitating' | 'fell' | 'escaped' | 'flipped';

export interface LevRun {
  samples: Float64Array;
  count: number;
  outcome: LevOutcome;
  duration: number;
  /** peak excursion from the starting point [m] */
  excursion: number;
  /** relative drift of the conserved energy over the run (damping off) */
  energyDrift: number;
  /** mean oscillation frequencies measured from the trajectory [Hz] */
  measuredFreq: { vertical: number; horizontal: number };
}

/* --------------------------------------------------------------- utilities */

/** rotation matrix from a unit quaternion (w, x, y, z), row-major */
function quatMatrix(w: number, x: number, y: number, z: number): number[] {
  const xx = x * x, yy = y * y, zz = z * z;
  return [
    1 - 2 * (yy + zz), 2 * (x * y - w * z), 2 * (x * z + w * y),
    2 * (x * y + w * z), 1 - 2 * (xx + zz), 2 * (y * z - w * x),
    2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (xx + yy),
  ];
}

/** body +z axis in lab coordinates */
function bodyAxis(w: number, x: number, y: number, z: number): Vec3 {
  return [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
}

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/* ---------------------------------------------------------------- the model */

export function simulateLevitation(
  spec: DynamicsSpec,
  init: { position: Vec3; velocity: Vec3; axis: Vec3; spinRps: number; tiltRad: number },
  duration: number,
  maxSamples = 4000,
): LevRun {
  const o = spec.object;
  const mass = o.mass;
  const { Is, Iperp } = inertia(o);
  const area = objectArea(o);

  // initial orientation: body +z tilted by `tiltRad` from the given axis
  const tilt = init.tiltRad;
  const q = [Math.cos(tilt / 2), Math.sin(tilt / 2), 0, 0]; // tilt about lab x
  const y0 = new Float64Array(N_STATE);
  y0[S.x] = init.position[0]; y0[S.y] = init.position[1]; y0[S.z] = init.position[2];
  y0[S.vx] = init.velocity[0]; y0[S.vy] = init.velocity[1]; y0[S.vz] = init.velocity[2];
  y0[S.q0] = q[0]; y0[S.q1] = q[1]; y0[S.q2] = q[2]; y0[S.q3] = q[3];
  // spin about the body axis
  y0[S.wz] = 2 * Math.PI * init.spinRps;

  /** magnetic force and body-frame torque at a state */
  const forceTorque = (y: Float64Array) => {
    const p: Vec3 = [y[S.x], y[S.y], y[S.z]];
    const { B, J } = spec.field.BJ(p);
    let F: Vec3 = [0, 0, 0];
    let tau: Vec3 = [0, 0, 0];
    const e3 = bodyAxis(y[S.q0], y[S.q1], y[S.q2], y[S.q3]);
    if (spec.force.kind === 'dipole') {
      // the moment is anti-parallel to the body axis (a repelled top)
      const mv: Vec3 = [-spec.force.moment * e3[0], -spec.force.moment * e3[1], -spec.force.moment * e3[2]];
      // F_k = Σ_i m_i ∂B_i/∂x_k
      F = [
        mv[0] * J[0] + mv[1] * J[3] + mv[2] * J[6],
        mv[0] * J[1] + mv[1] * J[4] + mv[2] * J[7],
        mv[0] * J[2] + mv[1] * J[5] + mv[2] * J[8],
      ];
      tau = cross3(mv, B);
    } else if (spec.force.kind === 'induced') {
      const { chiAxis, chiPerp } = spec.force;
      // U = −(V/2μ₀)[χ⊥|B|² + (χ∥−χ⊥)(B·ê₃)²]
      const gb = [
        2 * (B[0] * J[0] + B[1] * J[3] + B[2] * J[6]),
        2 * (B[0] * J[1] + B[1] * J[4] + B[2] * J[7]),
        2 * (B[0] * J[2] + B[1] * J[5] + B[2] * J[8]),
      ];
      const k = (chiPerp * spec.force.volume) / (2 * MU0);
      F = [k * gb[0], k * gb[1], k * gb[2]];
      const dchi = chiAxis - chiPerp;
      if (dchi !== 0) {
        const be = dot3(B as Vec3, e3);
        // the anisotropic part of the force, ∇[(B·ê₃)²] with ê₃ held fixed
        const ga = [
          2 * be * (e3[0] * J[0] + e3[1] * J[3] + e3[2] * J[6]),
          2 * be * (e3[0] * J[1] + e3[1] * J[4] + e3[2] * J[7]),
          2 * be * (e3[0] * J[2] + e3[1] * J[5] + e3[2] * J[8]),
        ];
        const ka = (dchi * spec.force.volume) / (2 * MU0);
        F = [F[0] + ka * ga[0], F[1] + ka * ga[1], F[2] + ka * ga[2]];
        // torque τ = (V/μ₀)(χ∥−χ⊥)(B·ê₃)(ê₃ × B)
        const c = cross3(e3, B as Vec3);
        const kt = (dchi * spec.force.volume * be) / MU0;
        tau = [kt * c[0], kt * c[1], kt * c[2]];
      }
    } else {
      // time-averaged eddy-current force: ⟨F⟩ = (Re α/4μ₀)·∇(B²)
      const gb = [
        2 * (B[0] * J[0] + B[1] * J[3] + B[2] * J[6]),
        2 * (B[0] * J[1] + B[1] * J[4] + B[2] * J[7]),
        2 * (B[0] * J[2] + B[1] * J[5] + B[2] * J[8]),
      ];
      const k = spec.force.polarisabilityRe / (4 * MU0);
      F = [k * gb[0], k * gb[1], k * gb[2]];
    }
    return { F, tau, B };
  };

  const deriv = (_t: number, y: Float64Array, dydt: Float64Array) => {
    const { F, tau } = forceTorque(y);
    const v: Vec3 = [y[S.vx], y[S.vy], y[S.vz]];
    const speed = Math.hypot(v[0], v[1], v[2]);
    const drag = 0.5 * spec.airDensity * spec.dragCd * area * speed;
    dydt[S.x] = v[0];
    dydt[S.y] = v[1];
    dydt[S.z] = v[2];
    dydt[S.vx] = (F[0] - drag * v[0]) / mass;
    dydt[S.vy] = (F[1] - drag * v[1]) / mass;
    dydt[S.vz] = (F[2] - drag * v[2]) / mass - spec.g;

    // body-frame torque
    const R = quatMatrix(y[S.q0], y[S.q1], y[S.q2], y[S.q3]);
    const tb: Vec3 = [
      R[0] * tau[0] + R[3] * tau[1] + R[6] * tau[2],
      R[1] * tau[0] + R[4] * tau[1] + R[7] * tau[2],
      R[2] * tau[0] + R[5] * tau[1] + R[8] * tau[2],
    ];
    const wx = y[S.wx], wy = y[S.wy], wz = y[S.wz];
    dydt[S.wx] = (tb[0] + (Iperp - Is) * wy * wz - spec.rotDamping * wx) / Iperp;
    dydt[S.wy] = (tb[1] + (Is - Iperp) * wx * wz - spec.rotDamping * wy) / Iperp;
    dydt[S.wz] = (tb[2] - spec.rotDamping * wz) / Is;

    // quaternion kinematics, q̇ = ½ q ⊗ (0, ω_body)
    const [q0, q1, q2, q3] = [y[S.q0], y[S.q1], y[S.q2], y[S.q3]];
    dydt[S.q0] = 0.5 * (-q1 * wx - q2 * wy - q3 * wz);
    dydt[S.q1] = 0.5 * (q0 * wx + q2 * wz - q3 * wy);
    dydt[S.q2] = 0.5 * (q0 * wy - q1 * wz + q3 * wx);
    dydt[S.q3] = 0.5 * (q0 * wz + q1 * wy - q2 * wx);
  };

  /** total energy — conserved when damping and drag are off */
  const energyOf = (y: Float64Array) => {
    const p: Vec3 = [y[S.x], y[S.y], y[S.z]];
    const B = spec.field.B(p);
    const b2 = B[0] * B[0] + B[1] * B[1] + B[2] * B[2];
    const e3 = bodyAxis(y[S.q0], y[S.q1], y[S.q2], y[S.q3]);
    let U = mass * spec.g * y[S.z];
    if (spec.force.kind === 'dipole') {
      U += spec.force.moment * dot3(e3, B as Vec3);
    } else if (spec.force.kind === 'induced') {
      const be = dot3(B as Vec3, e3);
      U += -(spec.force.volume / (2 * MU0)) * (spec.force.chiPerp * b2 + (spec.force.chiAxis - spec.force.chiPerp) * be * be);
    } else {
      U += -(spec.force.polarisabilityRe / (4 * MU0)) * b2;
    }
    const kin = 0.5 * mass * (y[S.vx] ** 2 + y[S.vy] ** 2 + y[S.vz] ** 2);
    const rot = 0.5 * (Iperp * (y[S.wx] ** 2 + y[S.wy] ** 2) + Is * y[S.wz] ** 2);
    return kin + rot + U;
  };

  const atol = new Float64Array(N_STATE).fill(1e-12);
  for (let i = 10; i < 13; i++) atol[i] = 1e-9;
  const integ = new DormandPrince(deriv, 0, y0, { rtol: spec.rtol, atol, hmax: duration / 50 });

  const samples = new Float64Array(maxSamples * N_LEV_FIELDS);
  let count = 0;
  const start: Vec3 = [...init.position] as Vec3;
  let excursion = 0;
  const e0 = energyOf(y0);
  let eMin = e0, eMax = e0;
  let outcome: LevOutcome = 'levitating';
  const zs: { t: number; z: number }[] = [];
  const xs: { t: number; x: number }[] = [];

  const write = (t: number, y: Float64Array) => {
    if (count >= maxSamples) return;
    const o2 = count * N_LEV_FIELDS;
    // renormalise the quaternion for the output (the integrator keeps |q| to rtol)
    const n = Math.hypot(y[S.q0], y[S.q1], y[S.q2], y[S.q3]) || 1;
    const B = spec.field.B([y[S.x], y[S.y], y[S.z]]);
    const e3 = bodyAxis(y[S.q0] / n, y[S.q1] / n, y[S.q2] / n, y[S.q3] / n);
    const bmag = Math.hypot(B[0], B[1], B[2]);
    const { F } = forceTorque(y);
    samples[o2 + LF.t] = t;
    samples[o2 + LF.x] = y[S.x];
    samples[o2 + LF.y] = y[S.y];
    samples[o2 + LF.z] = y[S.z];
    samples[o2 + LF.vx] = y[S.vx];
    samples[o2 + LF.vy] = y[S.vy];
    samples[o2 + LF.vz] = y[S.vz];
    samples[o2 + LF.q0] = y[S.q0] / n;
    samples[o2 + LF.q1] = y[S.q1] / n;
    samples[o2 + LF.q2] = y[S.q2] / n;
    samples[o2 + LF.q3] = y[S.q3] / n;
    samples[o2 + LF.wx] = y[S.wx];
    samples[o2 + LF.wy] = y[S.wy];
    samples[o2 + LF.wz] = y[S.wz];
    samples[o2 + LF.bmag] = bmag;
    samples[o2 + LF.spinRps] = y[S.wz] / (2 * Math.PI);
    samples[o2 + LF.tilt] = Math.acos(Math.min(1, Math.max(-1, e3[2]))) * (180 / Math.PI);
    samples[o2 + LF.energy] = energyOf(y);
    samples[o2 + LF.height] = y[S.z];
    samples[o2 + LF.speed] = Math.hypot(y[S.vx], y[S.vy], y[S.vz]);
    samples[o2 + LF.force] = Math.hypot(F[0], F[1], F[2]);
    samples[o2 + LF.precessHz] = spec.force.kind === 'dipole' && Math.abs(y[S.wz]) > 1e-9
      ? (spec.force.moment * bmag) / (Is * Math.abs(y[S.wz])) / (2 * Math.PI)
      : 0;
    count++;
  };

  write(0, y0);
  const stride = duration / (maxSamples - 2);
  let nextOut = stride;
  const tmp = new Float64Array(N_STATE);

  while (integ.t < duration && count < maxSamples - 1) {
    const zPrev = integ.y[S.z];
    if (!integ.step(duration)) break;
    const y = integ.y;
    // dense output on a fixed cadence
    while (nextOut <= integ.t && count < maxSamples - 1) {
      integ.dense(nextOut, tmp);
      write(nextOut, tmp);
      nextOut += stride;
    }
    const e = energyOf(y);
    eMin = Math.min(eMin, e);
    eMax = Math.max(eMax, e);
    excursion = Math.max(excursion, Math.hypot(y[S.x] - start[0], y[S.y] - start[1], y[S.z] - start[2]));
    zs.push({ t: integ.t, z: y[S.z] });
    xs.push({ t: integ.t, x: y[S.x] });

    if (y[S.z] <= spec.floor) {
      // locate the crossing exactly
      const tc = findRoot((t) => integ.dense(t, tmp)[S.z] - spec.floor, integ.tPrev, integ.t, zPrev - spec.floor, y[S.z] - spec.floor);
      integ.dense(tc, tmp);
      write(tc, tmp);
      outcome = 'fell';
      break;
    }
    if (Math.hypot(y[S.x], y[S.y], y[S.z]) > spec.escapeRadius) {
      write(integ.t, y);
      outcome = 'escaped';
      break;
    }
    const e3 = bodyAxis(y[S.q0], y[S.q1], y[S.q2], y[S.q3]);
    const nq = Math.hypot(y[S.q0], y[S.q1], y[S.q2], y[S.q3]) || 1;
    if (e3[2] / (nq * nq) < 0) {
      write(integ.t, y);
      outcome = 'flipped';
      break;
    }
  }
  if (count < maxSamples) write(integ.t, integ.y);

  return {
    samples, count, outcome,
    duration: samples[(count - 1) * N_LEV_FIELDS + LF.t],
    excursion,
    energyDrift: Math.abs(eMax - eMin) / Math.max(Math.abs(e0), 1e-30),
    measuredFreq: {
      vertical: dominantFrequency(zs.map((s) => s.t), zs.map((s) => s.z)),
      horizontal: dominantFrequency(xs.map((s) => s.t), xs.map((s) => s.x)),
    },
  };
}

/**
 * Frequency of a sampled oscillation, from the mean interval between
 * zero crossings of the signal about its own mean. Crude but robust, and it
 * needs no uniform sampling — which matters because the integrator's steps
 * are adaptive.
 */
export function dominantFrequency(t: number[], v: number[]): number {
  if (t.length < 4) return 0;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  const crossings: number[] = [];
  for (let i = 1; i < v.length; i++) {
    const a = v[i - 1] - mean, b = v[i] - mean;
    if (a === 0 || a * b < 0) {
      const f = a / (a - b);
      crossings.push(t[i - 1] + f * (t[i] - t[i - 1]));
    }
  }
  if (crossings.length < 3) return 0;
  const span = crossings[crossings.length - 1] - crossings[0];
  return span > 0 ? (crossings.length - 1) / (2 * span) : 0;
}

/**
 * Which force law a 6-DOF run should use for a given mode. Shared by the
 * worker (which integrates) and the renderer (which draws force arrows), so
 * the arrows can never disagree with the motion.
 */
export function forceModelFor(mode: LevMode, o: LevObject, mat: EMMaterial, app: { extras: Record<string, number> }): LevForceModel {
  switch (mode) {
    case 'permanentMagnet':
    case 'spinStabilised':
    case 'superconductor':
      return { kind: 'dipole', moment: o.moment };
    case 'eddyCurrent': {
      const sigma = mat.resistivity && mat.resistivity > 0 ? 1 / mat.resistivity : 0;
      const radius = Math.cbrt((3 * objectVolume(o)) / (4 * Math.PI));
      const omega = 2 * Math.PI * (app.extras.frequency ?? 50);
      return { kind: 'eddy', polarisabilityRe: sigma > 0 ? eddySpherePolarisability(radius, sigma, omega).re : 0 };
    }
    default: {
      const N = demagFactor(o.shape, objectAspect(o));
      const chi = mat.chi / (1 + N * mat.chi);
      const alt = mat.chiAlt ?? mat.chi;
      return { kind: 'induced', chiAxis: chi, chiPerp: alt / (1 + N * alt), volume: objectVolume(o) };
    }
  }
}

/**
 * The net force on the object at a point, gravity included, with its moment
 * taken as vertical. This is what the force arrows in the 3-D view draw: an
 * arrow pointing up means the object would actually rise there, which a plain
 * field-gradient arrow would not tell you.
 */
export function netForceFn(field: FieldAssembly, force: LevForceModel, mass: number, g: number): (p: Vec3) => Vec3 {
  return (p: Vec3) => {
    const { B, J } = field.BJ(p);
    const gb = (i: number) => 2 * (B[0] * J[i] + B[1] * J[3 + i] + B[2] * J[6 + i]);
    let F: Vec3 = [0, 0, 0];
    if (force.kind === 'dipole') {
      // the moment is held anti-parallel to +z, as a repelled floater
      const m = -force.moment;
      F = [m * J[6], m * J[7], m * J[8]];
    } else if (force.kind === 'induced') {
      const k = (force.chiAxis * force.volume) / (2 * MU0);
      F = [k * gb(0), k * gb(1), k * gb(2)];
    } else {
      const k = force.polarisabilityRe / (4 * MU0);
      F = [k * gb(0), k * gb(1), k * gb(2)];
    }
    return [F[0], F[1], F[2] - mass * g];
  };
}

/** sensible defaults for a dynamics run, given a solved scenario */
export function dynamicsDefaults(field: FieldAssembly, object: LevObject, force: LevForceModel, g: number, scale: number): DynamicsSpec {
  return {
    field, object, force, g,
    airDensity: 1.2041,
    dragCd: 1.1,
    rotDamping: 2e-9,
    floor: -scale,
    escapeRadius: scale * 12,
    rtol: 1e-9,
  };
}
