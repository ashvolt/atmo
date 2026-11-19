/**
 * U.S. Standard Atmosphere 1976 (NASA-TM-X-74335 / NOAA-S/T 76-1562).
 *
 *  -5 km … 80 km : exact analytic model (7 geopotential layers, M = M0).
 *  80 km … 1000 km: tabulated model (see scripts/ussa1976_reference.py), with
 *                   log-linear interpolation of ρ, p and linear interpolation of T.
 *  > 1000 km      : exponential extrapolation with the local scale height at 1000 km.
 *
 * Optional weather overrides (surface temperature offset, surface pressure,
 * relative humidity) re-integrate the hydrostatic equation through the lower
 * atmosphere — see `EarthAtmosphere`.
 */
import upper from '../../data/ussa1976_upper.json';
import type { Atmosphere, AtmosphereState } from './types';

// USSA-1976 constants (the 1976 values, deliberately not CODATA, so tables reproduce)
export const US76 = {
  r0: 6356766, // effective Earth radius for geopotential [m]
  g0: 9.80665,
  Rstar: 8314.32, // [J/(kmol K)]
  M0: 28.9644, // [kg/kmol]
  gamma: 1.4,
  beta: 1.458e-6, // Sutherland [kg/(s m K^1/2)]
  S: 110.4, // Sutherland [K]
  sigma: 3.65e-10, // effective collision diameter [m]
  NA: 6.022169e26, // [1/kmol]
  P0: 101325,
  T0: 288.15,
};

const Hb = [0, 11000, 20000, 32000, 47000, 51000, 71000, 84852];
const Lb = [-0.0065, 0, 0.001, 0.0028, 0, -0.0028, -0.002];
const Tb: number[] = [US76.T0];
const Pb: number[] = [US76.P0];
const GMR = (US76.g0 * US76.M0) / US76.Rstar; // 0.034163195 K/m
for (let i = 0; i < Lb.length; i++) {
  const dH = Hb[i + 1] - Hb[i];
  Tb.push(Tb[i] + Lb[i] * dH);
  Pb.push(
    Lb[i] === 0 ? Pb[i] * Math.exp((-GMR * dH) / Tb[i]) : Pb[i] * Math.pow(Tb[i] / (Tb[i] + Lb[i] * dH), GMR / Lb[i]),
  );
}
export const US76_LAYER_BASES = { Hb, Tb, Pb };

export const geopotential = (z: number) => (US76.r0 * z) / (US76.r0 + z);

/** Analytic lower atmosphere (valid -5 km ≤ z ≤ 86 km where M = M0; used ≤ 80 km). Returns [T, p]. */
export function lowerTP(z: number): [number, number] {
  const H = geopotential(z);
  let i = 0;
  while (i < Lb.length - 1 && H >= Hb[i + 1]) i++;
  const dH = H - Hb[i];
  const T = Tb[i] + Lb[i] * dH;
  const p = Lb[i] === 0 ? Pb[i] * Math.exp((-GMR * dH) / Tb[i]) : Pb[i] * Math.pow(Tb[i] / T, GMR / Lb[i]);
  return [T, p];
}

const UZ = Float64Array.from(upper.z_km, (v: number) => v * 1000);
const UT = Float64Array.from(upper.T);
const ULR = Float64Array.from(upper.logRho);
const ULP = Float64Array.from(upper.logP);
const UM = Float64Array.from(upper.M);
const TABLE_START = UZ[0];
const TABLE_END = UZ[UZ.length - 1];
// local scale height at the top of the table, for extrapolation above 1000 km
const H_TOP = (UZ[UZ.length - 1] - UZ[UZ.length - 2]) / (ULR[ULR.length - 2] - ULR[ULR.length - 1]);

