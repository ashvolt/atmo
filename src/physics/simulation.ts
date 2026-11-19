/**
 * Trajectory simulation in the body-fixed (rotating) frame.
 *
 * State y = [r(3), v(3), T_wall, m, ω_spin(3)]  — position/velocity in the
 * body-fixed Cartesian frame (ECEF for Earth), wall temperature, mass, spin.
 *
 * Equation of motion (rotating frame, Ω along +z):
 *   (m + C_a ρ V_b) dv/dt = (m − ρ V_b)(g_grav + g_cent) + F_drag + F_Magnus
 *                           − 2 m Ω × v
 *   g_cent = −Ω × (Ω × r)
 *   F_drag   = −½ ρ C_D A |u| u,         u = v − v_wind   (air velocity relative to the body)
 *   F_Magnus = ½ ρ A C_L |u|² (ω̂ × û)
 * Thermal: lumped skin model with Sutton–Graves heating and radiative exchange.
 */
import { G0 } from './constants';
import { ecefToEnu, ecefToGeodetic, enuToEcef, geodeticToEcef, geodesicDistance } from './geodesy';
import type { GravityField } from './gravity/harmonics';
import type { Atmosphere, AtmosphereState } from './atmosphere/types';
import { dragCoefficient, magnusLiftCoefficient, rarefactionWeight, SPIN_DECAY_CM, sportCd, sportCl } from './aero/drag';
import { AVERAGE_TO_STAGNATION, LAMBDA_FM, freeMolecularHeatFlux, recoveryTemperature, suttonGraves } from './aero/heating';
import { DormandPrince, findRoot } from './integrator';
import { MATERIALS, type ObjectSpec } from './objects';
import type { BodyDef } from './bodies';
import { NO_WIND, SEAWATER, windENU, type GeoidSampler, type TerrainSampler, type WindSettings } from './environment';
import { SIGMA_SB } from './constants';
import { cross, norm, type Vec3 } from './vec3';

export type SpinMode = 'none' | 'backspin' | 'topspin' | 'curveLeft' | 'curveRight' | 'rifle';

export interface LaunchConfig {
  lat: number; // deg
  lon: number; // deg
  mode: 'drop' | 'throw';
  /** release height above local ground (or sea surface) [m] */
  heightAGL: number;
  /** launch speed relative to the ground [m/s] (throw) */
  speed: number;
  /** elevation angle above local horizontal [deg] */
  elevation: number;
  /** azimuth clockwise from north [deg] */
  azimuth: number;
  spinRpm: number;
  spinMode: SpinMode;
  /** deploy parachute at this height above ground [m]; null = never */
  deployAGL: number | null;
  vacuum: boolean;
  wind: WindSettings;
  /** include centrifugal & Coriolis terms (Earth rotation) */
  rotation: boolean;
  /** with rotation on, set false to drop only the Coriolis term (isolates Coriolis deflection) */
  coriolis?: boolean;
  /** follow the object into the ocean down to the sea floor */
  water: boolean;
  /** spherical-harmonic degree of the gravity field used for integration */
  gravityDegree: number;
  /** stop after this simulated time [s] */
  maxTime: number;
  rtol: number;
  /** max output samples kept */
  maxSamples: number;
}

export const DEFAULT_LAUNCH: LaunchConfig = {
  lat: 0,
  lon: 0,
  mode: 'drop',
  heightAGL: 100,
  speed: 20,
  elevation: 45,
  azimuth: 90,
  spinRpm: 0,
  spinMode: 'none',
  deployAGL: null,
  vacuum: false,
  wind: NO_WIND,
  rotation: true,
  water: true,
  gravityDegree: 72,
  maxTime: 6 * 3600,
  rtol: 1e-10,
  maxSamples: 8000,
};

export interface SimEnvironment {
  body: BodyDef;
  field: GravityField;
  atmosphere: Atmosphere;
  terrain: TerrainSampler;
  geoid: GeoidSampler;
}

export type Outcome = 'impact' | 'seabed' | 'floating' | 'burned' | 'escaped' | 'orbit' | 'timeout' | 'floor' | 'error';

/** Fields of one output sample row. */
export const F = {
  t: 0, x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6, lat: 7, lon: 8, hMSL: 9, hAGL: 10, speed: 11, airspeed: 12,
  mach: 13, rho: 14, gLocal: 15, drag: 16, gLoad: 17, Tw: 18, qStag: 19, mass: 20, cd: 21, re: 22, kn: 23,
  qDyn: 24, medium: 25, chute: 26, downrange: 27, east: 28, north: 29, up: 30, vUp: 31, Tair: 32, pAir: 33,
  coriolis: 34, spin: 35, heatW: 36, gGrav: 37, energy: 38, cl: 39, buoy: 40,
} as const;
export const N_FIELDS = 41;

