/**
 * The build sheet: what hardware a required field would actually take.
 *
 * Given a target field, a bore and a cooling technology, this sizes the
 * winding, the current, the ohmic power, the cooling flow, the conductor mass
 * and the Lorentz hoop stress — and compares each against what has really
 * been built. The hoop stress is the interesting one: above roughly 45 T a
 * continuous magnet tears itself apart, which is why the world record above
 * that is held by pulsed coils that are sometimes destroyed in the shot.
 */
import { ENGINEERING, MU0 } from './constants';
import { fieldTier, powerTier, worseTier, type VerdictTier } from './levitation';

export type CoolingTech = 'air' | 'forcedAir' | 'water' | 'superconducting';

export const COOLING_LABEL: Record<CoolingTech, string> = {
  air: 'Air-cooled copper',
  forcedAir: 'Fan-cooled copper',
  water: 'Water-cooled copper (Bitter-style)',
  superconducting: 'Superconducting (NbTi, 4.2 K)',
};

export function currentDensityFor(tech: CoolingTech): number {
  switch (tech) {
    case 'air': return ENGINEERING.jAir;
    case 'forcedAir': return ENGINEERING.jForcedAir;
    case 'water': return ENGINEERING.jWater;
    case 'superconducting': return ENGINEERING.jNbTi;
  }
}

/** Standard AWG copper sizes, for a concrete wire recommendation. */
export const AWG: { gauge: number; diameter: number; area: number }[] = Array.from({ length: 31 }, (_, i) => {
  const g = i - 4; // AWG 4/0 (−3) … 26
  const diameter = 0.000127 * Math.pow(92, (36 - g) / 39);
  return { gauge: g, diameter, area: (Math.PI * diameter * diameter) / 4 };
});

export function pickWire(current: number, J: number): { gauge: number; diameter: number; area: number; strands: number } {
  const need = current / J;
  // smallest wire whose area is at least `need`; otherwise parallel strands
  const best = [...AWG].sort((a, b) => a.area - b.area).find((w) => w.area >= need);
  if (best) return { ...best, strands: 1 };
  const biggest = AWG.reduce((a, b) => (a.area > b.area ? a : b));
  return { ...biggest, strands: Math.ceil(need / biggest.area) };
}

export interface BuildSheet {
  /** target peak field [T] */
  field: number;
  bore: number;
  length: number;
  tech: CoolingTech;
  /** total amp-turns [A·turns] */
  ampTurns: number;
  /** winding cross-section needed [m²] */
  windowArea: number;
  /** radial build of the winding [m] */
  buildThickness: number;
  meanRadius: number;
  currentDensity: number;
  /** a practical turns/current split */
  turns: number;
  current: number;
  wire: { gauge: number; diameter: number; area: number; strands: number };
  /** conductor length and mass */
  conductorLength: number;
  conductorMass: number;
  /** winding resistance at 20 °C and at the operating temperature [Ω] */
  resistance: number;
  /** ohmic dissipation [W] — zero for a superconductor */
  power: number;
  /** cooling water flow for a 30 K rise [kg/s] and [L/min] */
  coolingFlow: number;
  coolingLitresPerMin: number;
  /** magnetic energy stored in the bore [J] */
  storedEnergy: number;
  /** Lorentz hoop stress in the winding [Pa] */
  hoopStress: number;
  /** copper yield strength for comparison [Pa] */
  yieldStrength: number;
  stressOk: boolean;
  /** indicative cost [$] of conductor plus a year of 8 h/day operation */
  conductorCost: number;
  energyCostPerHour: number;
  tier: VerdictTier;
  warnings: string[];
}

/**
 * Size a solenoid for a target central field.
 *
 * The honest way to cost a resistive magnet is the Fabry relation
 *
 *   B = μ₀·G·√(λP / (ρ·a₁))
 *
 * where a₁ is the bore radius, λ the copper packing fraction, ρ the
 * resistivity and G a dimensionless shape factor — at most about 0.18 for an
 * optimally graded winding, 0.12–0.15 for a real one. It says the thing that
 * matters: for a given bore, the field is set by the *power*, and no amount of
 * extra copper gets around it. Inverting,
 *
 *   P = (B/μ₀G)²·ρ·a₁/λ.
 *
 * Checked against the NHMFL 35 T resistive magnet (32 mm bore, 20 MW): the
 * relation returns 20.0 MW with G = 0.1236, which is the value used here.
 * Source: D. B. Montgomery, "Solenoid Magnet Design" (1969), ch. 1–2.
 *
 * A superconducting winding has no ohmic power, so there the geometry is set
 * by the conductor's engineering current density instead.
 */
const FABRY_G = 0.1236;

