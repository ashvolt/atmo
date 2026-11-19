/**
 * Apparatus: the hardware that produces the field, as both a physical field
 * assembly and a geometric description the renderer can draw.
 *
 * Every magnet and coil here is a real source from `sources.ts`, so the field
 * the picture shows is the field the solver uses — there is no separate
 * "display" model.
 */
import { MU0 } from './constants';
import {
  AxialGradientSource, CylinderMagnetSource, FieldAssembly, LoopSource, MagnetSource, SolenoidSource,
  rotationAxisAngle, type Mat3,
} from './sources';
import { emMaterial, remanenceAt } from './materials';
import { fieldTier, type LevMode, type VerdictTier } from './levitation';
import type { Vec3 } from '../vec3';

export type ApparatusId =
  | 'checkerboard' | 'magnetPair' | 'highFieldSolenoid' | 'bitterGradient' | 'idealGradient'
  | 'superconductorTrack' | 'halbachTrack' | 'acCoil' | 'emsRail' | 'levitronBase'
  | 'acousticCell' | 'opticalTweezer' | 'rotorRig' | 'balloonRig' | 'electrodePair';

export type PartKind = 'magnet' | 'coil' | 'solenoid' | 'plate' | 'yoke' | 'transducer' | 'reflector' | 'laser' | 'rotor' | 'electrode' | 'envelope';

export interface ApparatusPart {
  kind: PartKind;
  center: Vec3;
  /** full size (x, y, z) for boxes; [radius, radius, length] for round parts */
  size: Vec3;
  rot?: Mat3;
  /** +1 = north up, −1 = south up, 0 = not magnetic */
  polarity?: number;
  /** labelled colour role for the renderer */
  role?: 'copper' | 'iron' | 'superconductor' | 'conductor' | 'dielectric' | 'glass' | 'magnetN' | 'magnetS';
  label?: string;
}

export interface ParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  value: number;
  unit: string;
  log?: boolean;
  step?: number;
  hint?: string;
}

export interface Apparatus {
  id: ApparatusId;
  name: string;
  field: FieldAssembly;
  parts: ApparatusPart[];
  /** half-width of the interesting region [m] — sets the camera and the field grid */
  scale: number;
  /** a sensible starting height for the object [m] */
  startHeight: number;
  /** highest |B| anywhere the object can be [T] */
  peakField: number;
  /** extra numbers the mode solver needs */
  extras: Record<string, number>;
  notes: string[];
  /**
   * What it takes to own *this* apparatus as configured. The verdict uses it
   * when the object already levitates, instead of the cost of the
   * hypothetical magnet the build sheet sizes — a graphite flake over
   * hardware-shop magnets is a desk toy, not a national facility.
   */
  tier: VerdictTier;
}

export interface ApparatusDef {
  id: ApparatusId;
  name: string;
  modes: LevMode[];
  summary: string;
  params: ParamDef[];
  build(p: Record<string, number>): Apparatus;
}

const P = (key: string, label: string, min: number, max: number, value: number, unit: string, extra: Partial<ParamDef> = {}): ParamDef =>
  ({ key, label, min, max, value, unit, ...extra });

const get = (p: Record<string, number>, def: ApparatusDef, key: string) =>
  p[key] ?? def.params.find((q) => q.key === key)!.value;

/* ------------------------------------------------------------------------ */

/**
 * Checkerboard of cube magnets with alternating polarity — the classic
 * pyrolytic-graphite levitation demonstration. The field above a periodic
 * array falls off as exp(−2πz/λ) with λ twice the cube pitch, which is why
 * the gap is always a millimetre or two: the gradient only exists within a
 * fraction of the period.
 */
