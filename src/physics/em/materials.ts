/**
 * Electromagnetic, acoustic and optical material properties.
 *
 * Magnetic susceptibilities are SI **volume** susceptibilities χ_v
 * (dimensionless, B = μ₀(1+χ)H). Values follow J. F. Schenck, Med. Phys. 23
 * (1996) 815 — the standard compilation for diamagnetic levitation and MRI —
 * and the CRC Handbook, 97th ed., §4 "Magnetic susceptibility of the
 * elements and inorganic compounds". Where a material is magnetically
 * anisotropic, both principal values are given: pyrolytic graphite levitates
 * precisely because χ along its c-axis is five times the in-plane value.
 */

export interface SuperconductorData {
  /** critical temperature at zero field [K] */
  Tc: number;
  /** upper critical field extrapolated to 0 K [T] */
  Bc2_0: number;
  /** critical current density in self-field at 77 K [A/m²] (type II, bulk) */
  Jc77: number | null;
  /** critical current density at 4.2 K, 5 T [A/m²] */
  Jc42: number | null;
  kind: 'typeI' | 'typeII';
}

export interface PermanentMagnetData {
  /** remanent flux density [T] */
  Br: number;
  /** intrinsic coercivity [A/m] */
  Hci: number;
  /** maximum energy product [J/m³] */
  BHmax: number;
  /** recoil permeability */
  muR: number;
  /** reversible temperature coefficient of Br [1/K] */
  tempCoeffBr: number;
  /** maximum operating temperature [K] */
  Tmax: number;
}

export interface EMMaterial {
  id: string;
  name: string;
  /** density [kg/m³] */
  density: number;
  /** volume magnetic susceptibility, SI; the principal ("easy") value */
  chi: number;
  /** the other principal value, for anisotropic materials */
  chiAlt?: number;
  /** label for which axis `chi` refers to */
  chiAxis?: string;
  /** electrical resistivity at 20 °C [Ω·m]; null for a practical insulator */
  resistivity: number | null;
  /** relative permittivity (static) */
  epsR: number;
  /** dielectric strength [V/m]; null if not meaningful */
  dielectricStrength: number | null;
  /** longitudinal speed of sound [m/s] */
  soundSpeed: number | null;
  /** refractive index at 589 nm */
  refractiveIndex: number | null;
  sc?: SuperconductorData;
  pm?: PermanentMagnetData;
  /** short category used by the UI */
  group: 'diamagnet' | 'paramagnet' | 'conductor' | 'superconductor' | 'magnet' | 'insulator' | 'biological';
  source: string;
  note?: string;
}

const M = (m: EMMaterial) => m;

