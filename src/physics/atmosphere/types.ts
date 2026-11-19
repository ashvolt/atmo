export interface AtmosphereState {
  /** kinetic temperature [K] */
  T: number;
  /** pressure [Pa] */
  p: number;
  /** mass density [kg/m^3] */
  rho: number;
  /** speed of sound [m/s] */
  a: number;
  /** dynamic viscosity [Pa·s] */
  mu: number;
  /** mean free path [m] */
  mfp: number;
  /** mean molar mass [kg/kmol] */
  M: number;
  /** ratio of specific heats used for the speed of sound */
  gamma: number;
}

export interface Atmosphere {
  readonly name: string;
  /** Altitude above which density is treated as zero (top of model) [m]. */
  readonly top: number;
  /** Atmospheric state at geometric altitude z above the reference surface (MSL / datum) [m]. */
  at(z: number): AtmosphereState;
}

export const VACUUM_STATE: AtmosphereState = {
  T: 2.7,
  p: 0,
  rho: 0,
  a: 1,
  mu: 1e-5,
  mfp: Infinity,
  M: 1,
  gamma: 1.4,
};

export class Vacuum implements Atmosphere {
  readonly name = 'Vacuum';
  readonly top = 0;
  at(): AtmosphereState {
    return VACUUM_STATE;
  }
}

/** Isothermal exponential atmosphere ρ = ρ0 exp(−z/H) (analytic test cases, e.g. Allen–Eggers entry). */
export class ExponentialAtmosphere implements Atmosphere {
  readonly name: string;
  readonly top: number;
  constructor(
    readonly rho0: number,
    readonly H: number,
    readonly T = 288.15,
    readonly M = 28.9644,
  ) {
    this.name = `Exponential (ρ0=${rho0}, H=${H} m)`;
    this.top = H * 60;
  }
  at(z: number): AtmosphereState {
    const rho = this.rho0 * Math.exp(-z / this.H);
    const p = (rho * 8314.32 * this.T) / this.M;
    const n = (p * 6.022169e26) / (8314.32 * this.T);
    return {
      T: this.T,
      p,
      rho,
      a: Math.sqrt((1.4 * 8314.32 * this.T) / this.M),
      mu: (1.458e-6 * this.T ** 1.5) / (this.T + 110.4),
      mfp: n > 0 ? 1 / (Math.SQRT2 * Math.PI * 3.65e-10 ** 2 * n) : Infinity,
      M: this.M,
      gamma: 1.4,
    };
  }
}