export interface SimSummary {
  outcome: Outcome;
  message: string;
  flightTime: number;
  launchMSL: number;
  groundMSL: number;
  maxAltitudeMSL: number;
  maxAltitudeAGL: number;
  timeAtApogee: number;
  maxSpeed: number;
  maxMach: number;
  maxQ: number;
  maxGLoad: number;
  maxTemp: number;
  maxHeatFlux: number;
  impactSpeed: number;
  impactAngle: number; // below horizontal [deg]
  impactEnergy: number; // [J]
  impactLat: number;
  impactLon: number;
  range: number; // geodesic surface distance launch -> end [m]
  finalMass: number;
  terminalVelocityEstimate: number;
  localG: number; // |g| at the launch point (gravitation + centrifugal)
  chuteDeployTime: number | null;
  waterEntryTime: number | null;
  nSteps: number;
  nEvals: number;
  wallTimeMs: number;
}

export interface SimResult {
  samples: Float64Array; // N × N_FIELDS
  count: number;
  summary: SimSummary;
  launchECEF: Vec3;
  groundECEF: Vec3;
  launchLat: number;
  launchLon: number;
}

interface Scratch {
  lat: number; lon: number; hMSL: number; hAGL: number; ground: number;
  atm: AtmosphereState; airspeed: number; mach: number; cd: number; re: number; kn: number; cl: number;
  drag: Vec3; magnus: Vec3; gGrav: Vec3; gCent: Vec3; cor: Vec3; buoyMag: number;
  qStag: number; heatW: number; chute: number; accel: Vec3; tempRate: number; massRate: number; spinRate: Vec3;
}

const DEG = Math.PI / 180;

export class Simulation {
  private readonly obj: ObjectSpec;
  private readonly mat = MATERIALS.iron;
  private readonly env: SimEnvironment;
  private readonly cfg: LaunchConfig;
  private medium: 0 | 1 = 0; // 0 air, 1 water
  private chuteTime: number | null = null;
  private readonly m0: number;
  private readonly T0: number;
  private readonly omega: number;
  private launchECEF: Vec3 = [0, 0, 0];
  private groundECEF: Vec3 = [0, 0, 0];
  private s: Scratch;

  constructor(env: SimEnvironment, obj: ObjectSpec, cfg: LaunchConfig) {
    this.env = env;
    this.obj = obj;
    this.cfg = cfg;
    this.mat = MATERIALS[obj.material] ?? MATERIALS.stone;
    this.m0 = obj.mass;
    this.omega = cfg.rotation ? env.body.omega : 0;
    this.T0 = 288.15;
    this.s = {
      lat: 0, lon: 0, hMSL: 0, hAGL: 0, ground: 0, atm: env.atmosphere.at(0), airspeed: 0, mach: 0, cd: 0, re: 0, kn: 0, cl: 0,
      drag: [0, 0, 0], magnus: [0, 0, 0], gGrav: [0, 0, 0], gCent: [0, 0, 0], cor: [0, 0, 0], buoyMag: 0,
      qStag: 0, heatW: 0, chute: 0, accel: [0, 0, 0], tempRate: 0, massRate: 0, spinRate: [0, 0, 0],
    };
  }

  /** Surface level the object can hit in the current medium [m MSL]. */
  private surfaceLevel(lat: number, lon: number): number {
    const e = this.env.terrain.elevation(lat, lon);
    if (this.medium === 1) return e; // sea floor
    if (this.env.body.ocean && this.env.terrain.isOcean(lat, lon)) return 0; // sea surface
    return e;
  }

  private water(depth: number) {
    // EOS-80 compressibility ≈ 4.4e-10 /Pa; surface water ~1025 kg/m³
    const p = 101325 + 1025 * G0 * Math.max(depth, 0);
    const rho = 1025 * (1 + 4.4e-10 * (p - 101325));
    return {
      T: SEAWATER.temperature, p, rho, a: SEAWATER.soundSpeed, mu: SEAWATER.viscosity, mfp: 0, M: 18, gamma: 1,
    } as AtmosphereState;
  }