const checkerboard: ApparatusDef = {
  id: 'checkerboard',
  name: 'NdFeB checkerboard array',
  modes: ['diamagnetic', 'permanentMagnet', 'eddyCurrent'],
  summary: 'An n×n grid of cube magnets with alternating poles. Produces the strongest field gradient obtainable without a power supply.',
  params: [
    P('cube', 'Cube size', 0.003, 0.05, 0.0127, 'm', { hint: '12.7 mm = ½ inch, the common stock size' }),
    P('n', 'Grid', 2, 10, 6, 'per side', { step: 1 }),
    P('Br', 'Remanence', 0.39, 1.45, 1.32, 'T', { hint: 'N42 = 1.32 T' }),
    P('temp', 'Magnet temperature', 200, 350, 293.15, 'K'),
  ],
  build(p) {
    const s = get(p, checkerboard, 'cube');
    const n = Math.round(get(p, checkerboard, 'n'));
    const BrNom = get(p, checkerboard, 'Br');
    const T = get(p, checkerboard, 'temp');
    const Br = BrNom * (1 + -1.2e-3 * (T - 293.15));
    const field = new FieldAssembly();
    const parts: ApparatusPart[] = [];
    // Place one cube centred on the origin for both parities of n: above a
    // junction of four alternating cubes the vertical field cancels exactly by
    // symmetry, so the levitation axis has to run through a cube centre.
    const off = Math.floor(n / 2) * s;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const up = (i + j) % 2 === 0 ? 1 : -1;
        const c: Vec3 = [i * s - off, j * s - off, -s / 2];
        field.add(new MagnetSource(`cb${i}_${j}`, c, [s, s, s], Br * up));
        parts.push({ kind: 'magnet', center: c, size: [s, s, s], polarity: up, role: up > 0 ? 'magnetN' : 'magnetS' });
      }
    }
    const peak = Math.hypot(...field.B([0, 0, 1e-4]));
    return {
      id: 'checkerboard', name: `${n}×${n} checkerboard of ${(s * 1000).toFixed(1)} mm cubes`,
      field, parts, scale: Math.max(n * s * 0.8, 0.02), startHeight: s * 0.12,
      peakField: peak,
      extras: { wavelength: 2 * s, Br, pitch: s },
      notes: [
        `Field period λ = ${(2 * s * 1000).toFixed(1)} mm, so the field decays by e⁻²ᵖ ≈ 1/535 over one period above the surface.`,
        `Surface field ≈ ${peak.toFixed(3)} T; B·∂B/∂z just above the magnets reaches ${Math.abs(field.bGradB([0, 0, s * 0.05])).toFixed(0)} T²/m.`,
      ],
      tier: 'deskToy',
    };
  },
};

/**
 * Two coaxial magnets, the second one repelling. The Earnshaw demonstration:
 * the vertical force can be made to balance gravity exactly, and the lateral
 * stiffness is then necessarily negative.
 */
const magnetPair: ApparatusDef = {
  id: 'magnetPair',
  name: 'Repelling magnet pair',
  modes: ['permanentMagnet', 'spinStabilised'],
  summary: 'A base magnet with a second magnet floating above it, poles facing. The textbook arrangement that cannot work — and the proof is in the eigenvalues.',
  params: [
    P('diameter', 'Base magnet diameter', 0.01, 0.2, 0.05, 'm'),
    P('thickness', 'Base magnet thickness', 0.002, 0.05, 0.01, 'm'),
    P('Br', 'Remanence', 0.39, 1.45, 1.32, 'T'),
  ],
  build(p) {
    const d = get(p, magnetPair, 'diameter');
    const t = get(p, magnetPair, 'thickness');
    const Br = get(p, magnetPair, 'Br');
    const field = new FieldAssembly([new CylinderMagnetSource('base', [0, 0, -t / 2], [0, 0, 1], d / 2, t, Br)]);
    return {
      id: 'magnetPair', name: 'Repelling magnet pair',
      field,
      parts: [{ kind: 'magnet', center: [0, 0, -t / 2], size: [d / 2, d / 2, t], polarity: 1, role: 'magnetN', label: 'base magnet' }],
      scale: d, startHeight: d / 3,
      peakField: Math.abs(field.B([0, 0, 1e-4])[2]),
      extras: { Br, baseDiameter: d, baseThickness: t },
      notes: ['The floating magnet is modelled as a point dipole, so its energy −m·B is harmonic and Earnshaw applies exactly.'],
      tier: 'deskToy',
    };
  },
};

/**
 * A high-field superconducting solenoid: the Nijmegen-class magnet used for
 * diamagnetic levitation of water, frogs and hazelnuts. Its 32 mm bore and
 * 16 T peak field give B·∂B/∂z ≈ 1400 T²/m just above the midplane.
 */
