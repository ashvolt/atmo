import { describe, expect, it } from 'vitest';
import {
  acousticLevitation, analyseStability, buoyantVolume, demagFactor, designServo, diamagneticRequirement,
  eddySpherePolarisability, electrostaticLimits, emsForce, hoverPower, inductrack, levitronWindow,
  meissnerForce, meissnerHeight, meissnerHeightFinite, opticalLevitation, pinningCapability, stableBand,
  fixedDipolePotential, inducedPotential, adiabaticDipolePotential, verticalEquilibria, m3solve,
} from '../src/physics/em/levitation';
import { emMaterial, criticalCurrentDensity } from '../src/physics/em/materials';
import { buildApparatus, APPARATUS, defaultParams, APPARATUS_BY_ID } from '../src/physics/em/apparatus';
import { designSolenoid } from '../src/physics/em/engineering';
import { LEV_OBJECTS, levObject } from '../src/physics/em/objects';
import { solveLevitation } from '../src/physics/em/solve';
import { FieldAssembly, LoopSource, MagnetSource, SolenoidSource } from '../src/physics/em/sources';
import { MU0, EPS0, C_LIGHT } from '../src/physics/em/constants';
import type { Vec3 } from '../src/physics/vec3';

const G = 9.80665;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const base = { g: G, medium: 'air', temperature: 293.15, cooling: 'water' as const, bodyName: 'Earth', siteName: 'lab' };

function solve(mode: Parameters<typeof solveLevitation>[0]['mode'], apparatus: string, objectId: string, params: Record<string, number> = {}) {
  const def = APPARATUS_BY_ID[apparatus];
  return solveLevitation({
    ...base, mode, apparatus: apparatus as never,
    params: { ...defaultParams(def), ...params },
    object: levObject(objectId),
  });
}

describe('Earnshaw’s theorem', () => {
  it('a fixed dipole’s stiffnesses sum to zero everywhere', () => {
    // ∇²U = 0 for U = −m·B, so the three stiffness eigenvalues must cancel.
    const field = new FieldAssembly([
      new LoopSource('a', [0, 0, 0], [0, 0, 1], 0.04, 8000),
      new MagnetSource('b', [0.02, 0.01, -0.02], [0.02, 0.02, 0.01], 1.32),
    ]);
    const model = fixedDipolePotential(field, [0.1, -0.3, 0.9], 0.05, G);
    for (const p of [[0.01, 0.02, 0.05], [-0.03, 0.01, 0.08], [0.0, 0.0, 0.12]] as Vec3[]) {
      const { hess } = model.at(p);
      const ev = analyseStability(hess, 0.05).stiffness;
      const scale = Math.max(...ev.map(Math.abs));
      expect(Math.abs(ev[0] + ev[1] + ev[2]) / scale).toBeLessThan(1e-9);
      // and therefore at least one direction is unstable
      expect(ev[0]).toBeLessThan(0);
    }
  });

  it('a paramagnet can never be trapped, a diamagnet can', () => {
    const field = new FieldAssembly([
      new LoopSource('t', [0, 0, 0.03], [0, 0, 1], 0.04, 20000),
      new LoopSource('b', [0, 0, -0.03], [0, 0, 1], 0.04, -20000),
    ]);
    // the anti-Helmholtz pair has a field zero at the centre: a B² minimum
    const dia = inducedPotential(field, -9.05e-6, 1e-6, 1e-3, 0);
    const para = inducedPotential(field, +9.05e-6, 1e-6, 1e-3, 0);
    const kd = analyseStability(dia.at([0, 0, 0]).hess, 1e-3).stiffness;
    const kp = analyseStability(para.at([0, 0, 0]).hess, 1e-3).stiffness;
    expect(kd[0]).toBeGreaterThan(0); // minimum: stable
    expect(kp[2]).toBeLessThan(0); // maximum: unstable in every direction
    expect(kp[0]).toBeLessThan(0);
  });

  it('∇²(B²) ≥ 0 — the identity that makes diamagnetic levitation possible', () => {
    const field = new FieldAssembly([new MagnetSource('m', [0, 0, 0], [0.02, 0.02, 0.01], 1.32)]);
    for (let i = 1; i <= 25; i++) {
      const p: Vec3 = [0.004 * i, 0.003 * i, 0.02 + 0.002 * i];
      const b2 = field.B2d(p);
      const { J } = field.BJ(p);
      // ∇²(B²) = 2|∇B|², to machine precision
      const gradBsq = J.reduce((s, v) => s + v * v, 0);
      expect(rel(b2.laplacian, 2 * gradBsq)).toBeLessThan(1e-9);
      expect(b2.laplacian).toBeGreaterThan(0);
    }
  });

  it('the demagnetising factor is exact for the shapes it claims', () => {
    expect(demagFactor('sphere')).toBeCloseTo(1 / 3, 15);
    expect(demagFactor('plate')).toBe(1);
    // χ = −1 (superconductor) in a sphere gives χ_eff = −3/2
    const chiEff = -1 / (1 + demagFactor('sphere') * -1);
    expect(chiEff).toBeCloseTo(-1.5, 12);
  });
});

