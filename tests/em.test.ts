import { describe, expect, it } from 'vitest';
import { agmKE, carlsonRD, carlsonRF, ellipE, ellipK, ellipKderiv } from '../src/physics/em/elliptic';
import { D2, add, atan2d, div, eigen3, exp, log, mul, muls, sin, sq, sqrt } from '../src/physics/em/dual';
import {
  CylinderMagnetSource, DipoleSource, FieldAssembly, LoopSource, MagnetSource, SolenoidSource,
  UniformFieldSource, WireSource, frameFromAxis, loopBElliptic, loopNodes, m3apply, rotationAxisAngle,
} from '../src/physics/em/sources';
import { MU0 } from '../src/physics/em/constants';
import type { Vec3 } from '../src/physics/vec3';

const relErr = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);

describe('elliptic integrals', () => {
  it('Carlson and AGM agree to double precision', () => {
    for (let i = 0; i <= 200; i++) {
      const k = (i / 200) * 0.999;
      const [K1, E1] = [ellipK(k), ellipE(k)];
      const [K2, E2] = agmKE(k);
      expect(relErr(K1, K2)).toBeLessThan(5e-15);
      expect(relErr(E1, E2)).toBeLessThan(5e-15);
    }
  });

  it('matches published values at k = 0.5', () => {
    // Abramowitz & Stegun Table 17.1 (modulus convention)
    expect(relErr(ellipK(0.5), 1.6857503548125960429)).toBeLessThan(1e-14);
    expect(relErr(ellipE(0.5), 1.4674622093394271555)).toBeLessThan(1e-14);
    expect(relErr(ellipK(0), Math.PI / 2)).toBeLessThan(1e-16);
    expect(relErr(ellipE(0), Math.PI / 2)).toBeLessThan(1e-16);
    expect(relErr(ellipE(1), 1)).toBeLessThan(1e-12);
  });

  it('Carlson symmetric forms satisfy their defining identities', () => {
    // R_F(x,x,x) = x^{-1/2}, R_D(x,x,x) = x^{-3/2}
    for (const x of [0.25, 1, 3.7, 100]) {
      expect(relErr(carlsonRF(x, x, x), x ** -0.5)).toBeLessThan(1e-15);
      expect(relErr(carlsonRD(x, x, x), x ** -1.5)).toBeLessThan(1e-14);
    }
  });

  it('analytic derivatives of K and E match finite differences', () => {
    for (const k of [0.1, 0.35, 0.6, 0.85, 0.95]) {
      const h = 1e-6;
      const d = ellipKderiv(k);
      const dK = (ellipK(k + h) - ellipK(k - h)) / (2 * h);
      const dE = (ellipE(k + h) - ellipE(k - h)) / (2 * h);
      const d2K = (ellipK(k + h) - 2 * ellipK(k) + ellipK(k - h)) / h ** 2;
      const d2E = (ellipE(k + h) - 2 * ellipE(k) + ellipE(k - h)) / h ** 2;
      expect(relErr(d.K1, dK)).toBeLessThan(1e-8);
      expect(relErr(d.E1, dE)).toBeLessThan(1e-8);
      expect(relErr(d.K2, d2K)).toBeLessThan(1e-3);
      expect(relErr(d.E2, d2E)).toBeLessThan(1e-3);
    }
  });
});

