/**
 * Validation against measurements and documented real-world events.
 * Tolerances reflect the scatter / uncertainty of the reference data, which
 * is stated next to each test. Known model limitations are asserted explicitly
 * (as deviations of known size) so they stay visible.
 */
import { describe, expect, it } from 'vitest';
import { env, run } from './simhelpers';
import { loadEgm2008, relErr } from './helpers';
import { BODIES, bodyAtmosphere, bodyGravity } from '../src/physics/bodies';
import { EarthAtmosphere, ussa1976 } from '../src/physics/atmosphere/ussa1976';
import { cdSphereStandard, cdFreeMolecularSphere, dragCoefficient, GUNN_KINZER, erf } from '../src/physics/aero/drag';
import { presetById, type ObjectSpec } from '../src/physics/objects';
import { F, N_FIELDS } from '../src/physics/simulation';
import { FlatTerrain, ZERO_GEOID } from '../src/physics/environment';

const egm = loadEgm2008();
const earth = (ground = 0, atmosphere = new EarthAtmosphere()) => env({ body: { ...BODIES.earth, ocean: false }, field: egm, atmosphere, ground });
const drop = (o: ObjectSpec, h: number, extra: object = {}, e = earth()) =>
  run(e, o, { lat: 38.9, lon: -77, mode: 'drop', heightAGL: h, gravityDegree: 72, ...extra });

describe('Drag laws', () => {
  it('smooth-sphere Cd(Re) follows the measured drag curve (Lapple & Shepherd 1940; Achenbach 1972) within ±6 %', () => {
    const measured: [number, number][] = [[1, 26.5], [10, 4.15], [100, 1.09], [1000, 0.47], [1e4, 0.41], [1e5, 0.48]];
    for (const [Re, cd] of measured) expect(relErr(cdSphereStandard(Re), cd)).toBeLessThan(0.06);
    // drag crisis (Achenbach 1972): Cd drops to ~0.07-0.1 between Re 3.5e5 and 5e5, recovering to ~0.13-0.2 by 1e6+
    expect(cdSphereStandard(4.5e5)).toBeLessThan(0.1);
    expect(cdSphereStandard(3e6)).toBeGreaterThan(0.1);
    expect(cdSphereStandard(3e6)).toBeLessThan(0.2);
    // continuity of the piecewise fit
    for (const Re of [0.01, 20, 260, 1500, 1.2e4, 4.4e4, 3.38e5, 4e5, 1e6]) {
      expect(relErr(cdSphereStandard(Re * (1 - 1e-9)), cdSphereStandard(Re * (1 + 1e-9)))).toBeLessThan(0.03);
    }
  });

  it('free-molecular sphere drag has the asymptote 2 + 2/s² + 2√π/(3s)·√(Tw/T) at high speed ratio', () => {
    const s = 30, tw = 0.3;
    expect(Math.abs(cdFreeMolecularSphere(s, tw) - (2 + 2 / s ** 2 + ((2 * Math.sqrt(Math.PI)) / (3 * s)) * Math.sqrt(tw)))).toBeLessThan(1e-6);
    expect(Math.abs(erf(1) - 0.8427007929497149)).toBeLessThan(1e-15);
    expect(Math.abs(erf(3) - 0.9999779095030014)).toBeLessThan(1e-15);
  });

  it('drag varies continuously from continuum through transition to free-molecular flow', () => {
    let prev = dragCoefficient({ kind: 'sphere' }, { Re: 1e4, M: 10, Kn: 1e-4, s: 9, TwOverT: 1 });
    for (let lk = -4; lk <= 2; lk += 0.01) {
      const cd = dragCoefficient({ kind: 'sphere' }, { Re: 1e4, M: 10, Kn: 10 ** lk, s: 9, TwOverT: 1 });
      expect(Math.abs(cd - prev)).toBeLessThan(0.02);
      prev = cd;
    }
    expect(prev).toBeGreaterThan(2.0); // free-molecular limit
  });
});