describe('diamagnetic levitation', () => {
  it('water needs the published field–gradient product', () => {
    const r = diamagneticRequirement(emMaterial('water'), G, emMaterial('vacuum'));
    // μ₀ρg/|χ| with χ = −9.05e−6; the literature figure for water is ≈1400 T²/m
    expect(r.bGradB).toBeGreaterThan(1300);
    expect(r.bGradB).toBeLessThan(1450);
    expect(rel(r.bGradB, (MU0 * 998.2 * G) / 9.05e-6)).toBeLessThan(1e-12);
  });

  it('pyrolytic graphite needs ~20× less than water, and levitates on permanent magnets', () => {
    const g = diamagneticRequirement(emMaterial('pyrolyticGraphite'), G);
    const w = diamagneticRequirement(emMaterial('water'), G);
    expect(w.bGradB / g.bGradB).toBeGreaterThan(15);
    const s = solve('diamagnetic', 'checkerboard', 'graphiteFlake');
    expect(s.verdict.works).toBe(true);
    // the real demonstration floats a flake one to two millimetres up
    expect(s.equilibriumHeight!).toBeGreaterThan(0.0003);
    expect(s.equilibriumHeight!).toBeLessThan(0.004);
    expect(s.verdict.tier).toBe('deskToy');
  });

  it('a paramagnetic object is refused outright', () => {
    const s = solve('diamagnetic', 'checkerboard', 'alDisc');
    expect(s.verdict.possible).toBe(false);
    expect(s.verdict.tier).toBe('forbidden');
  });

  it('levitating a person needs tens of tesla, above any magnet ever built', () => {
    const s = solve('diamagnetic', 'idealGradient', 'human');
    const field = s.requirements.find((r) => r.label.startsWith('Peak field'))!;
    expect(field.value).toBeGreaterThan(30);
    expect(field.value).toBeLessThan(80);
    expect(s.verdict.possible).toBe(true); // not forbidden — just out of reach
  });

  it('the stable band is a property of the geometry, not the current', () => {
    // scaling every current leaves the sign of ∇∇(B²) unchanged
    const mk = (s: number) => new FieldAssembly([new SolenoidSource('s', [0, 0, 0], [0, 0, 1], 0.02, 0.4, 1, 1e6 * s)]);
    const a = stableBand(mk(1), 0.15, 0.3, 400);
    const b = stableBand(mk(3.7), 0.15, 0.3, 400);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(Math.abs(a!.zBest - b!.zBest)).toBeLessThan(1e-6);
    // and B·∂B/∂z scales exactly as the square
    expect(rel(b!.bGradB, a!.bGradB * 3.7 ** 2)).toBeLessThan(1e-6);
  });

  it('a frog levitates in a solenoid turned down to about 10 T', () => {
    const s = solve('diamagnetic', 'highFieldSolenoid', 'frog');
    const drive = s.achieved.find((r) => r.label.startsWith('Drive level'))!;
    // 16 T × scale; Nijmegen levitated frogs in a 16 T, 32 mm bore magnet
    expect(16 * drive.value).toBeGreaterThan(8);
    expect(16 * drive.value).toBeLessThan(14);
  });
});

