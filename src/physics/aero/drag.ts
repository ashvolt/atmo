/**
 * Drag coefficient models.
 *
 * Every Cd here is referenced to the object's frontal (reference) area A.
 * Three regimes are combined:
 *   1. continuum, incompressible: Cd(Re) — shape specific
 *   2. compressibility: Cd(M) — shape-specific Mach tables, blended in from M = 0.6
 *   3. rarefaction: bridging to the free-molecular limit as Knudsen number Kn = λ/D
 *      goes from 0.01 to 10 (sin² bridging in log Kn, as used in DSMC-calibrated
 *      engineering codes, e.g. ESA DRAMA / NASA DAS).
 *
 * The drag of real objects is experimental; these models reproduce the
 * published curves to within their stated scatter (see tests/aero.test.ts).
 */
import { interpLinear } from '../interp';

export type ShapeKind = 'sphere' | 'roughSphere' | 'drop' | 'bluff' | 'constant';

/**
 * Standard drag curve of a smooth sphere: R. Clift, J. R. Grace & M. E. Weber,
 * "Bubbles, Drops and Particles" (1978), Table 5.2 — piecewise correlations
 * fitted to the full body of measurements, including the drag crisis.
 */
export function cdSphereStandard(Re: number): number {
  if (Re <= 0) return 0;
  const w = Math.log10(Re);
  if (Re < 0.01) return 3 / 16 + 24 / Re;
  if (Re <= 20) return (24 / Re) * (1 + 0.1315 * Re ** (0.82 - 0.05 * w));
  if (Re <= 260) return (24 / Re) * (1 + 0.1935 * Re ** 0.6305);
  if (Re <= 1500) return 10 ** (1.6435 - 1.1242 * w + 0.1558 * w * w);
  if (Re <= 1.2e4) return 10 ** (-2.4571 + 2.5558 * w - 0.9295 * w * w + 0.1049 * w * w * w);
  if (Re <= 4.4e4) return 10 ** (-1.9181 + 0.637 * w - 0.0636 * w * w);
  if (Re <= 3.38e5) return 10 ** (-4.339 + 1.5809 * w - 0.1546 * w * w);
  if (Re <= 4e5) return 29.78 - 5.3 * w;
  // The published 4e5-1e6 segment (0.1 w - 0.49) starts 0.019 below the previous one; we blend
  // linearly in log Re from Cd(4e5) to Cd(1e6) = 0.11 so the curve is continuous. The change is
  // well inside the crisis-region scatter (Achenbach 1972: Cd_min 0.07-0.1).
  if (Re <= 1e6) {
    const w0 = Math.log10(4e5);
    const c0 = 29.78 - 5.3 * w0;
    return c0 + ((w - w0) / (6 - w0)) * (0.11 - c0);
  }
  return 0.19 - 8e4 / Re;
}

/**
 * Morrison (2013) smooth correlation (kept for comparison in the explainer).
 * F. A. Morrison, "An Introduction to Fluid Mechanics", CUP 2013, Eq. 8.83.
 */
export function cdSphereMorrison(Re: number): number {
  if (Re <= 0) return 0;
  if (Re < 0.1) return 24 / Re; // Stokes
  const ReC = Math.min(Re, 1e6);
  const t1 = 24 / ReC;
  const t2 = (2.6 * (ReC / 5)) / (1 + (ReC / 5) ** 1.52);
  const t3 = (0.411 * (ReC / 263000) ** -7.94) / (1 + (ReC / 263000) ** -8.0);
  const t4 = (0.25 * (ReC / 1e6)) / (1 + ReC / 1e6);
  return t1 + t2 + t3 + t4;
}

/**
 * Sphere drag vs Mach number at high (subcritical) Reynolds number.
 * Data: Miller & Bailey, J. Fluid Mech. 93 (1979) 449 (M 0.3–2);
 * Bailey & Hiatt, AIAA J. 10 (1972) 1436 (M 0.1–6); hypersonic
 * modified-Newtonian limit 0.92 (Hoerner, "Fluid-Dynamic Drag", 1965, Ch. 16).
 */
