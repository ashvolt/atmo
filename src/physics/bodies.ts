/**
 * Celestial bodies: shape, rotation, gravity field, atmosphere and surface.
 */
import { WGS84, type Ellipsoid } from './constants';
import type { GravityField } from './gravity/harmonics';
import { zonalField } from './gravity/harmonics';
import { EarthAtmosphere, type WeatherOverrides, STANDARD_WEATHER } from './atmosphere/ussa1976';
import { JupiterAtmosphere, MarsAtmosphere } from './atmosphere/planetary';
import { Vacuum, type Atmosphere } from './atmosphere/types';

export type BodyId = 'earth' | 'moon' | 'mars' | 'jupiter';

export interface BodyDef {
  id: BodyId;
  name: string;
  ellipsoid: Ellipsoid;
  /** sidereal rotation rate about +z [rad/s] */
  omega: number;
  /** Sutton–Graves constant for the atmosphere's composition */
  suttonGravesK: number;
  /** has liquid ocean (Earth) */
  ocean: boolean;
  /** solid surface? (Jupiter: no — simulation ends at the Galileo-probe 22-bar level) */
  solidSurface: boolean;
  /** lowest level the simulation follows below the datum (gas giants) [m] */
  floorAltitude: number;
  notes: string;
}

export const BODIES: Record<BodyId, BodyDef> = {
  earth: {
    id: 'earth',
    name: 'Earth',
    ellipsoid: { a: WGS84.a, f: WGS84.f },
    omega: WGS84.omega,
    suttonGravesK: 1.7415e-4,
    ocean: true,
    solidSurface: true,
    floorAltitude: -11_100,
    notes: 'WGS 84 ellipsoid, EGM2008 gravity, USSA-1976 atmosphere, real terrain & bathymetry.',
  },
  moon: {
    id: 'moon',
    name: 'Moon',
    // IAU 2015 mean radius 1737.4 km; flattening 0.0012
    ellipsoid: { a: 1_737_400, f: 0.0012 },
    omega: 2.6617e-6, // synchronous: 2π / 27.321661 d
    suttonGravesK: 0,
    ocean: false,
    solidSurface: true,
    floorAltitude: 0,
    notes: 'GRAIL GL0660B low-degree zonals; no atmosphere; flat datum surface.',
  },
  mars: {
    id: 'mars',
    name: 'Mars',
    // IAU 2015: equatorial 3396.19 km, polar 3376.20 km
    ellipsoid: { a: 3_396_190, f: (3396.19 - 3376.2) / 3396.19 },
    omega: 7.088218e-5,
    suttonGravesK: 1.9027e-4,
    ocean: false,
    solidSurface: true,
    floorAltitude: 0,
    notes: 'MRO120 low-degree zonals; NASA Glenn atmosphere; flat areoid surface.',
  },
  jupiter: {
    id: 'jupiter',
    name: 'Jupiter',
    // 1-bar level, IAU 2015: equatorial 71 492 km, polar 66 854 km
    ellipsoid: { a: 71_492_000, f: (71492 - 66854) / 71492 },
    omega: 1.75853e-4, // System III
    suttonGravesK: 6.556e-5,
    ocean: false,
    solidSurface: false,
    floorAltitude: -132_000, // Galileo probe's last signal, ~22 bar
    notes: 'Juno zonal harmonics J2–J10; Galileo-probe atmosphere; no solid surface.',
  },
};

/** Gravity fields for non-Earth bodies (Earth uses EGM2008, loaded at runtime). */
export function bodyGravity(id: Exclude<BodyId, 'earth'>): GravityField {
  switch (id) {
    case 'moon':
      // Konopliv et al. (2014), GRAIL GL0660B: GM, J2, J3, J4 (unnormalized)
      return zonalField('GL0660B (zonal)', 4.9028001184575496e12, 1_738_000, {
        2: 2.0330530e-4,
        3: 8.4597e-6,
        4: -9.7044e-6,
      });
    case 'mars':
      // Konopliv et al. (2016), MRO120D: GM, J2..J4
      return zonalField('MRO120D (zonal)', 4.282837581575610e13, 3_396_000, {
        2: 1.956608e-3, // C̄20 = −8.75022e-4
        3: 3.1450e-5,
        4: -1.5377e-5,
      });
    case 'jupiter':
      // Iess et al., Nature 555 (2018) 220 — Juno; reference radius 71 492 km
      return zonalField('Juno (Iess 2018)', 1.26686533e17, 71_492_000, {
        2: 14696.572e-6,
        3: -0.042e-6,
        4: -586.609e-6,
        5: -0.069e-6,
        6: 34.198e-6,
        7: 0.124e-6,
        8: -2.426e-6,
        9: -0.106e-6,
        10: 0.172e-6,
      });
  }
}

export function bodyAtmosphere(id: BodyId, weather: WeatherOverrides = STANDARD_WEATHER, vacuum = false): Atmosphere {
  if (vacuum) return new Vacuum();
  switch (id) {
    case 'earth':
      return new EarthAtmosphere(weather);
    case 'moon':
      return new Vacuum();
    case 'mars':
      return new MarsAtmosphere();
    case 'jupiter':
      return new JupiterAtmosphere();
  }
}
