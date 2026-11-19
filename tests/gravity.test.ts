import { describe, expect, it } from 'vitest';
import { DEG, WGS84 } from '../src/physics/constants';
import { geodeticToEcef, enuBasis } from '../src/physics/geodesy';
import { somigliana, normalGravityAtHeight, wgs84NormalField, wgs84NormalZonals } from '../src/physics/gravity/normal';
import { SphericalHarmonicField, zonalField } from '../src/physics/gravity/harmonics';
import { dot, norm, type Vec3 } from '../src/physics/vec3';
import { loadEgm2008, relErr } from './helpers';

const centrifugal = (r: Vec3): Vec3 => [WGS84.omega ** 2 * r[0], WGS84.omega ** 2 * r[1], 0];
const addv = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

describe('WGS84 normal gravity', () => {
  it('Somigliana reproduces the defining equator and pole values', () => {
    expect(somigliana(0)).toBe(WGS84.gammaE);
    expect(Math.abs(somigliana(Math.PI / 2) - WGS84.gammaP)).toBeLessThan(1e-12);
  });

  it('Somigliana with GRS80 constants gives the published γ45 = 9.806 199 203 m/s² (Moritz 1980)', () => {
    const grs80 = { a: 6378137, b: 6356752.3141, e2: 0.0066943800229, gammaE: 9.7803267715, gammaP: 9.8321863685 };
    expect(Math.abs(somigliana(45 * DEG, grs80) - 9.806199203)).toBeLessThan(1e-9);
  });

  it('J2n series reproduces published WGS84 even zonals C̄40..C̄10,0 (NIMA TR8350.2 Table 5.1 normal-field values)', () => {
    const published: Record<number, number> = {
      4: 0.790303733511e-6,
      6: -0.168724961151e-8,
      8: 0.346052468394e-11,
      10: -0.265002225747e-14,
    };
    const z = wgs84NormalZonals(10);
    for (const [n, c] of Object.entries(published)) {
      const Cn = -z.get(Number(n))! / Math.sqrt(2 * Number(n) + 1);
      expect(relErr(Cn, c)).toBeLessThan(1e-9);
    }
  });

  it('harmonic normal field + centrifugal equals Somigliana on the ellipsoid (|Δ| < 2e-9 m/s²) and is perpendicular to it', () => {
    const field = wgs84NormalField(20);
    for (let latDeg = -90; latDeg <= 90; latDeg += 5) {
      const lat = latDeg * DEG;
      const r = geodeticToEcef(lat, 0.7, 0, WGS84);
      const g = addv(field.accel(r), centrifugal(r));
      expect(Math.abs(norm(g) - somigliana(lat))).toBeLessThan(2e-9);
      const { u } = enuBasis(lat, 0.7);
      const cosAngle = -dot(g, u) / norm(g);
      expect(1 - cosAngle).toBeLessThan(1e-15); // angle < ~4e-8 rad
    }
  });

  it('closed-form height formula agrees with exact harmonic field to 2e-6 m/s² up to 20 km', () => {
    const field = wgs84NormalField(20);
    for (const h of [100, 1000, 5000, 10000, 20000]) {
      for (const latDeg of [0, 30, 60, 89]) {
        const r = geodeticToEcef(latDeg * DEG, 0, h, WGS84);
        const g = norm(addv(field.accel(r), centrifugal(r)));
        expect(Math.abs(g - normalGravityAtHeight(latDeg * DEG, h))).toBeLessThan(2e-6);
      }
    }
  });
});

