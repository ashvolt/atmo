import type { BodyId } from '../physics/bodies';
import { NO_WIND, type WindSettings } from '../physics/environment';
import { STANDARD_WEATHER, type WeatherOverrides } from '../physics/atmosphere/ussa1976';
import type { SpinMode } from '../physics/simulation';
import { customObject, presetById, type ObjectSpec } from '../physics/objects';

export interface CustomObjectParams {
  shape: 'sphere' | 'cube' | 'disk' | 'cylinder';
  size: number;
  mass: number;
  material: string;
  cd: number | null;
}

export interface Scenario {
  body: BodyId;
  lat: number;
  lon: number;
  siteName: string;
  landmarkId: string | null;
  groundOverride: number | null;
  mode: 'drop' | 'throw';
  heightAGL: number;
  speed: number;
  elevation: number;
  azimuth: number;
  objectId: string;
  custom: CustomObjectParams;
  spinRpm: number;
  spinMode: SpinMode;
  parachute: boolean;
  deployAGL: number;
  vacuum: boolean;
  rotation: boolean;
  water: boolean;
  weather: WeatherOverrides;
  wind: WindSettings;
  gravityDegree: number;
  rtol: number;
  maxTimeHours: number;
  date: string; // ISO for the Sun position
  /** 'noon': the Sun is set to local solar noon whenever the site changes */
  sunMode: 'noon' | 'custom';
}

export const DEFAULT_SCENARIO: Scenario = {
  body: 'earth',
  lat: 43.72297,
  lon: 10.39659,
  siteName: 'Leaning Tower of Pisa',
  landmarkId: 'pisa',
  groundOverride: 2,
  mode: 'drop',
  heightAGL: 56,
  speed: 25,
  elevation: 40,
  azimuth: 90,
  objectId: 'cannonball',
  custom: { shape: 'sphere', size: 0.1, mass: 1, material: 'iron', cd: null },
  spinRpm: 1800,
  spinMode: 'none',
  parachute: true,
  deployAGL: 1000,
  vacuum: false,
  rotation: true,
  water: true,
  weather: STANDARD_WEATHER,
  wind: NO_WIND,
  gravityDegree: 120,
  rtol: 1e-10,
  maxTimeHours: 6,
  date: new Date().toISOString(),
  sunMode: 'noon',
};

/** Today's local solar noon (UTC) at a longitude. */
export function solarNoonISO(lon: number): string {
  const d = new Date();
  const noon = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 12, 0, 0) - (lon / 15) * 3600e3;
  return new Date(noon).toISOString();
}

export function objectFor(s: Scenario): ObjectSpec {
  if (s.objectId === 'custom') {
    const c = s.custom;
    return customObject({ shape: c.shape, size: c.size, mass: c.mass, material: c.material, cd: c.cd ?? undefined });
  }
  return presetById(s.objectId);
}

export const RUN_COLORS = [0x5cc8ff, 0xffb547, 0xc084fc, 0x4ade80];
export const RUN_CSS = ['#5cc8ff', '#ffb547', '#c084fc', '#4ade80'];

export function describe(s: Scenario): string {
  const obj = s.objectId === 'custom' ? 'custom object' : presetById(s.objectId).name;
  const how = s.mode === 'drop' ? `dropped from ${s.heightAGL >= 1000 ? (s.heightAGL / 1000).toFixed(1) + ' km' : s.heightAGL.toFixed(1) + ' m'}` : `thrown ${s.speed.toFixed(1)} m/s @ ${s.elevation.toFixed(0)}°`;
  return `${obj} ${how} — ${s.siteName}${s.body !== 'earth' ? ` (${s.body})` : ''}${s.vacuum ? ', vacuum' : ''}`;
}