const highFieldSolenoid: ApparatusDef = {
  id: 'highFieldSolenoid',
  name: 'High-field solenoid (Nijmegen class)',
  modes: ['diamagnetic', 'superconductor', 'eddyCurrent'],
  summary: 'A vertical-bore magnet. Levitation happens near the top of the winding, where the field is still strong but falling off fast.',
  params: [
    P('field', 'Central field', 1, 45, 16, 'T'),
    P('bore', 'Bore radius', 0.008, 0.2, 0.016, 'm'),
    P('length', 'Winding length', 0.05, 1.5, 0.4, 'm'),
  ],
  build(p) {
    const B = get(p, highFieldSolenoid, 'field');
    const bore = get(p, highFieldSolenoid, 'bore');
    const L = get(p, highFieldSolenoid, 'length');
    // choose the sheet current that gives the requested central field exactly
    const r = bore * 1.15;
    const ampTurns = (B * Math.sqrt(L * L + 4 * r * r)) / MU0;
    const sol = new SolenoidSource('sol', [0, 0, 0], [0, 0, 1], r, L, 1, ampTurns);
    const field = new FieldAssembly([sol]);
    return {
      id: 'highFieldSolenoid', name: `${B.toFixed(1)} T solenoid, ${(bore * 2000).toFixed(0)} mm bore`,
      field,
      parts: [{ kind: 'solenoid', center: [0, 0, 0], size: [r, r * 1.35, L], role: 'copper', label: 'winding' }],
      scale: Math.max(L * 0.7, bore * 6),
      startHeight: L / 2 - L * 0.12,
      peakField: Math.abs(sol.axialExact(0)),
      extras: { ampTurns, bore, length: L, windingRadius: r },
      notes: [
        `Central field ${Math.abs(sol.axialExact(0)).toFixed(2)} T from ${(ampTurns / 1e6).toFixed(2)} MA·turns.`,
        `Levitation sits near z = ±${((L / 2) * 100).toFixed(1)} cm, where |B·∂B/∂z| peaks at ${Math.abs(field.bGradB([0, 0, L / 2 - L * 0.1])).toFixed(0)} T²/m.`,
      ],
      tier: fieldTier(B),
    };
  },
};

/** A resistive Bitter-style magnet optimised for gradient rather than peak field. */
const bitterGradient: ApparatusDef = {
  id: 'bitterGradient',
  name: 'Gradient coil pair (anti-Helmholtz)',
  modes: ['diamagnetic', 'eddyCurrent', 'superconductor'],
  summary: 'Two coils driven in opposition. The field is zero at the centre and the gradient is nearly constant — the cleanest way to make a given B·∂B/∂z.',
  params: [
    P('radius', 'Coil radius', 0.01, 0.3, 0.05, 'm'),
    P('separation', 'Coil separation', 0.01, 0.5, 0.087, 'm', { hint: '√3·R is the ideal anti-Helmholtz spacing' }),
    P('ampTurns', 'Amp-turns per coil', 1e3, 1e7, 3e5, 'A·t', { log: true }),
  ],
  build(p) {
    const R = get(p, bitterGradient, 'radius');
    const sep = get(p, bitterGradient, 'separation');
    const NI = get(p, bitterGradient, 'ampTurns');
    const field = new FieldAssembly([
      new LoopSource('top', [0, 0, sep / 2], [0, 0, 1], R, NI),
      new LoopSource('bot', [0, 0, -sep / 2], [0, 0, 1], R, -NI),
    ]);
    const parts: ApparatusPart[] = [
      { kind: 'coil', center: [0, 0, sep / 2], size: [R, R * 0.12, R * 0.12], role: 'copper', polarity: 1 },
      { kind: 'coil', center: [0, 0, -sep / 2], size: [R, R * 0.12, R * 0.12], role: 'copper', polarity: -1 },
    ];
    const probe = R * 0.4;
    return {
      id: 'bitterGradient', name: 'Anti-Helmholtz gradient pair',
      field, parts, scale: Math.max(R * 1.6, sep), startHeight: probe,
      peakField: Math.hypot(...field.B([0, 0, sep / 2 - R * 0.1])),
      extras: { radius: R, separation: sep, ampTurns: NI },
      notes: [
        `|B| vanishes at the centre and the axial gradient there is ${(field.BJ([0, 0, 0]).J[8]).toFixed(1)} T/m.`,
        'A field zero is also a |B| minimum, so this geometry traps diamagnets and (for neutral atoms) is the magnetic analogue of a magneto-optical trap.',
      ],
      tier: 'universityLab',
    };
  },
};

/** The idealised divergence-free constant-gradient field, for clean theory. */
const idealGradient: ApparatusDef = {
  id: 'idealGradient',
  name: 'Ideal gradient field (theory)',
  modes: ['diamagnetic', 'permanentMagnet', 'superconductor'],
  summary: 'B = (−Gx/2, −Gy/2, B₀+Gz): the simplest field with a constant axial gradient that still satisfies ∇·B = 0 and ∇×B = 0. Use it to read off requirements without any hardware.',
  params: [
    P('B0', 'Field at the origin', 0, 50, 10, 'T'),
    P('G', 'Axial gradient', -2000, 2000, -200, 'T/m'),
  ],
  build(p) {
    const B0 = get(p, idealGradient, 'B0');
    const G = get(p, idealGradient, 'G');
    const field = new FieldAssembly([new AxialGradientSource('ideal', B0, G)]);
    return {
      id: 'idealGradient', name: 'Ideal gradient field',
      field, parts: [], scale: 0.05, startHeight: 0.01,
      peakField: Math.abs(B0),
      extras: { B0, G, bGradB: Math.abs(B0 * G) },
      notes: [
        `B·∂B/∂z = ${(B0 * G).toFixed(0)} T²/m at the origin.`,
        'A bare (0,0,B₀+Gz) would violate ∇·B = 0, so the transverse terms are not optional — and they are exactly what makes the trap unstable sideways for a fixed dipole.',
      ],
      tier: fieldTier(Math.abs(B0)),
    };
  },
};