function findIndex(z: number): number {
  let lo = 0;
  let hi = UZ.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (UZ[mid] <= z) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function sutherland(T: number): number {
  return (US76.beta * T ** 1.5) / (T + US76.S);
}

/** Mean free path from pressure & temperature: L = kT / (√2 π σ² p)  (USSA76 eq. 49 with n = p/kT). */
export function meanFreePath(p: number, T: number): number {
  if (p <= 0) return Infinity;
  const n = (p * US76.NA) / (US76.Rstar * T);
  return 1 / (Math.SQRT2 * Math.PI * US76.sigma * US76.sigma * n);
}

export function makeState(T: number, p: number, rho: number, M: number): AtmosphereState {
  return {
    T,
    p,
    rho,
    a: Math.sqrt((US76.gamma * US76.Rstar * T) / M),
    mu: sutherland(T),
    mfp: meanFreePath(p, T),
    M,
    gamma: US76.gamma,
  };
}

/** Pure USSA-1976 state at geometric altitude z [m] above mean sea level. */
export function ussa1976(z: number): AtmosphereState {
  if (z < TABLE_START) {
    const [T, p] = lowerTP(Math.max(z, -5000));
    return makeState(T, p, (p * US76.M0) / (US76.Rstar * T), US76.M0);
  }
  if (z >= TABLE_END) {
    const i = UZ.length - 1;
    const f = Math.exp(-(z - TABLE_END) / H_TOP);
    return makeState(UT[i], Math.exp(ULP[i]) * f, Math.exp(ULR[i]) * f, UM[i]);
  }
  const i = findIndex(z);
  const w = (z - UZ[i]) / (UZ[i + 1] - UZ[i]);
  const T = UT[i] + w * (UT[i + 1] - UT[i]);
  const p = Math.exp(ULP[i] + w * (ULP[i + 1] - ULP[i]));
  const rho = Math.exp(ULR[i] + w * (ULR[i + 1] - ULR[i]));
  const M = UM[i] + w * (UM[i + 1] - UM[i]);
  return makeState(T, p, rho, M);
}

export interface WeatherOverrides {
  /** Surface (MSL) temperature offset from 288.15 K [K]. Applies fully up to 11 km, tapering to 0 at 20 km. */
  dT: number;
  /** Mean-sea-level pressure [Pa]. */
  pMSL: number;
  /** Relative humidity at the surface, 0–1 (vapour decays with a 2.5 km scale height). */
  RH: number;
}

export const STANDARD_WEATHER: WeatherOverrides = { dT: 0, pMSL: US76.P0, RH: 0 };

/** Saturation vapour pressure over water, Buck (1996) [Pa]; T in K. */
export function saturationVapourPressure(T: number): number {
  const c = T - 273.15;
  return c >= 0
    ? 611.21 * Math.exp((18.678 - c / 234.5) * (c / (257.14 + c)))
    : 611.15 * Math.exp((23.036 - c / 333.7) * (c / (279.82 + c)));
}

const M_VAPOUR = 18.01528;

/**
 * Earth's atmosphere: USSA-1976 with optional weather.
 * With STANDARD_WEATHER this is exactly `ussa1976`.
 */
export class EarthAtmosphere implements Atmosphere {
  readonly name = 'U.S. Standard Atmosphere 1976';
  readonly top = 2_000_000;
  private readonly custom: boolean;
  private tableZ0 = -2000;
  private tableDz = 25;
  private tableP: Float64Array | null = null;
  private ratioTop = 1; // p'/p_std at the top of the integrated table

  constructor(readonly weather: WeatherOverrides = STANDARD_WEATHER) {
    this.custom = weather.dT !== 0 || weather.pMSL !== US76.P0 || weather.RH !== 0;
    if (this.custom) this.integrate();
  }

  private weight(z: number) {
    const H = geopotential(z);
    if (H <= 11000) return 1;
    if (H >= 20000) return 0;
    return (20000 - H) / 9000;
  }

  private temperature(z: number) {
    return lowerTP(z)[0] + this.weather.dT * this.weight(z);
  }

  /** Hydrostatic integration dp/dz = −p g(z) M0 / (R* T'(z)), RK4, 25 m steps, −2 km … 50 km. */
  private integrate() {
    const z0 = this.tableZ0, dz = this.tableDz, zTop = 50000;
    const n = Math.round((zTop - z0) / dz) + 1;
    const P = new Float64Array(n);
    const g = (z: number) => US76.g0 * (US76.r0 / (US76.r0 + z)) ** 2;
    const f = (z: number, lnp: number) => {
      void lnp;
      return (-g(z) * US76.M0) / (US76.Rstar * this.temperature(z));
    };
    // integrate ln p; start at z = 0 with pMSL, go up and down
    const i0 = Math.round(-z0 / dz);
    P[i0] = Math.log(this.weather.pMSL);
    const step = (z: number, y: number, h: number) => {
      const k1 = f(z, y), k2 = f(z + h / 2, y + (h * k1) / 2), k3 = f(z + h / 2, y + (h * k2) / 2), k4 = f(z + h, y + h * k3);
      return y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    };
    for (let i = i0; i < n - 1; i++) P[i + 1] = step(z0 + i * dz, P[i], dz);
    for (let i = i0; i > 0; i--) P[i - 1] = step(z0 + i * dz, P[i], -dz);
    this.tableP = P;
    this.ratioTop = Math.exp(P[n - 1]) / lowerTP(zTop)[1];
  }

  at(z: number): AtmosphereState {
    if (!this.custom) return ussa1976(z);
    const zTop = 50000;
    let T: number, p: number;
    if (z < zTop) {
      const P = this.tableP!;
      const x = (Math.max(z, this.tableZ0) - this.tableZ0) / this.tableDz;
      const i = Math.min(Math.floor(x), P.length - 2);
      const w = x - i;
      T = this.temperature(z);
      p = Math.exp(P[i] + w * (P[i + 1] - P[i]));
    } else {
      const s = ussa1976(z);
      // pressure ratio carried aloft, tapering to the standard by 120 km
      const taper = z >= 120000 ? 0 : (120000 - z) / (120000 - zTop);
      const ratio = 1 + (this.ratioTop - 1) * taper;
      return makeState(s.T, s.p * ratio, s.rho * ratio, s.M);
    }
    // humidity: moist air is lighter at equal total pressure
    let rho = (p * US76.M0) / (US76.Rstar * T);
    if (this.weather.RH > 0) {
      const e = Math.min(this.weather.RH * saturationVapourPressure(T) * Math.exp(-Math.max(z, 0) / 2500), 0.5 * p);
      rho = ((p - e) * US76.M0 + e * M_VAPOUR) / (US76.Rstar * T);
      const M = (rho * US76.Rstar * T) / p;
      return makeState(T, p, rho, M);
    }
    return makeState(T, p, rho, US76.M0);
  }
}
