/**
 * Dormand–Prince 5(4) explicit Runge–Kutta integrator with adaptive step-size
 * control, FSAL, 4th-order dense output and event location.
 *
 * J. R. Dormand & P. J. Prince, J. Comput. Appl. Math. 6 (1980) 19–26.
 * Dense output & step control follow E. Hairer, S. P. Nørsett, G. Wanner,
 * "Solving Ordinary Differential Equations I", 2nd ed., §II.4–II.6 (DOPRI5).
 */

export type Derivative = (t: number, y: Float64Array, dydt: Float64Array) => void;

const c2 = 1 / 5, c3 = 3 / 10, c4 = 4 / 5, c5 = 8 / 9;
const a21 = 1 / 5;
const a31 = 3 / 40, a32 = 9 / 40;
const a41 = 44 / 45, a42 = -56 / 15, a43 = 32 / 9;
const a51 = 19372 / 6561, a52 = -25360 / 2187, a53 = 64448 / 6561, a54 = -212 / 729;
const a61 = 9017 / 3168, a62 = -355 / 33, a63 = 46732 / 5247, a64 = 49 / 176, a65 = -5103 / 18656;
const a71 = 35 / 384, a73 = 500 / 1113, a74 = 125 / 192, a75 = -2187 / 6784, a76 = 11 / 84;
const e1 = 71 / 57600, e3 = -71 / 16695, e4 = 71 / 1920, e5 = -17253 / 339200, e6 = 22 / 525, e7 = -1 / 40;
const d1 = -12715105075 / 11282082432, d3 = 87487479700 / 32700410799, d4 = -10690763975 / 1880347072,
  d5 = 701980252875 / 199316789632, d6 = -1453857185 / 822651844, d7 = 69997945 / 29380423;

export interface IntegratorOptions {
  rtol: number;
  atol: number | Float64Array;
  hmax?: number;
  hmin?: number;
  h0?: number;
}

export class DormandPrince {
  readonly n: number;
  t = 0;
  y: Float64Array;
  h = 0;
  /** derivative at current (t, y) — FSAL */
  private f0: Float64Array;
  private k2: Float64Array; private k3: Float64Array; private k4: Float64Array;
  private k5: Float64Array; private k6: Float64Array; private k7: Float64Array;
  private yt: Float64Array; private y1: Float64Array; private err: Float64Array;
  // dense output for the last accepted step [tPrev, t]
  tPrev = 0;
  hLast = 0;
  private r1: Float64Array; private r2: Float64Array; private r3: Float64Array; private r4: Float64Array; private r5: Float64Array;
  private atolArr: Float64Array;
  nfev = 0;
  nAccepted = 0;
  nRejected = 0;

  constructor(private f: Derivative, t0: number, y0: Float64Array, private opts: IntegratorOptions) {
    this.n = y0.length;
    const n = this.n;
    const mk = () => new Float64Array(n);
    this.y = Float64Array.from(y0);
    this.f0 = mk(); this.k2 = mk(); this.k3 = mk(); this.k4 = mk(); this.k5 = mk(); this.k6 = mk(); this.k7 = mk();
    this.yt = mk(); this.y1 = mk(); this.err = mk();
    this.r1 = mk(); this.r2 = mk(); this.r3 = mk(); this.r4 = mk(); this.r5 = mk();
    this.atolArr = typeof opts.atol === 'number' ? new Float64Array(n).fill(opts.atol) : Float64Array.from(opts.atol);
    this.reset(t0, y0);
  }

  /** Restart at a new state (after a discontinuity). Keeps the last step size as a hint. */
  reset(t0: number, y0: Float64Array) {
    this.t = t0;
    this.tPrev = t0;
    this.y.set(y0);
    this.f(t0, this.y, this.f0);
    this.nfev++;
    this.h = this.opts.h0 ?? this.initialStep();
  }

  private sc(i: number, a: number, b: number) {
    return this.atolArr[i] + this.opts.rtol * Math.max(Math.abs(a), Math.abs(b));
  }

  /** Hairer's initial step-size heuristic (HNW I, §II.4). */
  private initialStep(): number {
    const n = this.n;
    let d0 = 0, d1n = 0;
    for (let i = 0; i < n; i++) {
      const s = this.sc(i, this.y[i], this.y[i]);
      d0 += (this.y[i] / s) ** 2;
      d1n += (this.f0[i] / s) ** 2;
    }
    d0 = Math.sqrt(d0 / n);
    d1n = Math.sqrt(d1n / n);
    let h0 = d0 < 1e-5 || d1n < 1e-5 ? 1e-6 : 0.01 * (d0 / d1n);
    if (this.opts.hmax) h0 = Math.min(h0, this.opts.hmax);
    for (let i = 0; i < n; i++) this.yt[i] = this.y[i] + h0 * this.f0[i];
    this.f(this.t + h0, this.yt, this.k2);
    this.nfev++;
    let d2 = 0;
    for (let i = 0; i < n; i++) d2 += ((this.k2[i] - this.f0[i]) / this.sc(i, this.y[i], this.y[i])) ** 2;
    d2 = Math.sqrt(d2 / n) / h0;
    const dm = Math.max(d1n, d2);
    const h1 = dm <= 1e-15 ? Math.max(1e-6, h0 * 1e-3) : (0.01 / dm) ** (1 / 5);
    let h = Math.min(100 * h0, h1);
    if (this.opts.hmax) h = Math.min(h, this.opts.hmax);
    return h;
  }

