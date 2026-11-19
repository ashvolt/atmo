import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EarthAtmosphere, US76, US76_LAYER_BASES, ussa1976 } from '../src/physics/atmosphere/ussa1976';
import { relErr } from './helpers';

const ref = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/ussa1976_reference.json'), 'utf8'));

describe('USSA-1976 lower atmosphere (analytic)', () => {
  it('layer-base pressures equal NASA-TM-X-74335 Table 4 values', () => {
    const published = [101325.0, 22632.06, 5474.889, 868.0187, 110.9063, 66.93887, 3.95642, 0.3733836];
    published.forEach((p, i) => expect(relErr(US76_LAYER_BASES.Pb[i], p)).toBeLessThan(2e-6));
    const publishedT = [288.15, 216.65, 216.65, 228.65, 270.65, 270.65, 214.65, 186.946];
    publishedT.forEach((t, i) => expect(Math.abs(US76_LAYER_BASES.Tb[i] - t)).toBeLessThan(1e-3));
  });

  it('sea-level values equal the published standard', () => {
    const s = ussa1976(0);
    expect(s.T).toBe(288.15);
    expect(s.p).toBe(101325);
    expect(relErr(s.rho, 1.225)).toBeLessThan(2e-5);
    expect(relErr(s.a, 340.294)).toBeLessThan(2e-6);
    expect(relErr(s.mu, 1.7894e-5)).toBeLessThan(5e-5);
    expect(relErr(s.mfp, 6.6328e-8)).toBeLessThan(2e-4);
  });

  it('matches the ussa1976 reference implementation from 0 to 80 km (T,p,ρ to 1e-5)', () => {
    const { z, T, p, rho } = ref.lower;
    for (let i = 0; i < z.length; i++) {
      if (z[i] > 80000) continue;
      const s = ussa1976(z[i]);
      expect(relErr(s.T, T[i])).toBeLessThan(1e-6);
      expect(relErr(s.p, p[i])).toBeLessThan(1e-5);
      expect(relErr(s.rho, rho[i])).toBeLessThan(1e-5);
    }
  });
});

describe('USSA-1976 upper atmosphere (tabulated)', () => {
  it('is continuous at the 80 km analytic/table seam', () => {
    const a = ussa1976(80000 - 1e-6);
    const b = ussa1976(80000 + 1e-6);
    expect(relErr(a.rho, b.rho)).toBeLessThan(1e-5);
    expect(relErr(a.T, b.T)).toBeLessThan(1e-6);
  });

  it('reproduces every published density anchor exactly (86–1000 km)', () => {
    for (const [zk, rho] of Object.entries(ref.published_rho as Record<string, number>)) {
      expect(relErr(ussa1976(Number(zk) * 1000).rho, rho)).toBeLessThan(1e-7);
    }
  });

  it('reproduces published kinetic temperatures', () => {
    const T: Record<number, number> = { 100: 195.08, 110: 240.0, 120: 360.0, 150: 634.39, 200: 854.56, 300: 976.01, 400: 995.83, 500: 999.24, 1000: 1000.0 };
    for (const [zk, t] of Object.entries(T)) expect(Math.abs(ussa1976(Number(zk) * 1000).T - t)).toBeLessThan(0.01);
  });

  it('interpolation between table nodes is within 0.1 % of the full model', () => {
    const { z_km, T, rho } = ref.mid;
    let worst = 0;
    for (let i = 0; i < z_km.length; i++) {
      const s = ussa1976(z_km[i] * 1000);
      worst = Math.max(worst, relErr(s.rho, rho[i]));
      expect(relErr(s.T, T[i])).toBeLessThan(2e-3);
    }
    expect(worst).toBeLessThan(1e-3);
  });

  it('density decreases monotonically from −5 km to 2000 km', () => {
    let prev = Infinity;
    for (let z = -5000; z <= 2_000_000; z += 250) {
      const r = ussa1976(z).rho;
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });
});

describe('Weather overrides', () => {
  it('hydrostatic integrator reproduces the analytic standard when only pMSL is scaled', () => {
    const k = 1.02;
    const atm = new EarthAtmosphere({ dT: 0, pMSL: US76.P0 * k, RH: 0 });
    for (const z of [-1500, 0, 3000, 11000, 15000, 25000, 45000]) {
      expect(relErr(atm.at(z).p, ussa1976(z).p * k)).toBeLessThan(1e-7);
    }
  });

  it('a +15 K day at sea level has ρ = p M0 / (R* T)', () => {
    const atm = new EarthAtmosphere({ dT: 15, pMSL: US76.P0, RH: 0 });
    const s = atm.at(0);
    expect(s.T).toBeCloseTo(303.15, 10);
    expect(relErr(s.rho, (101325 * US76.M0) / (US76.Rstar * 303.15))).toBeLessThan(1e-12);
    // warmer column -> pressure decays more slowly
    expect(atm.at(10000).p).toBeGreaterThan(ussa1976(10000).p);
  });

  it('humid air is lighter than dry air at the same pressure', () => {
    const dry = new EarthAtmosphere({ dT: 15, pMSL: US76.P0, RH: 0 }).at(0);
    const wet = new EarthAtmosphere({ dT: 15, pMSL: US76.P0, RH: 1 }).at(0);
    const ratio = wet.rho / dry.rho;
    // e_s(30 °C) ≈ 4246 Pa -> ρ drops by e(1 − Mv/Md)/p ≈ 1.6 %
    expect(ratio).toBeGreaterThan(0.982);
    expect(ratio).toBeLessThan(0.986);
  });

  it('is continuous at the 50 km integrated-table seam', () => {
    const atm = new EarthAtmosphere({ dT: -20, pMSL: 98000, RH: 0.5 });
    expect(relErr(atm.at(50000 - 1e-3).p, atm.at(50000 + 1e-3).p)).toBeLessThan(1e-6);
  });
});
