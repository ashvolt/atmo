/**
 * Levitation physics: what balances gravity, how much of it is needed, and
 * whether the resulting equilibrium is stable.
 *
 * The organising fact is **Earnshaw's theorem** (S. Earnshaw, Trans. Camb.
 * Phil. Soc. 7 (1842) 97): in a region free of sources, a body whose
 * interaction energy is a harmonic function of position has no potential
 * minimum — every equilibrium is a saddle. For a fixed magnetic moment,
 * U = −m·B, and each Cartesian component of B is harmonic, so U is harmonic
 * and the equilibrium is always unstable. Every working levitator therefore
 * breaks one of the theorem's assumptions, and each mode below records which.
 *
 * The one static escape is a body whose moment is *induced*: then
 * U = −(χV/2μ₀)B², and because ∇²(B²) = 2|∇B|² ≥ 0 in a current-free region,
 * B² is subharmonic. It can have a minimum but never a maximum. A diamagnet
 * (χ < 0) sits in that minimum and is stable; a paramagnet (χ > 0) would need
 * a maximum, which cannot exist.
 */
import { MU0, EPS0, C_LIGHT, AIR_BREAKDOWN, FIELD_RECORDS } from './constants';
import { D2, add, adds, eigen3, muls, sq, sqrt as dsqrt } from './dual';
import { FieldAssembly, type Mat3 } from './sources';
import { chiContrast, criticalCurrentDensity, emMaterial, type EMMaterial } from './materials';
import type { Vec3 } from '../vec3';

export const LEV_MODES = [
  'electrostatic', 'permanentMagnet', 'diamagnetic', 'superconductor', 'eddyCurrent',
  'servo', 'spinStabilised', 'acoustic', 'optical', 'aerodynamic', 'buoyancy',
] as const;
export type LevMode = (typeof LEV_MODES)[number];

/** Which assumption of Earnshaw's theorem each mode breaks, if any. */
export const EARNSHAW_ESCAPE: Record<LevMode, { escapes: boolean; how: string }> = {
  electrostatic: { escapes: false, how: 'None. A fixed charge in a static field has a harmonic energy, so the equilibrium is a saddle. Real electrostatic levitators add active feedback (NASA ESL) or an oscillating field (Paul trap).' },
  permanentMagnet: { escapes: false, how: 'None. U = −m·B is harmonic for a fixed moment: whatever is stable vertically is unstable sideways, and vice versa. No arrangement of permanent magnets can passively levitate another magnet.' },
  diamagnetic: { escapes: true, how: 'The moment is induced, not fixed: U = +|χ|V B²/2μ₀. Since ∇²(B²) ≥ 0, B² can have a minimum, and the diamagnet sits in it. Stable with no feedback, no spin and no energy input.' },
  superconductor: { escapes: true, how: 'Twice over: a superconductor is a perfect diamagnet (χ = −1), and in a type-II material flux pinning adds hysteretic restoring forces that are not describable by any potential at all.' },
  eddyCurrent: { escapes: true, how: 'The field is time-varying — either an AC drive or motion through a static field. Earnshaw applies only to static fields.' },
  servo: { escapes: true, how: 'Energy is continuously supplied: a sensor measures the position and a controller modulates the current. The equilibrium is created by the feedback loop, not by the field.' },
  spinStabilised: { escapes: true, how: 'Angular momentum. The spinning moment precesses fast enough to follow the local field direction, so the effective energy is U = +m|B| rather than −m·B — and |B| can have a local minimum.' },
  acoustic: { escapes: true, how: 'The acoustic field oscillates; the trapping force is the time-averaged second-order (Gor’kov) force, which is not a static-field energy.' },
  optical: { escapes: true, how: 'Same: an optical trap averages an oscillating electromagnetic field, and the scattering force transfers momentum from the beam.' },
  aerodynamic: { escapes: true, how: 'Momentum transfer. Air is pushed downwards, so the system is not closed and no static-potential argument applies.' },
  buoyancy: { escapes: true, how: 'Buoyancy is a pressure gradient in a fluid, not a field energy — Archimedes, not Earnshaw.' },
};

/* ------------------------------------------------------------------ shapes */

export type LevShape = 'sphere' | 'cube' | 'disk' | 'plate' | 'cylinder';

/**
 * Demagnetising factor N along the symmetry axis, for the correction
 * χ_eff = χ/(1 + Nχ). It only matters when |χ| is not small — i.e. for
 * superconductors (χ = −1) and ferromagnets.
 * Source: J. A. Osborn, Phys. Rev. 67 (1945) 351.
 */
export function demagFactor(shape: LevShape, aspect = 1): number {
  switch (shape) {
    case 'sphere': return 1 / 3;
    case 'cube': return 1 / 3; // a cube has the same factor as a sphere by symmetry
    case 'plate': return 1; // field perpendicular to a thin plate
    case 'disk': return 1 - (Math.PI * aspect) / 4; // thickness/diameter = aspect, Osborn's oblate limit
    case 'cylinder': return 1 / (1 + 2 * aspect); // long axis, aspect = length/diameter
  }
}

export interface LevObject {
  id: string;
  name: string;
  emoji: string;
  shape: LevShape;
  /** characteristic size: diameter or edge [m] */
  size: number;
  /** thickness for disks and plates [m] */
  thickness: number;
  /** EM material id */
  material: string;
  /** mass [kg] — derived from the material unless overridden */
  mass: number;
  /** permanent magnetic moment [A·m²], for magnets and spinning tops */
  moment: number;
  /** net electric charge [C] */
  charge: number;
  /** spin rate [rev/s] */
  spinRps: number;
  description: string;
}

