/**
 * The mode solver: given an apparatus, an object and a place on Earth, work
 * out what balances gravity, whether the balance is stable, how much field,
 * power or sound pressure it takes, and whether anyone could build it.
 *
 * All the physics lives in `levitation.ts`, `sources.ts` and `engineering.ts`;
 * this file is the assembly, the verdict and the prose.
 */
import { MU0, EPS0, FIELD_RECORDS, C_LIGHT } from './constants';
import {
  EARNSHAW_ESCAPE, TIER_LABEL, TIER_NOTE, acousticLevitation, analyseStability, adiabaticDipolePotential,
  buoyantVolume, demagFactor, diamagneticRequirement, designServo, eddySpherePolarisability, electrostaticLimits,
  emsForce, fieldForBGradB, fieldTier, fixedDipolePotential, hoverPower, inducedPotential, inductrack, inertia,
  levitronWindow, meissnerHeight, meissnerHeightFinite, objectAspect, objectArea, objectVolume, opticalLevitation, pinningCapability,
  powerTier, stableBand, verticalEquilibria, worseTier,
  type LevMode, type LevObject, type PotentialModel, type ServoDesign, type Stability, type VerdictTier,
} from './levitation';
import { emMaterial, type EMMaterial } from './materials';
import { buildApparatus, type Apparatus, type ApparatusId } from './apparatus';
import { designSolenoid, type BuildSheet, type CoolingTech } from './engineering';
import type { FieldAssembly, Mat3 } from './sources';
import type { Vec3 } from '../vec3';

export interface LevScenarioInput {
  mode: LevMode;
  apparatus: ApparatusId;
  params: Record<string, number>;
  object: LevObject;
  /** local gravity from EGM2008 at the chosen site [m/s²] */
  g: number;
  /** surrounding medium (EM material id) */
  medium: string;
  /** temperature [K] */
  temperature: number;
  cooling: CoolingTech;
  /** body name, for the readout */
  bodyName: string;
  siteName: string;
}

export interface Requirement {
  label: string;
  value: number;
  unit: string;
  note?: string;
  /** true if this one is the binding constraint */
  binding?: boolean;
}

export interface Verdict {
  tier: VerdictTier;
  tierLabel: string;
  tierNote: string;
  /** does a stable levitated state exist with the apparatus as configured? */
  works: boolean;
  /** is it physically possible at all, with any hardware? */
  possible: boolean;
  headline: string;
  reason: string;
}

export interface Profile {
  z: Float64Array;
  U: Float64Array;
  Fz: Float64Array;
  B: Float64Array;
  /** the stiffness eigenvalues at each height, for the stability band */
  kMin: Float64Array;
}

export interface LevSolution {
  mode: LevMode;
  apparatusName: string;
  objectName: string;
  mass: number;
  weight: number;
  volume: number;
  requirements: Requirement[];
  achieved: Requirement[];
  equilibriumHeight: number | null;
  /** every height where the vertical force balances, stable ones flagged */
  equilibria: { z: number; stable: boolean; stiffness: [number, number, number]; freq: [number, number, number] }[];
  stability: Stability | null;
  earnshaw: { escapes: boolean; how: string };
  verdict: Verdict;
  build: BuildSheet | null;
  servo: ServoDesign | null;
  explanation: string[];
  warnings: string[];
  profile: Profile | null;
  /** normalised potential surface U(x, z) for the 3-D energy landscape */
  landscape: { nx: number; nz: number; x0: number; x1: number; z0: number; z1: number; U: Float32Array; saddle: Vec3 | null } | null;
}

/* ------------------------------------------------------------------ helpers */

const req = (label: string, value: number, unit: string, note?: string, binding?: boolean): Requirement =>
  ({ label, value, unit, note, binding });

/**
 * Vertical profile. The value and force come from the cheap scalar paths; the
 * minimum stiffness needs the exact Hessian, so it is evaluated on a coarser
 * stride and interpolated — enough to draw the stability band without paying
 * for a hyper-dual evaluation at every pixel.
 */
function sampleProfile(model: PotentialModel, field: FieldAssembly | null, z0: number, z1: number, n = 160, mass = 1): Profile {
  const z = new Float64Array(n), U = new Float64Array(n), Fz = new Float64Array(n), B = new Float64Array(n), kMin = new Float64Array(n);
  const stride = 4;
  for (let i = 0; i < n; i++) {
    const zz = z0 + ((z1 - z0) * i) / (n - 1);
    z[i] = zz;
    U[i] = model.energy([0, 0, zz]);
    Fz[i] = -model.grad([0, 0, zz])[2];
    B[i] = field ? Math.hypot(...field.B([0, 0, zz])) : 0;
    kMin[i] = NaN;
  }
  for (let i = 0; i < n; i += stride) {
    kMin[i] = analyseStability(model.at([0, 0, z[i]]).hess, mass).stiffness[0];
  }
  if (Number.isNaN(kMin[n - 1])) kMin[n - 1] = analyseStability(model.at([0, 0, z[n - 1]]).hess, mass).stiffness[0];
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(kMin[i])) continue;
    const a = i - (i % stride);
    const b = Math.min(a + stride, n - 1);
    const t = (z[i] - z[a]) / (z[b] - z[a] || 1);
    kMin[i] = kMin[a] + t * (kMin[b] - kMin[a]);
  }
  return { z, U, Fz, B, kMin };
}

/**
 * The window the energy surface should cover.
 *
 * Centring it on the equilibrium matters more than it sounds: a graphite flake
 * traps 1.1 mm above a checkerboard whose scan range runs to 150 mm, so a
 * window spanning the whole range would render the basin as a single row of
 * pixels. The window is sized from the equilibrium height itself, with the
 * apparatus scale only as a floor and a ceiling.
 */
function landscapeWindow(eqZ: number | null, app: Apparatus, zBot: number, zTop: number) {
  const centre = eqZ ?? app.startHeight;
  const span = Math.min(Math.max(centre * 2.2, app.scale * 0.08), app.scale * 1.2);
  return {
    half: span,
    z0: Math.max(zBot, centre - span),
    z1: Math.min(zTop, centre + span * 1.4),
  };
}

/** Energy landscape U(x, z) for the 3-D surface. Value only — no derivatives. */
function sampleLandscape(model: PotentialModel, halfX: number, z0: number, z1: number, mark: Vec3 | null, nx = 40, nz = 40) {
  const U = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const zz = z0 + ((z1 - z0) * j) / (nz - 1);
    for (let i = 0; i < nx; i++) {
      const xx = -halfX + (2 * halfX * i) / (nx - 1);
      U[j * nx + i] = model.energy([xx, 0, zz]);
    }
  }
  return { nx, nz, x0: -halfX, x1: halfX, z0, z1, U, saddle: mark };
}

function equilibriaOf(model: PotentialModel, mass: number, z0: number, z1: number) {
  return verticalEquilibria(model, z0, z1).map((z) => {
    const s = model.at([0, 0, z]);
    const st = analyseStability(s.hess, mass);
    return { z, stable: st.stable, stiffness: st.stiffness, freq: st.frequencies };
  });
}

/* ------------------------------------------------------------------- solver */

export function solveLevitation(input: LevScenarioInput): LevSolution {
  const app = buildApparatus(input.apparatus, input.params);
  const o = input.object;
  const mat = emMaterial(o.material);
  const medium = emMaterial(input.medium);
  const V = objectVolume(o);
  const mass = o.mass;
  const weight = mass * input.g;

  const base: LevSolution = {
    mode: input.mode,
    apparatusName: app.name,
    objectName: o.name,
    mass, weight, volume: V,
    requirements: [], achieved: [],
    equilibriumHeight: null, equilibria: [], stability: null,
    earnshaw: EARNSHAW_ESCAPE[input.mode],
    verdict: {
      tier: 'beyondTechnology', tierLabel: '', tierNote: '', works: false, possible: false,
      headline: '', reason: '',
    },
    build: null, servo: null, explanation: [], warnings: [], profile: null, landscape: null,
  };

  switch (input.mode) {
    case 'diamagnetic': return solveDiamagnetic(input, app, base, mat, medium);
    case 'permanentMagnet': return solvePermanentMagnet(input, app, base);
    case 'superconductor': return solveSuperconductor(input, app, base, mat);
    case 'eddyCurrent': return solveEddy(input, app, base, mat);
    case 'servo': return solveServo(input, app, base);
    case 'spinStabilised': return solveSpin(input, app, base);
    case 'electrostatic': return solveElectrostatic(input, app, base, mat, medium);
    case 'acoustic': return solveAcoustic(input, app, base, mat, medium);
    case 'optical': return solveOptical(input, app, base, mat, medium);
    case 'aerodynamic': return solveAero(input, app, base, medium);
    case 'buoyancy': return solveBuoyancy(input, app, base);
  }
}

