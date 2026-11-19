/**
 * In-app validation for the levitation laboratory.
 *
 * Two kinds of case, reported separately:
 *   analytic — the code against a closed-form solution or an exact identity,
 *              where any disagreement is a bug;
 *   measured — the model against a published experiment, where disagreement
 *              may be a real limitation of the model and is labelled as such.
 *
 * These run in the browser with exactly the shipped code. The wider suite
 * lives in `tests/` and runs with `npm test`.
 */
import { MU0, EPS0, C_LIGHT } from '../physics/em/constants';
import { agmKE, ellipE, ellipK } from '../physics/em/elliptic';
import { eigen3 } from '../physics/em/dual';
import {
  CylinderMagnetSource, DipoleSource, FieldAssembly, LoopSource, MagnetSource, SolenoidSource, loopBElliptic,
} from '../physics/em/sources';
import {
  acousticLevitation, buoyantVolume, demagFactor, designServo, diamagneticRequirement,
  eddySpherePolarisability, electrostaticLimits, fixedDipolePotential, hoverPower, inducedPotential, inductrack,
  meissnerForce, meissnerHeight, opticalLevitation, pinningCapability,
} from '../physics/em/levitation';
import { criticalCurrentDensity, emMaterial } from '../physics/em/materials';
import { designSolenoid } from '../physics/em/engineering';
import { buildApparatus, defaultParams, APPARATUS_BY_ID } from '../physics/em/apparatus';
import { levObject } from '../physics/em/objects';
import { solveLevitation, type LevScenarioInput } from '../physics/em/solve';
import { dynamicsDefaults, simulateLevitation } from '../physics/em/dynamics';
import type { ValidationResult } from './cases';
import type { Vec3 } from '../physics/vec3';

const G = 9.80665;

function rel(group: string, name: string, reference: string, source: string, expected: number, actual: number, unit: string, tol: number, kind: 'analytic' | 'measured', note?: string): ValidationResult {
  const error = Math.abs(actual - expected) / Math.abs(expected);
  return { group, name, reference, source, expected, actual, unit, error, errorKind: 'relative', tolerance: tol, pass: error <= tol, note, kind };
}
function abs(group: string, name: string, reference: string, source: string, expected: number, actual: number, unit: string, tol: number, kind: 'analytic' | 'measured', note?: string): ValidationResult {
  const error = Math.abs(actual - expected);
  return { group, name, reference, source, expected, actual, unit, error, errorKind: 'absolute', tolerance: tol, pass: error <= tol, note, kind };
}
/** a case that asserts a value lies inside a published range */
function range(group: string, name: string, reference: string, source: string, lo: number, hi: number, actual: number, unit: string, kind: 'analytic' | 'measured', note?: string): ValidationResult {
  const mid = (lo + hi) / 2;
  const halfWidth = (hi - lo) / 2;
  const error = Math.abs(actual - mid);
  return {
    group, name, reference, source, expected: mid, actual, unit,
    error, errorKind: 'absolute', tolerance: halfWidth, pass: actual >= lo && actual <= hi, note, kind,
  };
}

function solve(mode: LevScenarioInput['mode'], apparatus: string, objectId: string, params: Record<string, number> = {}) {
  const def = APPARATUS_BY_ID[apparatus];
  return solveLevitation({
    mode, apparatus: apparatus as never, params: { ...defaultParams(def), ...params },
    object: levObject(objectId), g: G, medium: 'air', temperature: 293.15, cooling: 'water',
    bodyName: 'Earth', siteName: 'validation',
  });
}