describe('hyper-dual arithmetic', () => {
  /** f(x,y,z) = exp(x·y)·sqrt(1+z²)/log(2+x) + sin(y·z) */
  const f = (x: number, y: number, z: number) =>
    (Math.exp(x * y) * Math.sqrt(1 + z * z)) / Math.log(2 + x) + Math.sin(y * z);
  const fd = (x: D2, y: D2, z: D2) =>
    add(div(mul(exp(mul(x, y)), sqrt(add(D2.c(1), sq(z)))), log(add(D2.c(2), x))), sin(mul(y, z)));

  it('reproduces first and second derivatives exactly', () => {
    const p = [0.3, -0.7, 1.4];
    const [x, y, z] = D2.point(p[0], p[1], p[2]);
    const r = fd(x, y, z);
    expect(relErr(r.v, f(p[0], p[1], p[2]))).toBeLessThan(1e-15);
    const h = 1e-5;
    const num = (i: number) => {
      const a = [...p], b = [...p];
      a[i] += h; b[i] -= h;
      return (f(a[0], a[1], a[2]) - f(b[0], b[1], b[2])) / (2 * h);
    };
    expect(relErr(r.gx, num(0))).toBeLessThan(1e-9);
    expect(relErr(r.gy, num(1))).toBeLessThan(1e-9);
    expect(relErr(r.gz, num(2))).toBeLessThan(1e-9);
    // second derivatives: finite-difference the *analytic* gradient, which is
    // far better conditioned than a second difference of the value
    const gradAt = (q: number[]) => {
      const r2 = fd(D2.x(q[0]), D2.y(q[1]), D2.z(q[2]));
      return [r2.gx, r2.gy, r2.gz];
    };
    const dgrad = (j: number, i: number) => {
      const a = [...p], b = [...p];
      a[j] += h; b[j] -= h;
      return (gradAt(a)[i] - gradAt(b)[i]) / (2 * h);
    };
    expect(relErr(r.hxx, dgrad(0, 0))).toBeLessThan(1e-8);
    expect(relErr(r.hyy, dgrad(1, 1))).toBeLessThan(1e-8);
    expect(relErr(r.hzz, dgrad(2, 2))).toBeLessThan(1e-8);
    expect(relErr(r.hxy, dgrad(0, 1))).toBeLessThan(1e-8);
    expect(relErr(r.hxz, dgrad(0, 2))).toBeLessThan(1e-8);
    expect(relErr(r.hyz, dgrad(1, 2))).toBeLessThan(1e-8);
    // symmetry of the mixed partials is structural, not assumed
    expect(relErr(dgrad(1, 0), dgrad(0, 1))).toBeLessThan(1e-8);
  });

  it('atan2 derivatives are exact in every quadrant', () => {
    for (const [yv, xv] of [[1, 2], [-1, 2], [1, -2], [-1, -2], [0.001, -3]]) {
      const Y = mul(D2.x(yv), D2.c(1));
      const X = add(D2.y(xv), muls(D2.z(0.5), 0.0));
      const t = atan2d(Y, X);
      expect(t.v).toBeCloseTo(Math.atan2(yv, xv), 14);
      // dθ/dy_var = X/(X²+Y²); dθ/dx_var = −Y/(X²+Y²)
      const D = xv * xv + yv * yv;
      expect(relErr(t.gx, xv / D)).toBeLessThan(1e-14);
      expect(relErr(t.gy, -yv / D)).toBeLessThan(1e-14);
    }
  });

  it('eigen3 matches a known symmetric spectrum', () => {
    const m = [2, -1, 0, -1, 2, -1, 0, -1, 2];
    const e = eigen3(m);
    const want = [2 - Math.SQRT2, 2, 2 + Math.SQRT2];
    for (let i = 0; i < 3; i++) expect(Math.abs(e[i] - want[i])).toBeLessThan(1e-13);
  });
});

