/**
 * Magnetic field sources.
 *
 * Every source exposes three consistent evaluations of the same analytic
 * expression:
 *
 *   B(p)      value only                      — fast path, rendering
 *   BJ(p)     value + exact Jacobian ∂Bi/∂xk  — dynamics (force needs ∇B)
 *   Bd(x,y,z) hyper-dual value                — exact ∇ and ∇∇ for stability
 *
 * The tests assert that the three agree, so none can drift from the others.
 *
 * Current loops are integrated along the conductor with the midpoint rule.
 * For a closed analytic loop the integrand is periodic and analytic, so the
 * rule converges geometrically — error ≈ e^{−Nσ} with σ = arccosh of the
 * singularity parameter — and the node count is chosen from the distance to
 * the wire to reach double precision (see `loopNodes`). This is exact to
 * machine precision everywhere except within ~1 % of a conductor radius of
 * the wire itself, and unlike the closed-form elliptic solution it has no
 * 1/ρ singularity on the axis. `src/physics/em/elliptic.ts` provides the
 * independent closed-form solution used to check it.
 */
import { MU0 } from './constants';
import { ellipKE } from './elliptic';
import { add, adds, asinh, atan, D2, div, mul, muls, norm3, sq, sqrt, sub, type D2 as Dual } from './dual';
import type { Vec3 } from '../vec3';

/** row-major 3×3 */
export type Mat3 = number[];

