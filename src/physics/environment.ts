/**
 * Environment: wind profile, terrain elevation and geoid samplers.
 */
import { bilinearGrid } from './interp';
import type { Vec3 } from './vec3';

export interface WindSettings {
  /** wind speed at 10 m above ground [m/s] */
  surfaceSpeed: number;
  /** meteorological direction the surface wind blows FROM [deg, 0 = north, 90 = east] */
  surfaceFrom: number;
  /** jet-stream core speed at ~11 km [m/s] */
  jetSpeed: number;
  jetFrom: number;
  /** Hellmann power-law exponent (0.143 open land, 0.11 sea, 0.25–0.4 urban) */
  alpha: number;
}

export const NO_WIND: WindSettings = { surfaceSpeed: 0, surfaceFrom: 270, jetSpeed: 0, jetFrom: 270, alpha: 0.143 };

/** Unit vector (east, north) the wind blows TOWARDS for a meteorological "from" direction. */
function toward(fromDeg: number): [number, number] {
  const a = (fromDeg * Math.PI) / 180;
  return [-Math.sin(a), -Math.cos(a)];
}

/**
 * Wind vector in local ENU [m/s].
 *  - 0 … 1000 m AGL: power law U(z) = U10 (z/10)^α  (IEC 61400-1 / Hellmann)
 *  - 1 km … 11 km MSL: linear blend (vector) to the jet-stream core
 *  - 11 … 20 km: decays to 20 % of the jet; 20 … 50 km: constant; → 0 by 80 km
 * Deterministic mean wind; turbulence/gusts are not modelled.
 */
export function windENU(w: WindSettings, zAGL: number, zMSL: number): Vec3 {
  if (w.surfaceSpeed === 0 && w.jetSpeed === 0) return [0, 0, 0];
  const [se, sn] = toward(w.surfaceFrom);
  const [je, jn] = toward(w.jetFrom);
  const zBL = 1000;
  const blTop = w.surfaceSpeed * (zBL / 10) ** w.alpha;
  if (zAGL <= zBL) {
    const u = w.surfaceSpeed * (Math.max(zAGL, 0.5) / 10) ** w.alpha;
    return [se * u, sn * u, 0];
  }
  const zBLmsl = zMSL - zAGL + zBL;
  const zJet = 11000;
  let e: number, n: number;
  if (zMSL <= zJet) {
    const t = zJet > zBLmsl ? Math.min(Math.max((zMSL - zBLmsl) / (zJet - zBLmsl), 0), 1) : 1;
    e = se * blTop * (1 - t) + je * w.jetSpeed * t;
    n = sn * blTop * (1 - t) + jn * w.jetSpeed * t;
  } else {
    let f: number;
    if (zMSL <= 20000) f = 1 - 0.8 * ((zMSL - zJet) / (20000 - zJet));
    else if (zMSL <= 50000) f = 0.2;
    else if (zMSL <= 80000) f = 0.2 * (1 - (zMSL - 50000) / 30000);
    else f = 0;
    e = je * w.jetSpeed * f;
    n = jn * w.jetSpeed * f;
  }
  return [e, n, 0];
}

/** Elevation of the surface above mean sea level [m] (negative = ocean floor / depression). */
export interface TerrainSampler {
  elevation(latDeg: number, lonDeg: number): number;
  /** true if the point is open ocean (surface is the sea surface at 0 m) */
  isOcean(latDeg: number, lonDeg: number): boolean;
}

export interface GridData {
  nLon: number;
  nLat: number;
  lat0: number;
  lon0: number;
  dLat: number;
  dLon: number;
  data: ArrayLike<number>;
}

export function sampleGrid(g: GridData, latDeg: number, lonDeg: number, wrap = true) {
  return bilinearGrid(g.data, g.nLon, g.nLat, g.lat0, g.lon0, g.dLat, g.dLon, latDeg, lonDeg, wrap);
}

export class FlatTerrain implements TerrainSampler {
  constructor(private h = 0, private ocean = false) {}
  elevation() {
    return this.h;
  }
  isOcean() {
    return this.ocean;
  }
}

