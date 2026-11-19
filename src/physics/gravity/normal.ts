/**
 * WGS 84 normal (reference-ellipsoid) gravity.
 * Source: NIMA TR8350.2 (2000), §4.
 */
import { WGS84, WGS84_B, WGS84_E2 } from '../constants';
import { SphericalHarmonicField, triIndex } from './harmonics';

export interface NormalGravityParams {
  a: number;
  b: number;
  e2: number;
  gammaE: number;
  gammaP: number;
}
const WGS84_NORMAL: NormalGravityParams = {
  a: WGS84.a,
  b: WGS84_B,
  e2: WGS84_E2,
  gammaE: WGS84.gammaE,
  gammaP: WGS84.gammaP,
};

/** Somigliana closed formula: normal gravity ON the ellipsoid surface [m/s^2]. Eq. 4-1. */
export function somigliana(lat: number, p: NormalGravityParams = WGS84_NORMAL): number {
  const k = (p.b * p.gammaP) / (p.a * p.gammaE) - 1;
  const s2 = Math.sin(lat) ** 2;
  return (p.gammaE * (1 + k * s2)) / Math.sqrt(1 - p.e2 * s2);
}

/**
 * Normal gravity above the ellipsoid via the Taylor series of TR8350.2 Eq. 4-3
 * (2nd order in h). Accurate to ~2e-6 m/s^2 below 20 km; the simulator itself
 * uses the exact harmonic form — this is used for display and cross-checks.
 */
export function normalGravityAtHeight(lat: number, h: number): number {
  const a = WGS84.a;
  const f = WGS84.f;
  const m = (WGS84.omega ** 2 * a * a * WGS84_B) / WGS84.GM;
  const s2 = Math.sin(lat) ** 2;
  return somigliana(lat) * (1 - (2 / a) * (1 + f + m - 2 * f * s2) * h + (3 / (a * a)) * h * h);
}

/**
 * Even zonal harmonics of the WGS84 normal potential (TR8350.2 Eq. 5-1 / Heiskanen & Moritz 2-92):
 *   J2n = (−1)^(n+1) · 3e^(2n) / ((2n+1)(2n+3)) · (1 − n + 5n·J2/e²)
 */
export function wgs84NormalZonals(maxDegree = 20): Map<number, number> {
  const J2 = -WGS84.C20 * Math.sqrt(5);
  const e2 = WGS84_E2;
  const out = new Map<number, number>();
  for (let n = 1; 2 * n <= maxDegree; n++) {
    const J2n = ((-1) ** (n + 1) * 3 * e2 ** n) / ((2 * n + 1) * (2 * n + 3)) * (1 - n + (5 * n * J2) / e2);
    out.set(2 * n, J2n);
  }
  return out;
}

/** The WGS84 normal gravitational field (no centrifugal part) as spherical harmonics. */
export function wgs84NormalField(maxDegree = 20): SphericalHarmonicField {
  const count = triIndex(maxDegree, maxDegree) + 1;
  const C = new Float64Array(count);
  const S = new Float64Array(count);
  C[0] = 1;
  for (const [n, Jn] of wgs84NormalZonals(maxDegree)) C[triIndex(n, 0)] = -Jn / Math.sqrt(2 * n + 1);
  return new SphericalHarmonicField('WGS84 normal', WGS84.GM, WGS84.a, C, S, maxDegree);
}