export const M3_I: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function m3apply(R: Mat3, v: Vec3): Vec3 {
  return [
    R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
    R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
    R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
  ];
}
/** Rᵀ·v */
export function m3applyT(R: Mat3, v: Vec3): Vec3 {
  return [
    R[0] * v[0] + R[3] * v[1] + R[6] * v[2],
    R[1] * v[0] + R[4] * v[1] + R[7] * v[2],
    R[2] * v[0] + R[5] * v[1] + R[8] * v[2],
  ];
}
export function m3mul(A: Mat3, B: Mat3): Mat3 {
  const o = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    let s = 0;
    for (let k = 0; k < 3; k++) s += A[i * 3 + k] * B[k * 3 + j];
    o[i * 3 + j] = s;
  }
  return o;
}
export function m3T(A: Mat3): Mat3 {
  return [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
}
/** R · M · Rᵀ — how a Jacobian transforms between frames */
export function m3conj(R: Mat3, M: Mat3): Mat3 {
  return m3mul(m3mul(R, M), m3T(R));
}

/** Rotation taking local +z onto `axis`; the other two axes are arbitrary but orthonormal. */
export function frameFromAxis(axis: Vec3): Mat3 {
  const n = Math.hypot(axis[0], axis[1], axis[2]);
  const z: Vec3 = n > 0 ? [axis[0] / n, axis[1] / n, axis[2] / n] : [0, 0, 1];
  // pick the world axis least aligned with z to start the orthogonalisation
  const a: Vec3 = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let x: Vec3 = [a[1] * z[2] - a[2] * z[1], a[2] * z[0] - a[0] * z[2], a[0] * z[1] - a[1] * z[0]];
  // x = a × z, then renormalise
  const xn = Math.hypot(x[0], x[1], x[2]);
  x = [x[0] / xn, x[1] / xn, x[2] / xn];
  const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  // columns are the local axes in lab coordinates
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

/** Rotation by `angle` about a unit `axis` (Rodrigues). */
export function rotationAxisAngle(axis: Vec3, angle: number): Mat3 {
  const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const [x, y, z] = [axis[0] / n, axis[1] / n, axis[2] / n];
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  return [
    t * x * x + c, t * x * y - s * z, t * x * z + s * y,
    t * x * y + s * z, t * y * y + c, t * y * z - s * x,
    t * x * z - s * y, t * y * z + s * x, t * z * z + c,
  ];
}

export interface FieldValue {
  B: Vec3;
  /** J[i*3+k] = ∂B_i/∂x_k [T/m] */
  J: Mat3;
}

export type SourceKind = 'loop' | 'solenoid' | 'magnet' | 'cylinderMagnet' | 'dipole' | 'wire' | 'uniform' | 'gradient';

export interface FieldSource {
  readonly id: string;
  readonly kind: SourceKind;
  B(p: Vec3): Vec3;
  BJ(p: Vec3): FieldValue;
  Bd(x: Dual, y: Dual, z: Dual): [Dual, Dual, Dual];
  /** is the point inside the source's material? (fields there are not modelled) */
  isInside(p: Vec3): boolean;
  /** rendering hint: bounding radius about `center` */
  readonly center: Vec3;
  readonly extent: number;
}

/* ------------------------------------------------------------------ frames */

abstract class Framed implements FieldSource {
  abstract readonly kind: SourceKind;
  constructor(readonly id: string, readonly center: Vec3, readonly R: Mat3 = M3_I) {}
  abstract get extent(): number;

  protected abstract lB(x: number, y: number, z: number): Vec3;
  protected abstract lBJ(x: number, y: number, z: number): FieldValue;
  protected abstract lBd(x: Dual, y: Dual, z: Dual): [Dual, Dual, Dual];

  protected toLocal(p: Vec3): Vec3 {
    return m3applyT(this.R, [p[0] - this.center[0], p[1] - this.center[1], p[2] - this.center[2]]);
  }
  /** local coordinates of a dual lab point (an affine map, so derivatives carry through) */
  protected toLocalD(x: Dual, y: Dual, z: Dual): [Dual, Dual, Dual] {
    const dx = adds(x, -this.center[0]), dy = adds(y, -this.center[1]), dz = adds(z, -this.center[2]);
    const R = this.R;
    const c = (i: number) => add(add(muls(dx, R[i]), muls(dy, R[3 + i])), muls(dz, R[6 + i]));
    return [c(0), c(1), c(2)];
  }

  B(p: Vec3): Vec3 {
    const q = this.toLocal(p);
    return m3apply(this.R, this.lB(q[0], q[1], q[2]));
  }
  BJ(p: Vec3): FieldValue {
    const q = this.toLocal(p);
    const r = this.lBJ(q[0], q[1], q[2]);
    return { B: m3apply(this.R, r.B), J: m3conj(this.R, r.J) };
  }
  Bd(x: Dual, y: Dual, z: Dual): [Dual, Dual, Dual] {
    const [lx, ly, lz] = this.toLocalD(x, y, z);
    const b = this.lBd(lx, ly, lz);
    const R = this.R;
    const row = (i: number) => add(add(muls(b[0], R[i * 3]), muls(b[1], R[i * 3 + 1])), muls(b[2], R[i * 3 + 2]));
    return [row(0), row(1), row(2)];
  }
  isInside(_p: Vec3): boolean {
    return false;
  }
}

/* ------------------------------------------------------------------- loops */

/**
 * Node count for the midpoint rule on a circular loop. The integrand's
 * nearest complex singularity sits at |Im φ| = arccosh[(ρ²+a²+z²)/(2aρ)], and
 * the rule's error is ≈ e^{−Nσ}; 40/σ therefore buys full double precision.
 */
export function loopNodes(a: number, rho: number, z: number): number {
  if (rho <= 0) return 48;
  const u = (rho * rho + a * a + z * z) / (2 * a * rho);
  const sigma = Math.acosh(Math.max(u, 1 + 1e-16));
  if (!Number.isFinite(sigma) || sigma <= 0) return 4096;
  return Math.min(4096, Math.max(48, Math.ceil(40 / sigma)));
}

/** Sum over loop nodes: value only. `a` radius, `I` total amp-turns. */
function loopB(a: number, I: number, x: number, y: number, z: number, N: number): Vec3 {
  const C = (MU0 * I * a) / (4 * Math.PI) * ((2 * Math.PI) / N);
  let bx = 0, by = 0, bz = 0;
  const dphi = (2 * Math.PI) / N;
  for (let j = 0; j < N; j++) {
    const phi = (j + 0.5) * dphi;
    const cs = Math.cos(phi), sn = Math.sin(phi);
    const rx = x - a * cs, ry = y - a * sn, rz = z;
    const r2 = rx * rx + ry * ry + rz * rz;
    const r3 = r2 * Math.sqrt(r2);
    bx += (cs * rz) / r3;
    by += (sn * rz) / r3;
    bz += (-sn * ry - cs * rx) / r3;
  }
  return [C * bx, C * by, C * bz];
}

/**
 * Value and analytic Jacobian. With T = t̂ × r and r = p − l(φ),
 *   ∂T_i/∂x = (0,0,−cosφ), ∂T_i/∂y = (0,0,−sinφ), ∂T_i/∂z = (cosφ,sinφ,0)
 *   ∂B_i/∂x_k = C Σ [ ∂T_i/∂x_k / r³ − 3 T_i r_k / r⁵ ]
 */
function loopBJ(a: number, I: number, x: number, y: number, z: number, N: number): FieldValue {
  const C = (MU0 * I * a) / (4 * Math.PI) * ((2 * Math.PI) / N);
  const B = [0, 0, 0];
  const J = new Array(9).fill(0);
  const dphi = (2 * Math.PI) / N;
  for (let j = 0; j < N; j++) {
    const phi = (j + 0.5) * dphi;
    const cs = Math.cos(phi), sn = Math.sin(phi);
    const rx = x - a * cs, ry = y - a * sn, rz = z;
    const r2 = rx * rx + ry * ry + rz * rz;
    const r = Math.sqrt(r2);
    const r3 = r2 * r, r5 = r3 * r2;
    const T0 = cs * rz, T1 = sn * rz, T2 = -sn * ry - cs * rx;
    B[0] += T0 / r3;
    B[1] += T1 / r3;
    B[2] += T2 / r3;
    // dT[k][i]
    const dT = [0, 0, -cs, 0, 0, -sn, cs, sn, 0]; // dT[k*3+i]
    const rk = [rx, ry, rz];
    for (let k = 0; k < 3; k++) {
      const f = (-3 * rk[k]) / r5;
      J[0 * 3 + k] += dT[k * 3 + 0] / r3 + T0 * f;
      J[1 * 3 + k] += dT[k * 3 + 1] / r3 + T1 * f;
      J[2 * 3 + k] += dT[k * 3 + 2] / r3 + T2 * f;
    }
  }
  return { B: [C * B[0], C * B[1], C * B[2]], J: J.map((v) => C * v) };
}

/**
 * Hyper-dual loop sum, hand-unrolled.
 *
 * The dual arithmetic is written out in scalars instead of going through the
 * `D2` operators, because the loop runs up to 4096 times per field evaluation
 * and allocating a few thousand objects per node made the solver ten times
 * slower. The algebra is the same chain and product rule the operators
 * implement, and the tests compare this path against the generic one.
 *
 * The incoming x, y, z are the independent variables of a lab point mapped
 * through an affine frame change, so their second derivatives vanish — that
 * is what lets the products collapse to the short forms below.
 */
function loopBd(a: number, I: number, x: Dual, y: Dual, z: Dual, N: number): [Dual, Dual, Dual] {
  const C = ((MU0 * I * a) / (4 * Math.PI)) * ((2 * Math.PI) / N);
  const dphi = (2 * Math.PI) / N;
  const linear = x.hxx === 0 && x.hxy === 0 && x.hxz === 0 && x.hyy === 0 && x.hyz === 0 && x.hzz === 0
    && y.hxx === 0 && y.hxy === 0 && y.hxz === 0 && y.hyy === 0 && y.hyz === 0 && y.hzz === 0
    && z.hxx === 0 && z.hxy === 0 && z.hxz === 0 && z.hyy === 0 && z.hyz === 0 && z.hzz === 0;
  if (!linear) {
    // generic (slow) path, kept for completeness
    let bx = D2.c(0), by = D2.c(0), bz = D2.c(0);
    for (let j = 0; j < N; j++) {
      const phi = (j + 0.5) * dphi;
      const cs = Math.cos(phi), sn = Math.sin(phi);
      const rx = adds(x, -a * cs), ry = adds(y, -a * sn), rz = z;
      const r2 = add(add(sq(rx), sq(ry)), sq(rz));
      const invr3 = powm32(r2);
      bx = add(bx, mul(muls(rz, cs), invr3));
      by = add(by, mul(muls(rz, sn), invr3));
      bz = add(bz, mul(sub(muls(ry, -sn), muls(rx, cs)), invr3));
    }
    return [muls(bx, C), muls(by, C), muls(bz, C)];
  }
  // gradients of the (affine) local coordinates
  const xg = [x.gx, x.gy, x.gz], yg = [y.gx, y.gy, y.gz], zg = [z.gx, z.gy, z.gz];
  // accumulators: value, 3 gradients, 6 Hessian entries, per component
  const acc = [new Float64Array(10), new Float64Array(10), new Float64Array(10)];
  const ug = [0, 0, 0];
  const H = [[0, 1, 2], [1, 3, 4], [2, 4, 5]]; // (i,j) → packed Hessian slot
  for (let j = 0; j < N; j++) {
    const phi = (j + 0.5) * dphi;
    const cs = Math.cos(phi), sn = Math.sin(phi);
    const rx = x.v - a * cs, ry = y.v - a * sn, rz = z.v;
    // r² and its derivatives, through the affine map
    const r2 = rx * rx + ry * ry + rz * rz;
    const r2g = [
      2 * (rx * xg[0] + ry * yg[0] + rz * zg[0]),
      2 * (rx * xg[1] + ry * yg[1] + rz * zg[1]),
      2 * (rx * xg[2] + ry * yg[2] + rz * zg[2]),
    ];
    const r2h = [
      2 * (xg[0] * xg[0] + yg[0] * yg[0] + zg[0] * zg[0]),
      2 * (xg[0] * xg[1] + yg[0] * yg[1] + zg[0] * zg[1]),
      2 * (xg[0] * xg[2] + yg[0] * yg[2] + zg[0] * zg[2]),
      2 * (xg[1] * xg[1] + yg[1] * yg[1] + zg[1] * zg[1]),
      2 * (xg[1] * xg[2] + yg[1] * yg[2] + zg[1] * zg[2]),
      2 * (xg[2] * xg[2] + yg[2] * yg[2] + zg[2] * zg[2]),
    ];
    const f = 1 / (r2 * Math.sqrt(r2));
    const f1 = (-1.5 * f) / r2;
    const f2 = (3.75 * f) / (r2 * r2);
    const fg = [f1 * r2g[0], f1 * r2g[1], f1 * r2g[2]];
    const fh = [
      f1 * r2h[0] + f2 * r2g[0] * r2g[0],
      f1 * r2h[1] + f2 * r2g[0] * r2g[1],
      f1 * r2h[2] + f2 * r2g[0] * r2g[2],
      f1 * r2h[3] + f2 * r2g[1] * r2g[1],
      f1 * r2h[4] + f2 * r2g[1] * r2g[2],
      f1 * r2h[5] + f2 * r2g[2] * r2g[2],
    ];
    for (let c = 0; c < 3; c++) {
      let uv: number;
      if (c === 0) {
        uv = cs * rz;
        ug[0] = cs * zg[0]; ug[1] = cs * zg[1]; ug[2] = cs * zg[2];
      } else if (c === 1) {
        uv = sn * rz;
        ug[0] = sn * zg[0]; ug[1] = sn * zg[1]; ug[2] = sn * zg[2];
      } else {
        uv = -sn * ry - cs * rx;
        ug[0] = -sn * yg[0] - cs * xg[0];
        ug[1] = -sn * yg[1] - cs * xg[1];
        ug[2] = -sn * yg[2] - cs * xg[2];
      }
      const A = acc[c];
      A[0] += uv * f;
      A[1] += ug[0] * f + uv * fg[0];
      A[2] += ug[1] * f + uv * fg[1];
      A[3] += ug[2] * f + uv * fg[2];
      for (let p = 0; p < 3; p++) {
        for (let q = p; q < 3; q++) {
          A[4 + H[p][q]] += ug[p] * fg[q] + ug[q] * fg[p] + uv * fh[H[p][q]];
        }
      }
    }
  }
  const mk = (A: Float64Array) =>
    new D2(C * A[0], C * A[1], C * A[2], C * A[3], C * A[4], C * A[5], C * A[6], C * A[7], C * A[8], C * A[9]);
  return [mk(acc[0]), mk(acc[1]), mk(acc[2])];
}

/** (r²)^(−3/2) as a dual */
function powm32(r2: Dual): Dual {
  const s = Math.sqrt(r2.v);
  const f = 1 / (s * r2.v); // r^-3
  const f1 = -1.5 * f / r2.v;
  const f2 = 3.75 * f / (r2.v * r2.v);
  return new D2(f,
    f1 * r2.gx, f1 * r2.gy, f1 * r2.gz,
    f1 * r2.hxx + f2 * r2.gx * r2.gx,
    f1 * r2.hxy + f2 * r2.gx * r2.gy,
    f1 * r2.hxz + f2 * r2.gx * r2.gz,
    f1 * r2.hyy + f2 * r2.gy * r2.gy,
    f1 * r2.hyz + f2 * r2.gy * r2.gz,
    f1 * r2.hzz + f2 * r2.gz * r2.gz);
}

/** A single circular current loop (or a tight pancake of `turns` turns). */
export class LoopSource extends Framed {
  readonly kind = 'loop' as const;
  /** total amp-turns */
  readonly ampTurns: number;
  constructor(id: string, center: Vec3, axis: Vec3, readonly radius: number, current: number, turns = 1) {
    super(id, center, frameFromAxis(axis));
    this.ampTurns = current * turns;
  }
  get extent() {
    return this.radius;
  }
  private nodes(x: number, y: number, z: number) {
    return loopNodes(this.radius, Math.hypot(x, y), z);
  }
  protected lB(x: number, y: number, z: number): Vec3 {
    return loopB(this.radius, this.ampTurns, x, y, z, this.nodes(x, y, z));
  }
  protected lBJ(x: number, y: number, z: number): FieldValue {
    return loopBJ(this.radius, this.ampTurns, x, y, z, this.nodes(x, y, z));
  }
  protected lBd(x: Dual, y: Dual, z: Dual): [Dual, Dual, Dual] {
    return loopBd(this.radius, this.ampTurns, x, y, z, this.nodes(x.v, y.v, z.v));
  }
}

/* --------------------------------------------------------------- solenoids */

/**
 * Gauss–Legendre nodes and weights on [-1, 1], computed once by Newton
 * iteration on the Legendre polynomial (standard; exact to machine
 * precision). GL quadrature of a smooth axial current distribution converges
 * geometrically, so a modest node count reproduces a continuous winding.
 */
const glCache = new Map<number, { x: number[]; w: number[] }>();
export function gaussLegendre(n: number): { x: number[]; w: number[] } {
  const hit = glCache.get(n);
  if (hit) return hit;
  const x: number[] = new Array(n), w: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let z = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let pp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = 0;
      for (let j = 0; j < n; j++) {
        const p2 = p1;
        p1 = p0;
        p0 = ((2 * j + 1) * z * p1 - j * p2) / (j + 1);
      }
      pp = (n * (z * p0 - p1)) / (z * z - 1);
      const dz = p0 / pp;
      z -= dz;
      if (Math.abs(dz) < 1e-16) break;
    }
    x[i] = z;
    w[i] = 2 / ((1 - z * z) * pp * pp);
  }
  const r = { x, w };
  glCache.set(n, r);
  return r;
}

