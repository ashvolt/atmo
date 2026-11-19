/**
 * Material properties and projectile presets. Masses and dimensions are the
 * official/regulation values where one exists (cited inline).
 */
import type { ShapeDrag } from './aero/drag';

export interface Material {
  id: string;
  name: string;
  density: number; // [kg/m^3]
  specificHeat: number; // [J/(kg K)]
  emissivity: number;
  /** temperature at which the surface melts / chars / ablates [K] */
  ablationTemp: number;
  /** effective heat of ablation [J/kg] */
  heatOfAblation: number;
  /** thermally active skin depth for the lumped heating model [m] */
  skinDepth: number;
}

// Heat of ablation: stone & iron 8 MJ/kg (meteor physics, Ceplecha et al., Space Sci. Rev. 84 (1998) 327);
// metals otherwise latent heat of fusion + heating to melt (spacecraft demise practice, ESA DRAMA);
// organics: pyrolysis/char values (~2–3 MJ/kg).
export const MATERIALS: Record<string, Material> = {
  iron: { id: 'iron', name: 'Iron', density: 7870, specificHeat: 450, emissivity: 0.7, ablationTemp: 1811, heatOfAblation: 8e6, skinDepth: 0.005 },
  stone: { id: 'stone', name: 'Stone (granite)', density: 2700, specificHeat: 790, emissivity: 0.9, ablationTemp: 1500, heatOfAblation: 8e6, skinDepth: 0.002 },
  aluminium: { id: 'aluminium', name: 'Aluminium', density: 2700, specificHeat: 900, emissivity: 0.3, ablationTemp: 933, heatOfAblation: 3.97e5, skinDepth: 0.004 },
  copperNickel: { id: 'copperNickel', name: 'Cupronickel', density: 8920, specificHeat: 385, emissivity: 0.3, ablationTemp: 1400, heatOfAblation: 2.3e5, skinDepth: 0.002 },
  lead: { id: 'lead', name: 'Lead', density: 11340, specificHeat: 129, emissivity: 0.4, ablationTemp: 600.6, heatOfAblation: 2.3e4, skinDepth: 0.004 },
  leather: { id: 'leather', name: 'Leather/cork/yarn', density: 640, specificHeat: 1500, emissivity: 0.9, ablationTemp: 600, heatOfAblation: 2e6, skinDepth: 0.002 },
  rubber: { id: 'rubber', name: 'Rubber', density: 1100, specificHeat: 2000, emissivity: 0.9, ablationTemp: 550, heatOfAblation: 2e6, skinDepth: 0.002 },
  resin: { id: 'resin', name: 'Polyester/urethane resin', density: 1500, specificHeat: 1300, emissivity: 0.9, ablationTemp: 600, heatOfAblation: 2.5e6, skinDepth: 0.003 },
  water: { id: 'water', name: 'Water', density: 998.2, specificHeat: 4186, emissivity: 0.96, ablationTemp: 373.15, heatOfAblation: 2.26e6, skinDepth: 0.001 },
  ice: { id: 'ice', name: 'Ice', density: 917, specificHeat: 2100, emissivity: 0.97, ablationTemp: 273.15, heatOfAblation: 3.34e5, skinDepth: 0.002 },
  keratin: { id: 'keratin', name: 'Keratin (feather)', density: 1300, specificHeat: 1500, emissivity: 0.9, ablationTemp: 500, heatOfAblation: 2e6, skinDepth: 0.0002 },
  human: { id: 'human', name: 'Human + suit', density: 1010, specificHeat: 3500, emissivity: 0.95, ablationTemp: 600, heatOfAblation: 2.5e6, skinDepth: 0.003 },
  inert: { id: 'inert', name: 'Ideal (no heating effects)', density: 1000, specificHeat: 1e30, emissivity: 0, ablationTemp: Infinity, heatOfAblation: Infinity, skinDepth: 1 },
  pica: { id: 'pica', name: 'PICA heat shield', density: 270, specificHeat: 1600, emissivity: 0.9, ablationTemp: 3000, heatOfAblation: 3e7, skinDepth: 0.01 },
};

