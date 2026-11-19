/**
 * Synthesises global grids from EGM2008 (degree 360) on the WGS84 ellipsoid:
 *   - gravity disturbance δg = |g(EGM2008) + centrifugal| − γ(Somigliana)   [mGal]
 *   - geoid undulation N = T/γ − 0.41 m (Bruns; WGS84 zero-degree term)    [m]
 *   - surface gravity |g| on the ellipsoid                                    [m/s²]
 *
 * Uses row-wise synthesis (Legendre functions once per latitude, then a
 * Fourier sum in longitude), equivalent to point-wise evaluation with
 * SphericalHarmonicField (checked at random points at the end).
 *
 * Output public/data/gravity_grid.bin:
 *   int32 nLon, int32 nLat, float64 lat0, lon0, dLat, dLon,
 *   float32 δg[nLat*nLon], float32 N[nLat*nLon], float32 g[nLat*nLon]   (row = latitude, south → north)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCoefficientFile, triIndex } from '../src/physics/gravity/harmonics';
import { WGS84, DEG } from '../src/physics/constants';
import { geodeticToEcef } from '../src/physics/geodesy';
import { somigliana, wgs84NormalZonals } from '../src/physics/gravity/normal';

const STEP = 0.5;
const nLon = Math.round(360 / STEP);
const nLat = Math.round(180 / STEP) + 1;
const N = 360;

const buf = readFileSync(resolve('public/data/egm2008_n360.bin'));
const egm = parseCoefficientFile('EGM2008', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const dv = new DataView(buf.buffer, buf.byteOffset);
const GM = dv.getFloat64(8, true);
const R = dv.getFloat64(16, true);
const count = triIndex(N, N) + 1;
const C = new Float64Array(buf.buffer.slice(buf.byteOffset + 24, buf.byteOffset + 24 + count * 8));
const S = new Float64Array(buf.buffer.slice(buf.byteOffset + 24 + count * 8, buf.byteOffset + 24 + count * 16));

// normal-field coefficients rescaled to EGM2008's GM and R, for the disturbing potential T
const dC = Float64Array.from(C);
dC[0] -= WGS84.GM / GM;
for (const [n, Jn] of wgs84NormalZonals(20)) dC[triIndex(n, 0)] -= ((-Jn / Math.sqrt(2 * n + 1)) * (WGS84.GM / GM)) * (WGS84.a / R) ** n;

// Legendre recursion coefficients (same as SphericalHarmonicField)
const anm = new Float64Array(count), bnm = new Float64Array(count), cnm = new Float64Array(count);
const diag = new Float64Array(N + 2);
diag[0] = 1; diag[1] = Math.sqrt(3);
for (let m = 2; m <= N + 1; m++) diag[m] = Math.sqrt((2 * m + 1) / (2 * m)) * diag[m - 1];
for (let n = 0; n <= N; n++) for (let m = 0; m <= n; m++) {
  const k = triIndex(n, m);
  if (n >= m + 2) {
    anm[k] = Math.sqrt(((2 * n - 1) * (2 * n + 1)) / ((n - m) * (n + m)));
    bnm[k] = Math.sqrt(((2 * n + 1) * (n + m - 1) * (n - m - 1)) / ((n - m) * (n + m) * (2 * n - 3)));
  }
  cnm[k] = m === 0 ? Math.sqrt((n * (n + 1)) / 2) : Math.sqrt((n - m) * (n + m + 1));
}
const Q = new Float64Array(count + N + 2);

const dg = new Float32Array(nLat * nLon);
const geoid = new Float32Array(nLat * nLon);
const gsurf = new Float32Array(nLat * nLon);
const lat0 = -90, lon0 = -180;

const t0 = Date.now();
for (let j = 0; j < nLat; j++) {
  const latDeg = lat0 + j * STEP;
  const lat = latDeg * DEG;
  const r3 = geodeticToEcef(lat, 0, 0, WGS84);
  const rr = Math.hypot(r3[0], r3[2]);
  const t = r3[2] / rr, u = Math.abs(r3[0]) / rr;
  // Legendre
  for (let m = 0; m <= N; m++) {
    Q[triIndex(m, m)] = diag[m];
    if (m + 1 <= N) Q[triIndex(m + 1, m)] = Math.sqrt(2 * m + 3) * t * diag[m];
    for (let n = m + 2; n <= N; n++) {
      const k = triIndex(n, m);
      Q[k] = anm[k] * t * Q[triIndex(n - 1, m)] - bnm[k] * Q[triIndex(n - 2, m)];
    }
  }
  const q = R / rr;
  const rho = new Float64Array(N + 1);
  rho[0] = 1;
  for (let n = 1; n <= N; n++) rho[n] = rho[n - 1] * q;
  // per-order coefficient sums: [Ar, Br, Aphi, Bphi, Alam, Blam, AT, BT]
  const sums = new Float64Array((N + 1) * 8);
  let um = 1, um1 = 0;
  for (let m = 0; m <= N; m++) {
    let ar = 0, br = 0, ap1 = 0, bp1 = 0, ap2 = 0, bp2 = 0, at = 0, bt = 0;
    for (let n = m; n <= N; n++) {
      const k = triIndex(n, m);
      const rq = rho[n] * Q[k];
      ar += (n + 1) * rq * C[k]; br += (n + 1) * rq * S[k];
      const qn = m + 1 <= n ? Q[k + 1] : 0;
      ap1 += rho[n] * cnm[k] * qn * C[k]; bp1 += rho[n] * cnm[k] * qn * S[k];
      ap2 += rq * C[k]; bp2 += rq * S[k];
      at += rq * dC[k]; bt += rq * S[k];
    }
    const o = m * 8;
    sums[o] = um * ar; sums[o + 1] = um * br;
    const fphi1 = um * u, fphi2 = m > 0 ? m * t * um1 : 0;
    sums[o + 2] = fphi1 * ap1 - fphi2 * ap2; sums[o + 3] = fphi1 * bp1 - fphi2 * bp2;
    const flam = m > 0 ? m * um1 : 0;
    sums[o + 4] = flam * ap2; sums[o + 5] = flam * bp2; // coefficients of (S cos − C sin) handled below
    sums[o + 6] = um * at; sums[o + 7] = um * bt;
    um1 = um; um *= u;
  }
  const k0 = GM / (rr * rr);
  const gam = somigliana(lat);
  for (let i = 0; i < nLon; i++) {
    const lon = (lon0 + i * STEP) * DEG;
    let sr = 0, sphi = 0, slam = 0, sT = 0;
    for (let m = 0; m <= N; m++) {
      const c = Math.cos(m * lon), s = Math.sin(m * lon);
      const o = m * 8;
      sr += sums[o] * c + sums[o + 1] * s;
      sphi += sums[o + 2] * c + sums[o + 3] * s;
      slam += sums[o + 5] * c - sums[o + 4] * s; // Σ m u^{m-1} Q (S cos − C sin)
      sT += sums[o + 6] * c + sums[o + 7] * s;
    }
    const w2 = WGS84.omega ** 2;
    const gr = -k0 * sr + w2 * rr * u * u;
    const gphi = k0 * sphi - w2 * rr * u * t;
    const glam = k0 * slam;
    const g = Math.hypot(gr, gphi, glam);
    const idx = j * nLon + i;
    gsurf[idx] = g;
    dg[idx] = (g - gam) * 1e5;
    geoid[idx] = ((GM / rr) * sT) / gam - 0.41;
  }
  if (j % 60 === 0) console.log(`row ${j}/${nLat}  ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// spot-check against the point-wise engine
let worst = 0; let worstAt = "";
for (let k = 0; k < 40; k++) {
  const j = Math.floor(Math.random() * nLat), i = Math.floor(Math.random() * nLon);
  const lat = (lat0 + j * STEP) * DEG, lon = (lon0 + i * STEP) * DEG;
  const r = geodeticToEcef(lat, lon, 0, WGS84);
  const a = egm.accel(r);
  const g = Math.hypot(a[0] + WGS84.omega ** 2 * r[0], a[1] + WGS84.omega ** 2 * r[1], a[2]);
  const d = Math.abs(g - gsurf[j * nLon + i]); if (d > worst) { worst = d; worstAt = `j=${j} i=${i} g=${g} grid=${gsurf[j * nLon + i]}`; }
}
console.log(`max |row synthesis − point evaluation| = ${worst.toExponential(2)} m/s²`, worstAt);
// grid is stored as float32 (ulp ≈ 9.5e-7 at 9.8 m/s²)
if (worst > 1e-6) throw new Error('Row synthesis disagrees with point evaluation');

const header = new ArrayBuffer(8 + 32);
const hv = new DataView(header);
hv.setInt32(0, nLon, true); hv.setInt32(4, nLat, true);
hv.setFloat64(8, lat0, true); hv.setFloat64(16, lon0, true); hv.setFloat64(24, STEP, true); hv.setFloat64(32, STEP, true);
const out = Buffer.concat([Buffer.from(header), Buffer.from(dg.buffer), Buffer.from(geoid.buffer), Buffer.from(gsurf.buffer)]);
writeFileSync(resolve('public/data/gravity_grid.bin'), out);
let mn = Infinity, mx = -Infinity, gmn = Infinity, gmx = -Infinity, nmn = Infinity, nmx = -Infinity;
for (let k = 0; k < dg.length; k++) {
  mn = Math.min(mn, dg[k]); mx = Math.max(mx, dg[k]);
  gmn = Math.min(gmn, gsurf[k]); gmx = Math.max(gmx, gsurf[k]);
  nmn = Math.min(nmn, geoid[k]); nmx = Math.max(nmx, geoid[k]);
}
console.log(`δg ${mn.toFixed(0)}…${mx.toFixed(0)} mGal | N ${nmn.toFixed(1)}…${nmx.toFixed(1)} m | g ${gmn.toFixed(5)}…${gmx.toFixed(5)} m/s²`);
console.log(`wrote ${(out.length / 1e6).toFixed(2)} MB`);