export const EM_MATERIALS: EMMaterial[] = [
  /* ---------------------------------------------------- strong diamagnets */
  M({
    id: 'pyrolyticGraphite', name: 'Pyrolytic graphite', density: 2200,
    chi: -4.5e-4, chiAlt: -8.5e-5, chiAxis: 'c-axis (⊥ basal plane)',
    resistivity: 5e-6, epsR: 12, dielectricStrength: null, soundSpeed: 3200, refractiveIndex: null,
    group: 'diamagnet',
    source: 'Simon & Geim, J. Appl. Phys. 87 (2000) 6200',
    note: 'The most diamagnetic material available in bulk. Levitates over an ordinary NdFeB checkerboard at room temperature — the classic desk demonstration.',
  }),
  M({
    id: 'bismuth', name: 'Bismuth', density: 9780,
    chi: -1.66e-4, resistivity: 1.29e-6, epsR: 100, dielectricStrength: null, soundSpeed: 1790, refractiveIndex: null,
    group: 'diamagnet',
    source: 'Schenck, Med. Phys. 23 (1996) 815',
    note: 'The most diamagnetic metal. Dense, so χ/ρ is far worse than graphite.',
  }),
  M({
    id: 'water', name: 'Water', density: 998.2,
    chi: -9.05e-6, resistivity: 2.0e5, epsR: 80.1, dielectricStrength: 1.3e7, soundSpeed: 1481, refractiveIndex: 1.333,
    group: 'diamagnet',
    source: 'Schenck, Med. Phys. 23 (1996) 815',
    note: 'Needs B·∂B/∂z ≈ 1360 T²/m — the Nijmegen 16 T magnet that levitated a live frog.',
  }),
  M({
    id: 'ice', name: 'Ice', density: 917,
    chi: -9.0e-6, resistivity: 1e8, epsR: 99, dielectricStrength: 1e7, soundSpeed: 3200, refractiveIndex: 1.31,
    group: 'diamagnet', source: 'CRC Handbook 97th ed.',
  }),
  M({
    id: 'graphiteIso', name: 'Graphite (isotropic)', density: 2250,
    chi: -1.6e-5, resistivity: 1e-5, epsR: 12, dielectricStrength: null, soundSpeed: 3000, refractiveIndex: null,
    group: 'diamagnet', source: 'CRC Handbook 97th ed.',
    note: 'Ordinary pressed graphite: the strong anisotropic diamagnetism is averaged away.',
  }),
  M({
    id: 'diamond', name: 'Diamond', density: 3515,
    chi: -2.2e-5, resistivity: 1e12, epsR: 5.7, dielectricStrength: 2e9, soundSpeed: 12000, refractiveIndex: 2.417,
    group: 'diamagnet', source: 'CRC Handbook 97th ed.',
  }),
  M({
    id: 'gold', name: 'Gold', density: 19300,
    chi: -3.44e-5, resistivity: 2.44e-8, epsR: 1, dielectricStrength: null, soundSpeed: 3240, refractiveIndex: null,
    group: 'conductor', source: 'Schenck, Med. Phys. 23 (1996) 815',
  }),
  M({
    id: 'copper', name: 'Copper', density: 8960,
    chi: -9.63e-6, resistivity: 1.724e-8, epsR: 1, dielectricStrength: null, soundSpeed: 4600, refractiveIndex: null,
    group: 'conductor', source: 'Schenck 1996; IEC 60028 for resistivity',
    note: 'Weakly diamagnetic but an excellent conductor: the material of choice for eddy-current levitation.',
  }),
  M({
    id: 'lead', name: 'Lead', density: 11340,
    chi: -1.8e-5, resistivity: 2.08e-7, epsR: 1, dielectricStrength: null, soundSpeed: 1960, refractiveIndex: null,
    group: 'conductor', source: 'CRC Handbook 97th ed.',
    note: 'Becomes a type-I superconductor below 7.2 K.',
  }),
  M({
    id: 'silicon', name: 'Silicon', density: 2330,
    chi: -4.1e-6, resistivity: 2.3e3, epsR: 11.7, dielectricStrength: 3e7, soundSpeed: 8433, refractiveIndex: 3.45,
    group: 'diamagnet', source: 'CRC Handbook 97th ed.',
  }),
  M({
    id: 'quartz', name: 'Fused quartz', density: 2200,
    chi: -1.5e-5, resistivity: null, epsR: 3.8, dielectricStrength: 3e7, soundSpeed: 5968, refractiveIndex: 1.4585,
    group: 'insulator', source: 'CRC Handbook 97th ed.',
  }),
  M({
    id: 'ptfe', name: 'PTFE', density: 2200,
    chi: -1.0e-5, resistivity: null, epsR: 2.1, dielectricStrength: 6e7, soundSpeed: 1400, refractiveIndex: 1.38,
    group: 'insulator', source: 'CRC Handbook 97th ed.',
  }),
  M({
    id: 'polystyrene', name: 'Polystyrene', density: 1050,
    chi: -8.2e-6, resistivity: null, epsR: 2.6, dielectricStrength: 2e7, soundSpeed: 2350, refractiveIndex: 1.59,
    group: 'insulator', source: 'CRC Handbook 97th ed.',
    note: 'The standard bead for optical tweezers and acoustic levitation.',
  }),

  /* ------------------------------------------------------- paramagnets */
  M({
    id: 'aluminium', name: 'Aluminium', density: 2700,
    chi: 2.2e-5, resistivity: 2.65e-8, epsR: 1, dielectricStrength: null, soundSpeed: 6420, refractiveIndex: null,
    group: 'conductor', source: 'Schenck 1996',
    note: 'Paramagnetic, so it is pulled into a field — but its conductivity makes it ideal for eddy-current and Inductrack levitation.',
  }),
  M({
    id: 'liquidOxygen', name: 'Liquid oxygen', density: 1141,
    chi: 3.449e-3, resistivity: null, epsR: 1.5, dielectricStrength: null, soundSpeed: 904, refractiveIndex: 1.22,
    group: 'paramagnet', source: 'CRC Handbook 97th ed.',
    note: 'Strongly paramagnetic: it is attracted to a magnet and cannot levitate diamagnetically, but it visibly sticks between pole faces.',
  }),
  M({
    id: 'oxygenGas', name: 'Oxygen (gas, STP)', density: 1.429,
    chi: 1.9e-6, resistivity: null, epsR: 1.0005, dielectricStrength: 3e6, soundSpeed: 316, refractiveIndex: 1.0003,
    group: 'paramagnet', source: 'CRC Handbook 97th ed.',
    note: 'The paramagnetism of air slightly reduces the field needed to levitate a diamagnet in air rather than vacuum.',
  }),
  M({
    id: 'steel', name: 'Mild steel (ferromagnetic)', density: 7850,
    chi: 4000, resistivity: 1.43e-7, epsR: 1, dielectricStrength: null, soundSpeed: 5920, refractiveIndex: null,
    group: 'paramagnet', source: 'typical B-H data for AISI 1018; χ is the initial value and saturates',
    note: 'Ferromagnetic: always attracted. Levitation is only possible with an active servo (how Maglev EMS trains work).',
  }),

  /* ----------------------------------------------------- biological */
  M({
    id: 'tissue', name: 'Living tissue', density: 1050,
    chi: -9.0e-6, resistivity: 2.0, epsR: 80, dielectricStrength: null, soundSpeed: 1540, refractiveIndex: 1.4,
    group: 'biological', source: 'Schenck, Med. Phys. 23 (1996) 815 (soft tissue, −7 to −11 ppm)',
    note: 'Essentially water magnetically. A frog, a mouse and a hazelnut have all been levitated in a 16 T bore at Nijmegen.',
  }),
  M({
    id: 'wood', name: 'Wood (dry pine)', density: 500,
    chi: -5.0e-6, resistivity: 1e10, epsR: 2.5, dielectricStrength: 5e6, soundSpeed: 3300, refractiveIndex: null,
    group: 'biological', source: 'estimated from cellulose and residual moisture',
  }),

  /* ------------------------------------------------- superconductors */
  M({
    id: 'ybco', name: 'YBCO (bulk, melt-textured)', density: 6300,
    chi: -1, resistivity: 0, epsR: 1, dielectricStrength: null, soundSpeed: 4600, refractiveIndex: null,
    group: 'superconductor',
    sc: { Tc: 92, Bc2_0: 120, Jc77: 3e8, Jc42: 1e9, kind: 'typeII' },
    source: 'Tc: Wu et al., PRL 58 (1987) 908; bulk Jc(77 K) ≈ 3×10⁴ A/cm²: Murakami, Supercond. Sci. Technol. 13 (2000) 448',
    note: 'Flux pinning gives lateral and vertical stiffness, so levitation is stable with no feedback — the basis of every superconducting Maglev.',
  }),
  M({
    id: 'nbti', name: 'NbTi', density: 6000,
    chi: -1, resistivity: 0, epsR: 1, dielectricStrength: null, soundSpeed: 5000, refractiveIndex: null,
    group: 'superconductor',
    sc: { Tc: 9.2, Bc2_0: 14.5, Jc77: null, Jc42: 3e9, kind: 'typeII' },
    source: 'Lee & Larbalestier, Cryogenics 48 (2008) 283',
    note: 'The workhorse of 1–9 T magnets (MRI). Needs liquid helium.',
  }),
  M({
    id: 'nb3sn', name: 'Nb₃Sn', density: 8900,
    chi: -1, resistivity: 0, epsR: 1, dielectricStrength: null, soundSpeed: 5000, refractiveIndex: null,
    group: 'superconductor',
    sc: { Tc: 18.3, Bc2_0: 29.5, Jc77: null, Jc42: 1.5e9, kind: 'typeII' },
    source: 'Godeke, Supercond. Sci. Technol. 19 (2006) R68',
    note: 'Takes superconducting magnets past 20 T; brittle, so it is reacted after winding.',
  }),
  M({
    id: 'mgb2', name: 'MgB₂', density: 2570,
    chi: -1, resistivity: 0, epsR: 1, dielectricStrength: null, soundSpeed: 8000, refractiveIndex: null,
    group: 'superconductor',
    sc: { Tc: 39, Bc2_0: 18, Jc77: null, Jc42: 5e8, kind: 'typeII' },
    source: 'Nagamatsu et al., Nature 410 (2001) 63',
  }),
  M({
    id: 'leadSc', name: 'Lead (superconducting, < 7.2 K)', density: 11340,
    chi: -1, resistivity: 0, epsR: 1, dielectricStrength: null, soundSpeed: 1960, refractiveIndex: null,
    group: 'superconductor',
    sc: { Tc: 7.196, Bc2_0: 0.0803, Jc77: null, Jc42: null, kind: 'typeI' },
    source: 'CRC Handbook 97th ed.',
    note: 'Type I: it expels flux completely but pins none, so levitation above it is unstable — the Meissner effect alone does not beat Earnshaw.',
  }),

  /* ------------------------------------------------- permanent magnets */
  M({
    id: 'ndfeb_n35', name: 'NdFeB N35', density: 7500,
    chi: 0.05, resistivity: 1.4e-6, epsR: 1, dielectricStrength: null, soundSpeed: 4000, refractiveIndex: null,
    group: 'magnet',
    pm: { Br: 1.17, Hci: 955000, BHmax: 263000, muR: 1.05, tempCoeffBr: -1.2e-3, Tmax: 353 },
    source: 'standard grade data (e.g. Arnold Magnetic Technologies datasheets)',
  }),
  M({
    id: 'ndfeb_n42', name: 'NdFeB N42', density: 7500,
    chi: 0.05, resistivity: 1.4e-6, epsR: 1, dielectricStrength: null, soundSpeed: 4000, refractiveIndex: null,
    group: 'magnet',
    pm: { Br: 1.32, Hci: 955000, BHmax: 334000, muR: 1.05, tempCoeffBr: -1.2e-3, Tmax: 353 },
    source: 'standard grade data',
    note: 'The usual hardware-shop neodymium magnet. Surface field of a thick block ≈ 0.6 T.',
  }),
  M({
    id: 'ndfeb_n52', name: 'NdFeB N52', density: 7500,
    chi: 0.05, resistivity: 1.4e-6, epsR: 1, dielectricStrength: null, soundSpeed: 4000, refractiveIndex: null,
    group: 'magnet',
    pm: { Br: 1.45, Hci: 876000, BHmax: 414000, muR: 1.05, tempCoeffBr: -1.2e-3, Tmax: 338 },
    source: 'standard grade data',
    note: 'The strongest commercial grade. Br = 1.45 T is close to the theoretical limit for Nd₂Fe₁₄B.',
  }),
  M({
    id: 'smco', name: 'SmCo 2:17', density: 8400,
    chi: 0.05, resistivity: 8.6e-7, epsR: 1, dielectricStrength: null, soundSpeed: 4000, refractiveIndex: null,
    group: 'magnet',
    pm: { Br: 1.08, Hci: 1590000, BHmax: 223000, muR: 1.05, tempCoeffBr: -3.5e-4, Tmax: 623 },
    source: 'standard grade data',
    note: 'Weaker than NdFeB but far more stable with temperature.',
  }),
  M({
    id: 'ferrite', name: 'Ferrite (ceramic 8)', density: 4900,
    chi: 0.05, resistivity: 1e4, epsR: 12, dielectricStrength: null, soundSpeed: 4000, refractiveIndex: null,
    group: 'magnet',
    pm: { Br: 0.39, Hci: 239000, BHmax: 28000, muR: 1.1, tempCoeffBr: -2.0e-3, Tmax: 523 },
    source: 'standard grade data',
    note: 'Cheap but weak: an array of these cannot levitate graphite.',
  }),
  M({
    id: 'alnico', name: 'AlNiCo 5', density: 7300,
    chi: 0.05, resistivity: 4.7e-7, epsR: 1, dielectricStrength: null, soundSpeed: 4000, refractiveIndex: null,
    group: 'magnet',
    pm: { Br: 1.28, Hci: 51000, BHmax: 43800, muR: 4.0, tempCoeffBr: -2.0e-4, Tmax: 798 },
    source: 'standard grade data',
    note: 'High remanence but very low coercivity — it demagnetises easily in a repelling arrangement.',
  }),

  /* ------------------------------------------------------------- media */
  M({
    id: 'air', name: 'Air (20 °C, 1 atm)', density: 1.2041,
    chi: 3.6e-7, resistivity: null, epsR: 1.00059, dielectricStrength: 3.0e6, soundSpeed: 343.2, refractiveIndex: 1.000293,
    group: 'paramagnet', source: 'CRC Handbook 97th ed.; breakdown from Meek & Craggs (1978)',
  }),
  M({
    id: 'vacuum', name: 'Vacuum', density: 0,
    chi: 0, resistivity: null, epsR: 1, dielectricStrength: 1e9, soundSpeed: null, refractiveIndex: 1,
    group: 'insulator', source: 'by definition',
    note: 'Breakdown is then set by electrode surface quality, not the gas: ~10–100 MV/m in practice (Kilpatrick criterion).',
  }),
  M({
    id: 'transformerOil', name: 'Transformer oil', density: 880,
    chi: -8e-6, resistivity: 1e12, epsR: 2.2, dielectricStrength: 1.2e7, soundSpeed: 1400, refractiveIndex: 1.47,
    group: 'insulator', source: 'IEC 60296',
    note: 'Four times the dielectric strength of air: electrostatic levitation works much better immersed.',
  }),
];