/* ---------------------------------------------------------- 3. diamagnetic */

function solveDiamagnetic(input: LevScenarioInput, app: Apparatus, out: LevSolution, mat: EMMaterial, medium: EMMaterial): LevSolution {
  const o = input.object;
  const r = diamagneticRequirement(mat, input.g, medium);
  const N = demagFactor(o.shape, objectAspect(o));
  const chiEff = r.chi / (1 + N * r.chi);
  out.requirements.push(
    req('Field–gradient product |B·∂B/∂z|', r.bGradB, 'T²/m', 'μ₀ρg/|χ| — the single number that decides diamagnetic levitation', true),
    req('Volume susceptibility χ', r.chi, '', `${mat.name} against ${medium.name}; ${mat.chiAlt !== undefined ? `anisotropic: ${mat.chi.toExponential(2)} along the ${mat.chiAxis}, ${mat.chiAlt.toExponential(2)} in-plane` : 'isotropic'}`),
    req('Density', mat.density, 'kg/m³'),
  );

  if (!r.possible) {
    out.verdict = {
      tier: 'forbidden', tierLabel: TIER_LABEL.forbidden, tierNote: TIER_NOTE.forbidden,
      works: false, possible: false,
      headline: `${mat.name} cannot be levitated diamagnetically at any field strength`,
      reason: r.reason,
    };
    out.explanation.push(
      'A paramagnetic body is drawn towards stronger field, so a stable state would need a *maximum* of B².',
      'In a current-free region ∇²(B²) = 2|∇B|² ≥ 0, which forbids an interior maximum. No amount of current changes that.',
    );
    return out;
  }

  const field = app.field;
  const hasField = field.sources.length > 0;
  let driveHint: { scale: number; z: number } | null = null;
  const model = inducedPotential(field, chiEff, objectVolume(o), o.mass, input.g);
  const zTop = app.scale * 2.5;
  const zBot = Math.max(app.startHeight * 0.02, app.scale * 1e-3);
  if (hasField) {
    out.equilibria = equilibriaOf(model, o.mass, zBot, zTop);
    out.profile = sampleProfile(model, field, zBot, zTop, 240, o.mass);
    {
      const stableEq = out.equilibria.find((e) => e.stable) ?? out.equilibria[0];
      const w = landscapeWindow(stableEq ? stableEq.z : null, app, zBot, zTop);
      out.landscape = sampleLandscape(model, w.half, w.z0, w.z1, stableEq ? [0, 0, stableEq.z] : null);
    }
    const stable = out.equilibria.find((e) => e.stable) ?? out.equilibria[0];
    if (stable) {
      out.equilibriumHeight = stable.z;
      out.stability = analyseStability(model.at([0, 0, stable.z]).hess, o.mass);
    }
    const bgb = out.profile.z.reduce((best, _z, i) => Math.max(best, Math.abs(field.bGradB([0, 0, out.profile!.z[i]]))), 0);
    out.achieved.push(
      req('Peak |B·∂B/∂z| available', bgb, 'T²/m', bgb >= r.bGradB ? 'enough' : 'short of what this object needs'),
      req('Peak |B| in reach of the object', app.peakField, 'T'),
    );
    // Where could it be trapped, and at what drive level? The stable band is
    // a property of the geometry alone, so this is a calculation, not a search.
    const band = stableBand(field, zBot, zTop);
    if (band) {
      driveHint = { scale: Math.sqrt(r.bGradB / band.bGradB), z: band.zBest };
      const scale = Math.sqrt(r.bGradB / band.bGradB);
      out.achieved.push(
        req('Stable band of this apparatus', band.zHigh - band.zLow, 'm',
          `from ${(band.zLow * 1000).toFixed(1)} to ${(band.zHigh * 1000).toFixed(1)} mm — the only heights where B² has a true minimum`),
        req('Drive level that puts this object in the band', scale, '×',
          `${scale < 1 ? 'turn the magnet down' : 'turn it up'} to a peak field of ${(app.peakField * scale).toFixed(2)} T`, true),
      );
      out.explanation.push(
        `Stability needs a *minimum* of B², and whether B² has one at a given point depends only on where the conductors are — scaling every current by s multiplies B² by s² and cannot change the sign of its curvature. So this apparatus traps at ${(band.zBest * 1000).toFixed(1)} mm whatever the current, and the current decides only which object sits there: s² · |B∂B/∂z| = μ₀ρg/|χ|.`,
      );
      if (!out.stability?.stable) {
        out.warnings.push(`At the present drive level the force balances outside the stable band, so it would drift away. Scale the field by ${scale.toFixed(3)} (peak ${(app.peakField * scale).toFixed(2)} T) and it sits in the trap.`);
      }
    } else {
      out.warnings.push('This apparatus has no region where B² has a true minimum, so it cannot trap a diamagnet at any current. A field zero between opposed coils is the usual way to make one.');
    }
  }

  // what hardware would be needed, sized from the object's own length scale
  const lengthScale = Math.max(o.size, o.thickness, 0.01);
  const neededField = fieldForBGradB(r.bGradB, lengthScale);
  out.requirements.push(req('Peak field, in a magnet scaled to the object', neededField, 'T',
    `A field falling from B to ~0 over the object's own size ${(lengthScale * 100).toFixed(1)} cm gives ∂B/∂z ≈ B/L, so B ≈ √(|B∂B/∂z|·L)`));
  const bore = Math.max(o.size * 1.4, 0.012);
  out.build = designSolenoid(neededField, bore / 2, Math.max(lengthScale * 4, 0.1), input.cooling);
  out.warnings.push(...out.build.warnings);

  const works = !!out.stability?.stable;
  // if it already levitates on the apparatus in front of you, the verdict is
  // what that apparatus costs — not what the hypothetical magnet would
  const tier = works ? app.tier : worseTier(fieldTier(neededField), powerTier(out.build.power));
  out.verdict = {
    tier, tierLabel: TIER_LABEL[tier], tierNote: TIER_NOTE[tier],
    works, possible: true,
    headline: works
      ? `Stable levitation at ${(out.equilibriumHeight! * 1000).toFixed(2)} mm — and no feedback, spin or power needed`
      : driveHint
        ? `Set this magnet to ${(app.peakField * driveHint.scale).toFixed(2)} T (×${driveHint.scale.toFixed(3)}) and it traps at ${(driveHint.z * 1000).toFixed(1)} mm`
        : hasField
          ? `This apparatus reaches ${out.achieved[0] ? out.achieved[0].value.toFixed(0) : 0} T²/m; ${o.name} needs ${r.bGradB.toFixed(0)} T²/m`
          : `Needs ${r.bGradB.toFixed(0)} T²/m, i.e. about ${neededField.toFixed(1)} T in a magnet this size`,
    reason: works
      ? 'The induced moment makes the energy proportional to +|χ|B², and B² has a genuine minimum. Earnshaw does not apply.'
      : 'The field–gradient product falls short. Either a stronger magnet, a smaller bore, or a less dense and more diamagnetic material.',
  };
  out.explanation.push(
    `Force balance: (χ_eff/2μ₀)·∂(B²)/∂z = ρg. With χ = ${r.chi.toExponential(3)} and ρ = ${mat.density} kg/m³ this needs |B·∂B/∂z| = ${r.bGradB.toFixed(1)} T²/m.`,
    `Note what is *absent*: the object's size and mass cancel, because both the magnetic force and the weight scale with volume. A big block of graphite is exactly as hard to levitate as a small one.`,
    `Demagnetising correction: χ_eff = χ/(1+Nχ) with N = ${N.toFixed(3)} for this shape — a ${(Math.abs(chiEff / r.chi - 1) * 100).toFixed(4)} % change here, but decisive for a superconductor where χ = −1.`,
  );
  if (mat.chiAlt !== undefined) {
    out.explanation.push(`${mat.name} is magnetically anisotropic: χ is ${(mat.chi / mat.chiAlt).toFixed(1)}× larger along the ${mat.chiAxis}, and the solver uses that strongest value, which is the orientation a real flake takes up.`);
    out.warnings.push('KNOWN LIMITATION: the orientation of an anisotropic flake is modelled at a single point. The exact small-body torque drives the hard axis across the field, which would stand the flake on edge; real flakes lie flat because a thin plate is held by the field varying across its width, which a point model cannot represent. The levitation height and stability are unaffected — only the predicted tilt is.');
  }
  return out;
}