describe('current loop', () => {
  const a = 0.05, I = 1234.5;

  it('reproduces the exact on-axis field', () => {
    const loop = new LoopSource('L', [0, 0, 0], [0, 0, 1], a, I);
    for (const z of [0, 0.001, 0.01, 0.05, 0.2, 1, 10]) {
      const exact = (MU0 * I * a * a) / (2 * (a * a + z * z) ** 1.5);
      const b = loop.B([0, 0, z]);
      expect(relErr(b[2], exact)).toBeLessThan(1e-14);
      expect(Math.abs(b[0])).toBeLessThan(1e-18);
      expect(Math.abs(b[1])).toBeLessThan(1e-18);
    }
  });

  it('agrees with the closed-form elliptic solution off axis', () => {
    const loop = new LoopSource('L', [0, 0, 0], [0, 0, 1], a, I);
    for (const rho of [0.002, 0.01, 0.03, 0.049, 0.06, 0.1, 0.5]) {
      for (const z of [-0.3, -0.02, 0.005, 0.02, 0.08, 0.4]) {
        const d = Math.hypot(rho - a, z);
        if (d < 0.02 * a) continue;
        const ref = loopBElliptic(a, I, rho, z);
        const b = loop.B([rho, 0, z]);
        const scale = Math.max(Math.hypot(ref.brho, ref.bz), 1e-12);
        expect(Math.abs(b[0] - ref.brho) / scale).toBeLessThan(1e-11);
        expect(Math.abs(b[2] - ref.bz) / scale).toBeLessThan(1e-11);
      }
    }
  });

  it('node count scales with the distance to the conductor', () => {
    expect(loopNodes(a, 0, 0)).toBe(48);
    expect(loopNodes(a, a, 0.5 * a)).toBeGreaterThan(40);
    expect(loopNodes(a, a, 0.02 * a)).toBeGreaterThan(900);
  });

  it('satisfies Maxwell: ∇·B = 0 and ∇×B = 0 in free space', () => {
    const loop = new LoopSource('L', [0.01, -0.02, 0.005], [0.3, 0.4, 0.9], a, I);
    for (const p of [[0.1, 0.05, 0.2], [-0.2, 0.1, -0.1], [0.0, 0.0, 0.3]] as Vec3[]) {
      const { B, J } = loop.BJ(p);
      const scale = Math.hypot(B[0], B[1], B[2]) / Math.hypot(p[0] - 0.01, p[1] + 0.02, p[2] - 0.005);
      const divB = J[0] + J[4] + J[8];
      const curl = [J[7] - J[5], J[2] - J[6], J[3] - J[1]];
      expect(Math.abs(divB) / scale).toBeLessThan(1e-10);
      for (const c of curl) expect(Math.abs(c) / scale).toBeLessThan(1e-10);
    }
  });

  it('analytic Jacobian matches finite differences and the dual gradient', () => {
    const loop = new LoopSource('L', [0, 0, 0], [0, 0, 1], a, I);
    const p: Vec3 = [0.03, 0.02, 0.04];
    const { J } = loop.BJ(p);
    const h = 1e-7;
    for (let k = 0; k < 3; k++) {
      const pp: Vec3 = [...p] as Vec3, pm: Vec3 = [...p] as Vec3;
      pp[k] += h; pm[k] -= h;
      const bp = loop.B(pp), bm = loop.B(pm);
      for (let i = 0; i < 3; i++) {
        const fd = (bp[i] - bm[i]) / (2 * h);
        expect(Math.abs(J[i * 3 + k] - fd) / Math.max(Math.abs(fd), 1e-6)).toBeLessThan(1e-6);
      }
    }
    const [bx, by, bz] = loop.Bd(D2.x(p[0]), D2.y(p[1]), D2.z(p[2]));
    const dual = [bx.gx, bx.gy, bx.gz, by.gx, by.gy, by.gz, bz.gx, bz.gy, bz.gz];
    for (let i = 0; i < 9; i++) expect(relErr(J[i], dual[i])).toBeLessThan(1e-12);
  });

  it('rotates rigidly with its frame', () => {
    const axis: Vec3 = [1, 1, 0];
    const R = rotationAxisAngle([0, 0, 1], Math.PI / 4);
    const upright = new LoopSource('a', [0, 0, 0], [0, 0, 1], a, I);
    const tilted = new LoopSource('b', [0, 0, 0], axis, a, I);
    // a point on the tilted loop's axis must see the same |B| as the upright
    // loop sees on its own axis at the same distance
    const dist = 0.11;
    const n = Math.hypot(axis[0], axis[1], axis[2]);
    const pt: Vec3 = [(axis[0] / n) * dist, (axis[1] / n) * dist, (axis[2] / n) * dist];
    const b1 = tilted.B(pt);
    const b0 = upright.B([0, 0, dist]);
    expect(relErr(Math.hypot(b1[0], b1[1], b1[2]), Math.abs(b0[2]))).toBeLessThan(1e-13);
    expect(m3apply(frameFromAxis([0, 0, 1]), [0, 0, 1])[2]).toBeCloseTo(1, 15);
    void R;
  });
});