export const EM_BY_ID: Record<string, EMMaterial> = Object.fromEntries(EM_MATERIALS.map((m) => [m.id, m]));

export function emMaterial(id: string): EMMaterial {
  const m = EM_BY_ID[id];
  if (!m) throw new Error(`Unknown EM material ${id}`);
  return m;
}

/**
 * Effective susceptibility of a body immersed in a medium. What drives the
 * force is the *contrast* χ_body − χ_medium, which is why levitating a
 * diamagnet in (paramagnetic) air is slightly easier than in vacuum.
 */
export function chiContrast(body: EMMaterial, medium: EMMaterial): number {
  return body.chi - medium.chi;
}

/**
 * Temperature-corrected remanence of a permanent magnet.
 * Br(T) = Br(20 °C)·[1 + α(T − 293.15)]
 */
export function remanenceAt(m: EMMaterial, tempK: number): number {
  if (!m.pm) return 0;
  return m.pm.Br * (1 + m.pm.tempCoeffBr * (tempK - 293.15));
}

/**
 * Critical current density of a type-II superconductor, Kim model with a
 * linear temperature dependence:
 *   Jc(B, T) = Jc0·(1 − T/Tc)^1.5 / (1 + B/B0)
 * This reproduces the measured fall-off well enough for levitation forces;
 * B0 is fitted so that Jc(77 K, 1 T) ≈ ⅓ of its self-field value for YBCO.
 * Source: Y. B. Kim et al., Phys. Rev. 129 (1963) 528.
 */
export function criticalCurrentDensity(m: EMMaterial, B: number, T: number): number {
  if (!m.sc) return 0;
  const { Tc, Jc77, Jc42 } = m.sc;
  const ref = Jc77 ?? Jc42 ?? 0;
  const refT = Jc77 !== null ? 77 : 4.2;
  if (T >= Tc) return 0;
  const Jc0 = ref / Math.pow(1 - refT / Tc, 1.5);
  const B0 = 0.5;
  return (Jc0 * Math.pow(1 - T / Tc, 1.5)) / (1 + Math.abs(B) / B0);
}