export function objectVolume(o: Pick<LevObject, 'shape' | 'size' | 'thickness'>): number {
  const r = o.size / 2;
  switch (o.shape) {
    case 'sphere': return (4 / 3) * Math.PI * r ** 3;
    case 'cube': return o.size ** 3;
    case 'disk': return Math.PI * r * r * o.thickness;
    case 'plate': return o.size * o.size * o.thickness;
    case 'cylinder': return Math.PI * r * r * o.thickness;
  }
}

/** frontal / projected area used for drag and radiation pressure [m²] */
export function objectArea(o: Pick<LevObject, 'shape' | 'size' | 'thickness'>): number {
  const r = o.size / 2;
  switch (o.shape) {
    case 'sphere': return Math.PI * r * r;
    case 'cube': return o.size ** 2;
    case 'disk': return Math.PI * r * r;
    case 'plate': return o.size * o.size;
    case 'cylinder': return Math.PI * r * r;
  }
}

/** aspect ratio (thickness / diameter) used by the demagnetising factor */
export function objectAspect(o: Pick<LevObject, 'shape' | 'size' | 'thickness'>): number {
  return o.shape === 'sphere' || o.shape === 'cube' ? 1 : o.thickness / o.size;
}

/**
 * Principal moments of inertia about the centre of mass [kg·m²],
 * [I_axis, I_transverse, I_transverse] for the axisymmetric shapes.
 */
export function inertia(o: LevObject): { Is: number; Iperp: number } {
  const m = o.mass, r = o.size / 2, t = o.thickness;
  switch (o.shape) {
    case 'sphere': return { Is: 0.4 * m * r * r, Iperp: 0.4 * m * r * r };
    case 'cube': return { Is: (m * o.size ** 2) / 6, Iperp: (m * o.size ** 2) / 6 };
    case 'disk':
    case 'cylinder':
      return { Is: 0.5 * m * r * r, Iperp: (m * (3 * r * r + t * t)) / 12 };
    case 'plate':
      return { Is: (m * (o.size ** 2 + o.size ** 2)) / 12, Iperp: (m * (o.size ** 2 + t * t)) / 12 };
  }
}

export function objectMass(o: Pick<LevObject, 'shape' | 'size' | 'thickness' | 'material'>): number {
  return emMaterial(o.material).density * objectVolume(o);
}

/* -------------------------------------------------- potential-energy models */

export interface PotentialSample {
  U: number;
  grad: Vec3;
  hess: Mat3;
}

/**
 * A potential-energy model, with three evaluations of increasing cost:
 *   energy  — value only, from B alone
 *   grad    — value and gradient, from B and its analytic Jacobian
 *   at      — value, gradient and exact Hessian, from the hyper-dual path
 * Scans and energy landscapes use the cheap ones; stability needs `at`.
 * The tests check that all three agree.
 */
export interface PotentialModel {
  at(p: Vec3): PotentialSample;
  energy(p: Vec3): number;
  grad(p: Vec3): Vec3;
  label: string;
}

/** ∇(B²) = 2·Jᵀ·B, from the analytic Jacobian — no second derivatives needed. */
function gradB2From(B: Vec3, J: Mat3): Vec3 {
  return [
    2 * (B[0] * J[0] + B[1] * J[3] + B[2] * J[6]),
    2 * (B[0] * J[1] + B[1] * J[4] + B[2] * J[7]),
    2 * (B[0] * J[2] + B[1] * J[5] + B[2] * J[8]),
  ];
}

const gravityPart = (mass: number, g: number): PotentialSample => ({
  U: 0, grad: [0, 0, mass * g], hess: new Array(9).fill(0),
});

/**
 * Induced-moment energy: U = −(χ_eff V/2μ₀)·B² + m g z.
 * Exact gradient and Hessian come from the hyper-dual B², so the stability
 * eigenvalues below are exact, not finite-differenced.
 */
export function inducedPotential(field: FieldAssembly, chiEff: number, volume: number, mass: number, g: number): PotentialModel {
  const k = -(chiEff * volume) / (2 * MU0);
  return {
    label: 'U = −χV B²/2μ₀ + mgz',
    energy(p: Vec3) {
      const b = field.B(p);
      return k * (b[0] * b[0] + b[1] * b[1] + b[2] * b[2]) + mass * g * p[2];
    },
    grad(p: Vec3) {
      const { B, J } = field.BJ(p);
      const gb = gradB2From(B, J);
      return [k * gb[0], k * gb[1], k * gb[2] + mass * g];
    },
    at(p: Vec3) {
      const b2 = field.B2d(p);
      const h = b2.hess.map((v) => k * v);
      return {
        U: k * b2.v + mass * g * p[2],
        grad: [k * b2.gx, k * b2.gy, k * b2.gz + mass * g] as Vec3,
        hess: h,
      };
    },
  };
}

/** Fixed-orientation dipole: U = −m·B + mgz. Harmonic ⇒ always a saddle. */
export function fixedDipolePotential(field: FieldAssembly, m: Vec3, mass: number, g: number): PotentialModel {
  return {
    label: 'U = −m·B + mgz',
    energy(p: Vec3) {
      const b = field.B(p);
      return -(m[0] * b[0] + m[1] * b[1] + m[2] * b[2]) + mass * g * p[2];
    },
    grad(p: Vec3) {
      const { B, J } = field.BJ(p);
      void B;
      const gi = (i: number) => -(m[0] * J[i] + m[1] * J[3 + i] + m[2] * J[6 + i]);
      return [gi(0), gi(1), gi(2) + mass * g];
    },
    at(p: Vec3) {
      const [x, y, z] = D2.point(p[0], p[1], p[2]);
      const b = field.Bd(x, y, z);
      const u = muls(add(add(muls(b[0], m[0]), muls(b[1], m[1])), muls(b[2], m[2])), -1);
      return {
        U: u.v + mass * g * p[2],
        grad: [u.gx, u.gy, u.gz + mass * g] as Vec3,
        hess: u.hess,
      };
    },
  };
}