/** High-resolution local patch (resampled web terrain tiles) with its own ocean mask. */
export interface LocalGrid extends GridData {
  /** 1 = connected ocean, 0 = land / inland depression */
  ocean: ArrayLike<number>;
}

/**
 * Global coarse grid + optional high-resolution local patches (from web
 * terrain tiles around the launch site). The finest patch containing a point
 * wins. Ocean = below 0 m AND connected to the open sea (flood-filled masks),
 * so endorheic depressions (Dead Sea, Caspian, Qattara, Death Valley …) are land.
 */
export class GridTerrain implements TerrainSampler {
  locals: LocalGrid[] = [];
  constructor(private global: GridData, private oceanMask: GridData | null) {}

  /** Patches must be ordered finest first. */
  setLocals(locals: LocalGrid[]) {
    this.locals = locals;
  }

  private patch(lat: number, lon: number): LocalGrid | null {
    for (const l of this.locals) {
      const x = (lon - l.lon0) / l.dLon;
      const y = (lat - l.lat0) / l.dLat;
      if (x >= 0 && y >= 0 && x <= l.nLon - 1 && y <= l.nLat - 1) return l;
    }
    return null;
  }

  elevation(lat: number, lon: number): number {
    const l = this.patch(lat, lon);
    return l ? sampleGrid(l, lat, lon, false) : sampleGrid(this.global, lat, lon);
  }

  isOcean(lat: number, lon: number): boolean {
    const l = this.patch(lat, lon);
    if (l) return sampleGrid({ ...l, data: l.ocean }, lat, lon, false) > 0.5 && sampleGrid(l, lat, lon, false) < 0;
    if (this.oceanMask) return sampleGrid(this.oceanMask, lat, lon) > 0.5 && this.elevation(lat, lon) < 0;
    return this.elevation(lat, lon) < 0;
  }
}

/**
 * Replaces the terrain height by a surveyed value within `radius` metres of a
 * site (e.g. the 8848.86 m summit of Everest, which a 30 m DEM under-samples),
 * blending smoothly back to the DEM over the same distance again.
 */
export class SiteOverrideTerrain implements TerrainSampler {
  private readonly cosLat: number;
  /** blend radius: 40 m, widened to 1.5×|correction| so a large correction stays a gentle summit, not a spike */
  readonly radius: number;
  constructor(
    private base: TerrainSampler,
    private lat: number,
    private lon: number,
    private height: number,
  ) {
    this.cosLat = Math.cos((lat * Math.PI) / 180);
    this.radius = overrideRadius(height, base.elevation(lat, lon));
  }
  private dist(lat: number, lon: number) {
    const dy = (lat - this.lat) * 111_195;
    let dl = lon - this.lon;
    if (dl > 180) dl -= 360;
    if (dl < -180) dl += 360;
    return Math.hypot(dy, dl * 111_195 * this.cosLat);
  }
  elevation(lat: number, lon: number): number {
    const d = this.dist(lat, lon);
    const e = this.base.elevation(lat, lon);
    if (d <= this.radius) return this.height;
    if (d >= 2 * this.radius) return e;
    const w = (d - this.radius) / this.radius;
    const s = w * w * (3 - 2 * w);
    return this.height * (1 - s) + e * s;
  }
  isOcean(lat: number, lon: number): boolean {
    return this.dist(lat, lon) > 2 * this.radius && this.base.isOcean(lat, lon);
  }
}

export const overrideRadius = (surveyed: number, dem: number) => Math.max(40, 1.5 * Math.abs(surveyed - dem));

export interface GeoidSampler {
  /** geoid height above the ellipsoid [m] */
  undulation(latDeg: number, lonDeg: number): number;
}

export const ZERO_GEOID: GeoidSampler = { undulation: () => 0 };

export class GridGeoid implements GeoidSampler {
  constructor(private grid: GridData) {}
  undulation(lat: number, lon: number) {
    return sampleGrid(this.grid, lat, lon);
  }
}

/** Sea water (UNESCO EOS-80 at 35 PSU, ~4 °C deep-water average). */
export const SEAWATER = {
  density: 1027.8,
  viscosity: 1.57e-3,
  soundSpeed: 1480,
  temperature: 277.15,
};