  /** Evaluate all forces & diagnostics; fills this.s. */
  private evaluate(t: number, y: Float64Array): Scratch {
    const s = this.s;
    const { body, field, atmosphere, geoid } = this.env;
    const r: Vec3 = [y[0], y[1], y[2]];
    const v: Vec3 = [y[3], y[4], y[5]];
    const Tw = y[6];
    const m = Math.max(y[7], 1e-12);
    const w: Vec3 = [y[8], y[9], y[10]];

    const g = ecefToGeodetic(r, body.ellipsoid);
    const latD = g.lat / DEG;
    const lonD = g.lon / DEG;
    const hMSL = g.h - geoid.undulation(latD, lonD);
    const ground = this.surfaceLevel(latD, lonD);
    s.lat = latD; s.lon = lonD; s.hMSL = hMSL; s.ground = ground; s.hAGL = hMSL - ground;

    // gravity
    const gg = field.accel(r, this.cfg.gravityDegree);
    const W = this.omega;
    s.gGrav = gg;
    s.gCent = [W * W * r[0], W * W * r[1], 0];
    s.cor = this.cfg.coriolis === false ? [0, 0, 0] : [2 * W * v[1], -2 * W * v[0], 0];

    // fluid
    let atm: AtmosphereState;
    let wind: Vec3 = [0, 0, 0];
    if (this.medium === 1) atm = this.water(-hMSL);
    else {
      atm = this.cfg.vacuum || hMSL > atmosphere.top ? { ...atmosphere.at(hMSL), rho: 0, p: 0 } : atmosphere.at(hMSL);
      if (atm.rho > 0 && (this.cfg.wind.surfaceSpeed || this.cfg.wind.jetSpeed)) {
        wind = enuToEcef(windENU(this.cfg.wind, s.hAGL, hMSL), g.lat, g.lon);
      }
    }
    s.atm = atm;

    // ablation shrinks the body: lengths ∝ (m/m0)^(1/3)
    const k = Math.cbrt(m / this.m0);
    const L = this.obj.length * k;
    const A = this.obj.area * k * k;
    const Vb = this.obj.volume * k * k * k;
    const rn = this.obj.noseRadius * k;

    const u: Vec3 = [v[0] - wind[0], v[1] - wind[1], v[2] - wind[2]];
    const U = norm(u);
    const rho = atm.rho;
    s.airspeed = U;
    s.mach = U / atm.a;
    s.re = atm.mu > 0 ? (rho * U * L) / atm.mu : 0;
    s.kn = this.medium === 1 ? 0 : atm.mfp / L;
    const sRatio = U / Math.sqrt((2 * 8314.462618 * atm.T) / atm.M);
    let cd = 0;
    const wMag = norm(w);
    const spinS = U > 1e-9 ? ((L / 2) * wMag) / U : 0;
    const sport = this.obj.drag.sport;
    if (rho > 0 && U > 0) {
      cd = dragCoefficient(this.obj.drag, { Re: s.re, M: s.mach, Kn: s.kn, s: sRatio, TwOverT: Tw / atm.T });
      if (sport && s.mach < 0.5 && s.kn < 0.01 && this.medium === 0) cd = sportCd(sport, spinS, (wMag * 60) / (2 * Math.PI), s.re);
    }
    // parachute
    let cdA = cd * A;
    s.chute = 0;
    if (this.chuteTime !== null && this.obj.parachute && t >= this.chuteTime) {
      const f = Math.min(1, ((t - this.chuteTime) / this.obj.parachute.inflationTime) ** 2);
      s.chute = Math.max(0, f);
      cdA = cdA * (1 - s.chute) + this.obj.parachute.cdA * s.chute;
    }
    s.cd = cd;
    const qd = 0.5 * rho * U;
    s.drag = [-qd * cdA * u[0], -qd * cdA * u[1], -qd * cdA * u[2]];

    // Magnus (spheres only, continuum)
    s.magnus = [0, 0, 0];
    s.cl = 0;
    const isBall = this.obj.drag.kind === 'sphere' || this.obj.drag.kind === 'roughSphere';
    if (isBall && wMag > 0 && U > 1e-6 && rho > 0) {
      const S = spinS;
      const clBase = sport && s.mach < 0.5 && this.medium === 0 ? sportCl(sport, S) : magnusLiftCoefficient(S);
      const cl = clBase * (1 - rarefactionWeight(s.kn));
      const wxu = cross(w, u);
      const nwxu = norm(wxu);
      if (nwxu > 0) {
        const f = (0.5 * rho * A * cl * U * U) / nwxu;
        s.magnus = [f * wxu[0], f * wxu[1], f * wxu[2]];
      }
      s.cl = cl;
    }

    // translational acceleration
    const ge: Vec3 = [gg[0] + s.gCent[0], gg[1] + s.gCent[1], gg[2] + s.gCent[2]];
    const mb = rho * Vb;
    s.buoyMag = mb * norm(ge);
    const meff = m + this.obj.addedMass * mb;
    const net = (m - mb) / meff;
    s.accel = [
      net * ge[0] + (s.drag[0] + s.magnus[0]) / meff + s.cor[0],
      net * ge[1] + (s.drag[1] + s.magnus[1]) / meff + s.cor[1],
      net * ge[2] + (s.drag[2] + s.magnus[2]) / meff + s.cor[2],
    ];

    // spin decay: dω/dt = −C_M ρ U A r² ω / I
    if (wMag > 0 && rho > 0) {
      const I = this.obj.inertiaFactor * m * (L / 2) ** 2;
      const k = (SPIN_DECAY_CM * rho * U * A * (L / 2) ** 2) / I;
      s.spinRate = [-k * w[0], -k * w[1], -k * w[2]];
    } else s.spinRate = [0, 0, 0];

    // thermal
    const mat = this.mat;
    const thermalMass = Math.min(m, mat.density * this.obj.surfaceArea * k * k * mat.skinDepth) * mat.specificHeat;
    let qIn = 0;
    s.qStag = 0;
    if (this.medium === 0 && rho > 0 && U > 0) {
      const wr = rarefactionWeight(s.kn);
      const qCont = suttonGraves(body.suttonGravesK, rho, rn, U);
      const qFm = freeMolecularHeatFlux(rho, U);
      const Tr = recoveryTemperature(atm.T, atm.gamma, s.mach);
      s.qStag = qCont * (1 - wr) + qFm * wr;
      // frontal-area averaged input: ½·q_stagnation in continuum, Λ·½ρV³ in free-molecular flow
      qIn = (qCont * AVERAGE_TO_STAGNATION * (1 - wr) + qFm * LAMBDA_FM * wr) * A * (1 - Tw / Math.max(Tr, 1));
    } else if (this.medium === 1) {
      // forced convection in water (h ≈ 2000 W/m²K for moderate speeds)
      qIn = 2000 * this.obj.surfaceArea * k * k * (atm.T - Tw);
    }
    const qRad = mat.emissivity * SIGMA_SB * this.obj.surfaceArea * k * k * (Tw ** 4 - this.T0 ** 4);
    const qNet = qIn - qRad;
    s.heatW = qIn;
    if (Tw >= mat.ablationTemp && qNet > 0) {
      s.tempRate = 0;
      s.massRate = -qNet / mat.heatOfAblation;
    } else {
      s.tempRate = qNet / thermalMass;
      s.massRate = 0;
    }
    return s;
  }