export function designSolenoid(field: number, bore: number, length: number, tech: CoolingTech, opts: { packing?: number; deltaT?: number; turns?: number } = {}): BuildSheet {
  const J0 = currentDensityFor(tech);
  const packing = opts.packing ?? ENGINEERING.packing;
  const warnings: string[] = [];
  // conventional α = 2 winding: outer radius twice the bore
  const t = bore;
  const r = bore + t / 2;
  const ampTurns = (field * Math.sqrt(length * length + 4 * r * r)) / MU0;
  const windowArea = t * length;
  const windingVolume = Math.PI * ((bore + t) ** 2 - bore ** 2) * length;
  const superc = tech === 'superconducting';
  const power = superc ? 0 : (field / (MU0 * FABRY_G)) ** 2 * (ENGINEERING.rhoCu20 * bore) / packing;
  // the current density the design actually needs: P = ρJ²·(λ·V_winding)
  const J = superc
    ? J0
    : Math.sqrt(power / (ENGINEERING.rhoCu20 * packing * windingVolume));
  const turns = opts.turns ?? Math.max(1, Math.round(Math.sqrt(ampTurns) * 4));
  const current = ampTurns / turns;
  const wire = pickWire(current, J);
  const conductorLength = turns * 2 * Math.PI * r;
  const conductorMass = packing * windingVolume * ENGINEERING.rhoCuMass;
  const resistance = superc || current === 0 ? 0 : power / (current * current);
  if (!superc && J > J0) {
    warnings.push(`The winding needs ${(J / 1e6).toFixed(0)} A/mm² but ${COOLING_LABEL[tech]} sustains about ${(J0 / 1e6).toFixed(0)} A/mm². Either cool it harder, make the winding bigger, or accept a pulsed duty cycle.`);
  }
  const deltaT = opts.deltaT ?? 30;
  const coolingFlow = power / (ENGINEERING.cpWater * deltaT);
  const boreVolume = Math.PI * bore * bore * length;
  const storedEnergy = ((field * field) / (2 * MU0)) * boreVolume;
  // Lorentz body force J×B over a winding of radius r gives a hoop stress
  // σ ≈ J·B·r (Montgomery §4) — the real reason continuous magnets stop near
  // 45 T whatever the power budget
  const hoopStress = J * packing * field * r;
  const yieldStrength = 2.5e8; // hard-drawn copper, ~250 MPa
  if (field > 45.5) warnings.push('Above the 45.5 T hybrid-magnet record — only pulsed coils reach this, and the strongest destroy themselves.');
  if (hoopStress > yieldStrength) warnings.push(`Lorentz hoop stress ${(hoopStress / 1e6).toFixed(0)} MPa exceeds hard copper's ~250 MPa yield: the winding needs external reinforcement or it will deform.`);
  if (power > 1e7) warnings.push(`${(power / 1e6).toFixed(1)} MW of ohmic heat: this is a dedicated-substation installation, not a laboratory bench.`);
  if (tech === 'superconducting' && field > 23.5) warnings.push('Above the practical NbTi/Nb₃Sn limit — this needs a resistive insert inside a superconducting outsert (a hybrid magnet).');
  if (t > bore * 20) warnings.push('The winding is far thicker than the bore: most of the copper contributes almost nothing, and the simple scaling here becomes optimistic.');
  return {
    field, bore, length, tech, ampTurns, windowArea, buildThickness: t, meanRadius: r,
    currentDensity: J, turns, current, wire,
    conductorLength, conductorMass, resistance, power,
    coolingFlow, coolingLitresPerMin: coolingFlow * 60,
    storedEnergy, hoopStress, yieldStrength, stressOk: hoopStress <= yieldStrength,
    conductorCost: conductorMass * (tech === 'superconducting' ? 200 : ENGINEERING.costCu),
    energyCostPerHour: (power / 1000) * ENGINEERING.costPower,
    tier: worseTier(fieldTier(field), powerTier(power)),
    warnings,
  };
}

/**
 * Permanent-magnet option: the mass of NdFeB needed to produce a given field
 * in a working gap. Using the energy-product relation
 * B_gap²·V_gap ≈ (BH)_max·V_magnet (Jiles, "Introduction to Magnetism and
 * Magnetic Materials", §12), which is the standard first-order sizing law.
 */
export function designPermanentMagnet(field: number, gapVolume: number, BHmax: number, density: number): {
  magnetVolume: number; magnetMass: number; cost: number; feasible: boolean; ceiling: number; note: string;
} {
  const ceiling = 1.5; // a Halbach cylinder of NdFeB can reach ~1.5 T in a small bore
  const magnetVolume = (field * field * gapVolume) / (MU0 * BHmax);
  const magnetMass = magnetVolume * density;
  return {
    magnetVolume, magnetMass, cost: magnetMass * ENGINEERING.costNdFeB,
    feasible: field <= ceiling, ceiling,
    note: field <= ceiling
      ? 'Within reach of permanent magnets — no power supply, no cooling, nothing to fail.'
      : `Permanent magnets saturate near ${ceiling} T even in an optimal Halbach cylinder, because the field cannot exceed what the remanence of the material supports. Beyond that you need current.`,
  };
}

/** Energy and cryogenic cost of running a superconducting magnet. */
export function cryogenicLoad(storedEnergy: number, boreVolume: number): {
  heliumBoilOffLitresPerDay: number; quenchEnergy: number; coldMass: number; note: string;
} {
  // a well-built 4.2 K magnet dewar loses ~0.5 W per litre of cold volume
  const coldMass = boreVolume * 8000;
  const staticLoad = Math.max(0.5, boreVolume * 500);
  return {
    heliumBoilOffLitresPerDay: (staticLoad * 86400) / 2.6e6 / 0.125,
    quenchEnergy: storedEnergy,
    coldMass,
    note: `A quench dumps the stored ${(storedEnergy / 1e6).toFixed(2)} MJ into the winding in under a second; magnets this size need an active quench-protection circuit.`,
  };
}