/**
 * A finite solenoid: `turns` turns of radius `radius` spread over `length`,
 * carrying `current`. Modelled as the equivalent axial current sheet and
 * integrated with a graded composite Gauss–Legendre quadrature, refined
 * near the winding so the result stays at double precision.
 */
export class SolenoidSource extends Framed {
  readonly kind = 'solenoid' as const;
  /** amp-turns per metre of length */
  readonly sheetCurrent: number;
  constructor(
    id: string, center: Vec3, axis: Vec3,
    readonly radius: number, readonly length: number, readonly turns: number, readonly current: number,
  ) {
    super(id, center, frameFromAxis(axis));
    this.sheetCurrent = (turns * current) / length;
  }
  get extent() {
    return Math.max(this.radius, this.length / 2);
  }
  /**
   * Graded quadrature mesh.
   *
   * The integrand along the winding is sharply peaked at the axial position
   * nearest the field point, with a width set by the distance d to the
   * conductor. A uniform mesh would need L/d intervals; instead the
   * boundaries step outwards as d, 2d, 4d, … from that point, so every
   * sub-interval is about as long as its own distance from the peak. The
   * 12-point Gauss–Legendre rule is then inside its geometric-convergence
   * regime on all of them, and the count grows only as log(L/d).
   */
  private segments(x: number, y: number, z: number): number[] {
    const L2 = this.length / 2;
    const rho = Math.hypot(x, y);
    const dz = Math.abs(z) > L2 ? Math.abs(z) - L2 : 0;
    const d = Math.max(Math.hypot(rho - this.radius, dz), this.length * 1e-7);
    const zc = Math.min(L2, Math.max(-L2, z));
    const up: number[] = [];
    let step = d, p = zc;
    while (p < L2 - 1e-15 * this.length && up.length < 48) {
      p = Math.min(L2, p + step);
      up.push(p);
      step *= 2;
    }
    const down: number[] = [];
    step = d;
    p = zc;
    while (p > -L2 + 1e-15 * this.length && down.length < 48) {
      p = Math.max(-L2, p - step);
      down.push(p);
      step *= 2;
    }
    return [...down.reverse(), zc, ...up];
  }
  private each(x: number, y: number, z: number, fn: (zc: number, amps: number) => void) {
    const bounds = this.segments(x, y, z);
    const gl = gaussLegendre(12);
    for (let s = 0; s + 1 < bounds.length; s++) {
      const a = bounds[s], b = bounds[s + 1];
      const h = b - a;
      if (h <= 0) continue;
      for (let q = 0; q < 12; q++) {
        const zc = a + (h / 2) * (1 + gl.x[q]);
        fn(zc, this.sheetCurrent * (h / 2) * gl.w[q]);
      }
    }
  }
  protected lB(x: number, y: number, z: number): Vec3 {
    const out: Vec3 = [0, 0, 0];
    this.each(x, y, z, (zc, amps) => {
      const zz = z - zc;
      const b = loopB(this.radius, amps, x, y, zz, loopNodes(this.radius, Math.hypot(x, y), zz));
      out[0] += b[0]; out[1] += b[1]; out[2] += b[2];
    });
    return out;
  }
  protected lBJ(x: number, y: number, z: number): FieldValue {
    const B: Vec3 = [0, 0, 0];
    const J = new Array(9).fill(0);
    this.each(x, y, z, (zc, amps) => {
      const zz = z - zc;
      const r = loopBJ(this.radius, amps, x, y, zz, loopNodes(this.radius, Math.hypot(x, y), zz));
      for (let i = 0; i < 3; i++) B[i] += r.B[i];
      for (let i = 0; i < 9; i++) J[i] += r.J[i];
    });
    return { B, J };
  }
  protected lBd(x: Dual, y: Dual, z: Dual): [Dual, Dual, Dual] {
    let bx = D2.c(0), by = D2.c(0), bz = D2.c(0);
    this.each(x.v, y.v, z.v, (zc, amps) => {
      const zz = adds(z, -zc);
      const b = loopBd(this.radius, amps, x, y, zz, loopNodes(this.radius, Math.hypot(x.v, y.v), zz.v));
      bx = add(bx, b[0]); by = add(by, b[1]); bz = add(bz, b[2]);
    });
    return [bx, by, bz];
  }
  isInside(p: Vec3): boolean {
    const q = this.toLocal(p);
    return Math.abs(q[2]) < this.length / 2 && Math.hypot(q[0], q[1]) < this.radius;
  }
  /** exact on-axis field, for validation [T] */
  axialExact(z: number): number {
    const L = this.length / 2, a = this.radius;
    const f = (u: number) => u / Math.sqrt(u * u + a * a);
    return (MU0 * this.sheetCurrent * (f(z + L) - f(z - L))) / 2;
  }
}