  private deriv = (t: number, y: Float64Array, dy: Float64Array) => {
    const s = this.evaluate(t, y);
    dy[0] = y[3]; dy[1] = y[4]; dy[2] = y[5];
    dy[3] = s.accel[0]; dy[4] = s.accel[1]; dy[5] = s.accel[2];
    dy[6] = s.tempRate;
    dy[7] = s.massRate;
    dy[8] = s.spinRate[0]; dy[9] = s.spinRate[1]; dy[10] = s.spinRate[2];
  };

  /** Initial state vector. */
  initialState(): { y: Float64Array; lat: number; lon: number } {
    const { body, geoid } = this.env;
    const c = this.cfg;
    const lat = c.lat * DEG, lon = c.lon * DEG;
    this.medium = 0;
    const ground = this.surfaceLevel(c.lat, c.lon);
    const N = geoid.undulation(c.lat, c.lon);
    const h = ground + Math.max(c.heightAGL, 0.01);
    this.launchECEF = geodeticToEcef(lat, lon, h + N, body.ellipsoid);
    this.groundECEF = geodeticToEcef(lat, lon, ground + N, body.ellipsoid);
    let vENU: Vec3 = [0, 0, 0];
    if (c.mode === 'throw') {
      const el = c.elevation * DEG, az = c.azimuth * DEG;
      vENU = [c.speed * Math.cos(el) * Math.sin(az), c.speed * Math.cos(el) * Math.cos(az), c.speed * Math.sin(el)];
    }
    const v = enuToEcef(vENU, lat, lon);
    // spin vector
    let w: Vec3 = [0, 0, 0];
    const wMag = (c.spinRpm * 2 * Math.PI) / 60;
    if (wMag > 0 && c.spinMode !== 'none') {
      const up: Vec3 = enuToEcef([0, 0, 1], lat, lon);
      const sp = norm(v);
      const vh: Vec3 = sp > 0 ? [v[0] / sp, v[1] / sp, v[2] / sp] : enuToEcef([Math.sin(c.azimuth * DEG), Math.cos(c.azimuth * DEG), 0], lat, lon);
      let axis: Vec3;
      switch (c.spinMode) {
        case 'backspin': axis = cross(vh, up); break;
        case 'topspin': axis = cross(up, vh); break;
        case 'curveLeft': axis = up; break; // ω̂ × v̂ points left
        case 'curveRight': axis = [-up[0], -up[1], -up[2]]; break;
        default: axis = vh; // rifle spin: no Magnus force
      }
      const n = norm(axis) || 1;
      w = [(axis[0] / n) * wMag, (axis[1] / n) * wMag, (axis[2] / n) * wMag];
    }
    const y = new Float64Array(11);
    y.set(this.launchECEF, 0);
    y.set(v, 3);
    y[6] = this.T0;
    y[7] = this.obj.mass;
    y.set(w, 8);
    return { y, lat, lon };
  }

