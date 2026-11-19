/**
 * Hyper-dual numbers over three independent variables (x, y, z).
 *
 * A value carries its own exact first and second partial derivatives, so a
 * field written once as an analytic expression yields its gradient and
 * Hessian to machine precision — no finite differencing, no step-size
 * compromise. This is what makes the stability analysis (eigenvalues of the
 * Hessian of the potential energy) exact rather than approximate.
 *
 * Truncated Taylor arithmetic: each operation applies the chain rule to the
 * value, the 3 first derivatives and the 6 independent second derivatives.
 * See J. A. Fike & J. J. Alonso, AIAA 2011-886, "The Development of
 * Hyper-Dual Numbers for Exact Second-Derivative Calculations".
 */

export class D2 {
  constructor(
    public v = 0,
    public gx = 0, public gy = 0, public gz = 0,
    public hxx = 0, public hxy = 0, public hxz = 0,
    public hyy = 0, public hyz = 0, public hzz = 0,
  ) {}

  static c(v: number): D2 {
    return new D2(v);
  }
  /** independent variable x */
  static x(v: number): D2 {
    return new D2(v, 1, 0, 0);
  }
  static y(v: number): D2 {
    return new D2(v, 0, 1, 0);
  }
  static z(v: number): D2 {
    return new D2(v, 0, 0, 1);
  }
  /** the three coordinates of a point as independent variables */
  static point(x: number, y: number, z: number): [D2, D2, D2] {
    return [D2.x(x), D2.y(y), D2.z(z)];
  }

  get grad(): [number, number, number] {
    return [this.gx, this.gy, this.gz];
  }
  /** symmetric 3×3 Hessian, row-major */
  get hess(): number[] {
    return [this.hxx, this.hxy, this.hxz, this.hxy, this.hyy, this.hyz, this.hxz, this.hyz, this.hzz];
  }
  /** Laplacian — zero for a harmonic function, a useful exactness check */
  get laplacian(): number {
    return this.hxx + this.hyy + this.hzz;
  }
}

export const dc = (v: number) => new D2(v);

export function add(a: D2, b: D2): D2 {
  return new D2(a.v + b.v, a.gx + b.gx, a.gy + b.gy, a.gz + b.gz,
    a.hxx + b.hxx, a.hxy + b.hxy, a.hxz + b.hxz, a.hyy + b.hyy, a.hyz + b.hyz, a.hzz + b.hzz);
}
export function sub(a: D2, b: D2): D2 {
  return new D2(a.v - b.v, a.gx - b.gx, a.gy - b.gy, a.gz - b.gz,
    a.hxx - b.hxx, a.hxy - b.hxy, a.hxz - b.hxz, a.hyy - b.hyy, a.hyz - b.hyz, a.hzz - b.hzz);
}
export function neg(a: D2): D2 {
  return new D2(-a.v, -a.gx, -a.gy, -a.gz, -a.hxx, -a.hxy, -a.hxz, -a.hyy, -a.hyz, -a.hzz);
}
/** multiply by a plain number */
export function muls(a: D2, s: number): D2 {
  return new D2(a.v * s, a.gx * s, a.gy * s, a.gz * s,
    a.hxx * s, a.hxy * s, a.hxz * s, a.hyy * s, a.hyz * s, a.hzz * s);
}
/** add a plain number */
export function adds(a: D2, s: number): D2 {
  return new D2(a.v + s, a.gx, a.gy, a.gz, a.hxx, a.hxy, a.hxz, a.hyy, a.hyz, a.hzz);
}

export function mul(a: D2, b: D2): D2 {
  const v = a.v * b.v;
  const gx = a.gx * b.v + a.v * b.gx;
  const gy = a.gy * b.v + a.v * b.gy;
  const gz = a.gz * b.v + a.v * b.gz;
  return new D2(v, gx, gy, gz,
    a.hxx * b.v + 2 * a.gx * b.gx + a.v * b.hxx,
    a.hxy * b.v + a.gx * b.gy + a.gy * b.gx + a.v * b.hxy,
    a.hxz * b.v + a.gx * b.gz + a.gz * b.gx + a.v * b.hxz,
    a.hyy * b.v + 2 * a.gy * b.gy + a.v * b.hyy,
    a.hyz * b.v + a.gy * b.gz + a.gz * b.gy + a.v * b.hyz,
    a.hzz * b.v + 2 * a.gz * b.gz + a.v * b.hzz);
}

/**
 * Generic unary chain rule: given f, f' and f'' at a.v.
 *   v  = f(u)
 *   gi = f'·u_i
 *   hij = f'·u_ij + f''·u_i·u_j
 */
export function chain(a: D2, f: number, f1: number, f2: number): D2 {
  return new D2(f,
    f1 * a.gx, f1 * a.gy, f1 * a.gz,
    f1 * a.hxx + f2 * a.gx * a.gx,
    f1 * a.hxy + f2 * a.gx * a.gy,
    f1 * a.hxz + f2 * a.gx * a.gz,
    f1 * a.hyy + f2 * a.gy * a.gy,
    f1 * a.hyz + f2 * a.gy * a.gz,
    f1 * a.hzz + f2 * a.gz * a.gz);
}

