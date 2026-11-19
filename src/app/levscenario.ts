import { APPARATUS_BY_ID, apparatusFor, defaultParams, type ApparatusId } from '../physics/em/apparatus';
import type { CoolingTech } from '../physics/em/engineering';
import type { LevMode } from '../physics/em/levitation';
import { customLevObject, levObject } from '../physics/em/objects';
import type { LevObject, LevShape } from '../physics/em/levitation';
import type { LevScenarioInput } from '../physics/em/solve';

export interface CustomLevParams {
  shape: LevShape;
  size: number;
  thickness: number;
  material: string;
  massOverride: number | null;
  moment: number;
  charge: number;
}

export interface LevScenario {
  mode: LevMode;
  apparatus: ApparatusId;
  /** apparatus parameters, keyed by apparatus id so switching back restores them */
  params: Record<string, Record<string, number>>;
  objectId: string;
  custom: CustomLevParams;
  medium: string;
  temperature: number;
  cooling: CoolingTech;
  /** 6-DOF run settings */
  spinRps: number;
  tiltDeg: number;
  offset: number;
  duration: number;
  damping: boolean;
  /** what the 3-D view shows */
  show: 'apparatus' | 'energy';
  fieldLines: boolean;
  forceArrows: boolean;
  fieldSlice: boolean;
}

export const MODE_LABEL: Record<LevMode, string> = {
  electrostatic: 'Electrostatic',
  permanentMagnet: 'Permanent magnet',
  diamagnetic: 'Diamagnetic',
  superconductor: 'Superconducting',
  eddyCurrent: 'Eddy current',
  servo: 'Active servo',
  spinStabilised: 'Spin-stabilised',
  acoustic: 'Acoustic',
  optical: 'Optical',
  aerodynamic: 'Thrust',
  buoyancy: 'Buoyancy',
};

export const MODE_SHORT: Record<LevMode, string> = {
  electrostatic: '⚡',
  permanentMagnet: '🧲',
  diamagnetic: '◼️',
  superconductor: '❄️',
  eddyCurrent: '🌀',
  servo: '🎛️',
  spinStabilised: '🎯',
  acoustic: '🔊',
  optical: '🔆',
  aerodynamic: '🌬️',
  buoyancy: '🎈',
};

/** does this mode have a magnetic field worth drawing and a rigid-body run? */
export const MODE_HAS_FIELD: Record<LevMode, boolean> = {
  electrostatic: false,
  permanentMagnet: true,
  diamagnetic: true,
  superconductor: true,
  eddyCurrent: true,
  servo: false,
  spinStabilised: true,
  acoustic: false,
  optical: false,
  aerodynamic: false,
  buoyancy: false,
};

/** the mode's one-line claim, shown under the selector */
export const MODE_TAGLINE: Record<LevMode, string> = {
  electrostatic: 'Charge in a field. Provably unstable — the reason real electrostatic levitators run a feedback loop.',
  permanentMagnet: 'Magnet over magnet. The arrangement everyone tries first, and the one Earnshaw proved cannot work.',
  diamagnetic: 'The induced-moment loophole. Stable with no feedback, no spin and no power — the only passive room-temperature mode.',
  superconductor: 'A perfect diamagnet that also pins flux. Stable in every direction at once; the basis of superconducting Maglev.',
  eddyCurrent: 'Induced currents in a conductor. Needs a changing field, so it needs either AC or motion.',
  servo: 'A sensor and a controller. Creates the equilibrium that the field cannot — and fails the instant the power does.',
  spinStabilised: 'Angular momentum as the loophole: a spinning moment follows the field, so the energy depends on |B| instead of B.',
  acoustic: 'Standing-wave sound. Particles collect at the pressure nodes, and the threshold loudness does not depend on their size.',
  optical: 'Light has momentum and a gradient. Enough for a micron bead; 1.5 MW for a gram.',
  aerodynamic: 'Push air down. Entirely conventional, entirely effective, and it never stops costing power.',
  buoyancy: 'Displace more air than you weigh. The oldest and still the cheapest way to float.',
};

export const DEFAULT_LEV_SCENARIO: LevScenario = {
  mode: 'diamagnetic',
  apparatus: 'checkerboard',
  params: {},
  objectId: 'graphiteFlake',
  custom: { shape: 'plate', size: 0.01, thickness: 0.001, material: 'pyrolyticGraphite', massOverride: null, moment: 0, charge: 0 },
  medium: 'air',
  temperature: 293.15,
  cooling: 'water',
  spinRps: 28,
  tiltDeg: 0.5,
  offset: 0,
  duration: 8,
  damping: true,
  show: 'apparatus',
  fieldLines: true,
  forceArrows: false,
  fieldSlice: true,
};

export function levObjectFor(s: LevScenario): LevObject {
  if (s.objectId === 'custom') {
    const c = s.custom;
    return customLevObject({
      shape: c.shape, size: c.size, thickness: c.thickness, material: c.material,
      mass: c.massOverride ?? undefined, moment: c.moment, charge: c.charge,
    });
  }
  return levObject(s.objectId);
}

export function paramsFor(s: LevScenario, apparatus = s.apparatus): Record<string, number> {
  const def = APPARATUS_BY_ID[apparatus];
  return { ...defaultParams(def), ...(s.params[apparatus] ?? {}) };
}

export function levInput(s: LevScenario, g: number, bodyName: string, siteName: string): LevScenarioInput {
  return {
    mode: s.mode,
    apparatus: s.apparatus,
    params: paramsFor(s),
    object: levObjectFor(s),
    g,
    medium: s.medium,
    temperature: s.temperature,
    cooling: s.cooling,
    bodyName,
    siteName,
  };
}

/** the first apparatus that supports a mode, used when switching modes */
export function defaultApparatusFor(mode: LevMode): ApparatusId {
  const list = apparatusFor(mode);
  return (list[0]?.id ?? 'idealGradient') as ApparatusId;
}

export function describeLev(s: LevScenario): string {
  const o = levObjectFor(s);
  return `${o.name} — ${MODE_LABEL[s.mode]} (${APPARATUS_BY_ID[s.apparatus].name})`;
}
