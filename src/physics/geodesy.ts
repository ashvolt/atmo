/**
 * Geodetic <-> Earth-centred Earth-fixed (ECEF) conversions and local
 * East-North-Up (ENU) frames on an arbitrary oblate ellipsoid.
 */
import type { Ellipsoid } from './constants';
import type { Vec3 } from './vec3';

export interface Geodetic {
  lat: number; // geodetic latitude [rad]
  lon: number; // longitude [rad]
  h: number; // height above ellipsoid [m]
}

export function geodeticToEcef(lat: number, lon: number, h: number, ell: Ellipsoid): Vec3 {
  const e2 = ell.f * (2 - ell.f);
  const sl = Math.sin(lat);
  const cl = Math.cos(lat);
  const N = ell.a / Math.sqrt(1 - e2 * sl * sl); // prime-vertical radius of curvature
  return [(N + h) * cl * Math.cos(lon), (N + h) * cl * Math.sin(lon), (N * (1 - e2) + h) * sl];
}

/**
 * Exact closed-form ECEF -> geodetic transformation.
 * H. Vermeille, "Direct transformation from geocentric coordinates to geodetic
 * coordinates", J. Geodesy 76 (2002) 451–454. Valid everywhere outside the
 * ellipsoid's evolute (a region within ~43 km of Earth's centre); inside it we
 * fall back to Bowring iteration.
 */
export function ecefToGeodetic(r: Vec3, ell: Ellipsoid): Geodetic {
  const [x, y, z] = r;
  const a = ell.a;
  const e2 = ell.f * (2 - ell.f);
  const e4 = e2 * e2;
  const rho = Math.hypot(x, y);
  const lon = rho > 0 ? 2 * Math.atan2(y, x + rho) : 0;

  if (e2 === 0) {
    const rr = Math.hypot(rho, z);
    return { lat: Math.atan2(z, rho), lon, h: rr - a };
  }

  const p = (rho * rho) / (a * a);
  const q = ((1 - e2) / (a * a)) * z * z;
  const rr = (p + q - e4) / 6;
  if (rr <= 0) return bowring(rho, z, lon, ell); // inside the evolute
  const s = (e4 * p * q) / (4 * rr * rr * rr);
  const t = Math.cbrt(1 + s + Math.sqrt(s * (2 + s)));
  const u = rr * (1 + t + 1 / t);
  const v = Math.sqrt(u * u + e4 * q);
  const w = (e2 * (u + v - q)) / (2 * v);
  const k = Math.sqrt(u + v + w * w) - w;
  const D = (k * rho) / (k + e2);
  const dz = Math.hypot(D, z);
  const lat = 2 * Math.atan2(z, D + dz);
  const h = ((k + e2 - 1) / k) * dz;
  return { lat, lon, h };
}

function bowring(rho: number, z: number, lon: number, ell: Ellipsoid): Geodetic {
  const a = ell.a;
  const e2 = ell.f * (2 - ell.f);
  let lat = Math.atan2(z, rho * (1 - e2));
  let h = 0;
  for (let i = 0; i < 20; i++) {
    const sl = Math.sin(lat);
    const N = a / Math.sqrt(1 - e2 * sl * sl);
    const cl = Math.cos(lat);
    h = Math.abs(cl) > 1e-10 ? rho / cl - N : Math.abs(z) - N * (1 - e2);
    const next = Math.atan2(z, rho * (1 - (e2 * N) / (N + h)));
    if (Math.abs(next - lat) < 1e-15) {
      lat = next;
      break;
    }
    lat = next;
  }
  return { lat, lon, h };
}

/** Local ENU unit vectors at geodetic (lat, lon), expressed in ECEF. */
export function enuBasis(lat: number, lon: number): { e: Vec3; n: Vec3; u: Vec3 } {
  const sl = Math.sin(lat);
  const cl = Math.cos(lat);
  const so = Math.sin(lon);
  const co = Math.cos(lon);
  return {
    e: [-so, co, 0],
    n: [-sl * co, -sl * so, cl],
    u: [cl * co, cl * so, sl],
  };
}

/** Convert an ENU vector at (lat, lon) to ECEF. */
export function enuToEcef(v: Vec3, lat: number, lon: number): Vec3 {
  const { e, n, u } = enuBasis(lat, lon);
  return [
    v[0] * e[0] + v[1] * n[0] + v[2] * u[0],
    v[0] * e[1] + v[1] * n[1] + v[2] * u[1],
    v[0] * e[2] + v[1] * n[2] + v[2] * u[2],
  ];
}

/** Convert an ECEF vector to ENU components at (lat, lon). */
export function ecefToEnu(v: Vec3, lat: number, lon: number): Vec3 {
  const { e, n, u } = enuBasis(lat, lon);
  return [
    v[0] * e[0] + v[1] * e[1] + v[2] * e[2],
    v[0] * n[0] + v[1] * n[1] + v[2] * n[2],
    v[0] * u[0] + v[1] * u[1] + v[2] * u[2],
  ];
}

/**
 * Geodesic surface distance on the ellipsoid between two points using
 * Vincenty's inverse formula (T. Vincenty, Survey Review 23 (1975) 88–93).
 * Accurate to ~0.5 mm; falls back to a spherical estimate for near-antipodal
 * points where the iteration does not converge.
 */
export function geodesicDistance(lat1: number, lon1: number, lat2: number, lon2: number, ell: Ellipsoid): number {
  const a = ell.a;
  const f = ell.f;
  const b = a * (1 - f);
  const L = lon2 - lon1;
  const U1 = Math.atan((1 - f) * Math.tan(lat1));
  const U2 = Math.atan((1 - f) * Math.tan(lat2));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
  let lambda = L;
  let iter = 0;
  let sinSigma = 0, cosSigma = 0, sigma = 0, cos2Alpha = 0, cos2SigmaM = 0;
  for (; iter < 200; iter++) {
    const sinL = Math.sin(lambda), cosL = Math.cos(lambda);
    sinSigma = Math.hypot(cosU2 * sinL, cosU1 * sinU2 - sinU1 * cosU2 * cosL);
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosL;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinL) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cos2Alpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cos2Alpha : 0;
    const C = (f / 16) * cos2Alpha * (4 + f * (4 - 3 * cos2Alpha));
    const prev = lambda;
    lambda = L + (1 - C) * f * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
    if (Math.abs(lambda - prev) < 1e-13) break;
  }
  if (iter >= 200) {
    // Near-antipodal: spherical great-circle with mean radius.
    const R = (2 * a + b) / 3;
    const d = Math.acos(Math.min(1, Math.max(-1, Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(L))));
    return R * d;
  }
  const u2 = (cos2Alpha * (a * a - b * b)) / (b * b);
  const A = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const dSigma =
    B * sinSigma * (cos2SigmaM + (B / 4) * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) - (B / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)));
  return b * A * (sigma - dSigma);
}