export type ShapeId = 'sphere' | 'roughSphere' | 'drop' | 'cube' | 'disk' | 'cylinder' | 'humanBelly' | 'humanHeadDown' | 'plate' | 'capsule' | 'custom';

export interface ObjectSpec {
  id: string;
  name: string;
  emoji: string;
  shape: ShapeId;
  mass: number; // [kg]
  /** characteristic length for Re & Kn (diameter) [m] */
  length: number;
  /** frontal (reference) area [m^2] */
  area: number;
  /** displaced volume [m^3] (buoyancy & added mass) */
  volume: number;
  /** wetted surface area [m^2] (radiative cooling) */
  surfaceArea: number;
  /** nose radius for stagnation heating [m] */
  noseRadius: number;
  drag: ShapeDrag;
  material: string;
  /** added-mass coefficient (0.5 sphere) */
  addedMass: number;
  /** moment of inertia factor I = k m r² (0.4 solid sphere, 2/3 hollow) */
  inertiaFactor: number;
  /** allows a parachute (skydivers) */
  parachute?: { cdA: number; inflationTime: number };
  description: string;
}

const sphere = (r: number) => ({ area: Math.PI * r * r, volume: (4 / 3) * Math.PI * r ** 3, surfaceArea: 4 * Math.PI * r * r });

function sphereObj(
  id: string, name: string, emoji: string, mass: number, diameter: number, material: string,
  description: string, drag: ShapeDrag = { kind: 'sphere' }, inertiaFactor = 0.4,
): ObjectSpec {
  const r = diameter / 2;
  return {
    id, name, emoji, shape: drag.kind === 'roughSphere' ? 'roughSphere' : drag.kind === 'drop' ? 'drop' : 'sphere',
    mass, length: diameter, ...sphere(r), noseRadius: r, drag, material, addedMass: 0.5, inertiaFactor, description,
  };
}

