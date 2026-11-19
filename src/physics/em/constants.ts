/**
 * Electromagnetic and acoustic constants. CODATA 2018 recommended values.
 * Source: E. Tiesinga et al., Rev. Mod. Phys. 93 (2021) 025010.
 */

/** Vacuum magnetic permeability [N/A²]. Measured since the 2019 SI redefinition. */
export const MU0 = 1.25663706212e-6;
/** Vacuum electric permittivity [F/m]. */
export const EPS0 = 8.8541878128e-12;
/** Speed of light in vacuum [m/s] (exact). */
export const C_LIGHT = 299792458;
/** Elementary charge [C] (exact). */
export const E_CHARGE = 1.602176634e-19;
/** Electron mass [kg]. */
export const M_ELECTRON = 9.1093837015e-31;

/**
 * Dielectric strength of dry air at 1 atm, 20 °C, 1 cm uniform gap [V/m].
 * Paschen-curve value; it rises steeply below ~1 mm gaps (Paschen minimum
 * 327 V at p·d = 7.5 Torr·mm) and falls with humidity and sharp electrodes.
 * Source: J. M. Meek & J. D. Craggs, "Electrical Breakdown of Gases" (1978).
 */
export const AIR_BREAKDOWN = 3.0e6;

/** Speed of sound in air at 20 °C [m/s] (USSA-1976 gives 343.2 m/s at 293.15 K). */
export const C_AIR_20 = 343.2;
/** Air density at 20 °C, 1 atm [kg/m³]. */
export const RHO_AIR_20 = 1.2041;

/**
 * Reference magnetic fields actually achieved, for the feasibility verdict.
 * Each is the highest independently reported value of its kind.
 */
export const FIELD_RECORDS = {
  /** surface field of a strong NdFeB magnet [T] */
  ndfebSurface: 0.6,
  /** clinical MRI [T] */
  mri: 3.0,
  /** iron-yoke laboratory electromagnet, saturation-limited [T] */
  ironYoke: 2.2,
  /** large-bore superconducting magnet (e.g. 20 T NMR) [T] */
  superconducting: 23.5,
  /** resistive Bitter magnet, NHMFL 41.4 T (2017) [T] */
  resistive: 41.4,
  /** hybrid resistive + superconducting, NHMFL 45.5 T (2019) [T] */
  hybrid: 45.5,
  /** non-destructive pulsed magnet, NHMFL 100.75 T (2012) [T] */
  pulsedNonDestructive: 100.75,
  /** destructive single-turn/flux-compression, 1200 T (Tokyo, 2018) [T] */
  pulsedDestructive: 1200,
} as const;

/**
 * Engineering limits used by the build sheet.
 */
export const ENGINEERING = {
  /** copper resistivity at 20 °C [Ω·m] (IEC 60028 annealed copper) */
  rhoCu20: 1.724e-8,
  /** copper temperature coefficient of resistivity [1/K] */
  alphaCu: 3.93e-3,
  /** copper density [kg/m³] */
  rhoCuMass: 8960,
  /** copper specific heat [J/(kg·K)] */
  cpCu: 385,
  /** water specific heat [J/(kg·K)] */
  cpWater: 4182,
  /** sustained current density, free air convection [A/m²] */
  jAir: 3e6,
  /** sustained current density, forced air [A/m²] */
  jForcedAir: 8e6,
  /** sustained current density, direct water cooling [A/m²] */
  jWater: 3e7,
  /** engineering current density of a wound NbTi magnet at 4.2 K [A/m²] */
  jNbTi: 3e8,
  /** copper packing fraction of a realistic winding */
  packing: 0.7,
  /** indicative material costs [$/kg] */
  costCu: 12,
  costNdFeB: 70,
  /** REBCO tape cost [$ per kA·m at 77 K] */
  costRebcoPerKAm: 50,
  /** electricity [$/kWh] */
  costPower: 0.15,
} as const;