export function inv(a: D2): D2 {
  const r = 1 / a.v;
  return chain(a, r, -r * r, 2 * r * r * r);
}
export function div(a: D2, b: D2): D2 {
  return mul(a, inv(b));
}
export function sqrt(a: D2): D2 {
  const s = Math.sqrt(a.v);
  return chain(a, s, 0.5 / s, -0.25 / (s * a.v));
}
export function log(a: D2): D2 {
  return chain(a, Math.log(a.v), 1 / a.v, -1 / (a.v * a.v));
}
export function exp(a: D2): D2 {
  const e = Math.exp(a.v);
  return chain(a, e, e, e);
}
/** a^p for a plain exponent p */
export function powp(a: D2, p: number): D2 {
  const f = Math.pow(a.v, p);
  return chain(a, f, (p * f) / a.v, (p * (p - 1) * f) / (a.v * a.v));
}
export function sq(a: D2): D2 {
  return mul(a, a);
}
export function asinh(a: D2): D2 {
  const u = a.v;
  const r = Math.sqrt(1 + u * u);
  return chain(a, Math.asinh(u), 1 / r, -u / (r * r * r));
}
export function atan(a: D2): D2 {
  const u = a.v;
  const d = 1 + u * u;
  return chain(a, Math.atan(u), 1 / d, (-2 * u) / (d * d));
}
export function sin(a: D2): D2 {
  return chain(a, Math.sin(a.v), Math.cos(a.v), -Math.sin(a.v));
}
export function cos(a: D2): D2 {
  return chain(a, Math.cos(a.v), -Math.sin(a.v), -Math.cos(a.v));
}

/**
 * Four-quadrant arc tangent, θ = atan2(Y, X), with exact derivatives:
 *   θ_i  = (X·Y_i − Y·X_i)/D,        D = X² + Y²
 *   θ_ij = [(X_j Y_i + X Y_ij − Y_j X_i − Y X_ij)·D − (X Y_i − Y X_i)·D_j]/D²
 * Needed because the solid-angle term of a cuboid magnet changes quadrant at
 * the plane of its pole faces.
 */
export function atan2d(Y: D2, X: D2): D2 {
  const D = X.v * X.v + Y.v * Y.v;
  const nx = X.v * Y.gx - Y.v * X.gx;
  const ny = X.v * Y.gy - Y.v * X.gy;
  const nz = X.v * Y.gz - Y.v * X.gz;
  const Dx = 2 * (X.v * X.gx + Y.v * Y.gx);
  const Dy = 2 * (X.v * X.gy + Y.v * Y.gy);
  const Dz = 2 * (X.v * X.gz + Y.v * Y.gz);
  const g = [nx / D, ny / D, nz / D];
  const Xg = [X.gx, X.gy, X.gz], Yg = [Y.gx, Y.gy, Y.gz];
  const Dg = [Dx, Dy, Dz], n = [nx, ny, nz];
  const Xh = X.hess, Yh = Y.hess;
  const hh = (i: number, j: number) => {
    const dn = Xg[j] * Yg[i] + X.v * Yh[i * 3 + j] - Yg[j] * Xg[i] - Y.v * Xh[i * 3 + j];
    return (dn * D - n[i] * Dg[j]) / (D * D);
  };
  return new D2(Math.atan2(Y.v, X.v), g[0], g[1], g[2],
    hh(0, 0), hh(0, 1), hh(0, 2), hh(1, 1), hh(1, 2), hh(2, 2));
}

/** |(x, y, z)| of three duals */
export function norm3(x: D2, y: D2, z: D2): D2 {
  return sqrt(add(add(sq(x), sq(y)), sq(z)));
}
/** x² + y² + z² of three duals */
export function sqnorm3(x: D2, y: D2, z: D2): D2 {
  return add(add(sq(x), sq(y)), sq(z));
}

/**
 * Symmetric 3×3 eigenvalues, sorted ascending. Closed-form trigonometric
 * solution (O. K. Smith, Comm. ACM 4 (1961) 168) — no iteration, so it is
 * exactly reproducible. `m` is row-major and assumed symmetric.
 */
export function eigen3(m: number[]): [number, number, number] {
  const p1 = m[1] * m[1] + m[2] * m[2] + m[5] * m[5];
  if (p1 === 0) {
    const d = [m[0], m[4], m[8]].sort((a, b) => a - b);
    return [d[0], d[1], d[2]];
  }
  const q = (m[0] + m[4] + m[8]) / 3;
  const p2 = (m[0] - q) ** 2 + (m[4] - q) ** 2 + (m[8] - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  const b = [(m[0] - q) / p, m[1] / p, m[2] / p, m[3] / p, (m[4] - q) / p, m[5] / p, m[6] / p, m[7] / p, (m[8] - q) / p];
  const det =
    b[0] * (b[4] * b[8] - b[5] * b[7]) -
    b[1] * (b[3] * b[8] - b[5] * b[6]) +
    b[2] * (b[3] * b[7] - b[4] * b[6]);
  const r = Math.min(1, Math.max(-1, det / 2));
  const phi = Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi);
  const e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  const e2 = 3 * q - e1 - e3;
  return [e3, e2, e1].sort((a, b2) => a - b2) as [number, number, number];
}