/* ------------------------------------------------------ 2. permanent magnet */

function solvePermanentMagnet(input: LevScenarioInput, app: Apparatus, out: LevSolution): LevSolution {
  const o = input.object;
  const moment = o.moment;
  if (moment <= 0) {
    out.verdict = {
      tier: 'forbidden', tierLabel: TIER_LABEL.forbidden, tierNote: TIER_NOTE.forbidden,
      works: false, possible: false,
      headline: `${o.name} has no permanent magnetic moment`,
      reason: 'This mode needs a magnetised object. Pick a magnet, or use the diamagnetic or eddy-current mode.',
    };
    return out;
  }
  // moment points down (anti-parallel to the base field) so the pair repels
  const model = fixedDipolePotential(app.field, [0, 0, -moment], o.mass, input.g);
  const zBot = Math.max(app.scale * 1e-3, 1e-4);
  const zTop = app.scale * 3;
  out.equilibria = equilibriaOf(model, o.mass, zBot, zTop);
  out.profile = sampleProfile(model, app.field, zBot, zTop, 240, o.mass);
  {
      const stableEq = out.equilibria.find((e) => e.stable) ?? out.equilibria[0];
      const w = landscapeWindow(stableEq ? stableEq.z : null, app, zBot, zTop);
      out.landscape = sampleLandscape(model, w.half, w.z0, w.z1, stableEq ? [0, 0, stableEq.z] : null);
    }
  const eq = out.equilibria[0] ?? null;
  if (eq) {
    out.equilibriumHeight = eq.z;
    const s = model.at([0, 0, eq.z]);
    out.stability = analyseStability(s.hess, o.mass);
    const lap = s.hess[0] + s.hess[4] + s.hess[8];
    out.achieved.push(
      req('Vertical stiffness', s.hess[8], 'N/m', s.hess[8] > 0 ? 'restoring' : 'repelling — it falls or flies away'),
      req('Horizontal stiffness', s.hess[0], 'N/m', s.hess[0] > 0 ? 'restoring' : 'the direction it escapes'),
      req('Trace of the stiffness matrix ∇²U', lap, 'N/m', 'Zero to numerical precision — that identity *is* Earnshaw’s theorem', true),
    );
  }
  out.requirements.push(
    req('Magnetic moment', moment, 'A·m²'),
    req('Field gradient to balance the weight', weightGradient(moment, out.weight), 'T/m', 'from m·∂B/∂z = mg'),
  );
  out.verdict = {
    tier: 'forbidden', tierLabel: TIER_LABEL.forbidden, tierNote: TIER_NOTE.forbidden,
    works: false, possible: false,
    headline: eq
      ? `Force balances at ${(eq.z * 1000).toFixed(1)} mm — and the equilibrium is a saddle, not a trap`
      : 'No height where the repulsion balances the weight with this base magnet',
    reason: 'Earnshaw’s theorem: for a fixed moment U = −m·B is harmonic, so the three stiffnesses must sum to zero. Making it stable vertically forces it to be unstable horizontally.',
  };
  out.explanation.push(
    'Each component of B satisfies ∇²B_i = 0 in a current-free region, so U = −m·B satisfies ∇²U = 0 too.',
    'The trace of the stiffness matrix is therefore exactly zero: whatever positive stiffness you buy in one direction is paid for with negative stiffness in another. The numbers above show it holding to machine precision.',
    'This is why every "floating magnet" toy has a physical constraint somewhere — a pencil through the middle, a cup, a rubbing string, or a spin.',
  );
  return out;
}

function weightGradient(moment: number, weight: number) {
  return weight / moment;
}

/* ------------------------------------------------------- 4. superconductor */

function solveSuperconductor(input: LevScenarioInput, app: Apparatus, out: LevSolution, mat: EMMaterial): LevSolution {
  const o = input.object;
  const T = app.extras.temperature ?? input.temperature;
  const sc = emMaterial(app.extras.puckDiameter !== undefined ? 'ybco' : mat.sc ? mat.id : 'ybco');
  const moment = o.moment > 0 ? o.moment : (app.extras.Br ?? 1.32) / MU0 * objectVolume(o);
  const hIdeal = meissnerHeight(moment, out.weight);
  const puckR = (app.extras.puckDiameter ?? 0.03) / 2;
  const h = meissnerHeightFinite(moment, out.weight, puckR) || hIdeal;
  const Bsurface = app.extras.Br ?? 1.32;
  const thickness = app.extras.puckThickness ?? 0.01;
  const pin = pinningCapability(sc, Bsurface / 2, T, thickness);

  out.requirements.push(
    req('Critical temperature', sc.sc?.Tc ?? 0, 'K', `${sc.name}; the apparatus runs at ${T.toFixed(1)} K`, true),
    req('Levitation pressure needed', out.weight / Math.max(objectArea(o), 1e-9), 'Pa'),
  );
  out.achieved.push(
    req('Levitation height', h, 'm', `image-dipole repulsion 3μ₀m²/32πh⁴, reduced by the ${(puckR * 2000).toFixed(0)} mm puck covering only part of the half-space`),
    req('Height over an ideal infinite plane', hIdeal, 'm', 'the uncorrected Meissner result — always an over-estimate for a real puck'),
    req('Maxwell-stress ceiling B²/2μ₀', pin.maxPressure, 'Pa', `at ${(Bsurface / 2).toFixed(2)} T`),
    req('Pinning pressure available', pin.pressure, 'Pa', pin.limited === 'thickness' ? 'limited by how deep the flux penetrates' : 'at the Maxwell limit'),
    req('Critical current density Jc', pin.Jc, 'A/m²', `Kim model at ${T.toFixed(0)} K`),
    req('Flux penetration depth', pin.penetration, 'm', 'Bean model, λ = B/μ₀Jc'),
  );

  const works = T < (sc.sc?.Tc ?? 0) && pin.pressure * objectArea(o) >= out.weight;
  // vertical stiffness of the image force: F ∝ h⁻⁴ ⇒ k = 4F/h = 4mg/h
  const kz = (4 * out.weight) / h;
  out.stability = {
    stiffness: [pin.pressure * objectArea(o) / Math.max(o.size, 1e-6), pin.pressure * objectArea(o) / Math.max(o.size, 1e-6), kz],
    frequencies: [0, 0, 0], stable: works, unstableDirections: works ? 0 : 1,
    escapeHint: works ? 'none — pinned in all three directions' : 'it sinks onto the superconductor',
  };
  out.stability.frequencies = out.stability.stiffness.map((k) => (k > 0 ? Math.sqrt(k / o.mass) / (2 * Math.PI) : NaN)) as [number, number, number];
  out.equilibriumHeight = h;

  const tier: VerdictTier = T >= 77 ? app.tier : 'universityLab';
  out.verdict = {
    tier, tierLabel: TIER_LABEL[tier], tierNote: T >= 77
      ? 'Liquid nitrogen, a YBCO puck and a magnet: a few hundred dollars and a school bench.'
      : 'Below 77 K means liquid helium or a cryocooler — a laboratory, not a bench.',
    works, possible: true,
    headline: works
      ? `Stable at ${(h * 1000).toFixed(1)} mm, pinned laterally as well as vertically`
      : T >= (sc.sc?.Tc ?? 0)
        ? `${sc.name} is not superconducting at ${T.toFixed(0)} K (Tc = ${sc.sc?.Tc} K)`
        : 'Pinning cannot carry this weight — a bigger puck, a colder bath, or a lighter magnet',
    reason: works
      ? 'Two separate escapes from Earnshaw: perfect diamagnetism (χ = −1) gives a true B² minimum, and flux pinning adds hysteretic lateral stiffness that no potential describes.'
      : 'The superconductor must be below its critical temperature and thick enough for the flux to pin.',
  };
  out.explanation.push(
    'A superconductor expels magnetic flux (Meissner effect). The boundary condition B⊥ = 0 on its surface is satisfied by an image dipole, and two repelling dipoles 2h apart give F = 3μ₀m²/32πh⁴.',
    'Perfect diamagnetism alone would still leave the magnet free to slide sideways — an infinite plane is translationally invariant. What stops it is flux pinning at defects in a type-II material: the trapped flux remembers where the magnet was when it was cooled.',
    `Bean’s model gives the penetration depth λ = B/μ₀Jc = ${(pin.penetration * 1e6).toFixed(1)} µm here, and the pinning force density is Jc × B.`,
    'This is the mode used by every superconducting Maglev — the Japanese SCMaglev and Rio de Janeiro’s MagLev Cobra.',
  );
  if (sc.sc?.kind === 'typeI') {
    out.warnings.push('Type-I superconductors expel flux but pin none, so levitation above them is laterally unstable. The Meissner effect by itself does not defeat Earnshaw.');
  }
  return out;
}