/* ----------------------------------------------------------------- magnets */

/**
 * Uniformly magnetised rectangular block, magnetisation M = Br/μ₀ along its
 * local +z. Exact closed form from the equivalent magnetic surface charge
 * σ = M·n̂ on the two pole faces:
 *
 *   Bx = −(Br/4π) Σ (−1)^{i+j+k} asinh[ v_j / √(u_i² + w_k²) ]
 *   By = −(Br/4π) Σ (−1)^{i+j+k} asinh[ u_i / √(v_j² + w_k²) ]
 *   Bz = +(Br/4π) Σ (−1)^{i+j+k} atan [ u_i v_j / (w_k R_{ijk}) ]
 *
 * with u_i = x ∓ a, v_j = y ∓ b, w_k = z ∓ c and R = √(u²+v²+w²).
 * Derivation: Furlani, "Permanent Magnet and Electromechanical Devices"
 * §3.3; equivalent to Camacho & Sosa, Rev. Mex. Fis. 59 (2013) 8.
 * Outside the block this is B; inside it returns μ₀H (the demagnetising
 * field) with μ₀M added back, giving the exact −Br/3 at the centre of a cube.
 */
export class MagnetSource extends Framed {
  readonly kind = 'magnet' as const;
  /** half-sizes along the local axes [m] */
  readonly half: Vec3;
  constructor(id: string, center: Vec3, size: Vec3, readonly remanence: number, R: Mat3 = M3_I) {
    super(id, center, R);
    this.half = [size[0] / 2, size[1] / 2, size[2] / 2];
  }
  get extent() {
    return Math.hypot(this.half[0], this.half[1], this.half[2]);
  }
  get volume() {
    return 8 * this.half[0] * this.half[1] * this.half[2];
  }
  /** magnetic moment magnitude [A·m²] */
  get moment() {
    return (this.remanence / MU0) * this.volume;
  }
  private signs(x: number, y: number, z: number) {
    const [a, b, c] = this.half;
    const eps = 1e-12 * Math.max(a, b, c);
    const wz = (w: number) => (Math.abs(w) < eps ? (w >= 0 ? eps : -eps) : w);
    return {
      u: [x + a, x - a],
      v: [y + b, y - b],
      w: [wz(z + c), wz(z - c)],
    };
  }
  protected lB(x: number, y: number, z: number): Vec3 {
    const { u, v, w } = this.signs(x, y, z);
    const K = this.remanence / (4 * Math.PI);
    let bx = 0, by = 0, bz = 0;
    // zero-based indices run (−a, +a), so (−1)^(i+j+k) of the 1-based form
    // is the negative of the parity computed here — hence the signs below.
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
      const s = (i + j + k) % 2 === 0 ? 1 : -1;
      const ui = u[i], vj = v[j], wk = w[k];
      const R = Math.sqrt(ui * ui + vj * vj + wk * wk);
      bx += s * Math.asinh(vj / Math.sqrt(ui * ui + wk * wk));
      by += s * Math.asinh(ui / Math.sqrt(vj * vj + wk * wk));
      bz += s * Math.atan((ui * vj) / (wk * R));
    }
    const out: Vec3 = [K * bx, K * by, -K * bz];
    if (Math.abs(x) < this.half[0] && Math.abs(y) < this.half[1] && Math.abs(z) < this.half[2]) out[2] += this.remanence;
    return out;
  }
  protected lBJ(x: number, y: number, z: number): FieldValue {
    // the closed form is cheap, so the Jacobian comes from the dual path
    const [bx, by, bz] = this.lBd(D2.x(x), D2.y(y), D2.z(z));
    return {
      B: [bx.v, by.v, bz.v],
      J: [bx.gx, bx.gy, bx.gz, by.gx, by.gy, by.gz, bz.gx, bz.gy, bz.gz],
    };
  }
  protected lBd(x: Dual, y: Dual, z: Dual): [Dual, Dual, Dual] {
    const [a, b, c] = this.half;
    const eps = 1e-12 * Math.max(a, b, c);
    const K = this.remanence / (4 * Math.PI);
    const u = [adds(x, a), adds(x, -a)];
    const v = [adds(y, b), adds(y, -b)];
    // nudge the value off the pole-face planes, where μ₀H_z is discontinuous
    const w = [adds(z, c), adds(z, -c)];
    for (const k of [0, 1]) if (Math.abs(w[k].v) < eps) w[k] = adds(w[k], w[k].v >= 0 ? eps : -eps);
    let bx = D2.c(0), by = D2.c(0), bz = D2.c(0);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) {
      const s = (i + j + k) % 2 === 0 ? 1 : -1;
      const ui = u[i], vj = v[j], wk = w[k];
      const R = norm3(ui, vj, wk);
      bx = add(bx, muls(asinh(div(vj, sqrt(add(sq(ui), sq(wk))))), s));
      by = add(by, muls(asinh(div(ui, sqrt(add(sq(vj), sq(wk))))), s));
      bz = add(bz, muls(atan(div(mul(ui, vj), mul(wk, R))), s));
    }
    const outz = muls(bz, -K);
    return [muls(bx, K), muls(by, K), Math.abs(x.v) < a && Math.abs(y.v) < b && Math.abs(z.v) < c ? adds(outz, this.remanence) : outz];
  }
  isInside(p: Vec3): boolean {
    const q = this.toLocal(p);
    return Math.abs(q[0]) < this.half[0] && Math.abs(q[1]) < this.half[1] && Math.abs(q[2]) < this.half[2];
  }
}

