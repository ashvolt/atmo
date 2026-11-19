/**
 * Downloads the EGM2008 spherical-harmonic coefficients (tide-free, fully
 * normalized) from ICGEM and truncates them to degree NMAX.
 *
 * The ICGEM .gfc file is sorted by degree, so only the first ~8 MB of the
 * 252 MB file are needed for degree 360. We request that byte range.
 *
 * Output: public/data/egm2008_n360.bin
 *   bytes 0..3    : uint32 nmax
 *   bytes 4..7    : uint32 reserved (0)
 *   bytes 8..15   : float64 GM  [m^3/s^2]
 *   bytes 16..23  : float64 R   [m]  (reference radius)
 *   then float64 C[k], k = n(n+1)/2 + m  for 0<=m<=n<=nmax
 *   then float64 S[k]
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const NMAX = 360;
const URL =
  'https://icgem.gfz-potsdam.de/getmodel/gfc/c50128797a9cb62e936337c890e4425f03f0461d7329b09a8cc8561504465340/EGM2008.gfc';
const RAW = resolve('data-raw/EGM2008_head.gfc');
const OUT = resolve('public/data/egm2008_n360.bin');

async function main() {
  let text: string;
  if (existsSync(RAW)) {
    text = readFileSync(RAW, 'utf8');
  } else {
    // ~112 bytes per line; (NMAX+1)(NMAX+2)/2 lines + header. Ask for a safe margin.
    const bytes = Math.ceil(((NMAX + 2) * (NMAX + 3)) / 2) * 120 + 20000;
    console.log(`Downloading first ${(bytes / 1e6).toFixed(1)} MB of EGM2008.gfc ...`);
    const res = await fetch(URL, { headers: { Range: `bytes=0-${bytes}` } });
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
    mkdirSync(dirname(RAW), { recursive: true });
    writeFileSync(RAW, text);
  }

  const header = text.slice(0, text.indexOf('end_of_head'));
  const gm = Number(/earth_gravity_constant\s+(\S+)/.exec(header)![1].replace(/d/i, 'e'));
  const radius = Number(/radius\s+(\S+)/.exec(header)![1].replace(/d/i, 'e'));
  if (!/fully_normalized/.test(header)) throw new Error('Expected fully normalized coefficients');
  if (!/tide_free/.test(header)) throw new Error('Expected tide-free model');

  const count = ((NMAX + 1) * (NMAX + 2)) / 2;
  const C = new Float64Array(count);
  const S = new Float64Array(count);
  const seen = new Uint8Array(count);

  const body = text.slice(text.indexOf('\n', text.indexOf('end_of_head')) + 1);
  for (const line of body.split('\n')) {
    const p = line.trim().split(/\s+/);
    if (p[0] !== 'gfc' || p.length < 5) continue;
    const n = Number(p[1]);
    const m = Number(p[2]);
    if (n > NMAX) break;
    const k = (n * (n + 1)) / 2 + m;
    C[k] = Number(p[3].replace(/d/i, 'e'));
    S[k] = Number(p[4].replace(/d/i, 'e'));
    seen[k] = 1;
  }
  // Degree 1 terms are zero by definition (origin at the centre of mass) and absent from file.
  for (const k of [1, 2]) seen[k] = 1;
  const missing = seen.reduce((a, v) => a + (v ? 0 : 1), 0);
  if (missing) throw new Error(`Missing ${missing} coefficients up to degree ${NMAX}`);

  const buf = new ArrayBuffer(24 + count * 16);
  const dv = new DataView(buf);
  dv.setUint32(0, NMAX, true);
  dv.setUint32(4, 0, true);
  dv.setFloat64(8, gm, true);
  dv.setFloat64(16, radius, true);
  new Float64Array(buf, 24, count).set(C);
  new Float64Array(buf, 24 + count * 8, count).set(S);
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, Buffer.from(buf));
  console.log(`GM=${gm} R=${radius} C20=${C[3]} C22=${C[5]} C360,360=${C[count - 1]}`);
  console.log(`Wrote ${OUT} (${(buf.byteLength / 1e6).toFixed(2)} MB, ${count} coefficient pairs)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