describe('solenoid and cylinder magnet', () => {
  it('finite solenoid matches its exact on-axis closed form', () => {
    const sol = new SolenoidSource('S', [0, 0, 0], [0, 0, 1], 0.03, 0.2, 500, 10);
    for (const z of [0, 0.05, 0.099, 0.15, 0.5, 2]) {
      const b = sol.B([0, 0, z]);
      expect(relErr(b[2], sol.axialExact(z))).toBeLessThan(1e-11);
    }
  });

  it('long solenoid interior approaches μ₀nI', () => {
    const sol = new SolenoidSource('S', [0, 0, 0], [0, 0, 1], 0.01, 4, 40000, 5);
    const b = sol.B([0, 0, 0]);
    expect(relErr(b[2], MU0 * sol.sheetCurrent)).toBeLessThan(1e-4);
  });

  it('cylinder magnet matches its exact on-axis closed form', () => {
    const m = new CylinderMagnetSource('M', [0, 0, 0], [0, 0, 1], 0.01, 0.005, 1.32);
    for (const z of [0.003, 0.006, 0.02, 0.1]) {
      const b = m.B([0, 0, z]);
      expect(relErr(b[2], m.axialExact(z))).toBeLessThan(1e-10);
    }
  });

  it('cylinder magnet far field approaches the equivalent dipole', () => {
    const Br = 1.32, R = 0.01, L = 0.005;
    const m = new CylinderMagnetSource('M', [0, 0, 0], [0, 0, 1], R, L, Br);
    const dip = new DipoleSource('d', [0, 0, 0], [0, 0, m.moment]);
    for (const p of [[0, 0, 0.5], [0.3, 0.2, 0.4]] as Vec3[]) {
      const a = m.B(p), b = dip.B(p);
      expect(relErr(Math.hypot(...a), Math.hypot(...b))).toBeLessThan(2e-3);
    }
  });
});

