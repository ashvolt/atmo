/**
 * Binary data loaders (usable from the main thread and from workers).
 */
import type { GridData } from '../physics/environment';

export interface GravityGrids {
  disturbance: GridData; // mGal
  geoid: GridData; // m
  surfaceG: GridData; // m/s²
}

export interface ElevationGrids {
  elevation: GridData; // m
  ocean: GridData; // 0/1
}

const base = (): string => {
  // works in window and worker contexts under Vite's base URL
  return (import.meta.env?.BASE_URL ?? '/').replace(/\/?$/, '/');
};

export async function fetchBuffer(path: string): Promise<ArrayBuffer> {
  const res = await fetch(base() + path);
  if (!res.ok) throw new Error(`Failed to load ${path}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

function header(buf: ArrayBuffer) {
  const dv = new DataView(buf);
  return {
    nLon: dv.getInt32(0, true),
    nLat: dv.getInt32(4, true),
    lat0: dv.getFloat64(8, true),
    lon0: dv.getFloat64(16, true),
    dLat: dv.getFloat64(24, true),
    dLon: dv.getFloat64(32, true),
  };
}

export function parseGravityGrid(buf: ArrayBuffer): GravityGrids {
  const h = header(buf);
  const n = h.nLon * h.nLat;
  const off = 40;
  return {
    disturbance: { ...h, data: new Float32Array(buf, off, n) },
    geoid: { ...h, data: new Float32Array(buf, off + n * 4, n) },
    surfaceG: { ...h, data: new Float32Array(buf, off + n * 8, n) },
  };
}

export function parseElevationGrid(buf: ArrayBuffer): ElevationGrids {
  const h = header(buf);
  const n = h.nLon * h.nLat;
  return {
    elevation: { ...h, data: new Int16Array(buf.slice(40, 40 + n * 2)) },
    ocean: { ...h, data: new Uint8Array(buf, 40 + n * 2, n) },
  };
}

export type Place = [name: string, cc: string, lat: number, lon: number, pop: number, elev: number | null];

let placesPromise: Promise<Place[]> | null = null;
export function loadPlaces(): Promise<Place[]> {
  placesPromise ??= fetch(base() + 'data/places.json').then((r) => r.json());
  return placesPromise;
}

export const textureUrl = (name: string) => `${base()}textures/${name}`;
