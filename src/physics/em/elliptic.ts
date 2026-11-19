/**
 * Complete elliptic integrals of the first and second kind, in the modulus
 * convention K(k) = ∫₀^{π/2} dθ/√(1 − k² sin²θ).
 *
 * Primary algorithm: Carlson's symmetric forms with the duplication theorem
 *   K(k) = R_F(0, 1 − k², 1),   E(k) = R_F(0, 1 − k², 1) − (k²/3)·R_D(0, 1 − k², 1)
 * B. C. Carlson, Numer. Math. 33 (1979) 1; implementation after
 * Press et al., "Numerical Recipes", 3rd ed. §6.12. The series truncation
 * error is O(ERRTOL⁶), i.e. below double-precision rounding here.
 *
 * `agmKE` is an independent arithmetic–geometric-mean implementation used by
 * the test suite to cross-check the Carlson path — two unrelated algorithms
 * agreeing to 1e-15 is the actual guarantee of correctness.
 */
import { chain, type D2 } from './dual';

const ERRTOL_F = 0.0015;
const ERRTOL_D = 0.0015;

/** Carlson's elliptic integral of the first kind R_F(x,y,z); x,y,z ≥ 0, at most one zero. */
export function carlsonRF(x: number, y: number, z: number): number {
  let xt = x, yt = y, zt = z;
  let ave = 0, delx = 0, dely = 0, delz = 0;
  for (let i = 0; i < 200; i++) {
    const sx = Math.sqrt(xt), sy = Math.sqrt(yt), sz = Math.sqrt(zt);
    const lam = sx * (sy + sz) + sy * sz;
    xt = 0.25 * (xt + lam);
    yt = 0.25 * (yt + lam);
    zt = 0.25 * (zt + lam);
    ave = (xt + yt + zt) / 3;
    delx = (ave - xt) / ave;
    dely = (ave - yt) / ave;
    delz = (ave - zt) / ave;
    if (Math.max(Math.abs(delx), Math.abs(dely), Math.abs(delz)) < ERRTOL_F) break;
  }
  const e2 = delx * dely - delz * delz;
  const e3 = delx * dely * delz;
  return (1 + ((1 / 24) * e2 - 0.1 - (3 / 44) * e3) * e2 + (1 / 14) * e3) / Math.sqrt(ave);
}

/** Carlson's degenerate integral of the second kind R_D(x,y,z); z > 0. */
export function carlsonRD(x: number, y: number, z: number): number {
  const C1 = 3 / 14, C2 = 1 / 6, C3 = 9 / 22, C4 = 3 / 26, C5 = 0.25 * C3, C6 = 1.5 * C4;
  let xt = x, yt = y, zt = z, sum = 0, fac = 1;
  let ave = 0, delx = 0, dely = 0, delz = 0;
  for (let i = 0; i < 200; i++) {
    const sx = Math.sqrt(xt), sy = Math.sqrt(yt), sz = Math.sqrt(zt);
    const lam = sx * (sy + sz) + sy * sz;
    sum += fac / (sz * (zt + lam));
    fac *= 0.25;
    xt = 0.25 * (xt + lam);
    yt = 0.25 * (yt + lam);
    zt = 0.25 * (zt + lam);
    ave = 0.2 * (xt + yt + 3 * zt);
    delx = (ave - xt) / ave;
    dely = (ave - yt) / ave;
    delz = (ave - zt) / ave;
    if (Math.max(Math.abs(delx), Math.abs(dely), Math.abs(delz)) < ERRTOL_D) break;
  }
  const ea = delx * dely, eb = delz * delz, ec = ea - eb, ed = ea - 6 * eb, ee = ed + ec + ec;
  return 3 * sum + (fac * (1 + ed * (-C1 + C5 * ed - C6 * delz * ee) + delz * (C2 * ee + delz * (-C3 * ec + delz * C4 * ea)))) / (ave * Math.sqrt(ave));
}

/** largest k² that keeps K(k) finite in double precision */
const KSQ_MAX = 1 - 1e-15;

/** Complete elliptic integral of the first kind, modulus convention. */
export function ellipK(k: number): number {
  const m = Math.min(k * k, KSQ_MAX);
  return carlsonRF(0, 1 - m, 1);
}

/** Complete elliptic integral of the second kind, modulus convention. */
export function ellipE(k: number): number {
  const m = Math.min(k * k, KSQ_MAX);
  return carlsonRF(0, 1 - m, 1) - (m / 3) * carlsonRD(0, 1 - m, 1);
}

/** Both at once (they share the same R_F). */
export function ellipKE(k: number): [number, number] {
  const m = Math.min(k * k, KSQ_MAX);
  const rf = carlsonRF(0, 1 - m, 1);
  return [rf, rf - (m / 3) * carlsonRD(0, 1 - m, 1)];
}

/**
 * Independent reference implementation via the arithmetic–geometric mean:
 *   K = π/(2 a_∞),  E = K·(1 − Σ_{n≥0} 2^{n−1} c_n²)
 * Abramowitz & Stegun §17.6; quadratically convergent.
 */
export function agmKE(k: number): [number, number] {
  let a = 1, b = Math.sqrt(Math.max(1 - k * k, 0));
  let sum = 0.5 * k * k; // n = 0 term: 2^{-1} c_0², c_0 = k
  let pow2 = 1;
  for (let i = 0; i < 100; i++) {
    // c_{n+1} = (a_n − b_n)/2 must be formed before the means are updated
    const c = 0.5 * (a - b);
    const an = 0.5 * (a + b);
    b = Math.sqrt(a * b);
    a = an;
    const term = pow2 * c * c; // 2^{n−1} c_n² with n = i+1
    sum += term;
    pow2 *= 2;
    // c_n stalls at the rounding floor (~ε·a) while 2^{n−1} keeps doubling,
    // so the series must be stopped as soon as a term stops mattering.
    if (term < 1e-21) break;
  }
  const K = Math.PI / (2 * a);
  return [K, K * (1 - sum)];
}

/**
 * Derivatives with respect to the modulus (Byrd & Friedman 710.00):
 *   dK/dk = [E − (1 − k²)K] / [k(1 − k²)]
 *   dE/dk = (E − K)/k
 * Second derivatives follow by differentiating these once more, so a dual
 * modulus propagates exactly.
 */
export function ellipKderiv(k: number): { K: number; E: number; K1: number; E1: number; K2: number; E2: number } {
  const [K, E] = ellipKE(k);
  const m = k * k, om = 1 - m;
  const K1 = (E - om * K) / (k * om);
  const E1 = (E - K) / k;
  // K'' from N/D with N = E − (1−k²)K, D = k(1−k²)
  const N = E - om * K;
  const D = k * om;
  const N1 = E1 + 2 * k * K - om * K1;
  const D1 = 1 - 3 * m;
  const K2 = (N1 * D - N * D1) / (D * D);
  const E2 = (E1 - K1) / k - (E - K) / (k * k);
  return { K, E, K1, E1, K2, E2 };
}

/** K(k) of a dual modulus. */
export function ellipKd(k: D2): D2 {
  const d = ellipKderiv(k.v);
  return chain(k, d.K, d.K1, d.K2);
}
/** E(k) of a dual modulus. */
export function ellipEd(k: D2): D2 {
  const d = ellipKderiv(k.v);
  return chain(k, d.E, d.E1, d.E2);
}
/** both, sharing one evaluation */
export function ellipKEd(k: D2): [D2, D2] {
  const d = ellipKderiv(k.v);
  return [chain(k, d.K, d.K1, d.K2), chain(k, d.E, d.E1, d.E2)];
}