/**
 * Axially magnetised cylinder (disc magnet), modelled as its exact equivalent
 * surface current sheet K = M on the lateral face — i.e. a solenoid with
 * amp-turns per metre equal to Br/μ₀.
 */
export class CylinderMagnetSource extends Framed {
  readonly kind = 'cylinderMagnet' as const;
  private sol: SolenoidSource;
  constructor(id: string, center: Vec3, axis: Vec3, readonly radius: number, readonly length: number, readonly remanence: number) {
    super(id, center, frameFromAxis(axis));
    // equivalent solenoid in the same frame, expressed in local coordinates
    this.sol = new SolenoidSource(id + ':eq', [0, 0, 0], [0, 0, 1], radius, length, 1, (remanence / MU0) * length);
  }
  get extent() {
    return Math.max(this.radius, this.length / 2);
  }
  get volume() {
    return Math.PI * this.radius * this.radius * this.length;
  }
  get moment() {
    return (this.remanence / MU0) * this.volume;
  }
  // The equivalent-surface-current model gives B directly, inside and out,
  // so no demagnetising correction is needed (unlike the magnetic-charge
  // model used for rectangular blocks).
  protected lB(x: number, y: number, z: number): Vec3 {
    return this.sol.B([x, y, z]);
  }
  protected lBJ(x: number, y: number, z: number): FieldValue {
    return this.sol.BJ([x, y, z]);
  }
  protected lBd(x: Dual, y: Dual, z: Dual): [Dual, Dual, Dual] {
    return this.sol.Bd(x, y, z);
  }
  private insideLocal(x: number, y: number, z: number) {
    return Math.hypot(x, y) < this.radius && Math.abs(z) < this.length / 2;
  }
  isInside(p: Vec3): boolean {
    const q = this.toLocal(p);
    return this.insideLocal(q[0], q[1], q[2]);
  }
  /** exact on-axis field [T] */
  axialExact(z: number): number {
    const L = this.length / 2, a = this.radius;
    const f = (u: number) => u / Math.sqrt(u * u + a * a);
    return (this.remanence * (f(z + L) - f(z - L))) / 2;
  }
}