  run(onProgress?: (frac: number) => void): SimResult {
    const t0wall = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const c = this.cfg;
    const { body, field } = this.env;
    const { y: y0, lat: lat0, lon: lon0 } = this.initialState();
    const atol = new Float64Array([1e-6, 1e-6, 1e-6, 1e-9, 1e-9, 1e-9, 1e-6, this.m0 * 1e-10, 1e-6, 1e-6, 1e-6]);
    const ig = new DormandPrince(this.deriv, 0, y0, { rtol: c.rtol, atol, hmax: 120 });

    /** raw states: [t, y0..y10, medium, pinned]; diagnostics are computed only for the samples kept */
    const raw: number[][] = [];
    let sampleDt = 1 / 120;
    let nextSample = 0;
    const launch = this.launchECEF;
    const launchGround = this.groundECEF;
    const summary: SimSummary = {
      outcome: 'timeout', message: '', flightTime: 0, launchMSL: 0, groundMSL: 0, maxAltitudeMSL: -Infinity, maxAltitudeAGL: -Infinity,
      timeAtApogee: 0, maxSpeed: 0, maxMach: 0, maxQ: 0, maxGLoad: 0, maxTemp: 0, maxHeatFlux: 0, impactSpeed: 0, impactAngle: 0,
      impactEnergy: 0, impactLat: 0, impactLon: 0, range: 0, finalMass: this.m0, terminalVelocityEstimate: 0, localG: 0,
      chuteDeployTime: null, waterEntryTime: null, nSteps: 0, nEvals: 0, wallTimeMs: 0,
    };

    const yq = new Float64Array(11);
    const record = (t: number, y: Float64Array, pinned = false) => {
      raw.push([t, ...y, this.medium, pinned ? 1 : 0]);
      if (raw.length > c.maxSamples) {
        // decimate: keep every other sample plus event samples, double the spacing
        const kept = raw.filter((r, i) => i % 2 === 0 || r[13] === 1 || i === raw.length - 1);
        raw.length = 0;
        raw.push(...kept);
        sampleDt *= 2;
      }
    };

    const computeRow = (t: number, y: Float64Array): number[] => {
      const s = this.evaluate(t, y);
      const r: Vec3 = [y[0], y[1], y[2]];
      const v: Vec3 = [y[3], y[4], y[5]];
      const sp = norm(v);
      const enu = ecefToEnu([r[0] - launchGround[0], r[1] - launchGround[1], r[2] - launchGround[2]], lat0, lon0);
      const vUp = ecefToEnu(v, s.lat * DEG, s.lon * DEG)[2];
      const ge: Vec3 = [s.gGrav[0] + s.gCent[0], s.gGrav[1] + s.gCent[1], s.gGrav[2] + s.gCent[2]];
      const m = y[7];
      const meff = m + this.obj.addedMass * s.atm.rho * this.obj.volume;
      const fNG: Vec3 = [(s.drag[0] + s.magnus[0]) / meff, (s.drag[1] + s.magnus[1]) / meff, (s.drag[2] + s.magnus[2]) / meff];
      const gLoad = norm(fNG) / G0;
      // specific mechanical energy in the rotating frame (Jacobi integral); degree ≤ 36 keeps this cheap
      const pot = field.potential(r, Math.min(c.gravityDegree, 36));
      const energy = 0.5 * sp * sp - pot - 0.5 * this.omega ** 2 * (r[0] ** 2 + r[1] ** 2);
      const row = new Array<number>(N_FIELDS).fill(0);
      row[F.t] = t; row[F.x] = r[0]; row[F.y] = r[1]; row[F.z] = r[2]; row[F.vx] = v[0]; row[F.vy] = v[1]; row[F.vz] = v[2];
      row[F.lat] = s.lat; row[F.lon] = s.lon; row[F.hMSL] = s.hMSL; row[F.hAGL] = s.hAGL; row[F.speed] = sp; row[F.airspeed] = s.airspeed;
      // Mach is undefined without a medium
      row[F.mach] = Number.isFinite(s.mach) && s.atm.rho > 0 ? s.mach : 0;
      row[F.rho] = s.atm.rho; row[F.gLocal] = norm(ge); row[F.drag] = norm(s.drag);
      row[F.gLoad] = gLoad; row[F.Tw] = y[6]; row[F.qStag] = s.qStag; row[F.mass] = m; row[F.cd] = s.cd; row[F.re] = s.re;
      row[F.kn] = Number.isFinite(s.kn) ? s.kn : 1e30; row[F.qDyn] = 0.5 * s.atm.rho * s.airspeed ** 2; row[F.medium] = this.medium;
      row[F.chute] = s.chute; row[F.downrange] = geodesicDistance(lat0, lon0, s.lat * DEG, s.lon * DEG, body.ellipsoid);
      row[F.east] = enu[0]; row[F.north] = enu[1]; row[F.up] = enu[2]; row[F.vUp] = vUp; row[F.Tair] = s.atm.T; row[F.pAir] = s.atm.p;
      row[F.coriolis] = norm(s.cor); row[F.spin] = norm([y[8], y[9], y[10]]); row[F.heatW] = s.heatW; row[F.gGrav] = norm(s.gGrav);
      row[F.energy] = energy; row[F.cl] = s.cl; row[F.buoy] = s.buoyMag;
      return row;
    };

    // launch diagnostics
    const s0 = this.evaluate(0, y0);
    this.surfaceLevelAtLaunch = s0.ground;
    summary.launchMSL = s0.hMSL;
    summary.groundMSL = s0.ground;
    summary.localG = norm([s0.gGrav[0] + s0.gCent[0], s0.gGrav[1] + s0.gCent[1], s0.gGrav[2] + s0.gCent[2]]);
    {
      // terminal velocity estimate at launch altitude: v_t = sqrt(2 (m − ρV) g / (ρ Cd A))
      const rho = s0.atm.rho;
      const cdGuess = this.obj.drag.kind === 'bluff' || this.obj.drag.kind === 'constant' ? this.obj.drag.cd0 ?? 1 : 0.47;
      const cdA = cdGuess * this.obj.area;
      summary.terminalVelocityEstimate = rho > 0 ? Math.sqrt((2 * (this.obj.mass - rho * this.obj.volume) * summary.localG) / (rho * cdA)) : Infinity;
    }
    record(0, y0, true);
    nextSample = sampleDt;

    // event functions
    const gGround = (y: Float64Array) => {
      const g = ecefToGeodetic([y[0], y[1], y[2]], body.ellipsoid);
      const latD = g.lat / DEG, lonD = g.lon / DEG;
      const hMSL = g.h - this.env.geoid.undulation(latD, lonD);
      if (!body.solidSurface) return hMSL - body.floorAltitude;
      return hMSL - this.surfaceLevel(latD, lonD);
    };
    const gChute = (y: Float64Array) => gGround(y) - (c.deployAGL ?? -1e9);
    const gRadial = (y: Float64Array) => y[0] * y[3] + y[1] * y[4] + y[2] * y[5];
    const gBurn = (y: Float64Array) => y[7] - 1e-3 * this.m0;
    /** below the sea surface (negative) while in water */
    const gSurface = (y: Float64Array) => {
      if (this.medium !== 1) return -1;
      const g = ecefToGeodetic([y[0], y[1], y[2]], body.ellipsoid);
      return g.h - this.env.geoid.undulation(g.lat / DEG, g.lon / DEG);
    };

    let prevGround = gGround(ig.y);
    let prevChute = gChute(ig.y);
    let prevRadial = gRadial(ig.y);
    let prevBurn = gBurn(ig.y);
    let prevSurface = -1;
    const yPrev = new Float64Array(11);
    let steps = 0;
    const maxSteps = 2_000_000;
    let done = false;
    const rEscape = Math.max(1e9, 50 * body.ellipsoid.a);

    const locate = (fn: (y: Float64Array) => number, ga: number, gb: number) =>
      findRoot((tq) => fn(ig.dense(tq, yq)), ig.tPrev, ig.t, ga, gb, 1e-9 * Math.max(1, ig.t));

    while (!done && steps < maxSteps) {
      // keep steps short near the ground so terrain crossings are not skipped
      const sp = Math.hypot(ig.y[3], ig.y[4], ig.y[5]);
      const agl = Math.max(prevGround, 0);
      const hCap = Math.max(1e-3, (0.5 * (agl + 2)) / (sp + 1e-9));
      if (ig.h > hCap) ig.h = hCap;
      yPrev.set(ig.y);
      const ok = ig.step(c.maxTime);
      steps++;
      if (!ok) {
        summary.outcome = 'error';
        summary.message = 'Integrator step size underflow';
        break;
      }
      // events, earliest first
      const gGr = gGround(ig.y);
      const gCh = gChute(ig.y);
      const gRa = gRadial(ig.y);
      const gBu = gBurn(ig.y);
      const gSu = gSurface(ig.y);
      type Ev = { t: number; kind: 'ground' | 'chute' | 'apogee' | 'burn' | 'surface' };
      const evs: Ev[] = [];
      if (prevGround > 0 && gGr <= 0) evs.push({ t: locate(gGround, prevGround, gGr), kind: 'ground' });
      if (c.deployAGL !== null && this.obj.parachute && this.chuteTime === null && prevChute > 0 && gCh <= 0)
        evs.push({ t: locate(gChute, prevChute, gCh), kind: 'chute' });
      if (prevRadial > 0 && gRa <= 0) evs.push({ t: locate(gRadial, prevRadial, gRa), kind: 'apogee' });
      if (prevBurn > 0 && gBu <= 0) evs.push({ t: locate(gBurn, prevBurn, gBu), kind: 'burn' });
      if (this.medium === 1 && prevSurface < 0 && gSu >= 0) evs.push({ t: locate(gSurface, prevSurface, gSu), kind: 'surface' });
      evs.sort((a, b) => a.t - b.t);

      // samples up to the first terminal/discontinuity event
      const firstBreak = evs.find((e) => e.kind !== 'apogee');
      const tEnd = firstBreak ? firstBreak.t : ig.t;
      while (nextSample < tEnd) {
        record(nextSample, ig.dense(nextSample, yq));
        nextSample += sampleDt;
      }
      for (const e of evs) if (e.kind === 'apogee' && e.t <= tEnd) record(e.t, ig.dense(e.t, yq), true);

      if (firstBreak) {
        const yE = Float64Array.from(ig.dense(firstBreak.t, yq));
        if (firstBreak.kind === 'ground') {
          const g = ecefToGeodetic([yE[0], yE[1], yE[2]], body.ellipsoid);
          const latD = g.lat / DEG, lonD = g.lon / DEG;
          const enteringWater = this.medium === 0 && body.ocean && c.water && this.env.terrain.isOcean(latD, lonD);
          if (enteringWater) {
            record(firstBreak.t, yE, true);
            this.medium = 1;
            summary.waterEntryTime = firstBreak.t;
            // nudge just below the surface and restart
            ig.reset(firstBreak.t, yE);
            nextSample = firstBreak.t + sampleDt;
            prevGround = gGround(ig.y);
            prevChute = gChute(ig.y);
            prevRadial = gRadial(ig.y);
            prevBurn = gBurn(ig.y);
            prevSurface = -1e-9;
            continue;
          }
          this.finish(summary, firstBreak.t, yE, this.medium === 1 ? 'seabed' : body.solidSurface ? 'impact' : 'floor', record, lat0, lon0);
          done = true;
          break;
        }
        if (firstBreak.kind === 'chute') {
          record(firstBreak.t, yE, true);
          this.chuteTime = firstBreak.t;
          summary.chuteDeployTime = firstBreak.t;
          ig.reset(firstBreak.t, yE);
          nextSample = firstBreak.t + sampleDt;
          prevGround = gGround(ig.y);
          prevChute = gChute(ig.y);
          prevRadial = gRadial(ig.y);
          prevBurn = gBurn(ig.y);
          continue;
        }
        if (firstBreak.kind === 'surface') {
          this.finish(summary, firstBreak.t, yE, 'floating', record, lat0, lon0);
          done = true;
          break;
        }
        if (firstBreak.kind === 'burn') {
          this.finish(summary, firstBreak.t, yE, 'burned', record, lat0, lon0);
          done = true;
          break;
        }
      }

      prevGround = gGr;
      prevChute = gCh;
      prevRadial = gRa;
      prevBurn = gBu;
      if (this.medium === 1) prevSurface = gSu;

      const r = Math.hypot(ig.y[0], ig.y[1], ig.y[2]);
      if (r > rEscape) {
        const v2 = ig.y[3] ** 2 + ig.y[4] ** 2 + ig.y[5] ** 2;
        const bound = 0.5 * v2 - field.GM / r < 0 && this.omega === 0;
        this.finish(summary, ig.t, ig.y, 'escaped', record, lat0, lon0);
        if (bound) summary.message = 'Left the region where Earth alone dominates (Moon/Sun not modelled)';
        done = true;
        break;
      }
      if (ig.t >= c.maxTime) {
        const v2 = ig.y[3] ** 2 + ig.y[4] ** 2 + ig.y[5] ** 2;
        const energy = 0.5 * v2 - field.GM / r;
        this.finish(summary, ig.t, ig.y, energy < 0 && prevGround > 80_000 ? 'orbit' : 'timeout', record, lat0, lon0);
        done = true;
        break;
      }
      if (onProgress && steps % 500 === 0) onProgress(ig.t / c.maxTime);
    }
    if (!done && summary.outcome !== 'error') {
      this.finish(summary, ig.t, ig.y, 'timeout', record, lat0, lon0);
      summary.message = 'Step limit reached';
    }
    summary.nSteps = ig.nAccepted;
    summary.nEvals = ig.nfev;
    summary.wallTimeMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0wall;

    // diagnostics for the kept samples (restoring the medium / parachute state of each)
    const finalMedium = this.medium;
    const out = new Float64Array(raw.length * N_FIELDS);
    const ys = new Float64Array(11);
    raw.forEach((r, i) => {
      ys.set(r.slice(1, 12));
      this.medium = r[12] as 0 | 1;
      const row = computeRow(r[0], ys);
      out.set(row, i * N_FIELDS);
      summary.maxSpeed = Math.max(summary.maxSpeed, row[F.speed]);
      summary.maxMach = Math.max(summary.maxMach, row[F.mach]);
      summary.maxQ = Math.max(summary.maxQ, row[F.qDyn]);
      summary.maxGLoad = Math.max(summary.maxGLoad, row[F.gLoad]);
      summary.maxTemp = Math.max(summary.maxTemp, row[F.Tw]);
      summary.maxHeatFlux = Math.max(summary.maxHeatFlux, row[F.qStag]);
      if (row[F.hMSL] > summary.maxAltitudeMSL) {
        summary.maxAltitudeMSL = row[F.hMSL];
        summary.maxAltitudeAGL = row[F.hMSL] - (this.surfaceLevelAtLaunch ?? 0);
        summary.timeAtApogee = row[F.t];
      }
    });
    this.medium = finalMedium;
    const samplesCount = raw.length;
    return { samples: out, count: samplesCount, summary, launchECEF: launch, groundECEF: launchGround, launchLat: c.lat, launchLon: c.lon };
  }