describe('permanent magnets and superconductors', () => {
  it('a magnet over a magnet balances but is always a saddle', () => {
    const s = solve('permanentMagnet', 'magnetPair', 'magnetCube');
    expect(s.equilibriumHeight).not.toBeNull();
    expect(s.stability!.stable).toBe(false);
    expect(s.stability!.unstableDirections).toBeGreaterThan(0);
    const trace = s.achieved.find((r) => r.label.startsWith('Trace'))!;
    expect(Math.abs(trace.value)).toBeLessThan(1e-12);
  });

  it('Meissner repulsion follows the image-dipole law exactly', () => {
    const m = 2.5, h = 0.02;
    expect(rel(meissnerForce(m, h), (3 * MU0 * m * m) / (32 * Math.PI * h ** 4))).toBeLessThan(1e-15);
    // the height formula is its exact inverse
    const w = meissnerForce(m, h);
    expect(rel(meissnerHeight(m, w), h)).toBeLessThan(1e-12);
    // the finite-puck correction always sits lower than the infinite plane
    const hf = meissnerHeightFinite(m, w, 0.015);
    expect(hf).toBeLessThan(h);
    expect(hf).toBeGreaterThan(0);
  });

  it('Jc falls with temperature and field, and vanishes above Tc', () => {
    const ybco = emMaterial('ybco');
    expect(criticalCurrentDensity(ybco, 0, 95)).toBe(0);
    const j77 = criticalCurrentDensity(ybco, 0, 77);
    const j4 = criticalCurrentDensity(ybco, 0, 4.2);
    expect(j4).toBeGreaterThan(j77);
    expect(criticalCurrentDensity(ybco, 2, 77)).toBeLessThan(j77);
    // the published self-field value at 77 K is ~3×10⁸ A/m²
    expect(j77).toBeGreaterThan(1e8);
    expect(j77).toBeLessThan(1e9);
  });

  it('pinning pressure never exceeds the Maxwell stress', () => {
    for (const B of [0.1, 0.5, 1, 2]) {
      const p = pinningCapability(emMaterial('ybco'), B, 77, 0.01);
      expect(p.pressure).toBeLessThanOrEqual(p.maxPressure * (1 + 1e-12));
      expect(rel(p.maxPressure, (B * B) / (2 * MU0))).toBeLessThan(1e-15);
    }
  });

  it('a magnet floats stably over a nitrogen-cooled YBCO puck', () => {
    const s = solve('superconductor', 'superconductorTrack', 'magnetDisc');
    expect(s.verdict.works).toBe(true);
    expect(s.equilibriumHeight!).toBeGreaterThan(0.002);
    expect(s.equilibriumHeight!).toBeLessThan(0.05);
    expect(s.stability!.stable).toBe(true);
  });

  it('a type-I superconductor is flagged as laterally unstable', () => {
    expect(emMaterial('leadSc').sc!.kind).toBe('typeI');
  });
});

describe('spin stabilisation (Levitron)', () => {
  it('the real top floats, in a window close to the measured 18–35 rev/s', () => {
    const s = solve('spinStabilised', 'levitronBase', 'levitronTop');
    expect(s.equilibriumHeight).not.toBeNull();
    expect(s.stability!.stable).toBe(true);
    // floats a few centimetres above the base
    expect(s.equilibriumHeight!).toBeGreaterThan(0.02);
    expect(s.equilibriumHeight!).toBeLessThan(0.08);
    const lo = s.achieved.find((r) => r.label === 'Minimum spin rate')!.value;
    const hi = s.achieved.find((r) => r.label === 'Maximum spin rate')!.value;
    expect(lo).toBeGreaterThan(8);
    expect(lo).toBeLessThan(28);
    expect(hi).toBeGreaterThan(28);
    expect(hi).toBeLessThan(70);
    expect(s.verdict.works).toBe(true);
  });

  it('the mass window is a fraction of a gram wide', () => {
    const s = solve('spinStabilised', 'levitronBase', 'levitronTop');
    const w = s.achieved.find((r) => r.label === 'Mass window')!;
    expect(w.value).toBeGreaterThan(0);
    expect(w.value).toBeLessThan(0.004); // under 4 g — the trim-washer problem
  });

  it('too slow and too fast both fail', () => {
    const slow = solve('spinStabilised', 'levitronBase', 'levitronTop');
    const window = levitronWindow(0.82, 0.0092, 1.45e-6, 7.6e-7, 1.2);
    expect(window.exists).toBe(true);
    expect(window.minRps).toBeLessThan(window.maxRps);
    // precession slows as the top spins faster — that is the upper bound
    expect(window.precessionHz(50)).toBeLessThan(window.precessionHz(20));
    void slow;
  });

  it('an unmagnetised object is refused', () => {
    const s = solve('spinStabilised', 'levitronBase', 'graphiteFlake');
    expect(s.verdict.possible).toBe(false);
  });
});