/**
 * Adiabatically following ("spin-stabilised") dipole: the moment precesses
 * fast enough to stay anti-parallel to the local field, so the energy depends
 * only on the field magnitude: U = +|m||B| + mgz. |B| is *not* harmonic, and
 * it can have a local minimum — that is the Levitron's loophole.
 * Source: M. V. Berry, Proc. R. Soc. A 452 (1996) 1207.
 */
export function adiabaticDipolePotential(field: FieldAssembly, moment: number, mass: number, g: number): PotentialModel {
  return {
    label: 'U = +m|B| + mgz',
    energy(p: Vec3) {
      const b = field.B(p);
      return moment * Math.hypot(b[0], b[1], b[2]) + mass * g * p[2];
    },
    grad(p: Vec3) {
      const { B, J } = field.BJ(p);
      const bm = Math.hypot(B[0], B[1], B[2]) || 1e-300;
      const gb = gradB2From(B, J);
      // ∇|B| = ∇(B²)/(2|B|)
      return [(moment * gb[0]) / (2 * bm), (moment * gb[1]) / (2 * bm), (moment * gb[2]) / (2 * bm) + mass * g];
    },
    at(p: Vec3) {
      const b2 = field.B2d(p);
      const bmag = dsqrt(b2);
      return {
        U: moment * bmag.v + mass * g * p[2],
        grad: [moment * bmag.gx, moment * bmag.gy, moment * bmag.gz + mass * g] as Vec3,
        hess: bmag.hess.map((v) => moment * v),
      };
    },
  };
}

/** Charge in an electrostatic field, expressed through a magnetic-style assembly is not possible; this is the analytic parallel-plate case. */
export function chargePotential(Efield: Vec3, charge: number, mass: number, g: number): PotentialModel {
  const E = Efield;
  return {
    label: 'U = −qE·r + mgz',
    energy(p: Vec3) {
      return -charge * (E[0] * p[0] + E[1] * p[1] + E[2] * p[2]) + mass * g * p[2];
    },
    grad(): Vec3 {
      return [-charge * E[0], -charge * E[1], -charge * E[2] + mass * g];
    },
    at(p: Vec3) {
      return {
        U: -charge * (Efield[0] * p[0] + Efield[1] * p[1] + Efield[2] * p[2]) + mass * g * p[2],
        grad: [-charge * Efield[0], -charge * Efield[1], -charge * Efield[2] + mass * g] as Vec3,
        hess: new Array(9).fill(0),
      };
    },
  };
}

void gravityPart;

/* ------------------------------------------------- equilibrium & stability */

/** 3×3 linear solve by Cramer's rule; returns null for a singular matrix. */
export function m3solve(A: Mat3, b: Vec3): Vec3 | null {
  const det =
    A[0] * (A[4] * A[8] - A[5] * A[7]) -
    A[1] * (A[3] * A[8] - A[5] * A[6]) +
    A[2] * (A[3] * A[7] - A[4] * A[6]);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-300) return null;
  const col = (i: number, v: Vec3) => {
    const M = [...A];
    M[i] = v[0]; M[3 + i] = v[1]; M[6 + i] = v[2];
    return (
      M[0] * (M[4] * M[8] - M[5] * M[7]) -
      M[1] * (M[3] * M[8] - M[5] * M[6]) +
      M[2] * (M[3] * M[7] - M[4] * M[6])
    );
  };
  return [col(0, b) / det, col(1, b) / det, col(2, b) / det];
}

export interface Stability {
  /** eigenvalues of the energy Hessian [N/m] — all positive ⇒ a true minimum */
  stiffness: [number, number, number];
  /** oscillation frequencies [Hz]; NaN where the eigenvalue is negative */
  frequencies: [number, number, number];
  stable: boolean;
  /** number of unstable directions: 0 = minimum, 3 = maximum, else a saddle */
  unstableDirections: number;
  /** the direction the object escapes along, if unstable */
  escapeHint: string;
}

export function analyseStability(hess: Mat3, mass: number): Stability {
  const ev = eigen3(hess);
  const freq = ev.map((l) => (l > 0 ? Math.sqrt(l / mass) / (2 * Math.PI) : NaN)) as [number, number, number];
  const unstable = ev.filter((l) => l < 0).length;
  // the softest direction tells you how it escapes; compare the diagonal to name an axis
  const diag = [hess[0], hess[4], hess[8]];
  const worst = diag.indexOf(Math.min(...diag));
  const names = ['horizontally (x)', 'horizontally (y)', 'vertically (z)'];
  return {
    stiffness: ev,
    frequencies: freq,
    stable: unstable === 0,
    unstableDirections: unstable,
    escapeHint: unstable === 0 ? 'none — it is trapped in all three directions' : names[worst],
  };
}

export interface Equilibrium {
  position: Vec3;
  /** residual force at the solution [N] */
  residual: number;
  /** total potential energy [J] */
  U: number;
  iterations: number;
  converged: boolean;
}

/**
 * Newton's method on ∇U = 0 using the exact Hessian. Falls back to a damped
 * step when the Hessian is indefinite (which is the normal case near a
 * saddle), and will still locate the saddle — that is the point.
 */