const SPHERE_MACH_M = [0, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.4, 1.6, 2.0, 2.5, 3.0, 4.0, 5.0, 10, 30];
const SPHERE_MACH_CD = [0.47, 0.47, 0.5, 0.53, 0.58, 0.66, 0.77, 0.88, 0.96, 1.0, 1.02, 1.02, 1.0, 0.98, 0.96, 0.94, 0.93, 0.92, 0.92];

/**
 * Generic bluff body (cube, disk, cylinder, human) Mach factor Cd(M)/Cd(0).
 * Hoerner (1965) Ch. 16 Fig. 16, 20, 27: flat plates and blunt bodies rise
 * ~45–50 % through the transonic range and settle ~35–40 % above subsonic
 * values in the hypersonic limit (stagnation-pressure scaling).
 */
const BLUFF_MACH_M = [0, 0.5, 0.6, 0.8, 0.9, 1.0, 1.2, 1.5, 2.0, 3.0, 5.0, 10, 30];
const BLUFF_MACH_F = [1, 1.0, 1.03, 1.12, 1.22, 1.35, 1.48, 1.5, 1.45, 1.4, 1.36, 1.35, 1.35];

export function sphereMachCd(M: number) {
  return interpLinear(SPHERE_MACH_M, SPHERE_MACH_CD, M);
}
export function bluffMachFactor(M: number) {
  return interpLinear(BLUFF_MACH_M, BLUFF_MACH_F, M);
}

/**
 * Water-drop drag derived from Gunn & Kinzer (1949) terminal velocities
 * (J. Meteor. 6, 243), at 20 °C, 1013 hPa: Cd = 4 (ρw−ρa) g d / (3 ρa v²).
 * Accounts for drop flattening and internal circulation, which a rigid
 * sphere law misses by up to 10 %. Diameter in mm, v in m/s.
 */
export const GUNN_KINZER: [number, number][] = [
  [0.1, 0.27], [0.2, 0.72], [0.3, 1.17], [0.4, 1.62], [0.5, 2.06], [0.6, 2.47], [0.7, 2.87], [0.8, 3.27],
  [0.9, 3.67], [1.0, 4.03], [1.2, 4.64], [1.4, 5.17], [1.6, 5.65], [1.8, 6.09], [2.0, 6.49], [2.2, 6.9],
  [2.4, 7.27], [2.6, 7.57], [2.8, 7.82], [3.0, 8.06], [3.2, 8.26], [3.4, 8.44], [3.6, 8.6], [3.8, 8.72],
  [4.0, 8.83], [4.2, 8.92], [4.4, 8.98], [4.6, 9.03], [4.8, 9.07], [5.0, 9.09], [5.2, 9.12], [5.4, 9.14],
  [5.6, 9.16], [5.8, 9.17],
];
export const GK_CONDITIONS = {
  rhoAir: 101300 / (287.05 * 293.15),
  mu: (1.458e-6 * 293.15 ** 1.5) / (293.15 + 110.4),
  rhoWater: 998.2,
  g: 9.801, // Washington D.C. (38.9° N)
};
const GK_LOGRE: number[] = [];
const GK_CD: number[] = [];
for (const [dmm, v] of GUNN_KINZER) {
  const d = dmm / 1000;
  const { rhoAir, mu, rhoWater, g } = GK_CONDITIONS;
  GK_LOGRE.push(Math.log((rhoAir * v * d) / mu));
  GK_CD.push((4 * (rhoWater - rhoAir) * g * d) / (3 * rhoAir * v * v));
}
export function cdDrop(Re: number) {
  if (Re <= 0) return 0;
  const lr = Math.log(Re);
  // below the smallest measured drop (0.1 mm) drops are rigid spheres: standard curve, scaled to meet the data
  if (lr < GK_LOGRE[0]) return cdSphereStandard(Re) * (GK_CD[0] / cdSphereStandard(Math.exp(GK_LOGRE[0])));
  return interpLinear(GK_LOGRE, GK_CD, lr);
}