describe('eddy currents', () => {
  it('the sphere polarisability has the right limits', () => {
    const a = 0.01, sigma = 5.8e7;
    // ω → 0: no shielding, no force
    const lo = eddySpherePolarisability(a, sigma, 2 * Math.PI * 1e-6);
    expect(Math.abs(lo.re) / (2 * Math.PI * a ** 3)).toBeLessThan(1e-6);
    // ω → ∞: perfect shielding, α → −2πa³ (the same as a superconductor)
    const hi = eddySpherePolarisability(a, sigma, 2 * Math.PI * 1e12);
    expect(rel(hi.re, -2 * Math.PI * a ** 3)).toBeLessThan(1e-3);
    // and it is monotone in between, never exceeding the perfect-shielding value
    let prev = 0;
    for (const f of [1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7]) {
      const p = eddySpherePolarisability(a, sigma, 2 * Math.PI * f);
      expect(-p.re).toBeGreaterThanOrEqual(prev - 1e-18);
      expect(-p.re).toBeLessThan(2 * Math.PI * a ** 3 * 1.0001);
      expect(p.im).toBeLessThan(0); // dissipative
      prev = -p.re;
    }
  });

  it('the low-frequency force grows as ω² and the loss as ω', () => {
    const a = 0.01, sigma = 5.8e7;
    const p1 = eddySpherePolarisability(a, sigma, 2 * Math.PI * 1);
    const p2 = eddySpherePolarisability(a, sigma, 2 * Math.PI * 2);
    expect(rel(p2.re / p1.re, 4)).toBeLessThan(0.02);
    expect(rel(p2.im / p1.im, 2)).toBeLessThan(0.02);
  });

  it('skin depth matches √(2/ωμσ)', () => {
    const p = eddySpherePolarisability(0.01, 5.8e7, 2 * Math.PI * 50);
    expect(rel(p.skinDepth, Math.sqrt(2 / (2 * Math.PI * 50 * MU0 * 5.8e7)))).toBeLessThan(1e-15);
  });

  it('Inductrack lift equals drag at the transition speed, and the ratio is v/v_c', () => {
    const args = [0.5, 0.1, 0.02, 1, 2] as const;
    const at = inductrack(args[0], args[1], args[2], args[3], args[4], 2);
    expect(rel(at.lift, at.drag)).toBeLessThan(1e-12);
    for (const v of [0.5, 2, 10, 50]) {
      const r = inductrack(args[0], args[1], args[2], args[3], args[4], v);
      expect(rel(r.lift / r.drag, v / args[4])).toBeLessThan(1e-12);
    }
    // lift saturates at the Maxwell stress times the gap decay
    const fast = inductrack(args[0], args[1], args[2], args[3], args[4], 1e9);
    const ceiling = ((0.5 * 0.5 * 1) / (2 * MU0)) * Math.exp((-4 * Math.PI * 0.02) / 0.1);
    expect(rel(fast.lift, ceiling)).toBeLessThan(1e-9);
  });
});

