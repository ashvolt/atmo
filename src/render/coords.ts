import * as THREE from 'three';
import type { Vec3 } from '../physics/vec3';

/** ECEF [m] → globe scene [km], three.js Y-up: (x, z, −y). */
export const ecefToScene = (r: Vec3 | ArrayLike<number>, out = new THREE.Vector3()) =>
  out.set(r[0] / 1000, r[2] / 1000, -r[1] / 1000);

export const sceneToEcef = (v: THREE.Vector3): Vec3 => [v.x * 1000, -v.z * 1000, v.y * 1000];

/** local ENU [m] → local scene (X east, Y up, Z south). */
export const enuToLocal = (e: number, n: number, u: number, out = new THREE.Vector3()) => out.set(e, u, -n);

/**
 * Sun direction in ECEF (unit) for a UTC date. NOAA / Meeus low-precision
 * solar coordinates (≈ 0.01°) and IAU-82 GMST.
 */
export function sunDirectionECEF(date: Date): Vec3 {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = ((280.46 + 0.9856474 * n) % 360) * (Math.PI / 180);
  const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
  const lambda = L + (1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * (Math.PI / 180);
  const eps = (23.439 - 0.0000004 * n) * (Math.PI / 180);
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const T = n / 36525;
  const gmstDeg = 280.46061837 + 360.98564736629 * n + 0.000387933 * T * T;
  const gmst = ((gmstDeg % 360) + 360) % 360 * (Math.PI / 180);
  const ha = ra - gmst; // longitude of the sub-solar point
  return [Math.cos(dec) * Math.cos(ha), Math.cos(dec) * Math.sin(ha), Math.sin(dec)];
}

/** Earth rotation angle relative to an inertial frame (for the "inertial view"). */
export function earthRotationAngle(t: number, omega: number) {
  return omega * t;
}

export const fmt = {
  num(v: number, digits = 3): string {
    if (!Number.isFinite(v)) return v > 0 ? '∞' : '—';
    const a = Math.abs(v);
    if (a !== 0 && (a < 1e-3 || a >= 1e7)) return v.toExponential(digits - 1);
    return v.toLocaleString('en-US', { maximumFractionDigits: a < 10 ? digits : a < 1000 ? Math.max(0, digits - 1) : 0 });
  },
  len(m: number): string {
    const a = Math.abs(m);
    if (a >= 100000) return `${fmt.num(m / 1000, 4)} km`;
    if (a >= 1000) return `${(m / 1000).toFixed(2)} km`;
    if (a >= 10) return `${m.toFixed(1)} m`;
    if (a >= 0.1) return `${m.toFixed(2)} m`;
    return `${(m * 100).toFixed(1)} cm`;
  },
  time(s: number): string {
    if (!Number.isFinite(s)) return '—';
    if (s < 60) return `${s.toFixed(2)} s`;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m ${sec.toFixed(0).padStart(2, '0')}s` : `${m}m ${sec.toFixed(1).padStart(4, '0')}s`;
  },
  speed(v: number): string {
    return v >= 1000 ? `${(v / 1000).toFixed(2)} km/s` : `${v.toFixed(v < 10 ? 2 : 1)} m/s`;
  },
  energy(j: number): string {
    if (j >= 4.184e12) return `${(j / 4.184e12).toFixed(2)} kt TNT`;
    if (j >= 4.184e9) return `${(j / 4.184e9).toFixed(2)} t TNT`;
    if (j >= 1e6) return `${(j / 1e6).toFixed(2)} MJ`;
    if (j >= 1e3) return `${(j / 1e3).toFixed(2)} kJ`;
    return `${j.toFixed(j < 10 ? 3 : 1)} J`;
  },
  latlon(lat: number, lon: number): string {
    return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}  ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
  },
};