/* ----------------------------------------------------------- 5. eddy current */

function solveEddy(input: LevScenarioInput, app: Apparatus, out: LevSolution, mat: EMMaterial): LevSolution {
  const o = input.object;
  if (app.id === 'halbachTrack') {
    const v = app.extras.speed, vc = app.extras.vc;
    const res = inductrack(app.peakField, app.extras.wavelength, app.extras.gap, app.extras.trackArea, vc, v);
    // lift saturates as v → ∞; that ceiling is what decides whether speed can ever be enough
    const ceilingLift = inductrack(app.peakField, app.extras.wavelength, app.extras.gap, app.extras.trackArea, vc, vc * 1e6).lift;
    out.requirements.push(
      req('Lift needed', out.weight, 'N'),
      req('Speed', v, 'm/s', `the transition speed of this track is ${vc.toFixed(2)} m/s`, true),
    );
    out.achieved.push(
      req('Lift', res.lift, 'N'),
      req('Lift ceiling at unlimited speed', ceilingLift, 'N', 'B₀²A/2μ₀ times the gap decay — no speed beats it'),
      req('Magnetic drag', res.drag, 'N'),
      req('Lift-to-drag ratio', res.ratio, '', 'equal to v/v_c — it grows linearly with speed'),
      req('Power lost to drag', res.drag * v, 'W'),
    );
    const works = res.lift >= out.weight;
    const tier: VerdictTier = app.tier;
    out.verdict = {
      tier, tierLabel: TIER_LABEL[tier], tierNote: 'A Halbach array and an aluminium track are buildable; a vehicle-scale version is a research programme.',
      works, possible: true,
      headline: works
        ? `Lifts ${res.lift.toFixed(1)} N at ${v.toFixed(1)} m/s, with a lift-to-drag ratio of ${res.ratio.toFixed(0)}:1`
        : ceilingLift < out.weight
          ? `Even at unlimited speed this array and track top out at ${ceilingLift.toFixed(1)} N against a weight of ${out.weight.toFixed(0)} N — the array area or the field is the limit, not the speed`
          : `Only ${res.lift.toFixed(2)} N of lift at ${v.toFixed(1)} m/s; it reaches ${out.weight.toFixed(1)} N at about ${(vc / Math.sqrt(Math.max(ceilingLift / out.weight - 1, 1e-9))).toFixed(1)} m/s`,
      reason: 'The field at the track is time-varying because the array is moving, so Earnshaw never applies. Below the transition speed the induced currents are resistive and mostly produce drag; above it they are inductive and produce lift.',
    };
    out.explanation.push(
      'Lift = (B₀²A/2μ₀)·e^{−4πy/λ}/(1+(v_c/v)²) and drag = lift·(v_c/v), so lift equals drag exactly at v = v_c and the ratio is just v/v_c (Post & Ryutov 2000).',
      'The exponential in the gap is unforgiving: doubling the gap at λ = 100 mm costs a factor of 12 in lift.',
      'This is passive and needs no control loop, but it only works while moving — an Inductrack vehicle rolls on wheels until it reaches v_c.',
    );
    out.profile = null;
    return out;
  }

  // AC coil: induced-dipole model for a conducting sphere
  const sigma = mat.resistivity && mat.resistivity > 0 ? 1 / mat.resistivity : 0;
  const f = app.extras.frequency ?? 50;
  const omega = 2 * Math.PI * f;
  const radius = o.shape === 'sphere' ? o.size / 2 : Math.cbrt((3 * objectVolume(o)) / (4 * Math.PI));
  if (sigma <= 0) {
    out.verdict = {
      tier: 'forbidden', tierLabel: TIER_LABEL.forbidden, tierNote: TIER_NOTE.forbidden,
      works: false, possible: false,
      headline: `${mat.name} does not conduct, so no eddy currents can flow`,
      reason: 'Induction levitation needs a closed conducting path in the object.',
    };
    return out;
  }
  const pol = eddySpherePolarisability(radius, sigma, omega);
  // time-averaged force ⟨F⟩ = (Re α /4μ₀)·∇(B_amp²)
  const k = pol.re / (4 * MU0);
  const model: PotentialModel = {
    label: '⟨U⟩ = −(Re α/4μ₀)·B²  + mgz',
    energy(p: Vec3) {
      const b = app.field.B(p);
      return -k * (b[0] * b[0] + b[1] * b[1] + b[2] * b[2]) + o.mass * input.g * p[2];
    },
    grad(p: Vec3) {
      const { B, J } = app.field.BJ(p);
      const g2 = (i: number) => 2 * (B[0] * J[i] + B[1] * J[3 + i] + B[2] * J[6 + i]);
      return [-k * g2(0), -k * g2(1), -k * g2(2) + o.mass * input.g];
    },
    at(p: Vec3) {
      const b2 = app.field.B2d(p);
      return {
        U: -k * b2.v + o.mass * input.g * p[2],
        grad: [-k * b2.gx, -k * b2.gy, -k * b2.gz + o.mass * input.g] as Vec3,
        hess: b2.hess.map((h) => -k * h),
      };
    },
  };
  const zBot = app.scale * 0.01, zTop = app.scale * 3;
  out.equilibria = equilibriaOf(model, o.mass, zBot, zTop);
  out.profile = sampleProfile(model, app.field, zBot, zTop, 240, o.mass);
  {
      const stableEq = out.equilibria.find((e) => e.stable) ?? out.equilibria[0];
      const w = landscapeWindow(stableEq ? stableEq.z : null, app, zBot, zTop);
      out.landscape = sampleLandscape(model, w.half, w.z0, w.z1, stableEq ? [0, 0, stableEq.z] : null);
    }
  const eq = out.equilibria.find((e) => e.stable) ?? out.equilibria[0];
  if (eq) {
    out.equilibriumHeight = eq.z;
    out.stability = analyseStability(model.at([0, 0, eq.z]).hess, o.mass);
  }
  const bAt = eq ? Math.hypot(...app.field.B([0, 0, eq.z])) : app.peakField;
  const dissipated = (-omega * pol.im * bAt * bAt) / (2 * MU0);
  out.requirements.push(
    req('Skin depth at this frequency', pol.skinDepth, 'm', `δ = √(2/ωμ₀σ); the object radius is ${(radius * 1000).toFixed(1)} mm`, true),
    req('Conductivity', sigma, 'S/m'),
  );
  out.achieved.push(
    req('Re α (lift)', pol.re, 'm³', 'negative ⇒ repelled from strong field'),
    req('Im α (loss)', pol.im, 'm³'),
    req('Shielding fraction', pol.re / (-2 * Math.PI * radius ** 3), '', '1 = perfect shielding (δ ≪ radius), 0 = field passes straight through'),
    req('Power dissipated in the object', dissipated, 'W', 'this is why induction-levitated metal glows'),
  );
  const works = !!out.stability?.stable;
  const tier = works ? worseTier(app.tier, powerTier(dissipated * 5)) : worseTier(powerTier(dissipated * 5), app.tier);
  out.verdict = {
    tier, tierLabel: TIER_LABEL[tier], tierNote: TIER_NOTE[tier],
    works, possible: true,
    headline: works
      ? `Floats at ${(out.equilibriumHeight! * 1000).toFixed(1)} mm, dissipating ${dissipated.toFixed(1)} W inside the object`
      : eq
        ? `It lifts at ${(eq.z * 1000).toFixed(1)} mm but slides off sideways — a flat coil gives no lateral stability, which is why real induction levitators use a conical coil`
        : 'The coil cannot lift it at this frequency and current — more amp-turns, or a higher frequency so the skin depth shrinks',
    reason: 'The drive field oscillates, so Earnshaw does not apply. The induced moment opposes the field (Lenz), giving repulsion, and the equilibrium can be genuinely stable.',
  };
  if (eq && !works) {
    out.explanation.push(
      'The vertical force balances here, but the horizontal stiffness is negative: above a flat coil the field weakens towards the axis as well as upwards, so the disc is pushed outwards. Induction levitators solve this with a conical ("pot") coil whose field curves inwards, trapping the object in the dip.',
    );
  }
  out.explanation.push(
    'A conducting sphere in an AC field acquires a dipole moment m = αH with a complex polarisability α(ω) = −2πa³[1 − 3/q² + 3cot(q)/q], q = (1−i)a/δ (Landau & Lifshitz §59).',
    'The real part gives the time-averaged force; the imaginary part gives the dissipation. They are inseparable — induction levitation always heats what it lifts.',
    `At ${f.toFixed(0)} Hz the skin depth is ${(pol.skinDepth * 1000).toFixed(2)} mm against a radius of ${(radius * 1000).toFixed(1)} mm, so the object is ${pol.skinDepth < radius ? 'shielding well' : 'nearly transparent to the field'}.`,
  );
  if (dissipated > 50) out.warnings.push(`${dissipated.toFixed(0)} W dissipated inside the object will melt it in seconds unless it is cooled — this is literally how induction furnaces work.`);
  return out;
}

