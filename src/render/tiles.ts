/**
 * Web terrain tiles around a launch site.
 *  - elevation: AWS Terrain Tiles (Terrarium PNG, SRTM/GMTED/ETOPO1 + bathymetry)
 *  - imagery:   Sentinel-2 cloudless 2016 by EOX (CC BY 4.0)
 * Produces a texture mosaic for rendering and a regular lat/lon grid (with a
 * flood-filled ocean mask) for the physics worker.
 */
import { sampleGrid, type GridData, type LocalGrid } from '../physics/environment';

const TILE = 256;
const terrUrl = (z: number, x: number, y: number) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const imgUrl = (z: number, x: number, y: number) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`;

export interface Patch {
  z: number;
  x0: number;
  y0: number;
  n: number;
  /** mosaic size in pixels */
  W: number;
  /** elevation in Mercator pixel layout, row 0 = north [m MSL] */
  elev: Float32Array;
  imagery: HTMLCanvasElement;
  imageryOk: boolean;
  elevationOk: boolean;
  latN: number;
  latS: number;
  lonW: number;
  lonE: number;
  grid: LocalGrid;
}

const imgCache = new Map<string, Promise<HTMLImageElement | null>>();
function loadImage(url: string): Promise<HTMLImageElement | null> {
  let p = imgCache.get(url);
  if (!p) {
    p = new Promise((resolve) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = url;
    });
    imgCache.set(url, p);
  }
  return p;
}

export const tileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
export const tileY = (lat: number, z: number) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
export const tileLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
export const tileLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;

async function pool<T>(jobs: (() => Promise<T>)[], size = 8): Promise<T[]> {
  const out: T[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, jobs.length) }, async () => {
      while (next < jobs.length) {
        const i = next++;
        out[i] = await jobs[i]();
      }
    }),
  );
  return out;
}

export interface PatchOptions {
  lat: number;
  lon: number;
  z: number;
  n: number;
  globalElevation: GridData;
  globalOcean: GridData;
  onProgress?: (f: number) => void;
}

export async function loadPatch(o: PatchOptions): Promise<Patch> {
  const { z, n } = o;
  const xf = tileX(o.lon, z), yf = tileY(Math.max(-85, Math.min(85, o.lat)), z);
  const x0 = Math.floor(xf - n / 2 + 0.5), y0 = Math.max(0, Math.min(2 ** z - n, Math.floor(yf - n / 2 + 0.5)));
  const W = n * TILE;
  const elev = new Float32Array(W * W);
  const imagery = document.createElement('canvas');
  imagery.width = imagery.height = W;
  const ictx = imagery.getContext('2d')!;
  const tcan = document.createElement('canvas');
  tcan.width = tcan.height = TILE;
  const tctx = tcan.getContext('2d', { willReadFrequently: true })!;
  let done = 0, elevOk = 0, imgOk = 0;
  const total = n * n * 2;
  const tick = () => o.onProgress?.(++done / total);
  const jobs: (() => Promise<void>)[] = [];
  const latN = tileLat(y0, z), latS = tileLat(y0 + n, z), lonW = tileLon(x0, z), lonE = tileLon(x0 + n, z);

  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const tx = (((x0 + i) % 2 ** z) + 2 ** z) % 2 ** z, ty = y0 + j;
      jobs.push(async () => {
        const im = await loadImage(terrUrl(z, tx, ty));
        if (im) {
          tctx.clearRect(0, 0, TILE, TILE);
          tctx.drawImage(im, 0, 0);
          const d = tctx.getImageData(0, 0, TILE, TILE).data;
          for (let py = 0; py < TILE; py++)
            for (let px = 0; px < TILE; px++) {
              const k = (py * TILE + px) * 4;
              elev[(j * TILE + py) * W + i * TILE + px] = d[k] * 256 + d[k + 1] + d[k + 2] / 256 - 32768;
            }
          elevOk++;
        } else {
          // offline fallback: global 0.25° grid
          for (let py = 0; py < TILE; py++) {
            const la = tileLat(y0 + j + (py + 0.5) / TILE, z);
            for (let px = 0; px < TILE; px++) {
              const lo = tileLon(x0 + i + (px + 0.5) / TILE, z);
              elev[(j * TILE + py) * W + i * TILE + px] = sampleGrid(o.globalElevation, la, lo);
            }
          }
        }
        tick();
      });
      jobs.push(async () => {
        const im = await loadImage(imgUrl(z, tx, ty));
        if (im) {
          ictx.drawImage(im, i * TILE, j * TILE, TILE, TILE);
          imgOk++;
        }
        tick();
      });
    }
  await pool(jobs, 10);
  if (z > 10) await fillBathymetry(elev, W, z, x0, y0, tcan, tctx, o);

  if (imgOk < n * n) paintFallbackImagery(ictx, elev, W, imgOk === 0);

  // regular lat/lon grid for physics (same pixel count, bilinear from the Mercator mosaic)
  const nLat = W, nLon = W;
  const dLat = (latN - latS) / (nLat - 1), dLon = (lonE - lonW) / (nLon - 1);
  const data = new Float32Array(nLat * nLon);
  for (let r = 0; r < nLat; r++) {
    const la = latS + r * dLat;
    const py = (tileY(la, z) - y0) * TILE - 0.5;
    for (let c = 0; c < nLon; c++) {
      const px = (tileX(lonW + c * dLon, z) - x0) * TILE - 0.5;
      data[r * nLon + c] = bilinearPx(elev, W, px, py);
    }
  }
  const ocean = floodOcean(data, nLon, nLat, (r, c) => sampleGrid(o.globalOcean, latS + r * dLat, lonW + c * dLon) > 0.5);
  const grid: LocalGrid = { nLon, nLat, lat0: latS, lon0: lonW, dLat, dLon, data, ocean };
  return { z, x0, y0, n, W, elev, imagery, imageryOk: imgOk === n * n, elevationOk: elevOk === n * n, latN, latS, lonW, lonE, grid };
}

/**
 * Terrarium tiles above zoom 10 carry no bathymetry: open water is encoded as
 * exactly 0 m. Replace those pixels with the zoom-10 (ETOPO1-based) depths
 * where the global mask says "ocean".
 */
async function fillBathymetry(
  elev: Float32Array, W: number, z: number, x0: number, y0: number,
  tcan: HTMLCanvasElement, tctx: CanvasRenderingContext2D, o: PatchOptions,
) {
  let zeros = 0;
  for (let k = 0; k < elev.length; k += 3) if (elev[k] === 0) zeros++;
  if (zeros === 0) return;
  const zb = 10;
  const n = W / TILE;
  const latN = tileLat(y0, z), latS = tileLat(y0 + n, z), lonW = tileLon(x0, z), lonE = tileLon(x0 + n, z);
  const bx0 = Math.floor(tileX(lonW, zb)), bx1 = Math.floor(tileX(lonE - 1e-9, zb));
  const by0 = Math.floor(tileY(latN, zb)), by1 = Math.floor(tileY(latS + 1e-9, zb));
  const tiles = new Map<string, Float32Array>();
  const jobs: (() => Promise<void>)[] = [];
  for (let by = by0; by <= by1; by++)
    for (let bx = bx0; bx <= bx1; bx++)
      jobs.push(async () => {
        const tx = ((bx % 2 ** zb) + 2 ** zb) % 2 ** zb;
        const im = await loadImage(terrUrl(zb, tx, by));
        if (!im) return;
        tctx.clearRect(0, 0, tcan.width, tcan.height);
        tctx.drawImage(im, 0, 0);
        const d = tctx.getImageData(0, 0, TILE, TILE).data;
        const a = new Float32Array(TILE * TILE);
        for (let k = 0; k < a.length; k++) a[k] = d[k * 4] * 256 + d[k * 4 + 1] + d[k * 4 + 2] / 256 - 32768;
        tiles.set(`${bx}/${by}`, a);
      });
  await pool(jobs, 6);
  for (let py = 0; py < W; py++) {
    const la = tileLat(y0 + (py + 0.5) / TILE, z);
    const fy = tileY(la, zb);
    for (let px = 0; px < W; px++) {
      const k = py * W + px;
      if (elev[k] !== 0) continue;
      const lo = tileLon(x0 + (px + 0.5) / TILE, z);
      if (sampleGrid(o.globalOcean, la, lo) < 0.5) continue;
      const fx = tileX(lo, zb);
      const t = tiles.get(`${Math.floor(fx)}/${Math.floor(fy)}`);
      if (!t) continue;
      const ix = Math.min(TILE - 1, Math.floor((fx % 1) * TILE)), iy = Math.min(TILE - 1, Math.floor((fy % 1) * TILE));
      const v = t[iy * TILE + ix];
      if (v < 0) elev[k] = v;
    }
  }
}

export function bilinearPx(elev: Float32Array, W: number, px: number, py: number): number {
  const x = Math.min(Math.max(px, 0), W - 1.001), y = Math.min(Math.max(py, 0), W - 1.001);
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const a = elev[j * W + i], b = elev[j * W + i + 1], c = elev[(j + 1) * W + i], d = elev[(j + 1) * W + i + 1];
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy;
}

/** Cells below 0 m connected (4-neighbour) to a cell the global mask marks as ocean. */
function floodOcean(data: Float32Array, nLon: number, nLat: number, isGlobalOcean: (r: number, c: number) => boolean): Uint8Array {
  const mask = new Uint8Array(nLon * nLat);
  const stack: number[] = [];
  const step = 16; // seed test every 16 cells (global mask is coarse)
  for (let r = 0; r < nLat; r += step)
    for (let c = 0; c < nLon; c += step) {
      const k = r * nLon + c;
      if (data[k] < 0 && isGlobalOcean(r, c)) { mask[k] = 1; stack.push(k); }
    }
  while (stack.length) {
    const k = stack.pop()!;
    const r = (k / nLon) | 0, c = k - r * nLon;
    if (c > 0) visit(k - 1);
    if (c < nLon - 1) visit(k + 1);
    if (r > 0) visit(k - nLon);
    if (r < nLat - 1) visit(k + nLon);
  }
  function visit(n: number) {
    if (!mask[n] && data[n] < 0) { mask[n] = 1; stack.push(n); }
  }
  return mask;
}

/** Hypsometric/bathymetric tint where satellite imagery is unavailable. */
function paintFallbackImagery(ctx: CanvasRenderingContext2D, elev: Float32Array, W: number, all: boolean) {
  const img = ctx.getImageData(0, 0, W, W);
  for (let k = 0; k < W * W; k++) {
    if (!all && img.data[k * 4 + 3] > 0) continue;
    const e = elev[k];
    let r: number, g: number, b: number;
    if (e < 0) { const t = Math.min(-e / 5000, 1); r = 20 * (1 - t) + 4 * t; g = 70 * (1 - t) + 18 * t; b = 110 * (1 - t) + 50 * t; }
    else if (e < 500) { r = 82; g = 110; b = 60; }
    else if (e < 1500) { r = 120; g = 118; b = 80; }
    else if (e < 3000) { r = 125; g = 105; b = 90; }
    else if (e < 4500) { r = 150; g = 145; b = 140; }
    else { r = 235; g = 238; b = 242; }
    img.data[k * 4] = r; img.data[k * 4 + 1] = g; img.data[k * 4 + 2] = b; img.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