describe('Raindrops (Gunn & Kinzer 1949, ±0.5 % measurement accuracy quoted by the authors)', () => {
  // laboratory conditions: 20 °C, 1013 hPa
  const lab = new EarthAtmosphere({ dT: 5, pMSL: 101300, RH: 0 });
  const dropOf = (dmm: number): ObjectSpec => {
    const r = dmm / 2000;
    return { ...presetById('raindrop'), mass: 998.2 * (4 / 3) * Math.PI * r ** 3, length: 2 * r, area: Math.PI * r * r, volume: (4 / 3) * Math.PI * r ** 3, surfaceArea: 4 * Math.PI * r * r, noseRadius: r };
  };
  it('terminal velocities reproduce the measurements at the laboratory conditions', () => {
    for (const [dmm, v] of GUNN_KINZER.filter((_, i) => i % 3 === 0)) {
      const res = drop(dropOf(dmm), 60, { rotation: false }, earth(0, lab));
      expect(relErr(res.summary.impactSpeed, v)).toBeLessThan(0.01);
    }
  });
  it('fall faster at altitude roughly as (ρ0/ρ)^0.4 (Foote & du Toit 1969 report exponents 0.37–0.50)', () => {
    const atm = new EarthAtmosphere();
    const low = drop(dropOf(2), 200, { rotation: false }, earth(0, atm));
    const high = drop(dropOf(2), 200, { rotation: false }, earth(5000, atm));
    const exponent = Math.log(high.summary.impactSpeed / low.summary.impactSpeed) / Math.log(ussa1976(0).rho / ussa1976(5000).rho);
    expect(exponent).toBeGreaterThan(0.37);
    expect(exponent).toBeLessThan(0.5);
  });
});

describe('People', () => {
  it('belly-to-earth skydiver reaches the USPA-quoted ≈ 120 mph (53.6 m/s) near sea level (±5 %)', () => {
    const res = drop(presetById('skydiver'), 4000);
    expect(relErr(res.summary.impactSpeed, 53.6)).toBeLessThan(0.05);
  });

  it('head-down freeflyer reaches 150–180 mph (67–80 m/s)', () => {
    const v = drop(presetById('headdown'), 4000).summary.impactSpeed;
    expect(v).toBeGreaterThan(67);
    expect(v).toBeLessThan(80);
  });

  it('Red Bull Stratos 2012: peak 377.1 m/s (calibrated) gives the measured Mach 1.25 at ≈ 28 km (independent)', () => {
    // FAI-certified: exit 38 969.4 m, max speed 1357.6 km/h, Mach 1.25; freefall 36 402.6 m in 4:19
    const res = drop(presetById('stratos'), 38969.4 - 1100, { lat: 33.39, lon: -104.52, deployAGL: 2566.8 - 1100 }, earth(1100));
    expect(relErr(res.summary.maxSpeed, 377.1)).toBeLessThan(0.01);
    expect(relErr(res.summary.maxMach, 1.25)).toBeLessThan(0.02);
    let iMax = 0;
    for (let i = 0; i < res.count; i++) if (res.samples[i * N_FIELDS + F.speed] > res.samples[iMax * N_FIELDS + F.speed]) iMax = i;
    const hPeak = res.samples[iMax * N_FIELDS + F.hMSL];
    expect(hPeak).toBeGreaterThan(26000);
    expect(hPeak).toBeLessThan(30000);
  });

  it('KNOWN LIMITATION: Stratos freefall is ~20 % shorter than the real 259 s (posture/spin changes are not modelled)', () => {
    const res = drop(presetById('stratos'), 38969.4 - 1100, { lat: 33.39, lon: -104.52, deployAGL: 2566.8 - 1100 }, earth(1100));
    const ratio = res.summary.chuteDeployTime! / 259;
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(0.85);
  });
});