/**
 * A permanent magnet above a bulk superconductor, cooled in place. The
 * superconductor's response is handled by the mode physics (Meissner image
 * plus flux pinning), so the assembly here holds only the magnet.
 */
const superconductorTrack: ApparatusDef = {
  id: 'superconductorTrack',
  name: 'Magnet over a bulk superconductor',
  modes: ['superconductor'],
  summary: 'A YBCO puck in liquid nitrogen with a magnet above it. Flux pinning holds the magnet sideways as well as up — the only passive mode that is stable in every direction.',
  params: [
    P('magnetD', 'Magnet diameter', 0.005, 0.1, 0.025, 'm'),
    P('magnetT', 'Magnet thickness', 0.002, 0.05, 0.01, 'm'),
    P('Br', 'Remanence', 0.39, 1.45, 1.32, 'T'),
    P('puckD', 'Superconductor diameter', 0.01, 0.15, 0.03, 'm'),
    P('puckT', 'Superconductor thickness', 0.002, 0.05, 0.01, 'm'),
    P('temp', 'Temperature', 4.2, 95, 77, 'K', { hint: '77 K = liquid nitrogen' }),
  ],
  build(p) {
    const d = get(p, superconductorTrack, 'magnetD');
    const t = get(p, superconductorTrack, 'magnetT');
    const Br = get(p, superconductorTrack, 'Br');
    const pd = get(p, superconductorTrack, 'puckD');
    const pt = get(p, superconductorTrack, 'puckT');
    const T = get(p, superconductorTrack, 'temp');
    // the field assembly is the *superconductor side*: empty. The floating
    // magnet is the object, and its image is created by the mode physics.
    const field = new FieldAssembly();
    return {
      id: 'superconductorTrack', name: 'YBCO puck + magnet',
      field,
      parts: [
        { kind: 'plate', center: [0, 0, -pt / 2], size: [pd / 2, pd / 2, pt], role: 'superconductor', label: 'YBCO' },
      ],
      scale: Math.max(pd, d) * 1.6, startHeight: d / 3,
      peakField: Br,
      extras: { magnetDiameter: d, magnetThickness: t, Br, puckDiameter: pd, puckThickness: pt, temperature: T },
      notes: [
        'Below 92 K YBCO expels flux (χ = −1) and pins what it cannot expel.',
        'Field-cooled, the pinned flux remembers the magnet’s position, which is what supplies the lateral restoring force.',
      ],
      tier: 'workshop',
    };
  },
};

/**
 * Inductrack: a linear Halbach array over a shorted aluminium track. The
 * array is built from real cube magnets with their magnetisation rotating
 * 90° per block, so the exp(−2πy/λ) decay is a result, not an assumption.
 */