export function findEquilibrium(model: PotentialModel, start: Vec3, scale: number): Equilibrium {
  let p: Vec3 = [...start] as Vec3;
  let s = model.at(p);
  let it = 0;
  for (; it < 200; it++) {
    const gn = Math.hypot(s.grad[0], s.grad[1], s.grad[2]);
    if (gn < 1e-14) break;
    const step = m3solve(s.hess, [-s.grad[0], -s.grad[1], -s.grad[2]]);
    let d: Vec3 = step ?? [0, 0, -s.grad[2] * 1e-6];
    const dn = Math.hypot(d[0], d[1], d[2]);
    const cap = 0.25 * scale;
    if (dn > cap) d = [(d[0] / dn) * cap, (d[1] / dn) * cap, (d[2] / dn) * cap];
    const next: Vec3 = [p[0] + d[0], p[1] + d[1], p[2] + d[2]];
    const ns = model.at(next);
    const nn = Math.hypot(ns.grad[0], ns.grad[1], ns.grad[2]);
    if (!Number.isFinite(nn)) break;
    p = next;
    s = ns;
    if (nn < 1e-13 * Math.max(1, Math.abs(s.U) / scale)) break;
  }
  const residual = Math.hypot(s.grad[0], s.grad[1], s.grad[2]);
  return { position: p, residual, U: s.U, iterations: it, converged: residual < 1e-9 };
}

/**
 * Scan upward along the z axis for a height where the net vertical force
 * changes sign, then refine by bisection. More robust than Newton from an
 * arbitrary start, and it reports *all* the crossings so a trap that only
 * exists over a narrow band of heights is visible.
 */
export function verticalEquilibria(model: PotentialModel, zMin: number, zMax: number, samples = 160, x = 0, y = 0): number[] {
  const f = (z: number) => model.grad([x, y, z])[2];
  const out: number[] = [];
  let zPrev = zMin, fPrev = f(zMin);
  for (let i = 1; i <= samples; i++) {
    const z = zMin + ((zMax - zMin) * i) / samples;
    const fz = f(z);
    if (Number.isFinite(fPrev) && Number.isFinite(fz) && fPrev * fz < 0) {
      let a = zPrev, b = z, fa = fPrev;
      for (let k = 0; k < 60; k++) {
        const mid = 0.5 * (a + b);
        const fm = f(mid);
        if (fa * fm <= 0) b = mid;
        else { a = mid; fa = fm; }
      }
      out.push(0.5 * (a + b));
    }
    zPrev = z;
    fPrev = fz;
  }
  return out;
}

/* ------------------------------------------------------------ mode physics */

/**
 * Diamagnetic levitation requirement. Balancing
 *   (χ_eff/2μ₀)·∂(B²)/∂z = ρ g
 * gives the field–gradient product that actually matters:
 *   |B ∂B/∂z| = μ₀ ρ g / |χ|
 * For water this is 1360 T²/m, the number behind the 16 T Nijmegen magnet
 * that levitated a live frog (Berry & Geim, Eur. J. Phys. 18 (1997) 307).
 */
export function diamagneticRequirement(material: EMMaterial, g: number, medium = emMaterial('air')): {
  bGradB: number; gradB2: number; chi: number; possible: boolean; reason: string;
} {
  const chi = chiContrast(material, medium);
  if (chi >= 0) {
    return {
      bGradB: Infinity, gradB2: Infinity, chi, possible: false,
      reason: 'Paramagnetic relative to its surroundings: it is pulled towards stronger field, and a static field has no interior maximum of B², so no stable levitation exists at any field strength.',
    };
  }
  const bGradB = (MU0 * material.density * g) / Math.abs(chi);
  return { bGradB, gradB2: 2 * bGradB, chi, possible: true, reason: '' };
}

/**
 * Field needed in a realistic solenoid-like geometry, where the gradient
 * scales as B/L with L the characteristic length of the magnet bore. Gives a
 * fair estimate of the peak field, which is the number the verdict uses.
 */
export function fieldForBGradB(bGradB: number, lengthScale: number): number {
  return Math.sqrt(bGradB * lengthScale);
}

/**
 * Where a diamagnet can actually be trapped, and how strong the magnet has to
 * be to put it there.
 *
 * Stability needs a *minimum* of B², and whether B² has a minimum at a given
 * point depends only on the geometry of the sources, not on how hard they are
 * driven: scaling every current by s multiplies B² by s² and leaves the sign
 * of the Hessian's eigenvalues unchanged. So the stable band is fixed by the
 * apparatus, and the drive level only decides *which object* sits in it:
 *   s² · |B ∂B/∂z|(z_band) = μ₀ρg/|χ|.
 * That makes the answer exact rather than a search — find the band once, then
 * read off the current.
 */
export function stableBand(field: FieldAssembly, zMin: number, zMax: number, samples = 150): {
  zLow: number; zHigh: number; zBest: number; bGradB: number;
} | null {
  // A coarse scan locates the band; its edges are then refined by bisection,
  // which costs ~40 extra Hessian evaluations instead of the few hundred a
  // fine scan would need. The band can be under a millimetre tall, so the
  // refinement is what makes it reportable.
  const smallest = (z: number) => {
    const p: Vec3 = [0, 0, z];
    if (field.isInsideAny(p)) return { ev: -1, bg: 0 };
    const b2 = field.B2d(p);
    return { ev: eigen3(b2.hess)[0], bg: Math.abs(b2.gz / 2) };
  };
  let zLow = NaN, zHigh = NaN, zBest = NaN, best = 0;
  let prevZ = zMin, prevOk = false;
  for (let i = 0; i <= samples; i++) {
    const z = zMin + ((zMax - zMin) * i) / samples;
    const { ev, bg } = smallest(z);
    const ok = ev > 0;
    if (ok) {
      if (Number.isNaN(zLow)) zLow = z;
      zHigh = z;
      if (bg > best) {
        best = bg;
        zBest = z;
      }
    }
    if (i > 0 && ok !== prevOk) {
      // refine the edge between prevZ (prevOk) and z (ok)
      let a = prevZ, b = z;
      for (let k = 0; k < 20; k++) {
        const mid = 0.5 * (a + b);
        if (smallest(mid).ev > 0 === ok) b = mid;
        else a = mid;
      }
      const edge = 0.5 * (a + b);
      if (ok) zLow = Math.min(Number.isNaN(zLow) ? edge : zLow, edge);
      else zHigh = Math.max(zHigh, edge);
    }
    prevZ = z;
    prevOk = ok;
  }
  return Number.isNaN(zLow) ? null : { zLow, zHigh, zBest, bGradB: best };
}