/* ----------------------------------------------------------------- 6. servo */

function solveServo(input: LevScenarioInput, app: Apparatus, out: LevSolution): LevSolution {
  const o = input.object;
  const gap = app.extras.gap, area = app.extras.poleArea, turns = app.extras.turns, bw = app.extras.bandwidth;
  const design = designServo(o.mass, input.g, gap, turns, area, bw);
  const f = emsForce(turns, area, design.current, gap);
  out.servo = design;
  out.requirements.push(
    req('Gap flux density', design.B, 'T', design.B > 1.8 ? 'above iron saturation — impossible' : 'within iron’s capability', true),
    req('Coil current', design.current, 'A'),
    req('Maxwell stress needed', out.weight / area, 'Pa', `against the ${((1.8 * 1.8) / (2 * MU0) / 1e6).toFixed(2)} MPa ceiling at 1.8 T`),
    req('Minimum control bandwidth', design.unstablePole / (2 * Math.PI) * 3, 'Hz', 'three times the open-loop instability rate'),
  );
  out.achieved.push(
    req('Open-loop instability growth rate', design.unstablePole, '1/s', 'e-folding time ' + (1000 / design.unstablePole).toFixed(1) + ' ms'),
    req('Position stiffness (open loop)', design.kx, 'N/m', 'negative: the magnet pulls harder as the gap closes'),
    req('Current stiffness', design.ki, 'N/A'),
    req('Proportional gain', design.kp, 'A/m'),
    req('Derivative gain', design.kd, 'A·s/m'),
    req('Current ripple from 1 µm of sensor noise', design.currentNoise, 'A'),
    req('Sensor bandwidth needed', design.sensorBandwidth, 'Hz'),
    req('Force at the design point', f.force, 'N', `weight is ${out.weight.toFixed(1)} N`),
  );
  const works = design.feasible;
  const tier: VerdictTier = o.mass > 100 ? 'nationalFacility' : o.mass > 1 ? 'universityLab' : 'workshop';
  out.verdict = {
    tier, tierLabel: TIER_LABEL[tier],
    tierNote: o.mass > 100 ? 'Vehicle-scale suspension: this is a transport engineering programme.' : 'A coil, a photo-interrupter or Hall sensor and an op-amp. The classic undergraduate project.',
    works, possible: true,
    headline: works
      ? `Holds a ${(gap * 1000).toFixed(1)} mm gap at ${design.current.toFixed(2)} A, with a ${bw.toFixed(0)} Hz loop`
      : design.B > 1.8
        ? `Needs ${design.B.toFixed(2)} T in the gap — iron saturates near 1.8 T, so the pole faces must be bigger`
        : `A ${bw.toFixed(0)} Hz loop is too slow for an instability that grows in ${(1000 / design.unstablePole).toFixed(0)} ms`,
    reason: 'Feedback supplies energy, so Earnshaw is irrelevant. The price is that it can never be switched off: cut the power and the object falls within one e-folding time.',
  };
  out.explanation.push(
    'Two air gaps in series give B = μ₀Ni/2x and a pull F = B²A/μ₀ = k(i/x)². Linearising about the operating point gives a negative position stiffness k_x = −2mg/x₀ and a current stiffness k_i = 2mg/i₀.',
    `The uncontrolled plant has a real pole at √(2g/x₀) = ${design.unstablePole.toFixed(1)} s⁻¹, so a disturbance doubles every ${((Math.LN2 * 1000) / design.unstablePole).toFixed(0)} ms. The loop must be an order of magnitude faster.`,
    'With u = −k_p·x̃ − k_d·ẋ the closed loop is m s² + k_i k_d s + (k_i k_p + k_x) = 0, and the gains above place it at the chosen frequency and damping.',
    'Sensor noise enters directly as current ripple, and current ripple is force ripple — which is why a Maglev ride quality is a sensor problem as much as a magnet problem.',
  );
  return out;
}

/* ------------------------------------------------------------------ 7. spin */