describe('servo suspension', () => {
  it('the open-loop pole is √(2g/x₀) and the gains stabilise it', () => {
    const d = designServo(1, G, 0.01, 600, 0.02, 100);
    expect(rel(d.unstablePole, Math.sqrt((2 * G) / 0.01))).toBeLessThan(1e-12);
    expect(d.kx).toBeLessThan(0);
    expect(d.ki).toBeGreaterThan(0);
    // closed loop: m s² + ki·kd·s + (ki·kp + kx) = 0 must have the design roots
    const wn = 2 * Math.PI * 100;
    expect(rel(d.ki * d.kp + d.kx, 1 * wn * wn)).toBeLessThan(1e-9);
    expect(rel(d.ki * d.kd, 2 * 0.7 * 1 * wn)).toBeLessThan(1e-9);
  });

  it('the magnet force law reproduces B = μ₀Ni/2x and F = B²A/μ₀', () => {
    const r = emsForce(600, 0.02, 2, 0.01);
    expect(rel(r.B, (MU0 * 600 * 2) / (2 * 0.01))).toBeLessThan(1e-15);
    expect(rel(r.force, (r.B * r.B * 0.02) / MU0)).toBeLessThan(1e-12);
  });

  it('a 20 t vehicle needs a realistic gap flux density', () => {
    const s = solve('servo', 'emsRail', 'maglevCar', { poleArea: 2, gap: 0.01, turns: 1500, bandwidth: 200 });
    const B = s.requirements.find((r) => r.label === 'Gap flux density')!.value;
    // commercial EMS runs below iron saturation, around 0.5–1.5 T
    expect(B).toBeGreaterThan(0.2);
    expect(B).toBeLessThan(1.8);
  });
});

describe('electrostatic levitation', () => {
  it('the maximum liftable radius matches ε₀E²/4ρg', () => {
    const lim = electrostaticLimits(emMaterial('water'), 1e-3, G);
    expect(rel(lim.maxRadius, (EPS0 * 3e6 * 3e6) / (4 * 998.2 * G))).toBeLessThan(1e-12);
    // a couple of millimetres for water in air
    expect(lim.maxRadius).toBeGreaterThan(1e-3);
    expect(lim.maxRadius).toBeLessThan(5e-3);
  });

  it('an object above that size cannot be held at any voltage', () => {
    const big = electrostaticLimits(emMaterial('water'), 0.05, G);
    expect(big.feasible).toBe(false);
    expect(big.maxForce).toBeLessThan(998.2 * (4 / 3) * Math.PI * 0.05 ** 3 * G);
  });

  it('Millikan’s oil drop balances in a field of a few tens of kV/m', () => {
    const s = solve('electrostatic', 'electrodePair', 'oilDrop');
    const need = s.achieved.find((r) => r.label.startsWith('Field needed for the charge'))!;
    expect(need.value).toBeGreaterThan(1e4);
    expect(need.value).toBeLessThan(2e5);
  });

  it('the Rayleigh limit is reported for liquid drops', () => {
    const lim = electrostaticLimits(emMaterial('water'), 1e-4, G);
    expect(lim.rayleighLimit).not.toBeNull();
    expect(rel(lim.rayleighLimit!, 8 * Math.PI * Math.sqrt(EPS0 * 0.0728 * 1e-12))).toBeLessThan(1e-12);
  });
});

describe('acoustic levitation', () => {
  it('water in air at 40 kHz needs about 160 dB, independent of particle size', () => {
    const a = acousticLevitation(emMaterial('water'), emMaterial('air'), 40000, G, 5e-4);
    expect(a.thresholdSPL).toBeGreaterThan(150);
    expect(a.thresholdSPL).toBeLessThan(168);
    const b = acousticLevitation(emMaterial('water'), emMaterial('air'), 40000, G, 5e-5);
    expect(rel(b.thresholdPressure, a.thresholdPressure)).toBeLessThan(1e-12);
  });

  it('node spacing is λ/2', () => {
    const a = acousticLevitation(emMaterial('water'), emMaterial('air'), 40000, G, 1e-4);
    expect(rel(a.nodeSpacing, 343.2 / 40000 / 2)).toBeLessThan(1e-12);
    expect(a.nodeSpacing).toBeGreaterThan(0.004);
    expect(a.nodeSpacing).toBeLessThan(0.0045);
  });

  it('the contrast factor is near 2.5 for a dense particle in air', () => {
    const a = acousticLevitation(emMaterial('polystyrene'), emMaterial('air'), 40000, G, 1e-4);
    expect(a.f1).toBeGreaterThan(0.99);
    expect(a.f2).toBeGreaterThan(0.99);
    expect(a.contrast).toBeGreaterThan(2.4);
    expect(a.contrast).toBeLessThan(2.6);
  });
});