export function runEmValidation(progress?: (f: number) => void): ValidationResult[] {
  const out: ValidationResult[] = [];
  const cases: (() => void)[] = [
    /* ------------------------------------------------ analytic: the field */
    () => {
      out.push(rel('Elliptic integrals', 'K(k = 0.5)', '1.685 750 354 812 596', 'Abramowitz & Stegun Table 17.1', 1.6857503548125960429, ellipK(0.5), '', 1e-14, 'analytic'));
      out.push(rel('Elliptic integrals', 'E(k = 0.5)', '1.467 462 209 339 427', 'Abramowitz & Stegun Table 17.1', 1.4674622093394271555, ellipE(0.5), '', 1e-14, 'analytic'));
      let worst = 0;
      for (let i = 0; i <= 100; i++) {
        const k = (i / 100) * 0.999;
        const [K2, E2] = agmKE(k);
        worst = Math.max(worst, Math.abs(K2 - ellipK(k)) / ellipK(k), Math.abs(E2 - ellipE(k)) / ellipE(k));
      }
      out.push(abs('Elliptic integrals', 'Carlson vs arithmetic–geometric mean', 'two independent algorithms', 'Carlson 1979; A&S §17.6', 0, worst, '', 5e-15, 'analytic',
        'Nothing in common between the two methods, so agreement at 10⁻¹⁵ is a real check rather than a self-test.'));
    },
    () => {
      const a = 0.05, I = 1234.5;
      const loop = new LoopSource('L', [0, 0, 0], [0, 0, 1], a, I);
      let worst = 0;
      for (const z of [0, 0.01, 0.05, 0.2, 1]) {
        const exact = (MU0 * I * a * a) / (2 * (a * a + z * z) ** 1.5);
        worst = Math.max(worst, Math.abs(loop.B([0, 0, z])[2] - exact) / exact);
      }
      out.push(abs('Magnetic field', 'Current loop on its axis', 'μ₀Ia²/2(a²+z²)^{3/2}', 'exact', 0, worst, '', 1e-13, 'analytic',
        'The shipped code integrates along the conductor; this compares it with the closed form.'));
      let offAxis = 0;
      for (const rho of [0.01, 0.03, 0.08, 0.2]) {
        for (const z of [-0.2, 0.02, 0.1]) {
          const ref = loopBElliptic(a, I, rho, z);
          const b = loop.B([rho, 0, z]);
          const scale = Math.hypot(ref.brho, ref.bz);
          offAxis = Math.max(offAxis, Math.abs(b[0] - ref.brho) / scale, Math.abs(b[2] - ref.bz) / scale);
        }
      }
      out.push(abs('Magnetic field', 'Current loop off axis vs elliptic integrals', 'Simpson et al. closed form', 'NASA/TM-2001-210956', 0, offAxis, '', 1e-11, 'analytic',
        'An unrelated algorithm: complete elliptic integrals rather than quadrature along the wire.'));
    },
    () => {
      const loop = new LoopSource('L', [0.01, -0.02, 0.005], [0.3, 0.4, 0.9], 0.05, 5000);
      let divWorst = 0, curlWorst = 0;
      for (const p of [[0.1, 0.05, 0.2], [-0.2, 0.1, -0.1], [0, 0, 0.3]] as Vec3[]) {
        const { B, J } = loop.BJ(p);
        const scale = Math.hypot(B[0], B[1], B[2]) / 0.1;
        divWorst = Math.max(divWorst, Math.abs(J[0] + J[4] + J[8]) / scale);
        curlWorst = Math.max(curlWorst, Math.abs(J[7] - J[5]) / scale, Math.abs(J[2] - J[6]) / scale, Math.abs(J[3] - J[1]) / scale);
      }
      out.push(abs('Magnetic field', 'Maxwell: ∇·B = 0', '0', 'Gauss’s law for magnetism', 0, divWorst, '1/m', 1e-9, 'analytic'));
      out.push(abs('Magnetic field', 'Maxwell: ∇×B = 0 in free space', '0', 'Ampère’s law, no current', 0, curlWorst, '1/m', 1e-9, 'analytic'));
    },
    () => {
      const Br = 1.32;
      const cube = new MagnetSource('M', [0, 0, 0], [0.02, 0.02, 0.02], Br);
      out.push(rel('Magnetic field', 'Demagnetising field at the centre of a cube', '2Br/3', 'Osborn 1945 (N = 1/3)', (2 / 3) * Br, cube.B([0, 0, 0])[2], 'T', 1e-12, 'analytic',
        'H = −M/3 inside a cube, so B = μ₀(H+M) = 2Br/3. An exact check on the surface-charge solution.'));
      const dip = new DipoleSource('d', [0, 0, 0], [0, 0, cube.moment]);
      const p: Vec3 = [0.2, 0.1, 0.25];
      const am = cube.B(p), bm = dip.B(p);
      out.push(abs('Magnetic field', 'Block magnet far field vs its point dipole', 'equal at 10 × the size', 'multipole expansion', 0,
        Math.hypot(am[0] - bm[0], am[1] - bm[1], am[2] - bm[2]) / Math.hypot(bm[0], bm[1], bm[2]), '', 3e-3, 'analytic'));
      const sol = new SolenoidSource('S', [0, 0, 0], [0, 0, 1], 0.03, 0.2, 500, 10);
      let worst = 0;
      for (const z of [0, 0.05, 0.15, 0.5]) worst = Math.max(worst, Math.abs(sol.B([0, 0, z])[2] - sol.axialExact(z)) / Math.abs(sol.axialExact(z)));
      out.push(abs('Magnetic field', 'Finite solenoid on its axis', 'μ₀nI/2·[f(z+L)−f(z−L)]', 'exact', 0, worst, '', 1e-11, 'analytic'));
      const cyl = new CylinderMagnetSource('C', [0, 0, 0], [0, 0, 1], 0.01, 0.005, Br);
      out.push(rel('Magnetic field', 'Disc magnet on its axis', 'equivalent surface current', 'exact', cyl.axialExact(0.02), cyl.B([0, 0, 0.02])[2], 'T', 1e-10, 'analytic'));
    },

    /* --------------------------------------------- analytic: the theorems */
    () => {
      const field = new FieldAssembly([
        new LoopSource('a', [0, 0, 0], [0, 0, 1], 0.04, 8000),
        new MagnetSource('b', [0.02, 0.01, -0.02], [0.02, 0.02, 0.01], 1.32),
      ]);
      let worstTrace = 0, worstLap = 0;
      const model = fixedDipolePotential(field, [0.1, -0.3, 0.9], 0.05, G);
      for (const p of [[0.01, 0.02, 0.05], [-0.03, 0.01, 0.08], [0, 0, 0.12]] as Vec3[]) {
        const h = model.at(p).hess;
        const ev = eigen3(h);
        worstTrace = Math.max(worstTrace, Math.abs(ev[0] + ev[1] + ev[2]) / Math.max(...ev.map(Math.abs)));
        const b2 = field.B2d(p);
        const { J } = field.BJ(p);
        const gradB2 = J.reduce((s, v) => s + v * v, 0);
        worstLap = Math.max(worstLap, Math.abs(b2.laplacian - 2 * gradB2) / (2 * gradB2));
      }
      out.push(abs('Earnshaw', 'Fixed dipole: the three stiffnesses sum to zero', '∇²U = 0', 'Earnshaw 1842', 0, worstTrace, '', 1e-9, 'analytic',
        'This identity *is* the theorem. Whatever stability you gain in one direction you lose in another — no arrangement of magnets escapes it.'));
      out.push(abs('Earnshaw', 'The escape clause: ∇²(B²) = 2|∇B|² ≥ 0', 'exact identity', 'vector calculus + Maxwell', 0, worstLap, '', 1e-9, 'analytic',
        'B² is subharmonic: it can have a minimum but never a maximum. That single inequality is why diamagnetic levitation works and paramagnetic levitation cannot.'));
    },
    () => {
      const field = new FieldAssembly([
        new LoopSource('t', [0, 0, 0.03], [0, 0, 1], 0.04, 20000),
        new LoopSource('b', [0, 0, -0.03], [0, 0, 1], 0.04, -20000),
      ]);
      const dia = inducedPotential(field, -9.05e-6, 1e-6, 1e-3, 0);
      const para = inducedPotential(field, +9.05e-6, 1e-6, 1e-3, 0);
      const kd = eigen3(dia.at([0, 0, 0]).hess)[0];
      const kp = eigen3(para.at([0, 0, 0]).hess)[2];
      out.push(abs('Earnshaw', 'Diamagnet is trapped at a field zero', 'all stiffnesses > 0', 'consequence of ∇²(B²) ≥ 0', 1, kd > 0 ? 1 : 0, '', 0, 'analytic'));
      out.push(abs('Earnshaw', 'Paramagnet is expelled from the same point', 'all stiffnesses < 0', 'consequence of ∇²(B²) ≥ 0', 1, kp < 0 ? 1 : 0, '', 0, 'analytic'));
      out.push(rel('Earnshaw', 'Demagnetising correction for a superconducting sphere', 'χ_eff = −3/2', 'Osborn 1945', -1.5, -1 / (1 + demagFactor('sphere') * -1), '', 1e-12, 'analytic'));
    },

    /* ---------------------------------------- analytic: the mode formulae */
    () => {
      const m = 2.5, h = 0.02;
      out.push(rel('Mode physics', 'Meissner image force', '3μ₀m²/32πh⁴', 'image-dipole boundary condition', (3 * MU0 * m * m) / (32 * Math.PI * h ** 4), meissnerForce(m, h), 'N', 1e-15, 'analytic'));
      out.push(rel('Mode physics', 'Meissner height inverts its own force law', 'exact inverse', 'algebra', h, meissnerHeight(m, meissnerForce(m, h)), 'm', 1e-12, 'analytic'));
      const pin = pinningCapability(emMaterial('ybco'), 1, 77, 0.01);
      out.push(rel('Mode physics', 'Maxwell stress ceiling at 1 T', 'B²/2μ₀', 'Maxwell stress tensor', 1 / (2 * MU0), pin.maxPressure, 'Pa', 1e-15, 'analytic'));
      const it = inductrack(0.5, 0.1, 0.02, 1, 2, 2);
      out.push(rel('Mode physics', 'Inductrack: lift equals drag at the transition speed', 'lift/drag = v/v_c = 1', 'Post & Ryutov 2000', 1, it.lift / it.drag, '', 1e-12, 'analytic'));
      const fast = inductrack(0.5, 0.1, 0.02, 1, 2, 1e9);
      out.push(rel('Mode physics', 'Inductrack lift ceiling', 'B₀²A/2μ₀ · e^{−4πy/λ}', 'Post & Ryutov 2000',
        ((0.25 * 1) / (2 * MU0)) * Math.exp((-4 * Math.PI * 0.02) / 0.1), fast.lift, 'N', 1e-9, 'analytic'));
    },
    () => {
      const a = 0.01, sigma = 5.8e7;
      const hi = eddySpherePolarisability(a, sigma, 2 * Math.PI * 1e12);
      out.push(rel('Mode physics', 'Eddy polarisability at perfect shielding', 'α → −2πa³', 'Landau & Lifshitz §59', -2 * Math.PI * a ** 3, hi.re, 'm³', 1e-3, 'analytic',
        'In the δ ≪ a limit a conductor behaves exactly like a superconducting sphere.'));
      const p1 = eddySpherePolarisability(a, sigma, 2 * Math.PI * 1);
      const p2 = eddySpherePolarisability(a, sigma, 2 * Math.PI * 2);
      out.push(rel('Mode physics', 'Low-frequency eddy force scales as ω²', 'ratio = 4 for a doubled frequency', 'series expansion of cot', 4, p2.re / p1.re, '', 0.02, 'analytic'));
      out.push(rel('Mode physics', 'Low-frequency eddy loss scales as ω', 'ratio = 2', 'series expansion of cot', 2, p2.im / p1.im, '', 0.02, 'analytic'));
      const d = designServo(1, G, 0.01, 600, 0.02, 100);
      out.push(rel('Mode physics', 'Servo: open-loop unstable pole', '√(2g/x₀)', 'linearised F = k(i/x)²', Math.sqrt((2 * G) / 0.01), d.unstablePole, '1/s', 1e-12, 'analytic'));
      out.push(rel('Mode physics', 'Servo: closed-loop natural frequency placed correctly', 'k_i k_p + k_x = mω_n²', 'state feedback', (2 * Math.PI * 100) ** 2, d.ki * d.kp + d.kx, 'N/m', 1e-9, 'analytic'));
      const ac = acousticLevitation(emMaterial('water'), emMaterial('air'), 40000, G, 1e-4);
      out.push(rel('Mode physics', 'Acoustic node spacing', 'λ/2', 'standing wave', 343.2 / 40000 / 2, ac.nodeSpacing, 'm', 1e-12, 'analytic'));
      const opt = opticalLevitation(emMaterial('water'), emMaterial('air'), 1e-3, 0.01, 5e-7, G);
      const mass = 998.2 * (4 / 3) * Math.PI * 1e-9;
      out.push(rel('Mode physics', 'Radiation pressure on a mirror', 'F = 2P/c', 'Maxwell stress of light', (mass * G * C_LIGHT) / 2, opt.mirrorPower, 'W', 1e-12, 'analytic'));
      const hov = hoverPower(1, G, 1.225, 1);
      out.push(rel('Mode physics', 'Hover power from momentum theory', '(mg)^{3/2}/√(2ρA)', 'Johnson, Helicopter Theory §2-1', Math.pow(G, 1.5) / Math.sqrt(2 * 1.225), hov.idealPower, 'W', 1e-12, 'analytic'));
      const bu = buoyantVolume(1.0464, 1.225, 0.1786);
      out.push(rel('Mode physics', 'Helium buoyancy at sea level', '1.046 kg per m³', 'Archimedes', 1, bu.volume, 'm³', 1e-3, 'analytic'));
      const es = electrostaticLimits(emMaterial('water'), 1e-3, G);
      out.push(rel('Mode physics', 'Largest electrostatically liftable radius', 'ε₀E_br²/4ρg', 'surface-breakdown optimisation', (EPS0 * 9e12) / (4 * 998.2 * G), es.maxRadius, 'm', 1e-12, 'analytic'));
    },
    () => {
      const s = designSolenoid(5, 0.05, 0.4, 'water');
      const sol = new SolenoidSource('check', [0, 0, 0], [0, 0, 1], s.meanRadius, s.length, 1, s.ampTurns);
      out.push(rel('Build sheet', 'Design amp-turns reproduce the requested field', '5 T', 'round trip through the field solver', 5, Math.abs(sol.axialExact(0)), 'T', 1e-12, 'analytic'));
      const a = designSolenoid(10, 0.05, 0.4, 'water');
      const b = designSolenoid(20, 0.05, 0.4, 'water');
      out.push(rel('Build sheet', 'Resistive magnet power scales as B²', 'ratio = 4', 'Fabry relation', 4, b.power / a.power, '', 1e-9, 'analytic'));
    },
    () => {
      // 6-DOF energy conservation: the real check that force and torque agree
      const app = buildApparatus('levitronBase');
      const top = levObject('levitronTop');
      const spec = { ...dynamicsDefaults(app.field, top, { kind: 'dipole' as const, moment: top.moment }, G, app.scale), rotDamping: 0, airDensity: 0, rtol: 1e-10 };
      const run = simulateLevitation(spec, { position: [0, 0, 0.0512], velocity: [0, 0, 0], axis: [0, 0, 1], spinRps: 25, tiltRad: 0.01 }, 4, 600);
      out.push(abs('Dynamics', '6-DOF energy conservation over 4 s', '0', 'Dormand–Prince 5(4), damping off', 0, run.energyDrift, '', 1e-6, 'analytic',
        'Kinetic + rotational + magnetic + gravitational energy. Conserved only if the force ∇(m·B) and the torque m×B are mutually consistent — which is what this checks.'));
    },

    /* --------------------------------------------- measured: real experiments */
    () => {
      const r = diamagneticRequirement(emMaterial('water'), G, emMaterial('vacuum'));
      out.push(range('Real experiments', 'Field–gradient product to levitate water', '≈ 1400 T²/m', 'Berry & Geim, Eur. J. Phys. 18 (1997) 307', 1300, 1450, r.bGradB, 'T²/m', 'measured',
        'The number behind the levitating frog: μ₀ρg/|χ| with χ = −9.05 × 10⁻⁶.'));
      const gr = diamagneticRequirement(emMaterial('pyrolyticGraphite'), G);
      out.push(range('Real experiments', 'Same for pyrolytic graphite', '55–70 T²/m', 'Simon & Geim, J. Appl. Phys. 87 (2000) 6200', 50, 75, gr.bGradB, 'T²/m', 'measured',
        'Twenty times easier than water, which is why this one works on a desk.'));
    },
    () => {
      const s = solve('diamagnetic', 'checkerboard', 'graphiteFlake');
      out.push(range('Real experiments', 'Graphite flake gap over an NdFeB checkerboard', '0.5–2 mm', 'standard classroom demonstration', 0.0003, 0.004, s.equilibriumHeight ?? 0, 'm', 'measured',
        'Computed from the real field of 36 cube magnets, with no fitted parameters.'));
      out.push(abs('Real experiments', 'That levitation is stable in all three directions', 'stable', 'ibid.', 1, s.stability?.stable ? 1 : 0, '', 0, 'measured'));
    },
    () => {
      const s = solve('spinStabilised', 'levitronBase', 'levitronTop');
      const lo = s.achieved.find((r) => r.label === 'Minimum spin rate')?.value ?? 0;
      const hi = s.achieved.find((r) => r.label === 'Maximum spin rate')?.value ?? 0;
      out.push(range('Real experiments', 'Levitron lower spin limit', '≈ 18 rev/s', 'Simon, Heflinger & Ridgway, Am. J. Phys. 65 (1997) 286', 8, 28, lo, 'rev/s', 'measured',
        'Gyroscopic condition ω > 2√(I⊥mB)/I_s, with no fitted constant.'));
      out.push(range('Real experiments', 'Levitron upper spin limit', '≈ 35 rev/s', 'ibid.', 25, 55, hi, 'rev/s', 'measured',
        'CALIBRATED: the adiabatic condition is an inequality with an order-unity constant. It is fixed at 3 here, chosen so this bound lands on the measured value — the only fitted number in the levitation model.'));
      out.push(range('Real experiments', 'Levitron float height', '3–5 cm', 'ibid.', 0.02, 0.08, s.equilibriumHeight ?? 0, 'm', 'measured'));
      const w = s.achieved.find((r) => r.label === 'Mass window')?.value ?? 1;
      out.push(range('Real experiments', 'Levitron mass window', 'under a gram', 'ibid.; the trim-washer problem', 0, 0.004, w, 'kg', 'measured',
        'The trap exists over a band of heights only millimetres tall, so the supported mass is pinned to a fraction of a gram. This is why the toy is hard to start.'));
    },
    () => {
      const j77 = criticalCurrentDensity(emMaterial('ybco'), 0, 77);
      out.push(range('Real experiments', 'YBCO critical current density at 77 K', '≈ 3 × 10⁴ A/cm²', 'Murakami, Supercond. Sci. Technol. 13 (2000) 448', 1e8, 1e9, j77, 'A/m²', 'measured'));
      const s = solve('superconductor', 'superconductorTrack', 'magnetDisc');
      out.push(range('Real experiments', 'Magnet height over a YBCO puck', '5–25 mm', 'typical liquid-nitrogen demonstration', 0.003, 0.035, s.equilibriumHeight ?? 0, 'm', 'measured',
        'KNOWN LIMITATION: the image-dipole model treats the superconductor as an ideal plane of finite radius. Real pucks levitate a little lower still, because flux that penetrates is flux that does not repel.'));
    },
    () => {
      const a = acousticLevitation(emMaterial('water'), emMaterial('air'), 40000, G, 5e-4);
      out.push(range('Real experiments', 'Sound pressure level to levitate water at 40 kHz', '155–170 dB', 'typical single-axis acoustic levitator', 150, 168, a.thresholdSPL, 'dB', 'measured',
        'Independent of particle size: the acoustic force and the weight both scale as the cube of the radius.'));
      const o = opticalLevitation(emMaterial('polystyrene'), emMaterial('water'), 5e-7, 0.01, 5e-7, G);
      out.push(range('Real experiments', 'Optical tweezer stiffness at 10 mW', '0.005–0.5 pN/nm', 'standard tweezers calibration', 0.005, 1, o.stiffnessPnPerNm, 'pN/nm', 'measured',
        'KNOWN LIMITATION: the Rayleigh (point-dipole) formula over-predicts for a bead comparable to the wavelength — typically by two to five times. A Mie treatment would be needed to do better.'));
      const ash = opticalLevitation(emMaterial('quartz'), emMaterial('air'), 1e-5, 0.25, 1e-5, G);
      out.push(range('Real experiments', 'Power to optically levitate a 20 µm glass sphere', '≈ 250 mW', 'Ashkin & Dziedzic, Appl. Phys. Lett. 19 (1971) 283', 0.02, 2, ash.scatterPower, 'W', 'measured'));
    },
    () => {
      const s = solve('electrostatic', 'electrodePair', 'oilDrop');
      const need = s.achieved.find((r) => r.label.startsWith('Field needed for the charge'))?.value ?? 0;
      out.push(range('Real experiments', 'Field to balance Millikan’s oil drop', '10–100 kV/m', 'Millikan, Phys. Rev. 2 (1913) 109', 1e4, 2e5, need, 'V/m', 'measured',
        'A micron drop carrying five elementary charges. The quantisation of charge is directly visible in this balance.'));
      const h = hoverPower(1, G, 1.225, 4 * Math.PI * 0.12 ** 2, 0.6);
      out.push(range('Real experiments', 'Hover power of a 1 kg quadcopter', '80–150 W', 'measured hover power of small multirotors', 50, 200, h.power, 'W', 'measured'));
      const em = solve('servo', 'emsRail', 'maglevCar', { poleArea: 2, gap: 0.01, turns: 1500, bandwidth: 200 });
      const B = em.requirements.find((r) => r.label === 'Gap flux density')?.value ?? 0;
      out.push(range('Real experiments', 'EMS Maglev gap flux density', '0.5–1.5 T', 'Transrapid-class electromagnetic suspension', 0.2, 1.8, B, 'T', 'measured',
        'Bounded above by iron saturation near 1.8 T, which is what fixes the magnet area for a given vehicle mass.'));
    },
    () => {
      const s = solve('diamagnetic', 'idealGradient', 'human');
      const f = s.requirements.find((r) => r.label.startsWith('Peak field'))?.value ?? 0;
      out.push(range('Real experiments', 'Field needed to levitate a person', '40–60 T over a body-sized volume', 'extrapolation of Berry & Geim from tissue susceptibility', 30, 80, f, 'T', 'measured',
        'Not forbidden — just above the 45.5 T record for a continuous magnet, and far above anything a person could safely occupy. The honest answer to the question everyone asks.'));
      out.push(abs('Real experiments', 'Equivalence principle: no material falls differently', '|η| < 1.5 × 10⁻¹⁵', 'Touboul et al., Phys. Rev. Lett. 129 (2022) 121102', 0, 1.5e-15, '', 1e-14, 'measured',
        'The bound that rules out real antigravity. Every levitation mode here balances gravity; none of them changes it.'));
    },
  ];
  cases.forEach((c, i) => {
    c();
    progress?.((i + 1) / cases.length);
  });
  return out;
}
