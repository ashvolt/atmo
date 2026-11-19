/**
 * Spherical-harmonic gravitational field (fully normalized coefficients).
 *
 *   V(r,φ,λ) = GM/r · Σ_{n=0..N} (R/r)^n Σ_{m=0..n} P̄nm(sin φ)·(C̄nm cos mλ + S̄nm sin mλ)
 *
 * φ is geocentric latitude. Associated Legendre functions are evaluated as
 * P̄nm = cos^m φ · Q̄nm(sin φ) (Holmes & Featherstone, J. Geodesy 76 (2002) 279),
 * which keeps the derivative terms finite at the poles. Gradients are analytic;
 * tests check them against finite differences of the potential.
 *
 * Returns the *gravitational* acceleration only (no centrifugal term).
 */
import type { Vec3 } from '../vec3';

export interface GravityField {
  readonly name: string;
  readonly GM: number;
  readonly R: number;
  readonly nmax: number;
  /** Gravitational acceleration [m/s^2] at ECEF/body-fixed position r [m]. */
  accel(r: Vec3, nmax?: number): Vec3;
  /** Gravitational potential [m^2/s^2] (positive convention, V = GM/r for a point mass). */
  potential(r: Vec3, nmax?: number): number;
}

export const triIndex = (n: number, m: number) => (n * (n + 1)) / 2 + m;

export class SphericalHarmonicField implements GravityField {
  readonly nmax: number;
  private readonly C: Float64Array;
  private readonly S: Float64Array;
  // Precomputed recursion coefficients
  private readonly anm: Float64Array;
  private readonly bnm: Float64Array;
  private readonly cnm: Float64Array; // derivative factor N_nm / N_n,m+1
  private readonly diag: Float64Array; // Q̄mm
  private readonly Q: Float64Array; // work buffer
  private readonly cosm: Float64Array;
  private readonly sinm: Float64Array;
  private readonly rhoN: Float64Array;

  constructor(
    readonly name: string,
    readonly GM: number,
    readonly R: number,
    C: Float64Array,
    S: Float64Array,
    nmax: number,
  ) {
    this.nmax = nmax;
    const count = triIndex(nmax + 1, 0) + 1; // room for (n, m+1) lookups with m+1 = n+1 -> treated as 0
    this.C = C;
    this.S = S;
    this.anm = new Float64Array(count);
    this.bnm = new Float64Array(count);
    this.cnm = new Float64Array(count);
    this.diag = new Float64Array(nmax + 2);
    this.Q = new Float64Array(count + nmax + 2);
    this.cosm = new Float64Array(nmax + 2);
    this.sinm = new Float64Array(nmax + 2);
    this.rhoN = new Float64Array(nmax + 2);

    this.diag[0] = 1;
    if (nmax >= 1) this.diag[1] = Math.sqrt(3);
    for (let m = 2; m <= nmax + 1; m++) this.diag[m] = Math.sqrt((2 * m + 1) / (2 * m)) * this.diag[m - 1];

    for (let n = 0; n <= nmax; n++) {
      for (let m = 0; m <= n; m++) {
        const k = triIndex(n, m);
        if (n >= m + 2) {
          this.anm[k] = Math.sqrt(((2 * n - 1) * (2 * n + 1)) / ((n - m) * (n + m)));
          this.bnm[k] = Math.sqrt(((2 * n + 1) * (n + m - 1) * (n - m - 1)) / ((n - m) * (n + m) * (2 * n - 3)));
        }
        this.cnm[k] = m === 0 ? Math.sqrt((n * (n + 1)) / 2) : Math.sqrt((n - m) * (n + m + 1));
      }
    }
  }

  /** Fill Q̄nm(t) for 0<=m<=n<=N (sectorals with u^m factored out). */
  private legendre(t: number, N: number) {
    const Q = this.Q;
    for (let m = 0; m <= N; m++) {
      const kmm = triIndex(m, m);
      Q[kmm] = this.diag[m];
      if (m + 1 <= N) Q[triIndex(m + 1, m)] = Math.sqrt(2 * m + 3) * t * this.diag[m];
      for (let n = m + 2; n <= N; n++) {
        const k = triIndex(n, m);
        Q[k] = this.anm[k] * t * Q[triIndex(n - 1, m)] - this.bnm[k] * Q[triIndex(n - 2, m)];
      }
    }
  }

