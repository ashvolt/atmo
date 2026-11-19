/**
 * Aerodynamic heating.
 *
 * Stagnation-point convective heat flux, Sutton & Graves (NASA TR R-376, 1971):
 *     q_s = k · sqrt(ρ / r_n) · V³        [W/m²]
 * with k = 1.7415e-4 kg^0.5/m for Earth air (Mars CO2: 1.9027e-4, H2/He: 6.556e-5).
 *
 * Valid for hypersonic continuum flow. To keep the model physical at low
 * speed we scale by (1 − T_w / T_r), where T_r is the adiabatic recovery
 * temperature (turbulent recovery factor 0.89), so a hot body cools when the
 * flow is slow. In free-molecular flow the heat flux tends to the
 * free-molecular limit q_fm = ½ α ρ V³ (accommodation α = 1), and we bridge
 * with the same Knudsen weight as drag.
 */
export function suttonGraves(k: number, rho: number, noseRadius: number, V: number): number {
  if (rho <= 0 || V <= 0) return 0;
  return k * Math.sqrt(rho / noseRadius) * V * V * V;
}

export function recoveryTemperature(Tinf: number, gamma: number, M: number, r = 0.89): number {
  return Tinf * (1 + (r * (gamma - 1) * M * M) / 2);
}

/** Free-molecular energy flux limit (full accommodation). */
export function freeMolecularHeatFlux(rho: number, V: number): number {
  return 0.5 * rho * V * V * V;
}

/** Fraction of stagnation heat flux averaged over the frontal area of a blunt body (continuum). */
export const AVERAGE_TO_STAGNATION = 0.5;
/**
 * Free-molecular heat-transfer coefficient Λ (fraction of the incident kinetic
 * energy flux ½ρV³ per frontal area deposited in the body). Λ ≈ 1 for small
 * meteoroids at high altitude (Bronshten 1983; Ceplecha et al. 1998).
 */
export const LAMBDA_FM = 1;
