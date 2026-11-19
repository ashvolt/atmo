/**
 * Physical constants. Every value cites its defining source.
 */

/** CODATA 2018 Newtonian constant of gravitation [m^3 kg^-1 s^-2]. */
export const G = 6.6743e-11;
/** CODATA 2018 Stefan–Boltzmann constant [W m^-2 K^-4]. */
export const SIGMA_SB = 5.670374419e-8;
/** CODATA 2018 Boltzmann constant [J/K] (exact). */
export const K_BOLTZMANN = 1.380649e-23;
/** Standard gravity, CGPM 1901 (exact) [m/s^2]. */
export const G0 = 9.80665;

/**
 * WGS 84 defining and derived parameters.
 * Source: NIMA TR8350.2, 3rd ed. (2000), Tables 3.1, 3.3, 3.4.
 */
export const WGS84 = {
  a: 6378137.0, // semi-major axis [m]
  f: 1 / 298.257223563, // flattening
  GM: 3.986004418e14, // [m^3/s^2], includes atmosphere
  omega: 7.292115e-5, // nominal mean angular velocity [rad/s]
  gammaE: 9.7803253359, // normal gravity at equator [m/s^2]
  gammaP: 9.8321849378, // normal gravity at poles [m/s^2]
  C20: -0.484166774985e-3, // fully normalized 2nd degree zonal of the normal field
} as const;

export const WGS84_B = WGS84.a * (1 - WGS84.f); // 6356752.3142 m
export const WGS84_E2 = WGS84.f * (2 - WGS84.f); // first eccentricity squared

export interface Ellipsoid {
  a: number; // equatorial radius [m]
  f: number; // flattening
}

export const DEG = Math.PI / 180;