  /**
   * Take one accepted step, never going beyond tMax. Returns false if the step
   * size underflowed.
   */
  step(tMax: number): boolean {
    const { n, y, f0, k2, k3, k4, k5, k6, k7, yt, y1, err } = this;
    const hmin = this.opts.hmin ?? 1e-12;
    for (let attempt = 0; attempt < 100; attempt++) {
      let h = this.h;
      if (this.opts.hmax) h = Math.min(h, this.opts.hmax);
      let last = false;
      if (this.t + h >= tMax) {
        h = tMax - this.t;
        last = true;
      }
      if (h <= 0) return false;
      const t = this.t;
      for (let i = 0; i < n; i++) yt[i] = y[i] + h * a21 * f0[i];
      this.f(t + c2 * h, yt, k2);
      for (let i = 0; i < n; i++) yt[i] = y[i] + h * (a31 * f0[i] + a32 * k2[i]);
      this.f(t + c3 * h, yt, k3);
      for (let i = 0; i < n; i++) yt[i] = y[i] + h * (a41 * f0[i] + a42 * k2[i] + a43 * k3[i]);
      this.f(t + c4 * h, yt, k4);
      for (let i = 0; i < n; i++) yt[i] = y[i] + h * (a51 * f0[i] + a52 * k2[i] + a53 * k3[i] + a54 * k4[i]);
      this.f(t + c5 * h, yt, k5);
      for (let i = 0; i < n; i++) yt[i] = y[i] + h * (a61 * f0[i] + a62 * k2[i] + a63 * k3[i] + a64 * k4[i] + a65 * k5[i]);
      this.f(t + h, yt, k6);
      for (let i = 0; i < n; i++) y1[i] = y[i] + h * (a71 * f0[i] + a73 * k3[i] + a74 * k4[i] + a75 * k5[i] + a76 * k6[i]);
      this.f(t + h, y1, k7);
      this.nfev += 6;

      let e = 0;
      for (let i = 0; i < n; i++) {
        err[i] = h * (e1 * f0[i] + e3 * k3[i] + e4 * k4[i] + e5 * k5[i] + e6 * k6[i] + e7 * k7[i]);
        e += (err[i] / this.sc(i, y[i], y1[i])) ** 2;
      }
      e = Math.sqrt(e / n);
      if (!Number.isFinite(e)) e = 1e10;

      if (e <= 1) {
        // dense output coefficients
        for (let i = 0; i < n; i++) {
          const ydiff = y1[i] - y[i];
          const bspl = h * f0[i] - ydiff;
          this.r1[i] = y[i];
          this.r2[i] = ydiff;
          this.r3[i] = bspl;
          this.r4[i] = ydiff - h * k7[i] - bspl;
          this.r5[i] = h * (d1 * f0[i] + d3 * k3[i] + d4 * k4[i] + d5 * k5[i] + d6 * k6[i] + d7 * k7[i]);
        }
        this.tPrev = t;
        this.hLast = h;
        this.t = last ? tMax : t + h;
        y.set(y1);
        f0.set(k7);
        this.nAccepted++;
        const fac = e === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * e ** -0.2));
        if (!last) this.h = h * fac;
        return true;
      }
      this.nRejected++;
      this.h = h * Math.max(0.2, 0.9 * e ** -0.2);
      if (this.h < hmin) return false;
    }
    return false;
  }

  /** Evaluate the dense-output interpolant at tq ∈ [tPrev, t]. */
  dense(tq: number, out: Float64Array): Float64Array {
    const s = this.hLast === 0 ? 1 : (tq - this.tPrev) / this.hLast;
    const s1 = 1 - s;
    for (let i = 0; i < this.n; i++) {
      out[i] = this.r1[i] + s * (this.r2[i] + s1 * (this.r3[i] + s * (this.r4[i] + s1 * this.r5[i])));
    }
    return out;
  }

  /** Derivative at the current state (from FSAL cache). */
  get derivative(): Float64Array {
    return this.f0;
  }
}

/**
 * Locate a root of g(t) on [ta, tb] (g(ta) and g(tb) have opposite signs) with the
 * Illinois variant of regula falsi; converges superlinearly to |Δt| < tol.
 */
export function findRoot(g: (t: number) => number, ta: number, tb: number, ga: number, gb: number, tol = 1e-10): number {
  let side = 0;
  for (let i = 0; i < 200; i++) {
    const tc = (ta * gb - tb * ga) / (gb - ga);
    const gc = g(tc);
    if (Math.abs(tb - ta) < tol || gc === 0) return tc;
    if (gc * gb > 0) {
      tb = tc; gb = gc;
      if (side === -1) ga /= 2;
      side = -1;
    } else {
      ta = tc; ga = gc;
      if (side === 1) gb /= 2;
      side = 1;
    }
  }
  return (ta + tb) / 2;
}