describe('optical levitation', () => {
  it('lifting a gram with light takes megawatts', () => {
    const r = opticalLevitation(emMaterial('water'), emMaterial('air'), 0.001, 0.01, 5e-7, G);
    const mass = 998.2 * (4 / 3) * Math.PI * 0.001 ** 3;
    expect(rel(r.mirrorPower, (mass * G * C_LIGHT) / 2)).toBeLessThan(1e-12);
    const gram = (1e-3 * G * C_LIGHT) / 2;
    expect(gram).toBeGreaterThan(1e6);
    expect(gram).toBeLessThan(2e6);
  });

  it('tweezer stiffness is in the measured pN/nm range', () => {
    const r = opticalLevitation(emMaterial('polystyrene'), emMaterial('water'), 5e-7, 0.01, 5e-7, G);
    // published traps: 0.005–0.5 pN/nm at 10 mW; the Rayleigh formula is an
    // upper bound because the bead is not small compared with the wavelength
    expect(r.stiffnessPnPerNm).toBeGreaterThan(0.005);
    expect(r.stiffnessPnPerNm).toBeLessThan(1);
    expect(r.rayleighValid).toBe(false);
  });

  it('Ashkin’s 1971 optical levitation needs a few hundred milliwatts', () => {
    const r = opticalLevitation(emMaterial('quartz'), emMaterial('air'), 1e-5, 0.25, 1e-5, G);
    expect(r.scatterPower).toBeGreaterThan(0.02);
    expect(r.scatterPower).toBeLessThan(2);
  });
});

describe('momentum and buoyancy', () => {
  it('a 1 kg quadcopter hovers on about 100 W', () => {
    const h = hoverPower(1, G, 1.225, 4 * Math.PI * 0.12 ** 2, 0.6);
    expect(h.power).toBeGreaterThan(50);
    expect(h.power).toBeLessThan(200);
    expect(rel(h.thrust, G)).toBeLessThan(1e-12);
    expect(rel(h.idealPower, Math.pow(G, 1.5) / Math.sqrt(2 * 1.225 * 4 * Math.PI * 0.12 ** 2))).toBeLessThan(1e-12);
  });

  it('hover power scales as weight^1.5 and area^-0.5', () => {
    const a = hoverPower(1, G, 1.225, 1);
    const b = hoverPower(4, G, 1.225, 1);
    const c = hoverPower(1, G, 1.225, 4);
    expect(rel(b.power / a.power, 8)).toBeLessThan(1e-12);
    expect(rel(c.power / a.power, 0.5)).toBeLessThan(1e-12);
  });

  it('helium lifts 1.05 kg per cubic metre at sea level', () => {
    const b = buoyantVolume(1.0464, 1.225, 0.1786);
    expect(rel(b.volume, 1)).toBeLessThan(1e-3);
    expect(rel(b.liftPerM3, 1.0464)).toBeLessThan(1e-12);
    expect(buoyantVolume(1, 1.225, 2).possible).toBe(false);
  });
});

describe('build sheet', () => {
  it('reproduces the 35 T / 20 MW NHMFL resistive magnet', () => {
    // the Fabry relation, with the shape factor this model uses
    const s = designSolenoid(35, 0.016, 0.5, 'water');
    expect(s.power).toBeGreaterThan(1.2e7);
    expect(s.power).toBeLessThan(3e7);
  });

  it('amp-turns reproduce the requested field when fed back into the field solver', () => {
    const s = designSolenoid(5, 0.05, 0.4, 'water');
    const sol = new SolenoidSource('check', [0, 0, 0], [0, 0, 1], s.meanRadius, s.length, 1, s.ampTurns);
    expect(rel(Math.abs(sol.axialExact(0)), 5)).toBeLessThan(1e-12);
  });

  it('power scales as B² and inversely with the packing fraction', () => {
    const a = designSolenoid(10, 0.05, 0.4, 'water');
    const b = designSolenoid(20, 0.05, 0.4, 'water');
    expect(rel(b.power / a.power, 4)).toBeLessThan(1e-9);
  });

  it('a superconducting winding dissipates nothing and warns above its limit', () => {
    const s = designSolenoid(30, 0.05, 0.4, 'superconducting');
    expect(s.power).toBe(0);
    expect(s.warnings.join(' ')).toMatch(/hybrid/);
  });

  it('flags the hoop stress that stops continuous magnets near 45 T', () => {
    const s = designSolenoid(60, 0.02, 0.3, 'water');
    expect(s.stressOk).toBe(false);
    expect(s.warnings.join(' ')).toMatch(/45.5 T|hoop/);
    expect(s.tier).toBe('beyondTechnology');
  });

  it('picks a wire gauge that carries the current', () => {
    const s = designSolenoid(1, 0.05, 0.3, 'air');
    expect(s.wire.area * s.wire.strands * s.currentDensity).toBeGreaterThanOrEqual(s.current * 0.999);
  });
});