/**
 * Electrostatic levitation.
 *
 * A conducting sphere of radius r in a uniform field E₀ carrying charge Q has
 * a surface field 3E₀ + Q/(4πε₀r²) at its poles. Breakdown of the medium caps
 * that sum, so the liftable weight is maximised at Q/(4πε₀r²) = E_br/2 and
 * E₀ = E_br/6, giving
 *   F_max = (π/3)·ε₀·r²·E_br²   ⇒   r_max = ε₀E_br²/(4ρg)
 * For a metal bead in air this is about 2 mm, which is why real electrostatic
 * levitators (NASA's ESL) run in vacuum with millimetre samples.
 */
export function electrostaticLimits(material: EMMaterial, radius: number, g: number, medium = emMaterial('air')): {
  requiredE: number; requiredCharge: number; maxForce: number; maxRadius: number;
  breakdown: number; rayleighLimit: number | null; feasible: boolean; limitedBy: string;
} {
  const Ebr = medium.dielectricStrength ?? AIR_BREAKDOWN;
  const mass = material.density * (4 / 3) * Math.PI * radius ** 3;
  const maxForce = (Math.PI / 3) * EPS0 * radius * radius * Ebr * Ebr;
  const maxRadius = (EPS0 * Ebr * Ebr) / (4 * material.density * g);
  const E0 = Ebr / 6;
  const requiredCharge = (mass * g) / E0;
  // Rayleigh limit on a charged liquid drop: Q_max = 8π√(ε₀ γ r³)
  const gamma = material.id === 'water' ? 0.0728 : null;
  const rayleigh = gamma === null ? null : 8 * Math.PI * Math.sqrt(EPS0 * gamma * radius ** 3);
  const feasible = maxForce >= mass * g && (rayleigh === null || requiredCharge <= rayleigh);
  return {
    requiredE: E0, requiredCharge, maxForce, maxRadius, breakdown: Ebr, rayleighLimit: rayleigh,
    feasible,
    limitedBy: !feasible && rayleigh !== null && requiredCharge > rayleigh
      ? 'the Rayleigh limit — the drop would break into a spray before it carried enough charge'
      : feasible ? '' : 'dielectric breakdown of the surrounding medium',
  };
}

/**
 * Meissner repulsion of a vertical dipole above an ideal superconducting
 * plane. The boundary condition B⊥ = 0 is met by an image dipole at −h, and
 * two coaxial repelling dipoles separated by 2h give
 *   F = 3μ₀m²/(32π h⁴)
 */
export function meissnerForce(moment: number, height: number): number {
  return (3 * MU0 * moment * moment) / (32 * Math.PI * height ** 4);
}

/** Height at which Meissner repulsion balances a given weight above an ideal infinite plane [m]. */
export function meissnerHeight(moment: number, weight: number): number {
  return Math.pow((3 * MU0 * moment * moment) / (32 * Math.PI * weight), 0.25);
}

/**
 * The same, corrected for a superconductor of finite radius R. A disc of
 * radius R seen from height h covers a fraction
 *   f(h) = 1 − h/√(h²+R²)
 * of the half-space solid angle, and only that fraction of the ideal image
 * forms, so the usable force is F_ideal(h)·f(h). Solved by bisection.
 *
 * This is a geometric approximation, not an exact boundary-value solution:
 * it captures the right limits (f → 1 for h ≪ R, f → R²/2h² for h ≫ R) and
 * removes the large over-estimate the infinite-plane formula gives, but a
 * real finite puck also distorts the field near its rim.
 */
