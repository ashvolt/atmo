/**
 * Objects to levitate. Masses and sizes are the real ones where the object
 * comes from a published experiment (the Nijmegen frog, the Levitron top,
 * Ashkin's silica sphere), so the solver's answers can be checked against
 * what actually happened.
 */
import { emMaterial } from './materials';
import { objectVolume, type LevObject } from './levitation';

function obj(o: Omit<LevObject, 'mass'> & { mass?: number }): LevObject {
  const mass = o.mass ?? emMaterial(o.material).density * objectVolume(o);
  return { ...o, mass };
}

export const LEV_OBJECTS: LevObject[] = [
  obj({
    id: 'graphiteFlake', name: 'Pyrolytic graphite flake', emoji: '◼️',
    shape: 'plate', size: 0.01, thickness: 0.001, material: 'pyrolyticGraphite',
    moment: 0, charge: 0, spinRps: 0,
    description: '10 × 10 × 1 mm, 0.22 g. Floats unaided a millimetre above a checkerboard of neodymium cubes — the only room-temperature levitation anyone can do on a desk.',
  }),
  obj({
    id: 'graphiteBig', name: 'Graphite tile 25 mm', emoji: '⬛',
    shape: 'plate', size: 0.025, thickness: 0.002, material: 'pyrolyticGraphite',
    moment: 0, charge: 0, spinRps: 0,
    description: 'Bigger and heavier, but the requirement does not change: diamagnetic levitation depends on density, not size.',
  }),
  obj({
    id: 'bismuthCube', name: 'Bismuth cube 10 mm', emoji: '🔷',
    shape: 'cube', size: 0.01, thickness: 0.01, material: 'bismuth',
    moment: 0, charge: 0, spinRps: 0,
    description: 'The most diamagnetic metal — but nearly five times denser than graphite, so it needs about ten times the field–gradient product.',
  }),
  obj({
    id: 'waterDrop', name: 'Water droplet 5 mm', emoji: '💧',
    shape: 'sphere', size: 0.005, thickness: 0.005, material: 'water',
    moment: 0, charge: 0, spinRps: 0,
    description: 'Needs B·∂B/∂z ≈ 1360 T²/m. Levitated at Nijmegen in 1997 in a 16 T bore.',
  }),
  obj({
    id: 'frog', name: 'Frog (30 g)', emoji: '🐸',
    shape: 'sphere', size: 0.038, thickness: 0.038, material: 'tissue', mass: 0.03,
    moment: 0, charge: 0, spinRps: 0,
    description: 'The famous one: a live frog levitated in the 16 T, 32 mm bore magnet at the Nijmegen High Field Magnet Laboratory. It was unharmed. Berry & Geim, Eur. J. Phys. 18 (1997) 307.',
  }),
  obj({
    id: 'mouse', name: 'Mouse (20 g)', emoji: '🐭',
    shape: 'sphere', size: 0.033, thickness: 0.033, material: 'tissue', mass: 0.02,
    moment: 0, charge: 0, spinRps: 0,
    description: 'Also levitated magnetically (NASA JPL, 2009), in a 17 T superconducting magnet, as a microgravity analogue.',
  }),
  obj({
    id: 'human', name: 'Person (70 kg)', emoji: '🧑',
    shape: 'cylinder', size: 0.4, thickness: 1.75, material: 'tissue', mass: 70,
    moment: 0, charge: 0, spinRps: 0,
    description: 'The honest test case. Diamagnetic levitation of a person is not forbidden — it needs about 40–55 T over a body-sized volume, above any magnet ever built and far above any safe one.',
  }),
  obj({
    id: 'alDisc', name: 'Aluminium disc 50 mm', emoji: '⚪',
    shape: 'disk', size: 0.05, thickness: 0.003, material: 'aluminium',
    moment: 0, charge: 0, spinRps: 0,
    description: 'Paramagnetic, so it can never levitate in a static field — but an excellent conductor, so an AC coil throws it upwards.',
  }),
  obj({
    id: 'cuPlate', name: 'Copper plate 80 mm', emoji: '🟫',
    shape: 'plate', size: 0.08, thickness: 0.004, material: 'copper',
    moment: 0, charge: 0, spinRps: 0,
    description: 'The jumping-ring demonstration in plate form: eddy currents, not magnetism, do the work.',
  }),
  obj({
    id: 'ybcoPuck', name: 'YBCO puck 25 mm', emoji: '🥏',
    shape: 'disk', size: 0.025, thickness: 0.008, material: 'ybco',
    moment: 0, charge: 0, spinRps: 0,
    description: 'Melt-textured bulk YBCO. Cooled in liquid nitrogen it locks itself in place above a magnet track, sideways as well as vertically.',
  }),
  obj({
    id: 'magnetCube', name: 'NdFeB cube 12.7 mm', emoji: '🧲',
    shape: 'cube', size: 0.0127, thickness: 0.0127, material: 'ndfeb_n42',
    moment: (1.32 / 1.25663706212e-6) * 0.0127 ** 3,
    charge: 0, spinRps: 0,
    description: 'Half-inch N42 cube, moment ≈ 2.2 A·m². Over a superconductor it floats; over another magnet it cannot be made to sit still.',
  }),
  obj({
    id: 'magnetDisc', name: 'NdFeB disc 25 mm', emoji: '⭕',
    shape: 'disk', size: 0.025, thickness: 0.005, material: 'ndfeb_n42',
    moment: (1.32 / 1.25663706212e-6) * Math.PI * 0.0125 ** 2 * 0.005,
    charge: 0, spinRps: 0,
    description: 'A thin disc magnet: the usual floater in a superconducting levitation demonstration.',
  }),
  obj({
    id: 'levitronTop', name: 'Levitron top (18 g)', emoji: '🌀',
    shape: 'disk', size: 0.0254, thickness: 0.006, material: 'ferrite', mass: 0.0171,
    // ceramic ferrite ring, Br = 0.39 T: m = (Br/μ₀)·V ≈ 0.82 A·m²
    moment: 0.82, charge: 0, spinRps: 28,
    description: 'Ring-magnet top, trimmed to 17.1 g with brass washers. Works only between roughly 20 and 35 revolutions per second, and only if the mass is tuned to a fraction of a gram — add 1 g and the trap vanishes.',
  }),
  obj({
    id: 'steelBall', name: 'Steel ball 25 mm', emoji: '⚫',
    shape: 'sphere', size: 0.025, thickness: 0.025, material: 'steel',
    moment: 0, charge: 0, spinRps: 0,
    description: 'Ferromagnetic: always attracted, never passively stable. The standard demonstration object for a feedback levitator.',
  }),
  obj({
    id: 'maglevCar', name: 'Maglev vehicle (20 t)', emoji: '🚄',
    shape: 'plate', size: 3, thickness: 1, material: 'steel', mass: 20000,
    moment: 0, charge: 0, spinRps: 0,
    description: 'A real Transrapid-class vehicle section. Electromagnetic suspension holds a 10 mm gap with a closed-loop bandwidth of a few hundred hertz.',
  }),
  obj({
    id: 'psBead', name: 'Polystyrene bead 1 mm', emoji: '⚪',
    shape: 'sphere', size: 0.001, thickness: 0.001, material: 'polystyrene',
    moment: 0, charge: 0, spinRps: 0,
    description: 'The standard acoustic-levitation particle: light, and acoustically very different from air.',
  }),
  obj({
    id: 'psBeadMicro', name: 'Polystyrene bead 1 µm', emoji: '·',
    shape: 'sphere', size: 1e-6, thickness: 1e-6, material: 'polystyrene',
    moment: 0, charge: 0, spinRps: 0,
    description: 'An optical-tweezers bead. Trapped routinely with a few milliwatts; a trap stiffness of 0.05–0.2 pN/nm is typical.',
  }),
  obj({
    id: 'silicaSphere', name: 'Silica sphere 20 µm', emoji: '•',
    shape: 'sphere', size: 2e-5, thickness: 2e-5, material: 'quartz',
    moment: 0, charge: 0, spinRps: 0,
    description: 'Ashkin levitated one of these optically in 1971 with about 250 mW — the first optical levitation of a macroscopic object.',
  }),
  obj({
    id: 'oilDrop', name: 'Oil drop 1 µm (Millikan)', emoji: '🔸',
    shape: 'sphere', size: 2e-6, thickness: 2e-6, material: 'transformerOil',
    moment: 0, charge: 5 * 1.602176634e-19, spinRps: 0,
    description: 'Millikan’s experiment held a charged oil drop still in a vertical electric field. With a handful of elementary charges, a field of a few hundred kV/m does it.',
  }),
  obj({
    id: 'quadcopter', name: 'Quadcopter (1 kg)', emoji: '🛸',
    shape: 'plate', size: 0.3, thickness: 0.05, material: 'polystyrene', mass: 1,
    moment: 0, charge: 0, spinRps: 0,
    description: 'Thrust levitation. A 1 kg machine on four 24 cm rotors needs about 100 W of shaft power to hover.',
  }),
  obj({
    id: 'payload', name: 'Balloon payload (1 kg)', emoji: '🎈',
    shape: 'cube', size: 0.1, thickness: 0.1, material: 'polystyrene', mass: 1,
    moment: 0, charge: 0, spinRps: 0,
    description: 'Archimedes still wins on energy: a cubic metre of helium lifts about 1.05 kg and costs nothing to keep up.',
  }),
];

export const LEV_OBJECT_BY_ID: Record<string, LevObject> = Object.fromEntries(LEV_OBJECTS.map((o) => [o.id, o]));

export function levObject(id: string): LevObject {
  const o = LEV_OBJECT_BY_ID[id];
  if (!o) throw new Error(`Unknown levitation object ${id}`);
  return o;
}

/** Build a custom object, recomputing mass from the material unless given. */
export function customLevObject(p: {
  shape: LevObject['shape']; size: number; thickness: number; material: string; mass?: number; moment?: number; charge?: number; spinRps?: number;
}): LevObject {
  return obj({
    id: 'custom', name: 'Custom object', emoji: '🛠️',
    shape: p.shape, size: p.size, thickness: p.thickness, material: p.material,
    mass: p.mass, moment: p.moment ?? 0, charge: p.charge ?? 0, spinRps: p.spinRps ?? 0,
    description: 'User-defined object.',
  });
}