/* ---------------------------------------------------------------- dipole */

/** Point magnetic dipole, B = μ₀/4π [3(m·r̂)r̂ − m]/r³. */
export class DipoleSource extends Framed {
  readonly kind = 'dipole' as const;
  constructor(id: string, center: Vec3, readonly m: Vec3) {
    super(id, center, M3_I);
  }
  get extent() {
    return 0;
  }
  get moment() {
    return Math.hypot(this.m[0], this.m[1], this.m[2]);
  }
  protected lB(x: number, y: number, z: number): Vec3 {
    const r2 = x * x + y * y + z * z;
    const r = Math.sqrt(r2);
    const k = MU0 / (4 * Math.PI);
    const mr = this.m[0] * x + this.m[1] * y + this.m[2] * z;
    const c = (3 * mr) / (r2 * r2 * r);
    const d = 1 / (r2 * r);
    return [k * (c * x - d * this.m[0]), k * (c * y - d * this.m[1]), k * (c * z - d * this.m[2])];
  }
  protected lBJ(x: number, y: number, z: number): FieldValue {
    const [bx, by, bz] = this.lBd(D2.x(x), D2.y(y), D2.z(z));
    return { B: [bx.v, by.v, bz.v], J: [bx.gx, bx.gy, bx.gz, by.gx, by.gy, by.gz, bz.gx, bz.gy, bz.gz] };
  }
  protected lBd(x: Dual, y: Dual, z: Dual): [Dual, Dual, Dual] {
    const k = MU0 / (4 * Math.PI);
    const r2 = add(add(sq(x), sq(y)), sq(z));
    const invr3 = powm32(r2);
    const invr5 = mul(invr3, inv2(r2));
    const mr = add(add(muls(x, this.m[0]), muls(y, this.m[1])), muls(z, this.m[2]));
    const c = muls(mul(mr, invr5), 3);
    const cmp = (i: number, xi: Dual) => muls(sub(mul(c, xi), muls(invr3, this.m[i])), k);
    return [cmp(0, x), cmp(1, y), cmp(2, z)];
  }
}