export const PRESETS: ObjectSpec[] = [
  sphereObj('baseball', 'Baseball', '⚾', 0.145, 0.0737, 'leather',
    'MLB Rule 3.01: 5–5¼ oz, 9–9¼ in circumference. Drag & Magnus lift from A. Nathan’s Statcast-fitted model.',
    { kind: 'roughSphere', reShift: 2.4, cdFloor: 0.3, sport: 'baseball' }),
  sphereObj('golf', 'Golf ball', '⛳', 0.04593, 0.04267, 'rubber',
    'R&A/USGA limits: ≤ 45.93 g, ≥ 42.67 mm. Dimpled-ball aerodynamics from Smits & Smith (1994).',
    { kind: 'roughSphere', reShift: 6, cdFloor: 0.25, sport: 'golf' }),
  sphereObj('football', 'Football (soccer)', '⚽', 0.43, 0.22, 'rubber', 'FIFA size 5: 410–450 g, 68–70 cm circumference.', { kind: 'sphere' }, 2 / 3),
  sphereObj('basketball', 'Basketball', '🏀', 0.62, 0.239, 'rubber', 'FIBA size 7: 567–650 g, 749–780 mm circumference.', { kind: 'roughSphere', reShift: 1.5, cdFloor: 0.3 }, 2 / 3),
  sphereObj('tennis', 'Tennis ball', '🎾', 0.0577, 0.0670, 'rubber', 'ITF: 56.0–59.4 g, 6.54–6.86 cm. Felt raises drag (Cd ≈ 0.55).', { kind: 'roughSphere', reShift: 0.5, cdFloor: 0.55 }, 2 / 3),
  sphereObj('bowling', 'Bowling ball', '🎳', 7.26, 0.2183, 'resin', 'USBC max: 16 lb (7.26 kg), 8.595 in diameter.'),
  sphereObj('cannonball', 'Cannonball', '💣', 5.44, 0.1167, 'iron', '12-pounder solid iron shot (5.44 kg, 4.62 in).'),
  sphereObj('leadshot', 'Lead sphere 10 cm', '⚫', 5.94, 0.1, 'lead', 'Dense, compact: high ballistic coefficient. Melts at 600 K.'),
  sphereObj('raindrop', 'Raindrop 2 mm', '💧', 998.2 * (4 / 3) * Math.PI * 0.001 ** 3, 0.002, 'water',
    'Drag from Gunn & Kinzer (1949) measurements — includes drop flattening.', { kind: 'drop' }),
  sphereObj('hail', 'Hailstone 5 cm', '🧊', 917 * (4 / 3) * Math.PI * 0.025 ** 3, 0.05, 'ice', 'Golf-ball hail; melts above 273 K.', { kind: 'roughSphere', reShift: 1, cdFloor: 0.5 }),
  sphereObj('meteoroid', 'Iron meteoroid 30 cm', '☄️', 7870 * (4 / 3) * Math.PI * 0.15 ** 3, 0.3, 'iron', 'Throw it at 20 km/s from space to watch ablation.'),
  sphereObj('stonemeteor', 'Stony meteoroid 1 m', '🪨', 3300 * (4 / 3) * Math.PI * 0.5 ** 3, 1.0, 'stone', 'Chondrite density 3.3 g/cm³.'),
  {
    id: 'rock', name: 'Rock 1 kg', emoji: '🪨', shape: 'cube', mass: 1, length: 0.0718, area: 0.0718 ** 2,
    volume: 1 / 2700, surfaceArea: 6 * 0.0718 ** 2, noseRadius: 0.036, drag: { kind: 'bluff', cd0: 0.9 },
    material: 'stone', addedMass: 0.6, inertiaFactor: 1 / 6, description: 'Irregular granite chunk, Cd ≈ 0.9 (between sphere and cube).',
  },
  {
    id: 'coin', name: 'Coin (US quarter)', emoji: '🪙', shape: 'disk', mass: 0.00567, length: 0.02426,
    area: Math.PI * 0.01213 ** 2, volume: Math.PI * 0.01213 ** 2 * 0.00175, surfaceArea: 2 * Math.PI * 0.01213 ** 2 + Math.PI * 0.02426 * 0.00175,
    noseRadius: 0.012, drag: { kind: 'bluff', cd0: 1.1 }, material: 'copperNickel', addedMass: 0.64, inertiaFactor: 0.25,
    description: 'US Mint: 5.670 g, 24.26 mm, 1.75 mm thick. Tumbling disk, Cd ≈ 1.1 on face area (Heisinger et al. 2014).',
  },
  {
    id: 'feather', name: 'Feather', emoji: '🪶', shape: 'plate', mass: 1.0e-5, length: 0.06, area: 0.06 * 0.015,
    volume: 1.0e-5 / 1300, surfaceArea: 2 * 0.06 * 0.015, noseRadius: 0.005, drag: { kind: 'bluff', cd0: 1.4 },
    material: 'keratin', addedMass: 0, inertiaFactor: 0.1, description: '10 mg contour feather, 6×1.5 cm vane. Falls at < 1 m/s in air; like a hammer in vacuum.',
  },
  {
    id: 'skydiver', name: 'Skydiver (belly)', emoji: '🪂', shape: 'humanBelly', mass: 90, length: 1.8, area: 0.78,
    volume: 0.085, surfaceArea: 2.2, noseRadius: 0.3, drag: { kind: 'bluff', cd0: 0.63 }, material: 'human', addedMass: 0, inertiaFactor: 0.1,
    parachute: { cdA: 40, inflationTime: 3 },
    description: 'Belly-to-earth, 90 kg with rig; CdA = 0.49 m² (calibrated) → ~54 m/s (120 mph) terminal at sea level (USPA).',
  },
  {
    id: 'headdown', name: 'Skydiver (head-down)', emoji: '🤸', shape: 'humanHeadDown', mass: 90, length: 0.45, area: 0.32,
    volume: 0.085, surfaceArea: 2.2, noseRadius: 0.12, drag: { kind: 'bluff', cd0: 0.8 }, material: 'human', addedMass: 0, inertiaFactor: 0.1,
    parachute: { cdA: 40, inflationTime: 3 }, description: 'Head-down freefly, CdA = 0.26 m² (calibrated) → ~75 m/s (165 mph) terminal at sea level.',
  },
  {
    id: 'stratos', name: 'Stratos pressure-suit jumper', emoji: '👨‍🚀', shape: 'humanBelly', mass: 118, length: 1.8, area: 0.75,
    volume: 0.12, surfaceArea: 2.6, noseRadius: 0.3, drag: { kind: 'bluff', cd0: 0.55 }, material: 'human', addedMass: 0, inertiaFactor: 0.1,
    parachute: { cdA: 40, inflationTime: 3 },
    description: 'Jumper + full pressure suit & pack (~118 kg), Cd calibrated to the 377.1 m/s record peak. Try: Roswell, 38 969 m, deploy at 1 467 m AGL (Red Bull Stratos, 2012).',
  },
  {
    id: 'capsule', name: 'Re-entry capsule', emoji: '🛰️', shape: 'capsule', mass: 3000, length: 3.9, area: Math.PI * 1.95 ** 2,
    volume: 15, surfaceArea: 40, noseRadius: 4.7, drag: { kind: 'bluff', cd0: 1.0 }, material: 'pica', addedMass: 0, inertiaFactor: 0.3,
    parachute: { cdA: 700, inflationTime: 6 },
    description: 'Apollo-like blunt capsule, 3.9 m PICA heat shield, hypersonic Cd ≈ 1.3–1.4. Throw it at 7.8 km/s from 120 km.',
  },
];