function solveSpin(input: LevScenarioInput, app: Apparatus, out: LevSolution): LevSolution {
  const o = input.object;
  const moment = o.moment;
  if (moment <= 0) {
    out.verdict = {
      tier: 'forbidden', tierLabel: TIER_LABEL.forbidden, tierNote: TIER_NOTE.forbidden,
      works: false, possible: false,
      headline: `${o.name} has no magnetic moment to precess`,
      reason: 'Spin stabilisation needs a magnetised, axisymmetric spinning body — a magnetic top.',
    };
    return out;
  }
  const model = adiabaticDipolePotential(app.field, moment, o.mass, input.g);
  const zBot = app.scale * 0.05, zTop = app.scale * 2.5;
  out.equilibria = equilibriaOf(model, o.mass, zBot, zTop);
  out.profile = sampleProfile(model, app.field, zBot, zTop, 300, o.mass);
  {
      const stableEq = out.equilibria.find((e) => e.stable) ?? out.equilibria[0];
      const w = landscapeWindow(stableEq ? stableEq.z : null, app, zBot, zTop);
      out.landscape = sampleLandscape(model, w.half, w.z0, w.z1, stableEq ? [0, 0, stableEq.z] : null);
    }
  const { Is, Iperp } = inertia(o);
  // Choose among the stable equilibria the one whose adiabatic window actually
  // contains a usable spin rate. This is what rules out the field zero on the
  // axis of a ring magnet: |B| = 0 is a minimum of |B|, but the precession
  // rate mB/I_sω_s vanishes there, so the moment cannot track the field at
  // all — the magnetic analogue of Majorana spin-flip losses in an atom trap.
  const candidates = out.equilibria.filter((e) => e.stable);
  const scored = candidates.map((e) => {
    const B = Math.hypot(...app.field.B([0, 0, e.z]));
    const fv = e.freq.filter((x) => Number.isFinite(x));
    const w = levitronWindow(moment, B, Is, Iperp, fv.length ? Math.max(...fv) : 2);
    return { e, B, w, width: w.exists ? w.maxRps - w.minRps : -1 };
  });
  const usable = scored.filter((s) => s.w.exists).sort((a, b) => b.width - a.width);
  const picked = usable[0];
  const eq = picked ? picked.e : null;
  if (scored.length > usable.length) {
    out.warnings.push('An equilibrium was found at a zero of the field and discarded. |B| = 0 is formally a minimum of |B|, but the precession rate mB/I_sω_s vanishes with the field, so the moment cannot track it and the adiabatic picture collapses — the magnetic analogue of Majorana spin-flip losses in an atom trap.');
  }
  /*
   * One scan does all the work.
   *
   * At a height z the gradient of |B| supports exactly one mass,
   * m(z) = moment·|∂|B|/∂z|/g, so the set of workable masses is the image of
   * the stable band under that map. There is no need to re-solve the whole
   * problem for trial masses: the trim mass and the mass window both fall out
   * of a single pass, which is what keeps the in-app report quick.
   */
  const traps = scanTraps(app, moment, input.g, Is, Iperp, zBot, zTop);
  const massWindow = massWindowFrom(traps, o.mass);
  const bandLow = traps.length ? traps[0].z : NaN;
  const bandHigh = traps.length ? traps[traps.length - 1].z : NaN;
  let trimMass = NaN, trimHeight = NaN, trimWindow: { minRps: number; maxRps: number } | null = null;
  if (!eq && traps.length) {
    let best = Infinity;
    for (const t of traps) {
      const d = Math.abs(Math.log(t.mass / o.mass));
      if (d < best) {
        best = d;
        trimMass = t.mass;
        trimHeight = t.z;
        trimWindow = t.window;
      }
    }
  }

  let window: ReturnType<typeof levitronWindow> | { minRps: number; maxRps: number; exists: boolean } = { minRps: NaN, maxRps: NaN, exists: false };
  if (eq) {
    out.equilibriumHeight = eq.z;
    out.stability = analyseStability(model.at([0, 0, eq.z]).hess, o.mass);
    const B = Math.hypot(...app.field.B([0, 0, eq.z]));
    const fVib = out.stability.frequencies.filter((x) => Number.isFinite(x));
    const vib = fVib.length ? Math.max(...fVib) : 2;
    window = levitronWindow(moment, B, Is, Iperp, vib);
    out.achieved.push(
      req('Field at the trap', B, 'T'),
      req('Vertical oscillation frequency', out.stability.frequencies[2], 'Hz'),
      req('Minimum spin rate', window.minRps, 'rev/s', 'slower and the top topples, like a sleeping top losing speed', true),
      req('Maximum spin rate', window.maxRps, 'rev/s', 'faster and the moment can no longer precess quickly enough to follow the field', true),
      req('Trap height band', Number.isNaN(bandLow) ? 0 : bandHigh - bandLow, 'm', Number.isNaN(bandLow) ? 'no stable band' : `from ${(bandLow * 1000).toFixed(1)} to ${(bandHigh * 1000).toFixed(1)} mm`),
      req('Mass window', massWindow.width, 'kg', massWindow.width > 0 ? `${(massWindow.low * 1000).toFixed(2)}–${(massWindow.high * 1000).toFixed(2)} g — the reason Levitrons ship with trim washers` : 'none at this field'),
    );
  }
  out.requirements.push(
    req('Magnetic moment', moment, 'A·m²'),
    req('Spin moment of inertia', Is, 'kg·m²'),
    req('Spin rate set', o.spinRps, 'rev/s'),
  );
  const inWindow = window.exists && o.spinRps >= window.minRps && o.spinRps <= window.maxRps;
  const works = !!out.stability?.stable && inWindow;
  out.verdict = {
    tier: 'deskToy', tierLabel: TIER_LABEL.deskToy,
    tierNote: 'A ring magnet, a top and a lot of patience with the trim washers.',
    works, possible: true,
    headline: works
      ? `Spinning at ${o.spinRps.toFixed(0)} rev/s it floats at ${(out.equilibriumHeight! * 1000).toFixed(1)} mm — inside the ${window.minRps.toFixed(0)}–${window.maxRps.toFixed(0)} rev/s window`
      : !eq
        ? Number.isFinite(trimMass)
          ? `Nothing balances at ${(o.mass * 1000).toFixed(1)} g: trim the top to ${(trimMass * 1000).toFixed(1)} g and it floats at ${(trimHeight * 1000).toFixed(1)} mm, spinning between ${trimWindow!.minRps.toFixed(0)} and ${trimWindow!.maxRps.toFixed(0)} rev/s`
          : '|B| has no usable local minimum above this base, so there is nothing for the top to sit in'
        : o.spinRps < window.minRps
          ? `Too slow: below ${window.minRps.toFixed(0)} rev/s the top tips over instead of precessing`
          : `Too fast: above ${window.maxRps.toFixed(0)} rev/s the moment cannot follow the field direction, and the trap disappears`,
    reason: 'Fast precession makes the moment track the local field, so the effective energy is U = +m|B| instead of −m·B. |B| is not harmonic and can have a genuine local minimum.',
  };
  out.explanation.push(
    'This is the one mode where the loophole is angular momentum. A non-spinning magnet feels U = −m·B, which is harmonic. A fast-spinning one adiabatically keeps its moment anti-parallel to B, so it feels U = +m|B| — and the magnitude of a field, unlike its components, is not a harmonic function.',
    'Both bounds on the spin rate come from the same adiabatic requirement, from opposite sides: the precession must be fast compared with the top tipping over, and slow compared with nothing — but the moment must still be able to reorient as the top moves through the field, which caps it from above.',
    `The trap here is only ${Number.isNaN(bandLow) ? 0 : ((bandHigh - bandLow) * 1000).toFixed(1)} mm tall, and the mass has to fall in a ${(massWindow.width * 1000).toFixed(2)} g window. That is not a flaw in the model — it is exactly why the toy is hard to start.`,
  );
  return out;
}

/**
 * Hessian of m|B| from the hyper-dual B², via |B| = √(B²):
 *   ∂²|B|/∂xi∂xj = [ ∂²(B²)/∂xi∂xj − ∂(B²)/∂xi·∂(B²)/∂xj / (2B²) ] / (2|B|)
 */
function dualMagnitudeHess(b2: { gx: number; gy: number; gz: number; hess: number[] }, bm: number, scale: number): Mat3 {
  const g = [b2.gx, b2.gy, b2.gz];
  return b2.hess.map((v, idx) => {
    const i = Math.floor(idx / 3), j = idx % 3;
    return (scale * (v - (g[i] * g[j]) / (2 * bm * bm))) / (2 * bm);
  });
}

/** one height where a spin-stabilised trap exists, and what it can carry */
interface Trap {
  z: number;
  mass: number;
  window: { minRps: number; maxRps: number };
}

/**
 * Every height at which a spinning magnet of the given moment can be trapped.
 *
 * A height qualifies only if |B| has a true local minimum there *and* a spin
 * window exists. The second condition is what excludes the zero of the field
 * on the axis of a ring magnet: |B| = 0 is formally a minimum, but the
 * precession rate mB/I_sω_s vanishes with the field, so the moment cannot
 * track it — the magnetic analogue of Majorana spin-flip losses in an atom
 * trap.
 */
function scanTraps(app: Apparatus, moment: number, g: number, Is: number, Iperp: number, zBot: number, zTop: number, samples = 360): Trap[] {
  const out: Trap[] = [];
  for (let i = 0; i <= samples; i++) {
    const z = zBot + ((zTop - zBot) * i) / samples;
    const p: Vec3 = [0, 0, z];
    if (app.field.isInsideAny(p)) continue;
    const g2 = app.field.B2d(p);
    const b = app.field.B(p);
    const bm = Math.hypot(b[0], b[1], b[2]);
    if (!(bm > 0)) continue;
    const slope = -g2.gz / (2 * bm);
    if (!(slope > 0)) continue;
    const mass = (moment * slope) / g;
    const st = analyseStability(dualMagnitudeHess(g2, bm, moment), mass);
    if (!st.stable) continue;
    const fv = st.frequencies.filter((x) => Number.isFinite(x));
    const w = levitronWindow(moment, bm, Is, Iperp, fv.length ? Math.max(...fv) : 2);
    if (!w.exists) continue;
    out.push({ z, mass, window: { minRps: w.minRps, maxRps: w.maxRps } });
  }
  return out;
}

/**
 * The band of masses around the chosen one for which a trap still exists.
 * Only the contiguous run containing the object counts — a second, unrelated
 * trap elsewhere in the field is not a wider tolerance.
 */
