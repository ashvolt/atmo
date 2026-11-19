import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCoefficientFile, type SphericalHarmonicField } from '../src/physics/gravity/harmonics';

let egm: SphericalHarmonicField | null = null;
export function loadEgm2008(): SphericalHarmonicField {
  if (!egm) {
    const b = readFileSync(resolve(__dirname, '../public/data/egm2008_n360.bin'));
    egm = parseCoefficientFile('EGM2008', b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  }
  return egm;
}

export const relErr = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
