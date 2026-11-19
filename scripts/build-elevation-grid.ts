/**
 * Builds a global 0.25° elevation grid (m above MSL, with bathymetry) and an
 * ocean mask from AWS Terrain Tiles (Terrarium encoding, z = 4; sources:
 * SRTM, GMTED2010, ETOPO1 — see https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
 *
 * Ocean = cells below 0 m that are connected to the open ocean (flood fill from
 * the deepest Pacific cell), so the Dead Sea, Caspian, Qattara, Death Valley,
 * Turpan etc. are treated as land.
 *
 * Output public/data/elevation_grid.bin:
 *   int32 nLon, int32 nLat, float64 lat0, lon0, dLat, dLon,
 *   int16 elevation[nLat*nLon], uint8 ocean[nLat*nLon]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';

const Z = 4;
const TILE = 256;
const N_TILES = 2 ** Z;
const STEP = 0.25;
const nLon = Math.round(360 / STEP);
const nLat = Math.round(180 / STEP) + 1;
const RAW = resolve('data-raw/terrarium');

async function tile(x: number, y: number): Promise<PNG> {
  const path = `${RAW}/${Z}_${x}_${y}.png`;
  if (!existsSync(path)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${Z}/${x}/${y}.png`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  return PNG.sync.read(readFileSync(path));
}

async function main() {
  mkdirSync(RAW, { recursive: true });
  const W = N_TILES * TILE;
  const mosaic = new Float32Array(W * W);
  for (let ty = 0; ty < N_TILES; ty++)
    for (let tx = 0; tx < N_TILES; tx++) {
      const png = await tile(tx, ty);
      for (let py = 0; py < TILE; py++)
        for (let px = 0; px < TILE; px++) {
          const o = (py * TILE + px) * 4;
          const e = png.data[o] * 256 + png.data[o + 1] + png.data[o + 2] / 256 - 32768;
          mosaic[(ty * TILE + py) * W + tx * TILE + px] = e;
        }
    }
  console.log('mosaic loaded', W, 'x', W);

  // resample Web-Mercator mosaic to the equirectangular grid (bilinear)
  const elev = new Int16Array(nLat * nLon);
  const maxLat = (Math.atan(Math.sinh(Math.PI)) * 180) / Math.PI; // 85.0511°
  for (let j = 0; j < nLat; j++) {
    const lat = Math.max(-maxLat + 1e-6, Math.min(maxLat - 1e-6, -90 + j * STEP));
    const yM = ((1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2) * W - 0.5;
    for (let i = 0; i < nLon; i++) {
      const lon = -180 + i * STEP;
      const xM = ((lon + 180) / 360) * W - 0.5;
      const x0 = Math.floor(xM), y0 = Math.max(0, Math.min(W - 2, Math.floor(yM)));
      const fx = xM - x0, fy = Math.max(0, Math.min(1, yM - y0));
      const xa = ((x0 % W) + W) % W, xb = (xa + 1) % W;
      const v =
        mosaic[y0 * W + xa] * (1 - fx) * (1 - fy) + mosaic[y0 * W + xb] * fx * (1 - fy) +
        mosaic[(y0 + 1) * W + xa] * (1 - fx) * fy + mosaic[(y0 + 1) * W + xb] * fx * fy;
      elev[j * nLon + i] = Math.round(v);
    }
  }
  // polar caps beyond the Mercator limit: Antarctic plateau rises to 2835 m at the South Pole
  // (Amundsen–Scott station), the Arctic Ocean is 4261 m deep at the North Pole.
  for (let j = 0; j < nLat; j++) {
    const lat = -90 + j * STEP;
    if (Math.abs(lat) <= maxLat) continue;
    const edge = lat < 0 ? Math.ceil((-maxLat + 90) / STEP) : Math.floor((maxLat + 90) / STEP);
    const target = lat < 0 ? 2835 : -4261;
    const w = (Math.abs(lat) - maxLat) / (90 - maxLat);
    for (let i = 0; i < nLon; i++) elev[j * nLon + i] = Math.round(elev[edge * nLon + i] * (1 - w) + target * w);
  }

  // ocean flood fill from the deepest point (Challenger Deep is in the Pacific)
  const ocean = new Uint8Array(nLat * nLon);
  let seed = 0;
  for (let k = 0; k < elev.length; k++) if (elev[k] < elev[seed]) seed = k;
  // Seas joined to the ocean only through straits narrower than a grid cell:
  // Bosphorus/Dardanelles (Black Sea, Marmara, Azov), Danish straits (Baltic).
  const extraSeeds: [number, number][] = [[43, 34], [40.75, 28], [46, 36.5], [57, 19], [63, 20]];
  const stack = [seed];
  ocean[seed] = 1;
  for (const [la, lo] of extraSeeds) {
    const k = Math.round((la + 90) / STEP) * nLon + Math.round((lo + 180) / STEP);
    if (elev[k] >= 0) throw new Error(`extra seed (${la}, ${lo}) is not below sea level`);
    ocean[k] = 1;
    stack.push(k);
  }
  while (stack.length) {
    const k = stack.pop()!;
    const j = Math.floor(k / nLon), i = k % nLon;
    const nb = [
      j * nLon + ((i + 1) % nLon), j * nLon + ((i - 1 + nLon) % nLon),
      j > 0 ? (j - 1) * nLon + i : -1, j < nLat - 1 ? (j + 1) * nLon + i : -1,
    ];
    for (const n of nb) if (n >= 0 && !ocean[n] && elev[n] < 0) { ocean[n] = 1; stack.push(n); }
  }
  const check = (name: string, lat: number, lon: number, expectOcean: boolean) => {
    const k = Math.round((lat + 90) / STEP) * nLon + (Math.round((lon + 180) / STEP) % nLon);
    const ok = !!ocean[k] === expectOcean;
    console.log(`${ok ? 'ok ' : 'BAD'} ${name}: elev ${elev[k]} m, ocean=${!!ocean[k]}`);
    if (!ok) throw new Error(`ocean mask wrong at ${name}`);
  };
  check('Dead Sea', 31.5, 35.5, false);
  check('Caspian Sea', 42, 51, false);
  check('Mid-Atlantic', 30, -40, true);
  check('Mariana Trench', 11.25, 142.25, true);
  check('Mediterranean', 35, 18, true);
  check('Black Sea', 43, 34, true);
  check('Baltic Sea', 57, 19, true);
  check('Persian Gulf', 27, 51, true);
  check('Red Sea', 20, 38.5, true);
  check('Everest', 28, 87, false);

  const header = new ArrayBuffer(40);
  const hv = new DataView(header);
  hv.setInt32(0, nLon, true); hv.setInt32(4, nLat, true);
  hv.setFloat64(8, -90, true); hv.setFloat64(16, -180, true); hv.setFloat64(24, STEP, true); hv.setFloat64(32, STEP, true);
  const out = Buffer.concat([Buffer.from(header), Buffer.from(elev.buffer), Buffer.from(ocean.buffer)]);
  writeFileSync(resolve('public/data/elevation_grid.bin'), out);
  console.log(`wrote ${(out.length / 1e6).toFixed(2)} MB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