describe('Sports balls (tracking-radar data)', () => {
  const field = earth(0, new EarthAtmosphere({ dT: 6.85, pMSL: 101325, RH: 0.5 })); // 70 °F, sea level
  const hit = (id: string, v: number, el: number, rpm: number, h: number) =>
    run(field, presetById(id), { lat: 40, lon: -74, mode: 'throw', heightAGL: h, speed: v, elevation: el, azimuth: 0, spinRpm: rpm, spinMode: 'backspin', gravityDegree: 36 });

  it('home run: 100 mph, 28°, 2000 rpm backspin carries ≈ 400–410 ft (Statcast; ±5 %)', () => {
    const ft = hit('baseball', 44.704, 28, 2000, 1).summary.range / 0.3048;
    expect(relErr(ft, 405)).toBeLessThan(0.05);
  });

  it('PGA Tour average drive: 167 mph, 10.9°, 2686 rpm carries 275 yd (TrackMan; ±5 %)', () => {
    const res = hit('golf', 74.66, 10.9, 2686, 0.02);
    expect(relErr(res.summary.range / 0.9144, 275)).toBeLessThan(0.05);
  });

  it('KNOWN LIMITATION: the golf apex is ~30 % above TrackMan’s 32 yd (Smits–Smith lift is high at launch)', () => {
    const apex = hit('golf', 74.66, 10.9, 2686, 0.02).summary.maxAltitudeAGL / 0.9144;
    expect(apex / 32).toBeGreaterThan(1.15);
    expect(apex / 32).toBeLessThan(1.45);
  });

  it('backspin lifts and topspin dips a baseball relative to no spin', () => {
    const base = { lat: 40, lon: -74, mode: 'throw' as const, heightAGL: 1, speed: 40, elevation: 15, azimuth: 0, spinRpm: 2000, gravityDegree: 36 };
    const none = run(field, presetById('baseball'), { ...base, spinMode: 'none' }).summary.range;
    const back = run(field, presetById('baseball'), { ...base, spinMode: 'backspin' }).summary.range;
    const top = run(field, presetById('baseball'), { ...base, spinMode: 'topspin' }).summary.range;
    expect(back).toBeGreaterThan(none);
    expect(top).toBeLessThan(none);
  });
});

describe('Hammer and feather', () => {
  it('on the Moon (Apollo 15, 1971) a hammer and a feather dropped from 1.6 m land together after √(2h/g)', () => {
    const moon = { body: BODIES.moon, field: bodyGravity('moon'), atmosphere: bodyAtmosphere('moon'), terrain: new FlatTerrain(0), geoid: ZERO_GEOID };
    const hammer: ObjectSpec = { ...presetById('rock'), mass: 1.32 };
    const a = run(moon, hammer, { lat: 26.13, lon: 3.63, mode: 'drop', heightAGL: 1.6, gravityDegree: 4 });
    const b = run(moon, presetById('feather'), { lat: 26.13, lon: 3.63, mode: 'drop', heightAGL: 1.6, gravityDegree: 4 });
    expect(Math.abs(a.summary.flightTime - b.summary.flightTime)).toBeLessThan(1e-9);
    expect(relErr(a.summary.flightTime, Math.sqrt((2 * 1.6) / a.summary.localG))).toBeLessThan(1e-5);
    expect(a.summary.localG).toBeGreaterThan(1.61);
    expect(a.summary.localG).toBeLessThan(1.63);
  });
  it('on Earth the feather drifts down at < 1 m/s', () => {
    expect(drop(presetById('feather'), 10).summary.impactSpeed).toBeLessThan(1);
  });
});

describe('Local gravity on Earth (EGM2008 + rotation)', () => {
  it('equator ≈ 9.780 m/s², poles ≈ 9.832 m/s² (±0.003 for local anomalies)', () => {
    const atEq = drop(presetById('bowling'), 1, { lat: 0, lon: -30, vacuum: true }).summary.localG;
    const atPole = drop(presetById('bowling'), 1, { lat: 89.99, lon: 0, vacuum: true }).summary.localG;
    expect(Math.abs(atEq - 9.7803)).toBeLessThan(0.003);
    expect(Math.abs(atPole - 9.8322)).toBeLessThan(0.003);
  });
  it('gravity on Everest’s summit is weaker than at sea level by ≈ 2h·g/R ≈ 0.027 m/s² (free-air)', () => {
    const top = drop(presetById('bowling'), 1, { lat: 27.9881, lon: 86.925, vacuum: true }, earth(8848.86)).summary.localG;
    const sea = drop(presetById('bowling'), 1, { lat: 27.9881, lon: 86.925, vacuum: true }, earth(0)).summary.localG;
    expect(Math.abs(sea - top - 0.0273)).toBeLessThan(0.002);
  });
});