/** Free-molecular sphere drag, diffuse reflection (Schaaf & Chambré 1958). s = speed ratio. */
export function cdFreeMolecularSphere(s: number, TwOverT: number): number {
  if (s < 1e-6) s = 1e-6;
  const s2 = s * s;
  return (
    ((2 * s2 + 1) / (Math.sqrt(Math.PI) * s * s2)) * Math.exp(-s2) +
    ((4 * s2 * s2 + 4 * s2 - 1) / (2 * s2 * s2)) * erf(s) +
    ((2 * Math.sqrt(Math.PI)) / (3 * s)) * Math.sqrt(TwOverT)
  );
}

/** Free-molecular flat plate normal to the flow, diffuse reflection (Schaaf & Chambré 1958). */
export function cdFreeMolecularPlate(s: number, TwOverT: number): number {
  if (s < 1e-6) s = 1e-6;
  return (
    (2 / (s * Math.sqrt(Math.PI))) * Math.exp(-s * s) +
    2 * (1 + 1 / (2 * s * s)) * erf(s) +
    (Math.sqrt(Math.PI) / s) * Math.sqrt(TwOverT)
  );
}

/** Abramowitz & Stegun 7.1.26 has 1.5e-7 error; use a higher precision series/continued fraction. */
export function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  if (x > 6) return sign;
  if (x < 2.5) {
    // Maclaurin series
    let sum = x, term = x;
    const x2 = x * x;
    for (let n = 1; n < 200; n++) {
      term *= -x2 / n;
      const add = term / (2 * n + 1);
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return sign * (2 / Math.sqrt(Math.PI)) * sum;
  }
  // continued fraction for erfc (Lentz)
  const tiny = 1e-300;
  let f = x, C = x, D = 0;
  for (let n = 1; n < 300; n++) {
    const an = n / 2;
    D = x + an * D;
    D = D === 0 ? tiny : 1 / D;
    C = x + an / C;
    if (C === 0) C = tiny;
    const delta = C * D;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  const erfc = Math.exp(-x * x) / Math.sqrt(Math.PI) / f;
  return sign * (1 - erfc);
}

export interface DragInputs {
  Re: number;
  M: number;
  Kn: number;
  /** molecular speed ratio s = V / sqrt(2 k T / m) */
  s: number;
  /** wall-to-gas temperature ratio */
  TwOverT: number;
}

export interface ShapeDrag {
  kind: ShapeKind;
  /** subsonic continuum Cd for bluff bodies (ignored for spheres/drops) */
  cd0?: number;
  /** roughness factor shifting the drag crisis to lower Re (rough spheres) */
  reShift?: number;
  /** post-crisis floor for rough spheres */
  cdFloor?: number;
  /** sport-ball aerodynamics fitted to tracking data (overrides generic sphere Cd/CL in subsonic continuum flow) */
  sport?: 'baseball' | 'golf';
}

/**
 * Baseball: A. M. Nathan, "Trajectory Calculator" (2018 revision), fitted to
 * Statcast/TrackMan data:  C_D = 0.3008 + 0.0292·(spin/1000 rpm),
 * C_L = 1 / (2.32 + 0.4/S).
 * Golf: A. J. Smits & D. R. Smith, "A new aerodynamic model of a golf ball in
 * flight", Science & Golf II (1994):  C_D = 0.24 + 0.18·S,  C_L = 0.54·S^0.4
 * (valid Re > 7.5e4; below that the dimples stop working and Cd rises).
 */
export function sportCd(sport: 'baseball' | 'golf', S: number, spinRpm: number, Re: number): number {
  if (sport === 'baseball') return 0.3008 + 0.0292 * (spinRpm / 1000);
  const base = 0.24 + 0.18 * S;
  if (Re >= 7.5e4) return base;
  // sub-critical: blend towards a smooth-sphere value at low Re
  const w = Math.max(0, Math.min(1, (7.5e4 - Re) / 5e4));
  return base * (1 - w) + cdSphereStandard(Re) * w;
}
export function sportCl(sport: 'baseball' | 'golf', S: number): number {
  if (S <= 0) return 0;
  return sport === 'baseball' ? 1 / (2.32 + 0.4 / S) : 0.54 * S ** 0.4;
}

/** Continuum incompressible Cd. */
export function cdContinuumLowMach(shape: ShapeDrag, Re: number): number {
  switch (shape.kind) {
    case 'sphere':
      return cdSphereStandard(Re);
    case 'roughSphere': {
      // Achenbach (1974): roughness moves the crisis to lower Re and raises the supercritical floor.
      const cd = cdSphereStandard(Re * (shape.reShift ?? 1));
      return Re * (shape.reShift ?? 1) > 3.38e5 ? Math.max(cd, shape.cdFloor ?? 0.2) : cd;
    }
    case 'drop':
      return cdDrop(Re);
    case 'constant':
      return shape.cd0 ?? 1;
    case 'bluff':
      // Oseen-type low-Re rise; negligible above Re ~ 1e3
      return (shape.cd0 ?? 1) + (Re > 0 ? 24 / Re : 0);
  }
}

/** Full continuum Cd including compressibility. */
export function cdContinuum(shape: ShapeDrag, Re: number, M: number): number {
  const low = cdContinuumLowMach(shape, Re);
  if (M <= 0.6) {
    if (shape.kind === 'bluff') return low * bluffMachFactor(M);
    return low + (sphereMachCd(M) - 0.47) * (shape.kind === 'drop' ? 0 : 1);
  }
  const high = shape.kind === 'bluff' ? (shape.cd0 ?? 1) * bluffMachFactor(M) : sphereMachCd(M);
  if (M >= 0.8) return high;
  // 0.6 < M < 0.8: blend low-Re-aware value into the Mach-dominated table
  const lowAt = shape.kind === 'bluff' ? low * bluffMachFactor(M) : low + (sphereMachCd(M) - 0.47);
  const w = (M - 0.6) / 0.2;
  return lowAt * (1 - w) + high * w;
}

/** Bridging weight between continuum (0) and free-molecular (1) flow. */
export function rarefactionWeight(Kn: number): number {
  if (!(Kn > 0.01)) return 0;
  if (Kn >= 10) return 1;
  const x = ((Math.log10(Kn) + 2) / 3) * (Math.PI / 2);
  return Math.sin(x) ** 2;
}

export function dragCoefficient(shape: ShapeDrag, d: DragInputs): number {
  if (shape.kind === 'constant') return shape.cd0 ?? 1; // user-fixed Cd: no Re/Mach/Kn dependence
  const w = rarefactionWeight(d.Kn);
  const cont = w < 1 ? cdContinuum(shape, d.Re, d.M) : 0;
  if (w === 0) return cont;
  const fm =
    shape.kind === 'bluff'
      ? // flat plate is the bluff-body upper bound; streamlined bodies scale down with their continuum Cd
        cdFreeMolecularPlate(d.s, d.TwOverT) * Math.min(1, Math.max(0.6, (shape.cd0 ?? 1) / 1.17))
      : cdFreeMolecularSphere(d.s, d.TwOverT);
  return cont * (1 - w) + fm * w;
}

/**
 * Magnus lift coefficient vs spin parameter S = rω/V.
 * Sawicki, Hubbard & Stronge, Am. J. Phys. 71 (2003) 1152 (baseball):
 *   C_L = 1.5 S (S ≤ 0.1),  0.09 + 0.6 S (S > 0.1), saturating at 0.40 (Nathan 2008).
 */
export function magnusLiftCoefficient(S: number): number {
  if (S <= 0) return 0;
  const cl = S <= 0.1 ? 1.5 * S : 0.09 + 0.6 * S;
  return Math.min(cl, 0.4);
}

/**
 * Spin decay: aerodynamic torque τ = C_M ρ U A r² ω, i.e. dω/dt = −C_M ρ U A r² ω / I.
 * C_M = 0.008 gives ≈ 3 %/s for a 100 mph baseball and ≈ 5 %/s for a driven golf ball,
 * matching measured decay rates (Tavares et al. 1999; Nathan et al. 2012).
 */
export const SPIN_DECAY_CM = 0.008;