export function customObject(p: {
  mass: number; shape: 'sphere' | 'cube' | 'disk' | 'cylinder'; size: number; material: string; cd?: number;
}): ObjectSpec {
  const s = p.size;
  const mat = MATERIALS[p.material];
  switch (p.shape) {
    case 'sphere':
      return {
        ...sphereObj('custom', 'Custom sphere', '🔵', p.mass, s, p.material, 'User-defined sphere',
          p.cd ? { kind: 'bluff', cd0: p.cd } : { kind: 'sphere' }),
        shape: p.cd ? 'custom' : 'sphere',
      };
    case 'cube':
      return {
        id: 'custom', name: 'Custom cube', emoji: '🟦', shape: 'cube', mass: p.mass, length: s, area: s * s, volume: s ** 3,
        surfaceArea: 6 * s * s, noseRadius: s / 2, drag: { kind: 'bluff', cd0: p.cd ?? 1.05 }, material: mat.id,
        addedMass: 0.7, inertiaFactor: 1 / 6, description: 'User-defined cube (Cd 1.05, Hoerner)',
      };
    case 'disk':
      return {
        id: 'custom', name: 'Custom disk', emoji: '⚪', shape: 'disk', mass: p.mass, length: s, area: (Math.PI * s * s) / 4,
        volume: ((Math.PI * s * s) / 4) * (s / 10), surfaceArea: (Math.PI * s * s) / 2, noseRadius: s / 2,
        drag: { kind: 'bluff', cd0: p.cd ?? 1.17 }, material: mat.id, addedMass: 0.64, inertiaFactor: 0.25,
        description: 'User-defined disk face-on (Cd 1.17, Hoerner), thickness = diameter/10',
      };
    case 'cylinder':
      return {
        id: 'custom', name: 'Custom cylinder', emoji: '🥫', shape: 'cylinder', mass: p.mass, length: s, area: s * 2 * s,
        volume: ((Math.PI * s * s) / 4) * 2 * s, surfaceArea: Math.PI * s * 2 * s + (Math.PI * s * s) / 2, noseRadius: s / 2,
        drag: { kind: 'bluff', cd0: p.cd ?? 0.74 }, material: mat.id, addedMass: 1, inertiaFactor: 0.5,
        description: 'User-defined cylinder (L = 2D), side-on: Cd = 1.2 × finite-length factor 0.62 (Hoerner Ch. 3)',
      };
  }
}

export function presetById(id: string): ObjectSpec {
  const p = PRESETS.find((o) => o.id === id);
  if (!p) throw new Error(`Unknown preset ${id}`);
  return p;
}