function massWindowFrom(traps: Trap[], mass: number): { low: number; high: number; width: number } {
  if (!traps.length) return { low: NaN, high: NaN, width: 0 };
  let bestIdx = 0, bestDist = Infinity;
  for (let i = 0; i < traps.length; i++) {
    const d = Math.abs(Math.log(traps[i].mass / mass));
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  let lo = traps[bestIdx].mass, hi = lo;
  for (let i = bestIdx; i >= 0; i--) {
    if (i < bestIdx && Math.abs(traps[i].z - traps[i + 1].z) > (traps[traps.length - 1].z - traps[0].z) / 8) break;
    lo = Math.min(lo, traps[i].mass);
    hi = Math.max(hi, traps[i].mass);
  }
  for (let i = bestIdx; i < traps.length; i++) {
    if (i > bestIdx && Math.abs(traps[i].z - traps[i - 1].z) > (traps[traps.length - 1].z - traps[0].z) / 8) break;
    lo = Math.min(lo, traps[i].mass);
    hi = Math.max(hi, traps[i].mass);
  }
  return { low: lo, high: hi, width: Math.max(hi - lo, 0) };
}

/* --------------------------------------------------------- 1. electrostatic */

function solveElectrostatic(input: LevScenarioInput, app: Apparatus, out: LevSolution, mat: EMMaterial, medium: EMMaterial): LevSolution {
  const o = input.object;
  const radius = o.shape === 'sphere' ? o.size / 2 : Math.cbrt((3 * objectVolume(o)) / (4 * Math.PI));
  const lim = electrostaticLimits(mat, radius, input.g, medium);
  const gap = app.extras.gap ?? 0.02;
  const E = app.extras.Efield ?? 1e6;
  const chargeNeeded = out.weight / E;
  const electrons = chargeNeeded / 1.602176634e-19;
  out.requirements.push(
    req('Charge needed at this field', chargeNeeded, 'C', `${electrons.toExponential(2)} elementary charges`, true),
    req('Field applied', E, 'V/m', `${(app.extras.voltage ?? 0) / 1000} kV over ${(gap * 1000).toFixed(0)} mm`),
    req('Breakdown field of the medium', lim.breakdown, 'V/m', medium.name),
    req('Largest radius this medium allows', lim.maxRadius, 'm', 'r_max = ε₀E_br²/4ρg, from maximising QE against surface breakdown'),
  );
  const maxSurfaceCharge = 4 * Math.PI * EPS0 * radius * radius * lim.breakdown;
  out.achieved.push(
    req('Maximum force before breakdown', lim.maxForce, 'N', `weight is ${out.weight.toExponential(3)} N`),
    req('Maximum charge the surface holds', maxSurfaceCharge, 'C'),
    req('Voltage needed across the gap', E * gap, 'V'),
    ...(lim.rayleighLimit !== null ? [req('Rayleigh limit for this drop', lim.rayleighLimit, 'C', 'above this a charged liquid drop breaks into a spray')] : []),
  );
  const canBalance = lim.maxForce >= out.weight && chargeNeeded <= maxSurfaceCharge;
  const tier: VerdictTier = canBalance ? 'workshop' : 'forbidden';
  out.verdict = {
    tier, tierLabel: TIER_LABEL[tier],
    tierNote: canBalance ? 'A high-voltage supply, two plates and a fast position sensor.' : TIER_NOTE.forbidden,
    works: false, possible: canBalance,
    headline: canBalance
      ? `The force balances with ${electrons.toExponential(2)} electrons of charge — but the equilibrium is a saddle and it needs feedback`
      : `Impossible as configured: ${lim.limitedBy}. Nothing bigger than ${(lim.maxRadius * 1000).toFixed(2)} mm radius of ${mat.name} can be held in ${medium.name}`,
    reason: canBalance
      ? 'A fixed charge in a static field has U = −qE·r, which is harmonic, so Earnshaw applies exactly as it does to magnets. Real electrostatic levitators add a position sensor and feedback (NASA’s ESL) or an oscillating field (a Paul trap).'
      : 'Surface breakdown caps the product of charge and field, and so caps the liftable weight.',
  };
  out.explanation.push(
    'A conducting sphere in a field E₀ has a surface field 3E₀ at its poles, plus Q/4πε₀r² from its own charge. Breakdown caps the sum, and the liftable force is maximised when the two contributions are E_br/2 and E_br/6.',
    `That gives F_max = (π/3)ε₀r²E_br² and a maximum radius ε₀E_br²/4ρg — ${(lim.maxRadius * 1000).toFixed(2)} mm here. It is why NASA’s electrostatic levitator runs in vacuum, where the limit is electrode quality rather than air.`,
    'Millikan’s oil-drop experiment is this mode at its most useful: a micron drop with a handful of elementary charges needs only a few hundred kV/m, and the quantisation of Q is directly visible.',
  );
  if (o.charge > 0) {
    out.achieved.push(req('Field needed for the charge given', out.weight / o.charge, 'V/m', `${(o.charge / 1.602176634e-19).toFixed(1)} elementary charges on the object`));
  }
  return out;
}

/* -------------------------------------------------------------- 8. acoustic */

function solveAcoustic(input: LevScenarioInput, app: Apparatus, out: LevSolution, mat: EMMaterial, medium: EMMaterial): LevSolution {
  const o = input.object;
  const radius = o.shape === 'sphere' ? o.size / 2 : Math.cbrt((3 * objectVolume(o)) / (4 * Math.PI));
  const f = app.extras.frequency;
  const a = acousticLevitation(mat, medium, f, input.g, radius);
  const pApplied = app.extras.pressure;
  // actual peak force available at the applied pressure
  const Fmax = (Math.PI * radius ** 3 * pApplied * pApplied * a.k * a.contrast) / (3 * medium.density * (medium.soundSpeed ?? 343) ** 2);
  const works = Fmax >= out.weight && a.feasible;
  out.requirements.push(
    req('Threshold pressure amplitude', a.thresholdPressure, 'Pa', 'independent of particle size — both the force and the weight scale as a³', true),
    req('Threshold sound pressure level', a.thresholdSPL, 'dB'),
    req('Acoustic contrast factor f₁ + 1.5f₂', a.contrast, '', a.contrast > 0 ? 'positive ⇒ the particle collects at pressure nodes' : 'negative ⇒ it is pushed to the antinodes instead'),
    req('Largest particle the theory covers', a.maxRadius, 'm', 'λ/8; above that the small-particle (Gor’kov) expansion fails'),
  );
  out.achieved.push(
    req('Applied pressure amplitude', pApplied, 'Pa', `${app.extras.spl.toFixed(0)} dB`),
    req('Peak axial force available', Fmax, 'N', `weight is ${out.weight.toExponential(3)} N`),
    req('Node spacing', a.nodeSpacing, 'm', 'λ/2'),
    req('Density contrast f₂', a.f2, ''),
    req('Compressibility contrast f₁', a.f1, ''),
  );
  // 1-D Gor'kov potential profile along the cavity
  const n = 240;
  const prof: Profile = { z: new Float64Array(n), U: new Float64Array(n), Fz: new Float64Array(n), B: new Float64Array(n), kMin: new Float64Array(n) };
  const C = (Math.PI * radius ** 3 * pApplied * pApplied) / (3 * medium.density * (medium.soundSpeed ?? 343) ** 2);
  for (let i = 0; i < n; i++) {
    const z = (app.extras.cavity * i) / (n - 1);
    prof.z[i] = z;
    prof.U[i] = C * (((a.f1 - 1.5 * a.f2) / 2) + (Math.cos(2 * a.k * z) * (a.f1 + 1.5 * a.f2)) / 2) + o.mass * input.g * z;
    prof.Fz[i] = C * a.k * Math.sin(2 * a.k * z) * a.contrast - o.mass * input.g;
    prof.kMin[i] = 2 * C * a.k * a.k * Math.cos(2 * a.k * z) * a.contrast;
  }
  out.profile = prof;
  // Where it actually sits: the first height where the axial force balances
  // the weight with a restoring slope. Gravity pulls the particle slightly
  // below the pressure node rather than exactly onto it.
  for (let i = 1; i < n; i++) {
    if (prof.Fz[i - 1] > 0 && prof.Fz[i] <= 0 && prof.kMin[i] > 0) {
      const f = prof.Fz[i - 1] / (prof.Fz[i - 1] - prof.Fz[i]);
      out.equilibriumHeight = prof.z[i - 1] + f * (prof.z[i] - prof.z[i - 1]);
      const k = prof.kMin[i];
      out.stability = {
        stiffness: [k, k, k],
        frequencies: [Math.sqrt(k / o.mass) / (2 * Math.PI), Math.sqrt(k / o.mass) / (2 * Math.PI), Math.sqrt(k / o.mass) / (2 * Math.PI)],
        stable: true, unstableDirections: 0,
        escapeHint: 'none — it is held at the pressure node',
      };
      const node = Math.round(out.equilibriumHeight / a.nodeSpacing) * a.nodeSpacing;
      out.achieved.push(req('Sag below the pressure node', node - out.equilibriumHeight, 'm',
        'gravity pulls it off the node until the acoustic force balances the weight'));
      break;
    }
  }
  const tier: VerdictTier = 'workshop';
  out.verdict = {
    tier, tierLabel: TIER_LABEL[tier],
    tierNote: 'Two ultrasonic transducers from a parking sensor, a driver board and a reflector. One of the cheapest levitators to build.',
    works, possible: a.contrast > 0,
    headline: works
      ? `Trapped just below a pressure node; ${app.extras.spl.toFixed(0)} dB gives ${(Fmax / out.weight).toFixed(1)}× the force needed`
      : !a.feasible && radius >= a.maxRadius
        ? `The particle is too big: at ${(f / 1000).toFixed(0)} kHz the theory holds only below ${(a.maxRadius * 1000).toFixed(2)} mm radius`
        : `${app.extras.spl.toFixed(0)} dB is not enough — it needs ${a.thresholdSPL.toFixed(0)} dB`,
    reason: 'The trapping force is the time-averaged second-order (Gor’kov) force of an oscillating field, so no static-potential theorem applies. Gravity simply shifts the particle slightly below the node.',
  };
  out.explanation.push(
    'Gor’kov’s potential for a particle much smaller than the wavelength combines a compressibility term f₁ and a density term f₂. For a dense, stiff particle in air both are close to 1, so the contrast factor is about 2.5 and the particle is driven to the pressure nodes.',
    `The threshold pressure is ${a.thresholdPressure.toFixed(0)} Pa — about ${a.thresholdSPL.toFixed(0)} dB. Notice it does not depend on particle size: the acoustic force and the weight both scale as the cube of the radius, so a 100 µm droplet and a 1 mm droplet need the same loudness.`,
    `The nodes are λ/2 = ${(a.nodeSpacing * 1000).toFixed(2)} mm apart, which is the hard size limit: a particle bigger than about λ/4 spans a node and an antinode at once.`,
  );
  if (app.extras.spl > 150) out.warnings.push('Above 150 dB of ultrasound is genuinely hazardous to tissue at close range, even though it is inaudible.');
  return out;
}

/* --------------------------------------------------------------- 9. optical */

function solveOptical(input: LevScenarioInput, app: Apparatus, out: LevSolution, mat: EMMaterial, medium: EMMaterial): LevSolution {
  const o = input.object;
  const radius = o.shape === 'sphere' ? o.size / 2 : Math.cbrt((3 * objectVolume(o)) / (4 * Math.PI));
  const power = app.extras.power, waist = app.extras.waist;
  const r = opticalLevitation(mat, medium, radius, power, waist, input.g);
  out.requirements.push(
    req('Power to lift it by radiation pressure alone', r.mirrorPower, 'W', 'F = 2P/c on a perfect mirror', true),
    req('Power to lift it by scattering on a bead', r.scatterPower, 'W', 'F = n·Q·P/c with Q ≈ 0.1'),
    req('Power applied', power, 'W'),
  );
  out.achieved.push(
    req('Transverse trap stiffness', r.stiffness, 'N/m'),
    req('Trap stiffness', r.stiffnessPnPerNm, 'pN/nm', 'typical measured tweezers: 0.005–0.2 pN/nm'),
    req('Trap depth', r.trapDepthKT, 'k_BT', 'a trap shallower than ~10 k_BT cannot hold a particle against Brownian motion'),
    req('Peak intensity', app.extras.intensity, 'W/m²'),
  );
  const works = power >= r.scatterPower && r.trapDepthKT > 10;
  const tier = worseTier(powerTier(r.scatterPower), 'universityLab');
  out.verdict = {
    tier, tierLabel: TIER_LABEL[tier], tierNote: TIER_NOTE[tier],
    works, possible: true,
    headline: works
      ? `Trapped: ${(r.stiffnessPnPerNm).toPrecision(2)} pN/nm and ${r.trapDepthKT.toExponential(1)} k_BT deep`
      : r.mirrorPower > 1e6
        ? `Would need ${(r.mirrorPower / 1e6).toFixed(1)} MW of light — F = 2P/c is a brutal exchange rate`
        : `${(power * 1000).toFixed(1)} mW is not enough; it needs about ${(r.scatterPower * 1000).toFixed(1)} mW`,
    reason: 'Light carries momentum, and a focused beam has an intensity gradient that pulls a transparent particle towards the brightest point. Both are time-averaged effects of an oscillating field, so Earnshaw is irrelevant.',
  };
  out.explanation.push(
    'Two forces, with very different scalings. Radiation pressure is F = 2P/c on a mirror: lifting one gram takes 1.5 MW, which is why light does not lift everyday objects.',
    'The gradient force is what makes tweezers work: F = (2πn_m a³/c)·((m²−1)/(m²+2))·∇I. It scales as the volume of the particle and with the *gradient* of intensity, so a tight focus matters more than raw power.',
    `Here the trap is ${r.trapDepthKT.toExponential(1)} k_BT deep. Brownian motion at room temperature sets the floor: below roughly 10 k_BT the particle simply diffuses out.`,
  );
  if (!r.rayleighValid) {
    out.warnings.push('KNOWN LIMITATION: the particle is not small compared with the wavelength, so the point-dipole (Rayleigh) formula over-predicts the stiffness — typically by a factor of 2–5. A full Mie or ray-optics treatment is needed for beads of a micron and above.');
  }
  return out;
}

/* ----------------------------------------------------------- 10. aerodynamic */

function solveAero(input: LevScenarioInput, app: Apparatus, out: LevSolution, medium: EMMaterial): LevSolution {
  const o = input.object;
  const A = app.extras.discArea;
  const h = hoverPower(o.mass, input.g, medium.density || 1.225, A, app.extras.figureOfMerit);
  out.requirements.push(
    req('Thrust', h.thrust, 'N', 'exactly the weight — no more, no less, to hover', true),
    req('Ideal hover power', h.idealPower, 'W', 'momentum theory: (mg)^{3/2}/√(2ρA)'),
    req('Real shaft power', h.power, 'W', `at a figure of merit of ${app.extras.figureOfMerit.toFixed(2)}`),
  );
  out.achieved.push(
    req('Disc loading', h.discLoading, 'Pa'),
    req('Downwash velocity', h.downwash, 'm/s'),
    req('Energy for one hour of hovering', h.power * 3600, 'J', `${((h.power * 3600) / 3.6e6).toFixed(2)} kWh`),
    req('Battery mass for one hour', (h.power * 3600) / (250 * 3600), 'kg', 'at 250 Wh/kg, a good lithium cell'),
  );
  const works = medium.density > 0;
  const tier = powerTier(h.power);
  out.verdict = {
    tier, tierLabel: TIER_LABEL[tier], tierNote: TIER_NOTE[tier],
    works, possible: works,
    headline: works
      ? `${h.power.toFixed(0)} W of shaft power, pushing air down at ${h.downwash.toFixed(1)} m/s`
      : 'No air to push: thrust levitation needs a fluid, or a rocket carrying its own reaction mass',
    reason: 'Momentum transfer. The system is not closed — air is thrown downwards — so no potential-energy theorem applies. The cost is continuous power, forever.',
  };
  out.explanation.push(
    'Momentum theory: to make thrust T through a disc of area A you accelerate air to a downwash v = √(T/2ρA), which costs P = Tv = (mg)^{3/2}/√(2ρA).',
    'The scaling is unkind. Power grows as the 3/2 power of weight and falls only as the square root of disc area, so halving the rotor size costs 40 % more power.',
    'This is the only mode on the list that works in free air with no apparatus around the object — and the only one that is utterly conventional.',
  );
  return out;
}

/* -------------------------------------------------------------- 11. buoyancy */

function solveBuoyancy(input: LevScenarioInput, app: Apparatus, out: LevSolution): LevSolution {
  const o = input.object;
  const b = buoyantVolume(o.mass, app.extras.airDensity, app.extras.gasDensity);
  const net = b.volume / (1 - app.extras.envelopeFraction);
  out.requirements.push(
    req('Displaced volume', b.volume, 'm³', 'mass / (ρ_air − ρ_gas)', true),
    req('Volume including the envelope', net, 'm³', `${(app.extras.envelopeFraction * 100).toFixed(0)} % of the lift spent on the skin`),
    req('Equivalent sphere diameter', 2 * Math.cbrt((3 * net) / (4 * Math.PI)), 'm'),
  );
  out.achieved.push(
    req('Net lift per cubic metre', b.liftPerM3, 'kg/m³'),
    req('Power to stay up', 0, 'W', 'nothing at all — this is the only mode with no running cost'),
  );
  out.verdict = {
    tier: 'deskToy', tierLabel: TIER_LABEL.deskToy,
    tierNote: 'A party balloon. Still the most practical way to make something float.',
    works: b.possible, possible: b.possible,
    headline: b.possible
      ? `${net.toFixed(2)} m³ of gas — a ${(2 * Math.cbrt((3 * net) / (4 * Math.PI))).toFixed(2)} m sphere — and it floats for free`
      : 'The lifting gas is denser than the surrounding air, so there is no lift at all',
    reason: 'Archimedes, not Earnshaw: buoyancy is a pressure gradient in a fluid, and the equilibrium is genuinely stable in the vertical direction because the air thins with height.',
  };
  out.explanation.push(
    'A balloon displaces air and feels the weight of what it displaced. Helium gives 1.05 kg of lift per cubic metre at sea level, hydrogen 1.14 kg, hot air about 0.27 kg.',
    'Vertical stability comes for free: rise, and the thinning air reduces the lift. That is a real potential minimum, with no field, no spin and no power.',
    'The catch is scale. Lift grows as volume while the envelope grows as area, so buoyant levitation gets *easier* with size — the exact opposite of every magnetic mode.',
  );
  void C_LIGHT;
  void FIELD_RECORDS;
  return out;
}
