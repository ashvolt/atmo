/**
 * Non-terrestrial atmospheres.
 */
import { interpLinear } from '../interp';
import type { Atmosphere, AtmosphereState } from './types';

const RSTAR = 8314.462618; // CODATA 2018 molar gas constant [J/(kmol K)]

function sutherlandGeneric(mu0: number, T0: number, S: number, T: number) {
  return mu0 * (T / T0) ** 1.5 * ((T0 + S) / (T + S));
}

/**
 * Mars: NASA Glenn Research Center Mars atmosphere model (fit to Mars Global
 * Surveyor data, 1996), datum = MOLA areoid.
 *   h < 7000 m : T = −31 − 0.000998 h  [°C]
 *   h ≥ 7000 m : T = −23.4 − 0.00222 h [°C]
 *   p = 0.699 · exp(−0.00009 h) [kPa],  ρ = p / (0.1921 (T + 273.1))
 * T is floored at 140 K (observed mesospheric minimum; Viking/Pathfinder
 * entry profiles), and the model is cut off at 200 km.
 * CO2: γ = 1.29, M = 43.34 kg/kmol (95 % CO2, 2.8 % N2, 2 % Ar).
 */
export class MarsAtmosphere implements Atmosphere {
  readonly name = 'Mars (NASA Glenn MGS model)';
  readonly top = 200_000;
  at(h: number): AtmosphereState {
    const z = Math.max(h, -8000);
    let Tc = z < 7000 ? -31 - 0.000998 * z : -23.4 - 0.00222 * z;
    let T = Tc + 273.15;
    if (T < 140) {
      T = 140;
      Tc = T - 273.15;
    }
    const p = 699 * Math.exp(-0.00009 * z);
    const rho = p / 1000 / (0.1921 * (Tc + 273.1));
    const M = 43.34;
    const gamma = 1.29;
    const mu = sutherlandGeneric(1.37e-5, 273, 222, T);
    const n = (p * 6.02214076e26) / (RSTAR * T);
    const mfp = 1 / (Math.SQRT2 * Math.PI * (4.0e-10) ** 2 * n);
    return { T, p, rho, a: Math.sqrt((gamma * RSTAR * T) / M), mu, mfp, M, gamma };
  }
}

/**
 * Jupiter, referenced to the 1-bar level (z = 0).
 *  Above 1 bar: Galileo Probe ASI temperature profile (A. Seiff et al.,
 *    J. Geophys. Res. 103 (1998) 22857): tropopause ≈ 110 K near 0.1 bar,
 *    warm thermosphere above.
 *  Below 1 bar: dry adiabat T = 166 K · (p / 1 bar)^κ, with κ = 0.3056 so that
 *    T(22 bar) = 427 K, the probe's last measurement.
 * Pressure follows from hydrostatic integration with the planet's gravity, so
 * p, ρ, T are mutually consistent. H2/He: M = 2.30 kg/kmol, γ = 1.43.
 */
const JUP_Z_KM = [0, 25, 50, 100, 150, 200, 300, 400, 600, 1000];
const JUP_T = [166, 125, 112, 116, 145, 160, 170, 200, 400, 900];
const JUP_KAPPA = Math.log(427 / 166) / Math.log(22);

export class JupiterAtmosphere implements Atmosphere {
  readonly name = 'Jupiter (Galileo probe ASI profile)';
  readonly top = 1_000_000;
  private readonly z0 = -150_000;
  private readonly dz = 250;
  private readonly lnp: Float64Array;
  private readonly M = 2.3;
  private readonly gamma = 1.43;

  constructor(g1bar = 24.79, radius = 71_492_000) {
    const n = Math.round((1_000_000 - this.z0) / this.dz) + 1;
    this.lnp = new Float64Array(n);
    const i0 = Math.round(-this.z0 / this.dz);
    this.lnp[i0] = Math.log(1e5);
    const f = (z: number, lnp: number) => {
      const g = g1bar * (radius / (radius + z)) ** 2;
      return (-g * this.M) / (RSTAR * this.tempAt(z, lnp));
    };
    const step = (z: number, y: number, h: number) => {
      const k1 = f(z, y), k2 = f(z + h / 2, y + (h * k1) / 2), k3 = f(z + h / 2, y + (h * k2) / 2), k4 = f(z + h, y + h * k3);
      return y + (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    };
    for (let i = i0; i < n - 1; i++) this.lnp[i + 1] = step(this.z0 + i * this.dz, this.lnp[i], this.dz);
    for (let i = i0; i > 0; i--) this.lnp[i - 1] = step(this.z0 + i * this.dz, this.lnp[i], -this.dz);
  }

  /** temperature from altitude (above 1 bar) or from pressure (adiabat below 1 bar) */
  private tempAt(z: number, lnp: number) {
    if (z >= 0) return interpLinear(JUP_Z_KM, JUP_T, z / 1000);
    return 166 * Math.exp(JUP_KAPPA * (lnp - Math.log(1e5)));
  }

  at(h: number): AtmosphereState {
    const z = Math.min(Math.max(h, this.z0), 1_000_000);
    const x = (z - this.z0) / this.dz;
    const i = Math.min(Math.floor(x), this.lnp.length - 2);
    const w = x - i;
    const lnp = this.lnp[i] + w * (this.lnp[i + 1] - this.lnp[i]);
    const p = Math.exp(lnp);
    const T = this.tempAt(z, lnp);
    const rho = (p * this.M) / (RSTAR * T);
    const mu = sutherlandGeneric(8.76e-6, 293.85, 72, T); // H2 dominated
    const n = (p * 6.02214076e26) / (RSTAR * T);
    const mfp = 1 / (Math.SQRT2 * Math.PI * (2.7e-10) ** 2 * n);
    return { T, p, rho, a: Math.sqrt((this.gamma * RSTAR * T) / this.M), mu, mfp, M: this.M, gamma: this.gamma };
  }
}