describe('Ocean', () => {
  const ocean = (depth: number) => ({
    body: BODIES.earth, field: egm, atmosphere: new EarthAtmosphere(),
    terrain: { elevation: () => -depth, isOcean: () => true }, geoid: ZERO_GEOID,
  });
  it('a bowling ball sinks to terminal velocity √(2(m−ρV)g/(ρ Cd A)) with buoyancy and added mass', () => {
    const o = presetById('bowling');
    const res = run(ocean(500), o, { lat: 11.35, lon: 142.2, mode: 'drop', heightAGL: 10, gravityDegree: 36 });
    expect(res.summary.outcome).toBe('seabed');
    const last = (res.count - 1) * N_FIELDS;
    const rho = 1025 * (1 + 4.4e-10 * 1025 * 9.80665 * 500);
    const cd = res.samples[last + F.cd];
    const vt = Math.sqrt((2 * (o.mass - rho * o.volume) * res.samples[last + F.gLocal]) / (rho * cd * o.area));
    expect(relErr(res.summary.impactSpeed, vt)).toBeLessThan(0.01);
    expect(res.summary.waterEntryTime).not.toBeNull();
  });
  it('a football (less dense than water) floats back up', () => {
    const res = run(ocean(500), presetById('football'), { lat: 0, lon: -140, mode: 'drop', heightAGL: 20, gravityDegree: 36 });
    expect(res.summary.outcome).toBe('floating');
  });
});

describe('Meteors and re-entry', () => {
  const meteoroid = (r: number): ObjectSpec => ({
    ...presetById('stonemeteor'), mass: 3300 * (4 / 3) * Math.PI * r ** 3, length: 2 * r, area: Math.PI * r * r,
    volume: (4 / 3) * Math.PI * r ** 3, surfaceArea: 4 * Math.PI * r * r, noseRadius: r,
  });
  const endHeight = (r: number, v: number) => {
    const res = run(earth(), meteoroid(r), { lat: 0, lon: 0, mode: 'throw', heightAGL: 200_000, speed: v, elevation: -45, azimuth: 90, gravityDegree: 36 });
    return { outcome: res.summary.outcome, h: res.samples[(res.count - 1) * N_FIELDS + F.hMSL] };
  };

  it('a 1 mm Perseid meteoroid (59 km/s) burns out at the observed 80-105 km (Perseid end heights ~90 km)', () => {
    const { outcome, h } = endHeight(0.0005, 59_000);
    expect(outcome).toBe('burned');
    expect(h).toBeGreaterThan(80_000);
    expect(h).toBeLessThan(105_000);
  });

  it('slower meteoroids penetrate deeper (energy per unit mass scales with V squared)', () => {
    const h20 = endHeight(0.0005, 20_000).h, h40 = endHeight(0.0005, 40_000).h, h70 = endHeight(0.0005, 70_000).h;
    expect(h20).toBeLessThan(h40);
    expect(h40).toBeLessThan(h70);
  });
});

describe('Other worlds', () => {
  it('Mars datum density ≈ 0.020 kg/m³ and gravity ≈ 3.71 m/s²', () => {
    const atm = bodyAtmosphere('mars');
    expect(atm.at(0).rho).toBeGreaterThan(0.015);
    expect(atm.at(0).rho).toBeLessThan(0.025);
    const g = bodyGravity('mars');
    const a = g.accel([BODIES.mars.ellipsoid.a, 0, 0]);
    expect(Math.abs(Math.hypot(...a) - BODIES.mars.omega ** 2 * BODIES.mars.ellipsoid.a - 3.711)).toBeLessThan(0.02);
  });
  it('Jupiter: the adiabatic interior reaches 22 bar about 115-150 km below the 1-bar level (Galileo probe descent)', () => {
    const atm = bodyAtmosphere('jupiter');
    let z = 0;
    while (atm.at(z).p < 22e5 && z > -150_000) z -= 250;
    expect(z).toBeLessThan(-115_000);
    expect(z).toBeGreaterThan(-150_000);
    expect(Math.abs(atm.at(z).T - 427)).toBeLessThan(3);
  });
});