const halbachTrack: ApparatusDef = {
  id: 'halbachTrack',
  name: 'Halbach array over a conducting track',
  modes: ['eddyCurrent'],
  summary: 'The Inductrack principle: move a Halbach array over a shorted coil track and the induced currents push it up. Lift grows with speed; drag falls.',
  params: [
    P('block', 'Magnet block size', 0.01, 0.1, 0.025, 'm'),
    P('blocks', 'Blocks', 4, 24, 12, '', { step: 1 }),
    P('Br', 'Remanence', 0.39, 1.45, 1.32, 'T'),
    P('gap', 'Gap to the track', 0.002, 0.1, 0.02, 'm'),
    P('speed', 'Speed', 0.5, 150, 30, 'm/s', { log: true }),
    P('vc', 'Track transition speed', 0.1, 20, 2, 'm/s', { hint: 'v_c = (R/L)(λ/2π) of the track' }),
  ],
  build(p) {
    const s = get(p, halbachTrack, 'block');
    const n = Math.round(get(p, halbachTrack, 'blocks'));
    const Br = get(p, halbachTrack, 'Br');
    const gap = get(p, halbachTrack, 'gap');
    const field = new FieldAssembly();
    const parts: ApparatusPart[] = [];
    const lambda = 4 * s;
    const off = ((n - 1) * s) / 2;
    for (let i = 0; i < n; i++) {
      // magnetisation rotates +90° per block about the y axis: +z, +x, −z, −x
      const angle = (i % 4) * (Math.PI / 2);
      const rot = rotationAxisAngle([0, 1, 0], angle);
      const c: Vec3 = [i * s - off, 0, s / 2 + gap];
      field.add(new MagnetSource(`hb${i}`, c, [s, s * 3, s], Br, rot));
      parts.push({ kind: 'magnet', center: c, size: [s, s * 3, s], rot, polarity: i % 4 === 0 ? 1 : i % 4 === 2 ? -1 : 0, role: 'magnetN' });
    }
    parts.push({ kind: 'plate', center: [0, 0, -s * 0.15], size: [n * s * 0.75, s * 2.2, s * 0.3], role: 'conductor', label: 'aluminium track' });
    const B0 = Math.hypot(...field.B([0, 0, 1e-4]));
    return {
      id: 'halbachTrack', name: `Halbach array, λ = ${(lambda * 1000).toFixed(0)} mm`,
      field, parts, scale: Math.max(n * s * 0.6, 0.05), startHeight: gap,
      peakField: B0,
      extras: { wavelength: lambda, Br, gap, block: s, speed: get(p, halbachTrack, 'speed'), vc: get(p, halbachTrack, 'vc'), trackArea: n * s * 0.75 * s * 2.2 },
      notes: [
        `Field just below the array: ${B0.toFixed(3)} T, decaying as exp(−2πz/λ) with λ = ${(lambda * 1000).toFixed(0)} mm.`,
        'A Halbach array puts almost all its flux on one side — the reason it beats a simple alternating array by about √2 in field.',
      ],
      tier: 'universityLab',
    };
  },
};

/** An AC coil levitating a conducting ring or plate (the Thomson-coil demo). */
const acCoil: ApparatusDef = {
  id: 'acCoil',
  name: 'AC coil (induction levitation)',
  modes: ['eddyCurrent'],
  summary: 'Mains-frequency current in a coil induces opposing currents in a conducting ring above it, and the two repel. The classic jumping-ring experiment, run continuously.',
  params: [
    P('radius', 'Coil radius', 0.01, 0.2, 0.04, 'm'),
    P('ampTurns', 'Amp-turns (rms)', 100, 2e5, 8000, 'A·t', { log: true }),
    P('frequency', 'Frequency', 10, 1e6, 50, 'Hz', { log: true }),
    P('length', 'Coil length', 0.005, 0.2, 0.04, 'm'),
  ],
  build(p) {
    const R = get(p, acCoil, 'radius');
    const NI = get(p, acCoil, 'ampTurns');
    const f = get(p, acCoil, 'frequency');
    const L = get(p, acCoil, 'length');
    const sol = new SolenoidSource('ac', [0, 0, -L / 2], [0, 0, 1], R, L, 1, NI);
    const field = new FieldAssembly([sol]);
    return {
      id: 'acCoil', name: `AC coil, ${f.toFixed(0)} Hz`,
      field,
      parts: [{ kind: 'solenoid', center: [0, 0, -L / 2], size: [R, R * 1.25, L], role: 'copper', label: 'drive coil' }],
      scale: R * 2.5, startHeight: R * 0.4,
      peakField: Math.abs(sol.axialExact(L / 2)),
      extras: { frequency: f, radius: R, ampTurns: NI },
      notes: [
        'The field here is the *amplitude* of the oscillating field; the time-averaged force follows the real part of the induced polarisability.',
        'Levitation costs continuous power because the induced currents dissipate — the floating object gets hot.',
      ],
      tier: 'workshop',
    };
  },
};