export function meissnerHeightFinite(moment: number, weight: number, puckRadius: number): number {
  const F = (h: number) => meissnerForce(moment, h) * (1 - h / Math.hypot(h, puckRadius));
  let lo = 1e-9, hi = Math.max(meissnerHeight(moment, weight) * 4, puckRadius * 10);
  if (F(lo) < weight) return 0;
  for (let i = 0; i < 200; i++) {
    const mid = 0.5 * (lo + hi);
    if (F(mid) > weight) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/**
 * Flux-pinning capability of a type-II superconductor.
 *
 * The Maxwell stress sets the ceiling on levitation pressure, B²/2μ₀. What
 * pinning actually delivers is the Lorentz force density J_c × B acting over
 * the flux-penetrated depth λ = B/(μ₀J_c) (Bean's model), giving a pressure
 * J_c B λ = B²/2μ₀ · 2 — i.e. pinning can reach the Maxwell limit when the
 * sample is thicker than λ, and falls short when it is not.
 * Sources: C. P. Bean, Rev. Mod. Phys. 36 (1964) 31; Moon, "Superconducting
 * Levitation" (1994).
 */
export function pinningCapability(material: EMMaterial, B: number, tempK: number, thickness: number): {
  Jc: number; penetration: number; maxPressure: number; pressure: number; limited: 'thickness' | 'maxwell';
} {
  const Jc = criticalCurrentDensity(material, B, tempK);
  const penetration = Jc > 0 ? B / (MU0 * Jc) : Infinity;
  const maxPressure = (B * B) / (2 * MU0);
  const depth = Math.min(thickness, penetration);
  const pressure = Math.min(Jc * B * depth, maxPressure);
  return { Jc, penetration, maxPressure, pressure, limited: penetration > thickness ? 'thickness' : 'maxwell' };
}

/**
 * Eddy-current (electrodynamic) levitation of a conducting sphere in an AC
 * field. The magnetic polarisability of a non-magnetic sphere of conductivity
 * σ, defined by m = αH, is
 *
 *   α(ω) = −2πa³·F(q),   F(q) = 1 − 3/q² + 3·cot(q)/q,
 *   q = ka = (1−i)a/δ,   δ = √(2/ωμ₀σ)
 *
 * The two limits are the check that matters. Expanding cot for small q gives
 * F → −q²/15 − 2q⁴/315, so with q² = −iωμ₀σa² the real part grows as ω² (the
 * familiar low-frequency eddy-current force) and the imaginary part as ω (the
 * dissipation). For δ ≪ a, cot(q) → i and F → 1, i.e. α → −2πa³: perfect
 * shielding, the same polarisability as a superconducting sphere.
 *
 * Re α gives the time-averaged force, Im α the power dissipated — one complex
 * number for both the lift and what it costs, which is why induction
 * levitation always heats what it lifts.
 * Source: L. D. Landau & E. M. Lifshitz, "Electrodynamics of Continuous
 * Media", 2nd ed., §59.
 */
export function eddySpherePolarisability(radius: number, conductivity: number, omega: number): { re: number; im: number; skinDepth: number } {
  const delta = Math.sqrt(2 / (omega * MU0 * conductivity));
  // q = ka = (1 − i)·a/δ, so q² = −2i(a/δ)²
  const u = radius / delta;
  const qr = u, qi = -u;
  const { re: cr, im: ci } = ccot(qr, qi);
  const inv = cdiv(3, 0, 0, -2 * u * u); // 3/q²
  const t = cdiv(3 * cr, 3 * ci, qr, qi); // 3cot(q)/q
  const fr = 1 - inv.re + t.re;
  const fi = -inv.im + t.im;
  const pre = -2 * Math.PI * radius ** 3;
  return { re: pre * fr, im: pre * fi, skinDepth: delta };
}

function cdiv(ar: number, ai: number, br: number, bi: number) {
  const d = br * br + bi * bi;
  return { re: (ar * br + ai * bi) / d, im: (ai * br - ar * bi) / d };
}
function ccot(xr: number, xi: number) {
  // cot z → ∓i as Im z → ±∞. Taking that limit explicitly avoids cosh and
  // sinh overflowing for large |Im z|, which happens as soon as the skin
  // depth is a few hundred times smaller than the sphere.
  if (xi < -20) return { re: 0, im: 1 };
  if (xi > 20) return { re: 0, im: -1 };
  const sr = Math.sin(xr) * Math.cosh(xi), si = Math.cos(xr) * Math.sinh(xi);
  const cr = Math.cos(xr) * Math.cosh(xi), ci = -Math.sin(xr) * Math.sinh(xi);
  return cdiv(cr, ci, sr, si);
}

/**
 * Inductrack: a Halbach array moving over a shorted conducting track.
 * With λ the array wavelength, y the gap, and the track's L/R time constant
 * fixing a transition speed v_c = (R/L)(λ/2π):
 *
 *   lift  = (B₀²A/2μ₀)·e^{−4πy/λ}·1/(1 + (v_c/v)²)
 *   drag  = lift·(v_c/v)         ⇒  lift/drag = v/v_c
 *
 * Lift equals drag at v = v_c and the ratio then grows linearly with speed —
 * the central result of R. F. Post & D. D. Ryutov, IEEE Trans. Appl.
 * Supercond. 10 (2000) 901.
 */
export function inductrack(B0: number, lambda: number, gap: number, area: number, vc: number, v: number): {
  lift: number; drag: number; ratio: number; transitionSpeed: number;
} {
  const decay = Math.exp((-4 * Math.PI * gap) / lambda);
  const f = 1 / (1 + (vc / v) ** 2);
  const lift = ((B0 * B0 * area) / (2 * MU0)) * decay * f;
  const drag = lift * (vc / v);
  return { lift, drag, ratio: v / vc, transitionSpeed: vc };
}

/**
 * Attractive electromagnet over a ferromagnetic armature (EMS Maglev).
 * Two air gaps of length x in series give B = μ₀Ni/(2x) and a pull of
 * F = B²A/μ₀ = μ₀N²A i²/(4x²) ≡ k(i/x)².
 */
export function emsForce(turns: number, poleArea: number, current: number, gap: number): { force: number; B: number; k: number } {
  const k = (MU0 * turns * turns * poleArea) / 4;
  const B = (MU0 * turns * current) / (2 * gap);
  return { force: k * (current / gap) ** 2, B, k };
}

export interface ServoDesign {
  /** operating current [A] */
  current: number;
  /** flux density in the gap [T] */
  B: number;
  /** open-loop position stiffness, negative = unstable [N/m] */
  kx: number;
  /** current stiffness [N/A] */
  ki: number;
  /** growth rate of the uncontrolled instability [1/s] */
  unstablePole: number;
  /** chosen closed-loop natural frequency [Hz] and damping */
  bandwidth: number;
  damping: number;
  /** proportional and derivative gains [A/m], [A·s/m] */
  kp: number;
  kd: number;
  /** current ripple caused by sensor noise [A rms] */
  currentNoise: number;
  /** minimum sensor bandwidth for the loop to work [Hz] */
  sensorBandwidth: number;
  feasible: boolean;
}

/**
 * State-feedback design for an EMS magnet. Linearising F = k(i/x)² about
 * (i₀, x₀) with F₀ = mg gives k_x = −2F₀/x₀ (destabilising) and k_i = 2F₀/i₀.
 * With u = −k_p x̃ − k_d ẋ the closed loop is
 *   m s² + k_i k_d s + (k_i k_p + k_x) = 0,
 * so the gains follow from a chosen ω_n and ζ. The uncontrolled plant has a
 * real pole at √(2g/x₀) — about 44 s⁻¹ at a 10 mm gap, which is why Maglev
 * magnets need kilohertz-rate control.
 */
export function designServo(mass: number, g: number, gap: number, turns: number, poleArea: number, bandwidthHz: number, damping = 0.7, sensorNoiseM = 1e-6): ServoDesign {
  const weight = mass * g;
  const k = (MU0 * turns * turns * poleArea) / 4;
  const current = gap * Math.sqrt(weight / k);
  const B = (MU0 * turns * current) / (2 * gap);
  const kx = (-2 * weight) / gap;
  const ki = (2 * weight) / current;
  const wn = 2 * Math.PI * bandwidthHz;
  const kp = (mass * wn * wn - kx) / ki;
  const kd = (2 * damping * mass * wn) / ki;
  return {
    current, B, kx, ki,
    unstablePole: Math.sqrt((2 * g) / gap),
    bandwidth: bandwidthHz, damping, kp, kd,
    currentNoise: kp * sensorNoiseM,
    sensorBandwidth: 10 * bandwidthHz,
    feasible: B < 1.8 && bandwidthHz > Math.sqrt((2 * g) / gap) / (2 * Math.PI) * 3,
  };
}

/**
 * Levitron stability window.
 *
 * Two competing requirements bracket the spin rate:
 *  • too slow and the top topples in the field gradient, the magnetic
 *    analogue of a sleeping top losing speed: ω_s > 2√(I_⊥ m B)/I_s;
 *  • too fast and the precession Ω = mB/(I_s ω_s) becomes slower than the
 *    orbital motion in the trap, so the moment can no longer track the field
 *    direction and the whole basis for U = +m|B| fails: Ω ≥ κ·ω_vib.
 *
 * The adiabatic condition is an inequality with an order-unity constant, not
 * an equality. `ADIABATIC_MARGIN` fixes it at 3, which is calibrated so that a
 * real Levitron's window comes out as the measured 18–35 rev/s; it is the one
 * fitted number in this model and the validation report flags it as such.
 *
 * Sources: M. V. Berry, Proc. R. Soc. A 452 (1996) 1207; M. D. Simon,
 * L. O. Heflinger & S. L. Ridgway, Am. J. Phys. 65 (1997) 286.
 */
export const ADIABATIC_MARGIN = 3;

export function levitronWindow(moment: number, B: number, Is: number, Iperp: number, vibrationHz: number): {
  minRps: number; maxRps: number; exists: boolean; precessionHz: (rps: number) => number;
} {
  const wVib = 2 * Math.PI * vibrationHz;
  const wMin = (2 * Math.sqrt(Iperp * moment * B)) / Is;
  const wMax = (moment * B) / (Is * wVib * ADIABATIC_MARGIN);
  return {
    minRps: wMin / (2 * Math.PI),
    maxRps: wMax / (2 * Math.PI),
    exists: wMax > wMin,
    precessionHz: (rps: number) => (moment * B) / (Is * 2 * Math.PI * rps) / (2 * Math.PI),
  };
}

/**
 * Gor'kov acoustic radiation potential for a sphere much smaller than the
 * wavelength, in a plane standing wave of pressure amplitude p_a:
 *
 *   U(z) = (πa³p_a²/3ρ₀c₀²)·[ (f₁ − 1.5f₂)/2 + cos(2kz)(f₁ + 1.5f₂)/2 ]
 *   f₁ = 1 − ρ₀c₀²/ρ_pc_p²      (compressibility contrast)
 *   f₂ = 2(ρ_p − ρ₀)/(2ρ_p + ρ₀) (density contrast)
 *
 * The peak axial force is πa³p_a²k(f₁+1.5f₂)/(3ρ₀c₀²); setting it equal to
 * the weight gives a threshold pressure *independent of particle size*,
 * because both scale as a³. About 1.7 kPa (159 dB) for water in air at
 * 40 kHz, matching real levitators.
 * Sources: L. P. Gor'kov, Sov. Phys. Dokl. 6 (1962) 773; H. Bruus, Lab Chip
 * 12 (2012) 1014.
 */
export function acousticLevitation(particle: EMMaterial, medium: EMMaterial, frequency: number, g: number, radius: number): {
  f1: number; f2: number; contrast: number; k: number; nodeSpacing: number;
  thresholdPressure: number; thresholdSPL: number; maxRadius: number; feasible: boolean;
} {
  const rho0 = medium.density, c0 = medium.soundSpeed ?? 343.2;
  const rhoP = particle.density, cP = particle.soundSpeed ?? 1500;
  const f1 = 1 - (rho0 * c0 * c0) / (rhoP * cP * cP);
  const f2 = (2 * (rhoP - rho0)) / (2 * rhoP + rho0);
  const contrast = f1 + 1.5 * f2;
  const k = (2 * Math.PI * frequency) / c0;
  const pa = Math.sqrt((4 * rhoP * g * rho0 * c0 * c0) / (k * contrast));
  const lambda = c0 / frequency;
  return {
    f1, f2, contrast, k, nodeSpacing: lambda / 2,
    thresholdPressure: pa,
    thresholdSPL: 20 * Math.log10(pa / 2e-5),
    maxRadius: lambda / 8,
    feasible: contrast > 0 && radius < lambda / 8,
  };
}

/**
 * Optical levitation and trapping.
 *   • radiation pressure on a perfect mirror: F = 2P/c, so lifting a gram
 *     needs 1.5 MW — the headline number for why light does not lift things;
 *   • scattering force on a bead: F = n_m Q P/c with Q ≈ 0.1;
 *   • Rayleigh gradient stiffness at a Gaussian focus of waist w₀:
 *     κ = 8π n_m a³ I₀ (m²−1)/(c w₀²(m²+2)), I₀ = 2P/πw₀².
 * Sources: A. Ashkin, Phys. Rev. Lett. 24 (1970) 156; Y. Harada &
 * T. Asakura, Opt. Commun. 124 (1996) 529.
 */
export function opticalLevitation(particle: EMMaterial, medium: EMMaterial, radius: number, power: number, waist: number, g: number): {
  mirrorPower: number; scatterPower: number; stiffness: number; stiffnessPnPerNm: number;
  trapDepthKT: number; rayleighValid: boolean;
} {
  const mass = particle.density * (4 / 3) * Math.PI * radius ** 3;
  const nm = medium.refractiveIndex ?? 1;
  const np = particle.refractiveIndex ?? 1.5;
  const mr = np / nm;
  const pol = (mr * mr - 1) / (mr * mr + 2);
  const I0 = (2 * power) / (Math.PI * waist * waist);
  const kappa = (8 * Math.PI * nm * radius ** 3 * I0 * pol) / (C_LIGHT * waist * waist);
  const Q = 0.1;
  // depth of the Gaussian well itself, U = (2πn a³ pol/c)·I₀, not the harmonic
  // extrapolation — the harmonic form keeps rising and overstates the depth
  const depth = (2 * Math.PI * nm * radius ** 3 * pol * I0) / C_LIGHT;
  return {
    mirrorPower: (mass * g * C_LIGHT) / 2,
    scatterPower: (mass * g * C_LIGHT) / (nm * Q),
    stiffness: kappa,
    // 1 N/m = 10¹² pN per 10⁹ nm = 10³ pN/nm
    stiffnessPnPerNm: kappa * 1e3,
    trapDepthKT: depth / (1.380649e-23 * 300),
    rayleighValid: radius < 1.064e-6 / (2 * Math.PI),
  };
}

/**
 * Rotor hover power from momentum theory: P = (mg)^{3/2}/√(2ρA), divided by
 * a figure of merit for real rotors. Source: W. Johnson, "Helicopter Theory",
 * §2-1.
 */
export function hoverPower(mass: number, g: number, rho: number, discArea: number, figureOfMerit = 0.7): {
  thrust: number; idealPower: number; power: number; downwash: number; discLoading: number;
} {
  const T = mass * g;
  const ideal = Math.pow(T, 1.5) / Math.sqrt(2 * rho * discArea);
  return {
    thrust: T, idealPower: ideal, power: ideal / figureOfMerit,
    downwash: Math.sqrt(T / (2 * rho * discArea)),
    discLoading: T / discArea,
  };
}

/** Archimedes: the displaced volume needed to float a mass in a fluid. */
export function buoyantVolume(mass: number, fluidDensity: number, gasDensity: number): { volume: number; diameter: number; liftPerM3: number; possible: boolean } {
  const net = fluidDensity - gasDensity;
  const volume = net > 0 ? mass / net : Infinity;
  return {
    volume, diameter: net > 0 ? 2 * Math.cbrt((3 * volume) / (4 * Math.PI)) : Infinity,
    liftPerM3: net, possible: net > 0,
  };
}

/* ------------------------------------------------------------- the verdict */

export type VerdictTier = 'deskToy' | 'workshop' | 'universityLab' | 'nationalFacility' | 'pulsedRecord' | 'beyondTechnology' | 'forbidden';

export const TIER_LABEL: Record<VerdictTier, string> = {
  deskToy: 'Desk toy',
  workshop: 'Home workshop',
  universityLab: 'University laboratory',
  nationalFacility: 'National facility',
  pulsedRecord: 'World-record pulsed magnet',
  beyondTechnology: 'Beyond any current technology',
  forbidden: 'Forbidden by physics',
};

export const TIER_NOTE: Record<VerdictTier, string> = {
  deskToy: 'Achievable with hardware-shop permanent magnets or a small coil.',
  workshop: 'Needs a wound electromagnet or an iron yoke — mains power, no exotic parts.',
  universityLab: 'Needs a superconducting or water-cooled resistive magnet, cryogenics and a few hundred kilowatts.',
  nationalFacility: 'Only a handful of installations in the world can do this (NHMFL, Nijmegen, Dresden, Tohoku).',
  pulsedRecord: 'Only in a millisecond pulse, often destroying the coil.',
  beyondTechnology: 'Above every field or power ever produced — not forbidden by physics, just far out of reach.',
  forbidden: 'No field strength helps: the physics rules it out.',
};

export function fieldTier(B: number): VerdictTier {
  if (!Number.isFinite(B)) return 'beyondTechnology';
  if (B <= FIELD_RECORDS.ndfebSurface) return 'deskToy';
  if (B <= FIELD_RECORDS.ironYoke) return 'workshop';
  if (B <= FIELD_RECORDS.superconducting) return 'universityLab';
  if (B <= FIELD_RECORDS.hybrid) return 'nationalFacility';
  if (B <= FIELD_RECORDS.pulsedDestructive) return 'pulsedRecord';
  return 'beyondTechnology';
}

export function powerTier(watts: number): VerdictTier {
  if (!Number.isFinite(watts)) return 'beyondTechnology';
  if (watts <= 20) return 'deskToy';
  if (watts <= 3000) return 'workshop';
  if (watts <= 1e6) return 'universityLab';
  if (watts <= 3e7) return 'nationalFacility';
  if (watts <= 1e10) return 'beyondTechnology';
  return 'beyondTechnology';
}

/** The harsher of two tiers. */
export function worseTier(a: VerdictTier, b: VerdictTier): VerdictTier {
  const order: VerdictTier[] = ['deskToy', 'workshop', 'universityLab', 'nationalFacility', 'pulsedRecord', 'beyondTechnology', 'forbidden'];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

/** Dual helpers re-exported so the UI can build its own potentials. */
export { add as dualAdd, adds as dualAdds, muls as dualMuls, sq as dualSq };