/** 1/u as a dual (small helper to avoid importing div for scalars) */
function inv2(u: Dual): Dual {
  const r = 1 / u.v;
  return new D2(r,
    -r * r * u.gx, -r * r * u.gy, -r * r * u.gz,
    -r * r * u.hxx + 2 * r * r * r * u.gx * u.gx,
    -r * r * u.hxy + 2 * r * r * r * u.gx * u.gy,
    -r * r * u.hxz + 2 * r * r * r * u.gx * u.gz,
    -r * r * u.hyy + 2 * r * r * r * u.gy * u.gy,
    -r * r * u.hyz + 2 * r * r * r * u.gy * u.gz,
    -r * r * u.hzz + 2 * r * r * r * u.gz * u.gz);
}

/* ------------------------------------------------------- idealised fields */

/** Uniform field (an infinite Helmholtz pair, idealised). */
export class UniformFieldSource implements FieldSource {
  readonly kind = 'uniform' as const;
  readonly center: Vec3 = [0, 0, 0];
  readonly extent = 0;
  constructor(readonly id: string, readonly B0: Vec3) {}
  B(): Vec3 {
    return [...this.B0] as Vec3;
  }
  BJ(): FieldValue {
    return { B: [...this.B0] as Vec3, J: new Array(9).fill(0) };
  }
  Bd(): [Dual, Dual, Dual] {
    return [D2.c(this.B0[0]), D2.c(this.B0[1]), D2.c(this.B0[2])];
  }
  isInside() {
    return false;
  }
}

/**
 * Idealised axial gradient field B = (−Gx/2, −Gy/2, B₀ + Gz).
 * This is the simplest field that is both divergence-free and curl-free with
 * a constant axial gradient, so it is the honest idealisation of "a field with
 * gradient G" — a bare (0,0,B₀+Gz) would violate ∇·B = 0.
 */
export class AxialGradientSource implements FieldSource {
  readonly kind = 'gradient' as const;
  readonly center: Vec3 = [0, 0, 0];
  readonly extent = 0;
  constructor(readonly id: string, readonly B0: number, readonly G: number, readonly z0 = 0) {}
  B(p: Vec3): Vec3 {
    return [(-this.G * p[0]) / 2, (-this.G * p[1]) / 2, this.B0 + this.G * (p[2] - this.z0)];
  }
  BJ(p: Vec3): FieldValue {
    return { B: this.B(p), J: [-this.G / 2, 0, 0, 0, -this.G / 2, 0, 0, 0, this.G] };
  }
  Bd(x: Dual, y: Dual, z: Dual): [Dual, Dual, Dual] {
    return [muls(x, -this.G / 2), muls(y, -this.G / 2), adds(muls(z, this.G), this.B0 - this.G * this.z0)];
  }
  isInside() {
    return false;
  }
}