/** An attracting electromagnet above a steel rail: EMS Maglev. */
const emsRail: ApparatusDef = {
  id: 'emsRail',
  name: 'Servo electromagnet over a steel rail',
  modes: ['servo'],
  summary: 'An electromagnet pulls up on an iron rail from below it. Hopelessly unstable open-loop — and the basis of every commercial EMS Maglev train.',
  params: [
    P('gap', 'Nominal gap', 0.001, 0.05, 0.01, 'm'),
    P('poleArea', 'Pole face area', 1e-4, 0.5, 0.02, 'm²', { log: true }),
    P('turns', 'Turns', 50, 5000, 600, '', { step: 10 }),
    P('bandwidth', 'Control bandwidth', 5, 2000, 100, 'Hz', { log: true }),
  ],
  build(p) {
    const gap = get(p, emsRail, 'gap');
    const area = get(p, emsRail, 'poleArea');
    const turns = get(p, emsRail, 'turns');
    const bw = get(p, emsRail, 'bandwidth');
    const w = Math.sqrt(area);
    // The magnet is above and the object hangs beneath it across the gap —
    // the arrangement of both the classroom ball levitator and an EMS Maglev
    // bogie gripping its rail from below.
    // lift the pole faces clear of the bench so the suspended object, which
    // hangs a gap below them, is actually visible rather than buried
    const poleZ = Math.max(gap * 3, w * 0.5);
    return {
      id: 'emsRail', name: 'EMS servo magnet',
      field: new FieldAssembly(),
      parts: [
        { kind: 'yoke', center: [0, 0, poleZ + w * 0.35], size: [w * 1.3, w, w * 0.6], role: 'iron', label: 'E-core + winding' },
        { kind: 'plate', center: [0, 0, poleZ + w * 0.78], size: [w * 1.8, w * 1.3, w * 0.22], role: 'iron', label: 'steel rail' },
      ],
      scale: w * 1.45, startHeight: poleZ - gap - w * 0.25,
      peakField: 1.5,
      extras: { gap, poleArea: area, turns, bandwidth: bw, poleZ },
      notes: [
        'Maxwell stress sets the ceiling: B²/2μ₀ = 1.1 MPa at 1.7 T, where iron saturates.',
        'The open-loop plant has a real unstable pole at √(2g/x₀) — 44 s⁻¹ at a 10 mm gap, so the loop must close far faster than that.',
      ],
      tier: 'workshop',
    };
  },
};

/**
 * The Levitron base: a ring magnet, modelled exactly as a large cylinder plus
 * a coaxial inner cylinder of opposite remanence (so the hole is a genuine
 * absence of material, not an approximation).
 */
const levitronBase: ApparatusDef = {
  id: 'levitronBase',
  name: 'Levitron base (ring magnet)',
  modes: ['spinStabilised', 'permanentMagnet'],
  summary: 'A ring magnet whose field has a genuine local minimum of |B| above the hole. A spinning top sits in that minimum; a non-spinning one cannot.',
  params: [
    P('outer', 'Outer diameter', 0.04, 0.2, 0.1, 'm'),
    P('inner', 'Inner diameter', 0.005, 0.1, 0.04, 'm'),
    P('thickness', 'Thickness', 0.003, 0.05, 0.0125, 'm'),
    P('Br', 'Remanence', 0.2, 1.45, 0.39, 'T', { hint: 'the original Levitron base is ceramic ferrite' }),
  ],
  build(p) {
    const od = get(p, levitronBase, 'outer');
    const id2 = get(p, levitronBase, 'inner');
    const t = get(p, levitronBase, 'thickness');
    const Br = get(p, levitronBase, 'Br');
    const field = new FieldAssembly([
      new CylinderMagnetSource('ringOuter', [0, 0, -t / 2], [0, 0, 1], od / 2, t, Br),
      new CylinderMagnetSource('ringHole', [0, 0, -t / 2], [0, 0, 1], id2 / 2, t, -Br),
    ]);
    return {
      id: 'levitronBase', name: 'Levitron ring magnet',
      field,
      parts: [{ kind: 'magnet', center: [0, 0, -t / 2], size: [od / 2, id2 / 2, t], polarity: 1, role: 'magnetN', label: 'ring magnet' }],
      scale: od * 0.9, startHeight: od * 0.3,
      peakField: Math.abs(field.B([0, 0, 1e-4])[2]),
      extras: { outer: od, inner: id2, thickness: t, Br },
      notes: [
        'Superposing a full disc with a negative inner disc is exact: uniform magnetisation is additive.',
        'The trap exists only over a band of heights a few millimetres tall, which is why the top’s mass has to be tuned with washers to a fraction of a gram.',
      ],
      tier: 'deskToy',
    };
  },
};