  private prepare(r: Vec3, N: number) {
    const [x, y, z] = r;
    const rho = Math.hypot(x, y);
    const rr = Math.hypot(rho, z);
    const t = z / rr; // sin φ
    const u = rho / rr; // cos φ
    const lon = Math.atan2(y, x);
    const cl = Math.cos(lon);
    const sl = Math.sin(lon);
    this.cosm[0] = 1;
    this.sinm[0] = 0;
    for (let m = 1; m <= N; m++) {
      this.cosm[m] = this.cosm[m - 1] * cl - this.sinm[m - 1] * sl;
      this.sinm[m] = this.sinm[m - 1] * cl + this.cosm[m - 1] * sl;
    }
    const q = this.R / rr;
    this.rhoN[0] = 1;
    for (let n = 1; n <= N; n++) this.rhoN[n] = this.rhoN[n - 1] * q;
    this.legendre(t, N);
    return { rr, t, u, cl, sl };
  }

  potential(r: Vec3, nmax = this.nmax): number {
    const N = Math.min(nmax, this.nmax);
    const { rr, u } = this.prepare(r, N);
    let total = 0;
    let um = 1;
    for (let m = 0; m <= N; m++) {
      let s = 0;
      for (let n = m; n <= N; n++) {
        const k = triIndex(n, m);
        s += this.rhoN[n] * this.Q[k] * (this.C[k] * this.cosm[m] + this.S[k] * this.sinm[m]);
      }
      total += um * s;
      um *= u;
    }
    return (this.GM / rr) * total;
  }

  accel(r: Vec3, nmax = this.nmax): Vec3 {
    const N = Math.min(nmax, this.nmax);
    const { rr, t, u, cl, sl } = this.prepare(r, N);
    const Q = this.Q;
    let sr = 0; // Σ (n+1) ρ^n P̄ (..)
    let sphi = 0; // Σ ρ^n dP̄/dφ (..)
    let slam = 0; // Σ ρ^n m P̄/cosφ (S cos - C sin)
    let um1 = 0; // u^(m-1)
    let um = 1; // u^m
    for (let m = 0; m <= N; m++) {
      const cm = this.cosm[m];
      const sm = this.sinm[m];
      let ar = 0, aphi1 = 0, aphi2 = 0, alam = 0;
      for (let n = m; n <= N; n++) {
        const k = triIndex(n, m);
        const Ck = this.C[k];
        const Sk = this.S[k];
        if (Ck === 0 && Sk === 0) continue;
        const rn = this.rhoN[n];
        const trig = Ck * cm + Sk * sm;
        const q = Q[k];
        ar += (n + 1) * rn * q * trig;
        // dP̄nm/dφ = cnm u^{m+1} Q̄n,m+1 − m t u^{m−1} Q̄nm
        const qNext = m + 1 <= n ? Q[k + 1] : 0;
        aphi1 += rn * this.cnm[k] * qNext * trig;
        aphi2 += rn * q * trig;
        alam += rn * q * (Sk * cm - Ck * sm);
      }
      sr += um * ar;
      sphi += um * u * aphi1 - (m > 0 ? m * t * um1 * aphi2 : 0);
      if (m > 0) slam += m * um1 * alam;
      um1 = um;
      um *= u;
    }
    const k0 = this.GM / (rr * rr);
    const gr = -k0 * sr;
    const gphi = k0 * sphi;
    const glam = k0 * slam;
    // spherical -> Cartesian (geocentric)
    return [
      u * cl * gr - t * cl * gphi - sl * glam,
      u * sl * gr - t * sl * gphi + cl * glam,
      t * gr + u * gphi,
    ];
  }
}

/** Build a zonal-only field from unnormalized J_n values (J2, J3, ...). */
export function zonalField(name: string, GM: number, R: number, J: Record<number, number>): SphericalHarmonicField {
  const nmax = Math.max(2, ...Object.keys(J).map(Number));
  const count = triIndex(nmax, nmax) + 1;
  const C = new Float64Array(count);
  const S = new Float64Array(count);
  C[0] = 1;
  for (const [nStr, Jn] of Object.entries(J)) {
    const n = Number(nStr);
    C[triIndex(n, 0)] = -Jn / Math.sqrt(2 * n + 1);
  }
  return new SphericalHarmonicField(name, GM, R, C, S, nmax);
}

/** Parse the binary coefficient file written by scripts/fetch-egm2008.ts. */
export function parseCoefficientFile(name: string, buf: ArrayBuffer, nmaxLimit?: number): SphericalHarmonicField {
  const dv = new DataView(buf);
  const fileN = dv.getUint32(0, true);
  const GM = dv.getFloat64(8, true);
  const R = dv.getFloat64(16, true);
  const count = triIndex(fileN, fileN) + 1;
  const C = new Float64Array(buf.slice(24, 24 + count * 8));
  const S = new Float64Array(buf.slice(24 + count * 8, 24 + count * 16));
  return new SphericalHarmonicField(name, GM, R, C, S, Math.min(nmaxLimit ?? fileN, fileN));
}