  private surfaceLevelAtLaunch: number | null = null;

  private finish(
    summary: SimSummary, t: number, y: Float64Array, outcome: Outcome,
    record: (t: number, y: Float64Array, pinned?: boolean) => void, lat0: number, lon0: number,
  ) {
    record(t, y, true);
    const geo = ecefToGeodetic([y[0], y[1], y[2]], this.env.body.ellipsoid);
    const row: number[] = [];
    row[F.lat] = geo.lat / DEG;
    row[F.lon] = geo.lon / DEG;
    summary.outcome = outcome;
    summary.flightTime = t;
    const v: Vec3 = [y[3], y[4], y[5]];
    const sp = norm(v);
    summary.impactSpeed = sp;
    const lat = row[F.lat] * DEG, lon = row[F.lon] * DEG;
    const vUp = ecefToEnu(v, lat, lon)[2];
    summary.impactAngle = sp > 0 ? (Math.asin(Math.min(1, Math.max(-1, -vUp / sp))) * 180) / Math.PI : 90;
    summary.impactEnergy = 0.5 * y[7] * sp * sp;
    summary.impactLat = row[F.lat];
    summary.impactLon = row[F.lon];
    summary.range = geodesicDistance(lat0, lon0, lat, lon, this.env.body.ellipsoid);
    summary.finalMass = y[7];
    const msgs: Record<Outcome, string> = {
      impact: 'Hit the ground',
      seabed: 'Sank to the sea floor',
      floating: 'Less dense than sea water: popped back up and floats',
      burned: 'Burned up / ablated away',
      escaped: 'Escaped the gravity well',
      orbit: 'Still in orbit when the simulation ended',
      timeout: 'Simulation time limit reached',
      floor: "Crushed below Jupiter's 22-bar level (where the Galileo probe was lost)",
      error: 'Numerical error',
    };
    summary.message = msgs[outcome];
  }
}