/** A 40 kHz standing-wave acoustic levitator: transducer plus reflector. */
const acousticCell: ApparatusDef = {
  id: 'acousticCell',
  name: 'Acoustic levitator (standing wave)',
  modes: ['acoustic'],
  summary: 'An ultrasonic transducer facing a reflector a whole number of half-wavelengths away. Particles collect at the pressure nodes.',
  params: [
    P('frequency', 'Frequency', 20000, 200000, 40000, 'Hz', { log: true }),
    P('spl', 'Sound pressure level', 120, 180, 160, 'dB'),
    P('nodes', 'Half-wavelengths in the cavity', 1, 10, 4, '', { step: 1 }),
    P('aperture', 'Transducer diameter', 0.005, 0.1, 0.016, 'm'),
  ],
  build(p) {
    const f = get(p, acousticCell, 'frequency');
    const spl = get(p, acousticCell, 'spl');
    const nodes = Math.round(get(p, acousticCell, 'nodes'));
    const ap = get(p, acousticCell, 'aperture');
    const c0 = emMaterial('air').soundSpeed!;
    const lambda = c0 / f;
    const height = (nodes * lambda) / 2;
    return {
      id: 'acousticCell', name: `${(f / 1000).toFixed(0)} kHz standing-wave levitator`,
      field: new FieldAssembly(),
      parts: [
        { kind: 'transducer', center: [0, 0, 0], size: [ap / 2, ap / 2, ap * 0.4], role: 'dielectric', label: 'transducer' },
        { kind: 'reflector', center: [0, 0, height], size: [ap * 0.62, ap * 0.62, ap * 0.12], role: 'conductor', label: 'reflector' },
      ],
      scale: Math.max(height, ap) * 0.9, startHeight: lambda / 4,
      peakField: 0,
      extras: { frequency: f, spl, pressure: 2e-5 * Math.pow(10, spl / 20), wavelength: lambda, cavity: height, aperture: ap, nodeCount: nodes },
      notes: [
        `Node spacing λ/2 = ${(lambda / 2 * 1000).toFixed(2)} mm; particles must be smaller than about λ/8 for the small-particle theory to hold.`,
        `${spl.toFixed(0)} dB is a pressure amplitude of ${(2e-5 * Math.pow(10, spl / 20)).toFixed(0)} Pa — loud enough to be dangerous if it were audible.`,
      ],
      tier: 'workshop',
    };
  },
};

/** A focused laser beam: optical tweezers / optical levitation. */
const opticalTweezer: ApparatusDef = {
  id: 'opticalTweezer',
  name: 'Optical trap (focused laser)',
  modes: ['optical'],
  summary: 'A tightly focused beam. The gradient force pulls a transparent bead to the brightest point; radiation pressure pushes it along the beam.',
  params: [
    P('power', 'Laser power', 1e-4, 1e6, 0.01, 'W', { log: true }),
    P('waist', 'Focal waist', 2e-7, 1e-4, 5e-7, 'm', { log: true }),
    P('wavelength', 'Wavelength', 4e-7, 2e-6, 1.064e-6, 'm', { log: true }),
  ],
  build(p) {
    const power = get(p, opticalTweezer, 'power');
    const waist = get(p, opticalTweezer, 'waist');
    const lambda = get(p, opticalTweezer, 'wavelength');
    return {
      id: 'opticalTweezer', name: `${power >= 1 ? power.toFixed(1) + ' W' : (power * 1000).toFixed(1) + ' mW'} optical trap`,
      field: new FieldAssembly(),
      parts: [{ kind: 'laser', center: [0, 0, -0.002], size: [waist * 40, waist * 40, 0.004], role: 'glass', label: 'objective' }],
      scale: Math.max(waist * 60, 2e-5), startHeight: 0,
      peakField: 0,
      extras: { power, waist, wavelength: lambda, intensity: (2 * power) / (Math.PI * waist * waist) },
      notes: [
        `Peak intensity ${((2 * power) / (Math.PI * waist * waist) / 1e9).toPrecision(3)} GW/m² at the focus.`,
        'Levitating against gravity by radiation pressure alone needs F = 2P/c, which is why a gram would take 1.5 MW.',
      ],
      tier: 'universityLab',
    };
  },
};

/** A rotor rig: thrust levitation by momentum transfer. */
const rotorRig: ApparatusDef = {
  id: 'rotorRig',
  name: 'Rotors (thrust)',
  modes: ['aerodynamic'],
  summary: 'Push air down hard enough and anything hovers. Momentum theory gives the minimum power, and it is brutal for small discs.',
  params: [
    P('rotorR', 'Rotor radius', 0.02, 5, 0.12, 'm', { log: true }),
    P('rotors', 'Rotors', 1, 8, 4, '', { step: 1 }),
    P('figureOfMerit', 'Figure of merit', 0.3, 0.85, 0.6, '', { hint: 'ideal = 1; small propellers manage 0.4–0.6' }),
  ],
  build(p) {
    const R = get(p, rotorRig, 'rotorR');
    const n = Math.round(get(p, rotorRig, 'rotors'));
    const fm = get(p, rotorRig, 'figureOfMerit');
    const parts: ApparatusPart[] = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 2 * Math.PI;
      const d = n > 1 ? R * 1.3 : 0;
      parts.push({ kind: 'rotor', center: [Math.cos(a) * d, Math.sin(a) * d, 0], size: [R, R, R * 0.04], role: 'conductor' });
    }
    return {
      id: 'rotorRig', name: `${n} × ${(R * 100).toFixed(0)} cm rotors`,
      field: new FieldAssembly(), parts,
      scale: R * 3, startHeight: R * 0.5,
      peakField: 0,
      extras: { discArea: n * Math.PI * R * R, figureOfMerit: fm, rotors: n, rotorRadius: R },
      notes: ['Ideal hover power scales as (mg)^{3/2}/√(2ρA): doubling the disc area saves 30 % of the power.'],
      tier: 'deskToy',
    };
  },
};