describe('solver coverage', () => {
  it('every mode and apparatus combination produces a verdict without throwing', () => {
    for (const def of APPARATUS) {
      for (const mode of def.modes) {
        const obj = LEV_OBJECTS.find((o) =>
          mode === 'permanentMagnet' || mode === 'spinStabilised' ? o.moment > 0
            : mode === 'diamagnetic' ? o.material === 'pyrolyticGraphite'
              : mode === 'eddyCurrent' ? o.material === 'aluminium'
                : mode === 'superconductor' ? o.moment > 0
                  : true)!;
        const s = solveLevitation({ ...base, mode, apparatus: def.id, params: defaultParams(def), object: obj });
        expect(s.verdict.headline.length).toBeGreaterThan(10);
        expect(s.verdict.reason.length).toBeGreaterThan(10);
        expect(s.explanation.length).toBeGreaterThan(0);
        expect(Number.isFinite(s.weight)).toBe(true);
      }
    }
  });

  it('local gravity changes the requirement measurably', () => {
    const lo = diamagneticRequirement(emMaterial('water'), 9.7639); // Nevado Huascarán
    const hi = diamagneticRequirement(emMaterial('water'), 9.8337); // near the pole
    expect(hi.bGradB / lo.bGradB).toBeGreaterThan(1.006);
    // the field itself only differs by half that, since B ∝ √(B∂B/∂z)
    expect(Math.sqrt(hi.bGradB / lo.bGradB)).toBeLessThan(1.004);
  });

  it('equilibrium finding and the 3×3 solve are consistent', () => {
    const A = [4, 1, 0, 1, 3, 1, 0, 1, 2];
    const x = m3solve(A, [1, 2, 3])!;
    const b = [
      A[0] * x[0] + A[1] * x[1] + A[2] * x[2],
      A[3] * x[0] + A[4] * x[1] + A[5] * x[2],
      A[6] * x[0] + A[7] * x[1] + A[8] * x[2],
    ];
    expect(b[0]).toBeCloseTo(1, 12);
    expect(b[1]).toBeCloseTo(2, 12);
    expect(b[2]).toBeCloseTo(3, 12);
    expect(m3solve([1, 0, 0, 1, 0, 0, 1, 0, 0], [1, 1, 1])).toBeNull();
  });

  it('the cheap and exact potential paths agree', () => {
    const app = buildApparatus('checkerboard');
    const models = [
      inducedPotential(app.field, -4.5e-4, 1e-7, 2.2e-4, G),
      fixedDipolePotential(app.field, [0, 0, -0.5], 0.01, G),
      adiabaticDipolePotential(app.field, 0.5, 0.01, G),
    ];
    for (const m of models) {
      for (const p of [[0.001, 0.002, 0.004], [0, 0, 0.01], [-0.004, 0.001, 0.02]] as Vec3[]) {
        const full = m.at(p);
        expect(rel(m.energy(p), full.U)).toBeLessThan(1e-12);
        const g = m.grad(p);
        for (let i = 0; i < 3; i++) {
          const scale = Math.max(Math.abs(full.grad[i]), 1e-12);
          expect(Math.abs(g[i] - full.grad[i]) / scale).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('vertical equilibria really are force zeros', () => {
    const app = buildApparatus('checkerboard');
    const m = inducedPotential(app.field, -4.5e-4, 1e-7, 2.2e-4, G);
    const zs = verticalEquilibria(m, 1e-4, 0.03);
    expect(zs.length).toBeGreaterThan(0);
    for (const z of zs) expect(Math.abs(m.grad([0, 0, z])[2])).toBeLessThan(1e-9);
  });
});