/** Infinitely long straight wire along `axis` through `center`. */
export class WireSource extends Framed {
  readonly kind = 'wire' as const;
  constructor(id: string, center: Vec3, axis: Vec3, readonly current: number) {
    super(id, center, frameFromAxis(axis));
  }
  get extent() {
    return 0;
  }
  protected lB(x: number, y: number, _z: number): Vec3 {
    const k = (MU0 * this.current) / (2 * Math.PI);
    const r2 = x * x + y * y;
    return [(-k * y) / r2, (k * x) / r2, 0];
  }
  protected lBJ(x: number, y: number, z: number): FieldValue {
    const [bx, by, bz] = this.lBd(D2.x(x), D2.y(y), D2.z(z));
    return { B: [bx.v, by.v, bz.v], J: [bx.gx, bx.gy, bx.gz, by.gx, by.gy, by.gz, bz.gx, bz.gy, bz.gz] };
  }
  protected lBd(x: Dual, y: Dual, _z: Dual): [Dual, Dual, Dual] {
    const k = (MU0 * this.current) / (2 * Math.PI);
    const r2 = add(sq(x), sq(y));
    const ir2 = inv2(r2);
    return [muls(mul(y, ir2), -k), muls(mul(x, ir2), k), D2.c(0)];
  }
}

/* --------------------------------------------------------------- composite */

/** The superposition of any number of sources. This is what the solver uses. */
export class FieldAssembly {
  constructor(public sources: FieldSource[] = []) {}

  add(s: FieldSource): this {
    this.sources.push(s);
    return this;
  }

  B(p: Vec3): Vec3 {
    const o: Vec3 = [0, 0, 0];
    for (const s of this.sources) {
      const b = s.B(p);
      o[0] += b[0]; o[1] += b[1]; o[2] += b[2];
    }
    return o;
  }
  magnitude(p: Vec3): number {
    const b = this.B(p);
    return Math.hypot(b[0], b[1], b[2]);
  }
  BJ(p: Vec3): FieldValue {
    const B: Vec3 = [0, 0, 0];
    const J = new Array(9).fill(0);
    for (const s of this.sources) {
      const r = s.BJ(p);
      for (let i = 0; i < 3; i++) B[i] += r.B[i];
      for (let i = 0; i < 9; i++) J[i] += r.J[i];
    }
    return { B, J };
  }
  Bd(x: Dual, y: Dual, z: Dual): [Dual, Dual, Dual] {
    let bx = D2.c(0), by = D2.c(0), bz = D2.c(0);
    for (const s of this.sources) {
      const b = s.Bd(x, y, z);
      bx = add(bx, b[0]); by = add(by, b[1]); bz = add(bz, b[2]);
    }
    return [bx, by, bz];
  }
  /** B² with exact gradient and Hessian — the quantity diamagnetic levitation lives on */
  B2d(p: Vec3): Dual {
    const [x, y, z] = D2.point(p[0], p[1], p[2]);
    const [bx, by, bz] = this.Bd(x, y, z);
    return add(add(sq(bx), sq(by)), sq(bz));
  }
  /** ∇(B²) [T²/m] */
  gradB2(p: Vec3): Vec3 {
    const g = this.B2d(p);
    return [g.gx, g.gy, g.gz];
  }
  /** |B·∂B/∂z| expressed as the product that sets diamagnetic lift [T²/m] */
  bGradB(p: Vec3): number {
    return this.gradB2(p)[2] / 2;
  }
  isInsideAny(p: Vec3): boolean {
    return this.sources.some((s) => s.isInside(p));
  }
}

/* ------------------------------------------- independent closed-form check */

/**
 * Closed-form field of a circular loop in terms of complete elliptic
 * integrals (Simpson, Lane, Immer & Youngquist, NASA/TM-2001-210956):
 *
 *   B_ρ = (C z)/(2 α² β ρ) [ (a² + r²) E(k) − α² K(k) ]
 *   B_z = (C)  /(2 α² β)   [ (a² − r²) E(k) + α² K(k) ]
 *   α² = a² + r² − 2aρ,  β² = a² + r² + 2aρ,  k² = 1 − α²/β²,  C = μ₀I/π
 *
 * Used only by the test suite: it is an algorithm with nothing in common
 * with the quadrature path, and it is singular on the axis (0/0 in B_ρ),
 * which is exactly why the quadrature is the shipped implementation.
 */
export function loopBElliptic(a: number, I: number, rho: number, z: number): { brho: number; bz: number } {
  const r2 = rho * rho + z * z;
  const alpha2 = a * a + r2 - 2 * a * rho;
  const beta2 = a * a + r2 + 2 * a * rho;
  const beta = Math.sqrt(beta2);
  const k = Math.sqrt(Math.max(1 - alpha2 / beta2, 0));
  const C = (MU0 * I) / Math.PI;
  const [K, E] = ellipKE(k);
  const brho = rho === 0 ? 0 : (C * z * ((a * a + r2) * E - alpha2 * K)) / (2 * alpha2 * beta * rho);
  const bz = (C * ((a * a - r2) * E + alpha2 * K)) / (2 * alpha2 * beta);
  return { brho, bz };
}

/** exposed for the test suite's independent cross-checks */
export { loopB as rawLoopB, loopBJ as rawLoopBJ, loopBd as rawLoopBd };