/** A lifting-gas envelope: buoyancy. */
const balloonRig: ApparatusDef = {
  id: 'balloonRig',
  name: 'Lifting gas (buoyancy)',
  modes: ['buoyancy'],
  summary: 'The oldest levitation technology. Displace more air than you weigh.',
  params: [
    P('gasDensity', 'Lifting-gas density', 0.0899, 1.2, 0.1786, 'kg/m³', { hint: 'H₂ 0.0899, He 0.1786, hot air ≈ 0.95' }),
    P('airDensity', 'Ambient air density', 0.05, 1.3, 1.225, 'kg/m³'),
    P('envelopeMass', 'Envelope mass fraction', 0, 0.9, 0.2, '', { hint: 'share of the lift spent on the skin' }),
  ],
  build(p) {
    const gas = get(p, balloonRig, 'gasDensity');
    const air = get(p, balloonRig, 'airDensity');
    const frac = get(p, balloonRig, 'envelopeMass');
    return {
      id: 'balloonRig', name: 'Buoyant envelope',
      field: new FieldAssembly(),
      parts: [{ kind: 'envelope', center: [0, 0, 0.6], size: [0.5, 0.5, 0.6], role: 'dielectric', label: 'envelope' }],
      scale: 1.2, startHeight: 0.5,
      peakField: 0,
      extras: { gasDensity: gas, airDensity: air, envelopeFraction: frac },
      notes: [`Net lift ${(air - gas).toFixed(3)} kg per m³ — ${((air - gas) * (1 - frac)).toFixed(3)} kg after the envelope.`],
      tier: 'deskToy',
    };
  },
};

/** A parallel-plate electrostatic levitator. */
const electrodePair: ApparatusDef = {
  id: 'electrodePair',
  name: 'Electrostatic levitator (parallel plates)',
  modes: ['electrostatic'],
  summary: 'A charged object between two plates. Simple, and provably unstable without feedback — which is exactly how NASA’s ESL is built.',
  params: [
    P('gap', 'Plate gap', 0.002, 0.2, 0.02, 'm'),
    P('voltage', 'Plate voltage', 100, 500000, 20000, 'V', { log: true }),
    P('medium', 'Medium (0 air, 1 vacuum, 2 oil)', 0, 2, 0, '', { step: 1 }),
  ],
  build(p) {
    const gap = get(p, electrodePair, 'gap');
    const V = get(p, electrodePair, 'voltage');
    const med = Math.round(get(p, electrodePair, 'medium'));
    const w = gap * 3;
    return {
      id: 'electrodePair', name: `Electrostatic levitator, ${(V / 1000).toFixed(1)} kV over ${(gap * 1000).toFixed(0)} mm`,
      field: new FieldAssembly(),
      parts: [
        { kind: 'electrode', center: [0, 0, gap], size: [w, w, gap * 0.08], role: 'conductor', label: '+' },
        { kind: 'electrode', center: [0, 0, 0], size: [w, w, gap * 0.08], role: 'conductor', label: '−' },
      ],
      scale: w * 0.8, startHeight: gap / 2,
      peakField: 0,
      extras: { gap, voltage: V, Efield: V / gap, medium: med },
      notes: [
        `Uniform field E = ${(V / gap / 1e6).toFixed(2)} MV/m.`,
        'Air breaks down at 3 MV/m, so the field — and therefore the liftable mass — is capped by the gas, not the supply.',
      ],
      tier: 'workshop',
    };
  },
};

export const APPARATUS: ApparatusDef[] = [
  checkerboard, magnetPair, highFieldSolenoid, bitterGradient, idealGradient,
  superconductorTrack, halbachTrack, acCoil, emsRail, levitronBase,
  acousticCell, opticalTweezer, rotorRig, balloonRig, electrodePair,
];

export const APPARATUS_BY_ID: Record<string, ApparatusDef> = Object.fromEntries(APPARATUS.map((a) => [a.id, a]));

export function apparatusFor(mode: LevMode): ApparatusDef[] {
  return APPARATUS.filter((a) => a.modes.includes(mode));
}

export function defaultParams(def: ApparatusDef): Record<string, number> {
  return Object.fromEntries(def.params.map((p) => [p.key, p.value]));
}

export function buildApparatus(id: ApparatusId, params: Record<string, number> = {}): Apparatus {
  const def = APPARATUS_BY_ID[id];
  if (!def) throw new Error(`Unknown apparatus ${id}`);
  return def.build({ ...defaultParams(def), ...params });
}

void remanenceAt;