describe('rectangular magnet', () => {
  const Br = 1.32; // N42 remanence

  it('gives the exact demagnetising factor at the centre of a cube', () => {
    const m = new MagnetSource('M', [0, 0, 0], [0.02, 0.02, 0.02], Br);
    const b = m.B([0, 0, 0]);
    // H = −M/3 inside a cube ⇒ B = μ₀(H + M) = 2Br/3
    expect(relErr(b[2], (2 / 3) * Br)).toBeLessThan(1e-12);
  });

  it('far field approaches the equivalent point dipole', () => {
    const size: Vec3 = [0.012, 0.012, 0.012];
    const m = new MagnetSource('M', [0, 0, 0], size, Br);
    const dip = new DipoleSource('d', [0, 0, 0], [0, 0, m.moment]);
    for (const p of [[0, 0, 0.3], [0.2, 0.1, 0.25], [0.4, 0, 0]] as Vec3[]) {
      const a = m.B(p), b = dip.B(p);
      for (let i = 0; i < 3; i++) {
        expect(Math.abs(a[i] - b[i]) / Math.hypot(...b)).toBeLessThan(2e-3);
      }
    }
  });

  it('satisfies Maxwell outside the material', () => {
    const m = new MagnetSource('M', [0, 0, 0], [0.02, 0.01, 0.005], Br, rotationAxisAngle([1, 0.3, 0], 0.4));
    for (const p of [[0.03, 0.02, 0.02], [-0.05, 0.01, 0.03], [0.01, 0.01, 0.04]] as Vec3[]) {
      const { B, J } = m.BJ(p);
      const scale = Math.hypot(...B) / 0.01;
      expect(Math.abs(J[0] + J[4] + J[8]) / scale).toBeLessThan(1e-9);
      expect(Math.abs(J[7] - J[5]) / scale).toBeLessThan(1e-9);
      expect(Math.abs(J[2] - J[6]) / scale).toBeLessThan(1e-9);
      expect(Math.abs(J[3] - J[1]) / scale).toBeLessThan(1e-9);
    }
  });

  it('field value, Jacobian and dual path agree', () => {
    const m = new MagnetSource('M', [0.001, -0.002, 0.003], [0.02, 0.01, 0.005], Br, rotationAxisAngle([0.2, 1, 0.1], 0.9));
    const p: Vec3 = [0.02, 0.015, 0.03];
    const b = m.B(p);
    const bj = m.BJ(p);
    const [dx, dy, dz] = m.Bd(D2.x(p[0]), D2.y(p[1]), D2.z(p[2]));
    for (let i = 0; i < 3; i++) {
      expect(relErr(b[i], bj.B[i])).toBeLessThan(1e-14);
      expect(relErr(b[i], [dx.v, dy.v, dz.v][i])).toBeLessThan(1e-14);
    }
  });
});

describe('field assembly', () => {
  it('superposes linearly', () => {
    const l1 = new LoopSource('a', [0, 0, 0.02], [0, 0, 1], 0.03, 100);
    const l2 = new MagnetSource('b', [0.01, 0, -0.01], [0.01, 0.01, 0.01], 1.3);
    const f = new FieldAssembly([l1, l2]);
    const p: Vec3 = [0.02, 0.01, 0.015];
    const b = f.B(p);
    const b1 = l1.B(p), b2 = l2.B(p);
    for (let i = 0; i < 3; i++) expect(relErr(b[i], b1[i] + b2[i])).toBeLessThan(1e-14);
  });

  it('Earnshaw: ∇²(B²) ≥ 0 everywhere in free space', () => {
    // In a current-free region B² is subharmonic, so it has no interior
    // maximum: a fixed-moment dipole can never sit in a potential minimum.
    const f = new FieldAssembly([
      new LoopSource('a', [0, 0, 0], [0, 0, 1], 0.04, 5000),
      new MagnetSource('b', [0.03, 0.01, -0.02], [0.02, 0.02, 0.01], 1.32, rotationAxisAngle([1, 1, 0], 0.7)),
      new DipoleSource('c', [-0.05, 0.02, 0.01], [0.5, -0.2, 0.9]),
    ]);
    let checked = 0;
    for (let i = 0; i < 60; i++) {
      const p: Vec3 = [Math.sin(i * 1.7) * 0.08, Math.cos(i * 2.3) * 0.07, Math.sin(i * 0.9) * 0.09 + 0.02];
      if (f.isInsideAny(p)) continue;
      const g = f.B2d(p);
      const scale = (g.v / 1e-4) * 2;
      expect(g.laplacian).toBeGreaterThan(-1e-9 * Math.max(scale, 1));
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('uniform and wire sources behave analytically', () => {
    const u = new UniformFieldSource('u', [0, 0, 0.5]);
    expect(u.B()[2]).toBe(0.5);
    const w = new WireSource('w', [0, 0, 0], [0, 0, 1], 1000);
    const b = w.B([0.01, 0, 0]);
    expect(relErr(b[1], (MU0 * 1000) / (2 * Math.PI * 0.01))).toBeLessThan(1e-15);
    expect(Math.abs(b[0])).toBeLessThan(1e-20);
  });
});
