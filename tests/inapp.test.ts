import { describe, expect, it } from 'vitest';
import { runValidation } from '../src/validation/cases';
import { loadEgm2008 } from './helpers';

describe('In-app validation suite', () => {
  it('every case passes its stated tolerance', () => {
    const results = runValidation(loadEgm2008());
    for (const r of results) {
      const msg = `${r.name}: expected ${r.expected}, got ${r.actual} (${r.errorKind} error ${r.error.toExponential(2)} > ${r.tolerance})`;
      expect(r.pass, msg).toBe(true);
    }
    expect(results.length).toBeGreaterThanOrEqual(15);
  });
});