describe('Spherical harmonic engine', () => {
  it('degree-0 field is exactly a point mass', () => {
    const f = zonalField('pm', 4e14, 6.4e6, { 2: 0 });
    const r: Vec3 = [7.1e6, -2.3e6, 3.3e6];
    const a = f.accel(r);
    const rr = norm(r);
    for (let i = 0; i < 3; i++) expect(relErr(a[i], (-4e14 * r[i]) / rr ** 3)).toBeLessThan(1e-14);
    expect(relErr(f.potential(r), 4e14 / rr)).toBeLessThan(1e-14);
  });

  it('J2 acceleration matches the closed-form J2 perturbation', () => {
    const GM = WGS84.GM, R = WGS84.a, J2 = 1.08262998905e-3;
    const f = zonalField('j2', GM, R, { 2: J2 });
    const r: Vec3 = [4.2e6, 3.1e6, 4.9e6];
    const rr = norm(r);
    const z2 = (r[2] / rr) ** 2;
    const k = (-1.5 * J2 * GM * R * R) / rr ** 5;
    const exact: Vec3 = [
      (-GM * r[0]) / rr ** 3 + k * r[0] * (1 - 5 * z2),
      (-GM * r[1]) / rr ** 3 + k * r[1] * (1 - 5 * z2),
      (-GM * r[2]) / rr ** 3 + k * r[2] * (3 - 5 * z2),
    ];
    const a = f.accel(r);
    for (let i = 0; i < 3; i++) expect(Math.abs(a[i] - exact[i])).toBeLessThan(1e-13);
  });

  it('EGM2008 (n=360) analytic gradient equals finite-difference gradient of the potential', () => {
    const egm = loadEgm2008();
    const pts: [number, number, number][] = [
      [27.9881, 86.925, 8848], // Everest
      [-33.9, 18.4, 0],
      [89.9999, 10, 0], // near pole
      [-89.5, -140, 2000],
      [0, 0, 400e3],
      [11.35, 142.2, 0],
    ];
    for (const [la, lo, h] of pts) {
      const r = geodeticToEcef(la * DEG, lo * DEG, h, WGS84);
      const a = egm.accel(r);
      const d = 5;
      for (let i = 0; i < 3; i++) {
        const rp: Vec3 = [...r] as Vec3; rp[i] += d;
        const rm: Vec3 = [...r] as Vec3; rm[i] -= d;
        const fd = (egm.potential(rp) - egm.potential(rm)) / (2 * d);
        expect(Math.abs(fd - a[i])).toBeLessThan(5e-8);
      }
    }
  });

  it('is finite and continuous exactly at the poles', () => {
    const egm = loadEgm2008();
    for (const z of [WGS84.a * (1 - WGS84.f), -WGS84.a * (1 - WGS84.f)]) {
      const a0 = egm.accel([0, 0, z]);
      const a1 = egm.accel([1e-3, 1e-3, z]);
      for (let i = 0; i < 3; i++) {
        expect(Number.isFinite(a0[i])).toBe(true);
        expect(Math.abs(a0[i] - a1[i])).toBeLessThan(1e-8);
      }
    }
  });
});

describe('EGM2008 physical validation', () => {
  const egm = loadEgm2008();
  const normal = wgs84NormalField(20);
  const U0 = 62636851.7146; // WGS84 normal potential on the ellipsoid [m^2/s^2], TR8350.2 Table 3.4
  /** Geoid height via Bruns' formula N = T/γ evaluated on the ellipsoid. */
  const geoid = (latDeg: number, lonDeg: number) => {
    const lat = latDeg * DEG, lon = lonDeg * DEG;
    const r = geodeticToEcef(lat, lon, 0, WGS84);
    const T = egm.potential(r) - normal.potential(r);
    // zero-degree term from GM difference and W0 - U0 is folded into the -0.41 m WGS84 correction (Pavlis et al. 2012)
    return T / somigliana(lat) - 0.41;
  };

  it('normal potential at the ellipsoid equals the published U0', () => {
    const r = geodeticToEcef(37 * DEG, 0, 0, WGS84);
    const W = normal.potential(r) + 0.5 * WGS84.omega ** 2 * (r[0] ** 2 + r[1] ** 2);
    expect(Math.abs(W - U0)).toBeLessThan(1e-3);
  });

  it('geoid height at (0°,0°) ≈ 17.2 m (EGM2008 reference value 17.16 m)', () => {
    expect(Math.abs(geoid(0, 0) - 17.16)).toBeLessThan(1.0);
  });

  it('Indian Ocean geoid low reaches ≈ −106 m near (4.7°N, 78.8°E)', () => {
    let min = Infinity;
    for (let la = 0; la <= 10; la += 0.5) for (let lo = 74; lo <= 84; lo += 0.5) min = Math.min(min, geoid(la, lo));
    expect(min).toBeGreaterThan(-110);
    expect(min).toBeLessThan(-102);
  });

  it('New Guinea geoid high reaches ≈ +85 m', () => {
    let max = -Infinity;
    for (let la = -10; la <= 0; la += 0.5) for (let lo = 140; lo <= 150; lo += 0.5) max = Math.max(max, geoid(la, lo));
    expect(max).toBeGreaterThan(80);
    expect(max).toBeLessThan(90);
  });

  it('surface gravity disturbances stay within the physically known ±0.006 m/s² envelope', () => {
    let maxAbs = 0;
    for (let la = -85; la <= 85; la += 5)
      for (let lo = -180; lo < 180; lo += 5) {
        const lat = la * DEG, lon = lo * DEG;
        const r = geodeticToEcef(lat, lon, 0, WGS84);
        const g = norm(addv(egm.accel(r), centrifugal(r)));
        maxAbs = Math.max(maxAbs, Math.abs(g - somigliana(lat)));
      }
    expect(maxAbs).toBeLessThan(0.006);
    expect(maxAbs).toBeGreaterThan(0.0005);
  });

  it('class is exported', () => {
    expect(egm).toBeInstanceOf(SphericalHarmonicField);
  });
});
