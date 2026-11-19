/**
 * The levitation laboratory view.
 *
 * A bench-scale scene in metres, scaled into view-space so a 12 mm magnet and
 * a 4 m solenoid can share one camera. Everything drawn here is computed from
 * the same `FieldAssembly` the solver uses — the field lines, the |B| slice
 * and the force arrows are the real field, not a decoration.
 *
 * Two things are worth noting about the visuals:
 *
 * • The field-line colour is log|B|, because magnetic fields span decades
 *   over a few centimetres and a linear ramp shows nothing.
 * • The force arrows show the *net* force on the chosen object, gravity
 *   included, so an upward arrow means it would actually rise. Field-gradient
 *   arrows on their own would be prettier and useless.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Apparatus, ApparatusPart } from '../physics/em/apparatus';
import type { FieldAssembly } from '../physics/em/sources';
import type { LevObject } from '../physics/em/levitation';
import type { LevSolution } from '../physics/em/solve';
import { LF, N_LEV_FIELDS } from '../physics/em/dynamics';
import type { Vec3 } from '../physics/vec3';

export type LevShow = 'apparatus' | 'energy';

export interface LevDynRun {
  samples: Float64Array;
  count: number;
  outcome: string;
  duration: number;
}

/* ------------------------------------------------------------- colour maps */

/** perceptual blue→cyan→yellow→white ramp for |B| */
export function fieldColour(t: number, out = new THREE.Color()): THREE.Color {
  const u = Math.min(1, Math.max(0, t));
  const stops: [number, number, number, number][] = [
    [0.0, 0.05, 0.08, 0.3],
    [0.25, 0.1, 0.45, 0.75],
    [0.5, 0.25, 0.85, 0.85],
    [0.75, 0.95, 0.8, 0.35],
    [1.0, 1.0, 0.98, 0.92],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ar, ag, ab] = stops[i];
    const [b, br, bg, bb] = stops[i + 1];
    if (u <= b || i === stops.length - 2) {
      const f = (u - a) / (b - a);
      return out.setRGB(ar + (br - ar) * f, ag + (bg - ag) * f, ab + (bb - ab) * f);
    }
  }
  return out;
}

/** cool→warm ramp for the energy surface */
function energyColour(t: number, out = new THREE.Color()): THREE.Color {
  const u = Math.min(1, Math.max(0, t));
  return out.setRGB(0.15 + 0.85 * u, 0.3 + 0.3 * (1 - Math.abs(u - 0.5) * 2), 0.95 - 0.75 * u);
}

const MAT_COLOUR: Record<string, number> = {
  copper: 0xd98a4a,
  iron: 0x8d939b,
  superconductor: 0x2a3b55,
  conductor: 0xb9c2cc,
  dielectric: 0x4a5668,
  glass: 0x9fd4ff,
  magnetN: 0xd4453c,
  magnetS: 0x3b74d4,
};

/* ----------------------------------------------------------------- the view */

export class LevView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  active = false;

  private apparatusGroup = new THREE.Group();
  private fieldGroup = new THREE.Group();
  private arrowGroup = new THREE.Group();
  private sliceGroup = new THREE.Group();
  private objectGroup = new THREE.Group();
  private energyGroup = new THREE.Group();
  private markerGroup = new THREE.Group();
  private trail: Line2 | null = null;
  private trailMat: LineMaterial | null = null;
  private resolution = new THREE.Vector2(1, 1);

  /** metres → view units */
  private unit = 1;
  private app: Apparatus | null = null;
  private field: FieldAssembly | null = null;
  private levObject: LevObject | null = null;
  private objectMesh: THREE.Object3D | null = null;
  private run: LevDynRun | null = null;
  private show: LevShow = 'apparatus';
  private rotors: THREE.Object3D[] = [];
  private time = 0;
  private spinPhase = 0;
  private objectHeight = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.002, 500);
    this.camera.position.set(2.1, 1.35, 2.6);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.25, 0);
    this.controls.minDistance = 0.3;
    this.controls.maxDistance = 40;

    this.scene.background = new THREE.Color(0x05070d);
    this.scene.fog = new THREE.Fog(0x05070d, 8, 30);

    const hemi = new THREE.HemisphereLight(0x93b8ff, 0x0b1120, 0.55);
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(3, 6, 4);
    const rim = new THREE.DirectionalLight(0x7fb6ff, 0.6);
    rim.position.set(-4, 1.5, -3);
    const fill = new THREE.PointLight(0xffd9a0, 0.5, 20);
    fill.position.set(0, 1.2, 2);
    this.scene.add(hemi, key, rim, fill);

    // bench: a dark reflective plate with a fine grid
    const bench = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 0.04, 96),
      new THREE.MeshStandardMaterial({ color: 0x0c1220, roughness: 0.55, metalness: 0.35 }),
    );
    bench.position.y = -0.021;
    const grid = new THREE.GridHelper(12, 60, 0x1d3356, 0x12203a);
    grid.position.y = 0.001;
    this.scene.add(bench, grid);

    this.scene.add(this.apparatusGroup, this.fieldGroup, this.arrowGroup, this.sliceGroup, this.objectGroup, this.energyGroup, this.markerGroup);
    this.energyGroup.visible = false;
  }

  setSize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.resolution.set(w, h);
    if (this.trailMat) this.trailMat.resolution.copy(this.resolution);
  }

  render(renderer: THREE.WebGLRenderer) {
    renderer.render(this.scene, this.camera);
  }

  update(dt: number) {
    this.controls.update();
    this.spinPhase += dt;
    for (const r of this.rotors) r.rotation.y = this.spinPhase * 40;
  }

  /** metres → view units, for external callers that need the same mapping */
  get scaleFactor() {
    return this.unit;
  }

  private clear(g: THREE.Group) {
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
    }
  }

  /* ------------------------------------------------------------- apparatus */

  /**
   * Replace the field used for the visuals without touching the apparatus.
   * The superconducting mode needs this: the apparatus itself has no sources,
   * and the field worth drawing is the floating magnet's own, plus the image
   * dipole the superconductor's boundary condition creates.
   */
  setDisplayField(field: FieldAssembly) {
    this.field = field;
  }

  setApparatus(app: Apparatus, field: FieldAssembly) {
    this.app = app;
    this.field = field;
    // scale so the interesting region is about 1 view unit across
    this.unit = 1 / Math.max(app.scale, 1e-6);
    this.clear(this.apparatusGroup);
    this.rotors = [];
    for (const part of app.parts) this.apparatusGroup.add(this.buildPart(part, app));
    this.frameApparatus(app);
    this.controls.update();
  }

  /**
   * Fit the camera to everything that matters: the apparatus parts, the
   * working height and the object. A fixed camera distance cannot serve both
   * a 76 mm checkerboard and a 17 mm standing-wave column whose reflector sits
   * at the top, so the framing is derived from the actual bounds.
   */
  private frameApparatus(app: Apparatus) {
    let zMin = 0, zMax = Math.max(app.startHeight, this.objectHeight, app.scale * 0.3), rMax = app.scale * 0.5;
    zMin = Math.min(zMin, this.objectHeight);
    for (const part of app.parts) {
      const halfZ = part.size[2] / 2;
      zMin = Math.min(zMin, part.center[2] - halfZ);
      zMax = Math.max(zMax, part.center[2] + halfZ);
      const reach = Math.hypot(Math.abs(part.center[0]) + part.size[0] / 2, Math.abs(part.center[1]) + part.size[1] / 2);
      rMax = Math.max(rMax, reach, part.size[0]);
    }
    const u = this.unit;
    const midZ = ((zMin + zMax) / 2) * u;
    const radius = Math.max(Math.hypot(rMax, (zMax - zMin) / 2) * u, 0.2) * 1.12;
    const dist = radius / Math.sin((this.camera.fov * Math.PI) / 360);
    this.controls.target.set(0, midZ, 0);
    // a slightly lower eye line: it keeps the gap under a suspended object
    // visible instead of looking down onto the top of the apparatus
    const dir = new THREE.Vector3(0.62, 0.30, 0.72).normalize();
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
  }

  private buildPart(part: ApparatusPart, app: Apparatus): THREE.Object3D {
    const u = this.unit;
    const col = MAT_COLOUR[part.role ?? 'conductor'] ?? 0x9aa6b4;
    const pos = new THREE.Vector3(part.center[0] * u, part.center[2] * u, -part.center[1] * u);
    const g = new THREE.Group();
    g.position.copy(pos);
    if (part.rot) {
      const R = part.rot;
      // the physics frame is (x, y, z up); the scene is (x, z up, −y)
      const m = new THREE.Matrix4().set(
        R[0], R[2], -R[1], 0,
        R[6], R[8], -R[7], 0,
        -R[3], -R[5], R[4], 0,
        0, 0, 0, 1,
      );
      g.quaternion.setFromRotationMatrix(m);
    }

    const steel = (c: number, rough = 0.35, metal = 0.85) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });

    switch (part.kind) {
      case 'magnet': {
        const isRing = part.label === 'ring magnet';
        const isDisc = part.size[0] === part.size[1] && !isRing;
        if (isRing) {
          const shape = new THREE.Shape();
          shape.absarc(0, 0, part.size[0] * u, 0, Math.PI * 2, false);
          const hole = new THREE.Path();
          hole.absarc(0, 0, part.size[1] * u, 0, Math.PI * 2, true);
          shape.holes.push(hole);
          const geo = new THREE.ExtrudeGeometry(shape, { depth: part.size[2] * u, bevelEnabled: false, curveSegments: 64 });
          geo.rotateX(-Math.PI / 2);
          geo.translate(0, (part.size[2] * u) / 2, 0);
          const m = new THREE.Mesh(geo, steel(0xb04a44, 0.4, 0.5));
          g.add(m);
          // the north face on top
          const cap = new THREE.Mesh(
            new THREE.RingGeometry(part.size[1] * u, part.size[0] * u, 64),
            new THREE.MeshStandardMaterial({ color: MAT_COLOUR.magnetN, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide }),
          );
          cap.rotation.x = -Math.PI / 2;
          cap.position.y = (part.size[2] * u) / 2 + 1e-4;
          g.add(cap);
        } else if (isDisc && part.size[2] !== part.size[0]) {
          const r = part.size[0] * u, h = part.size[2] * u;
          const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48), steel(0xa8acb4, 0.3, 0.9));
          g.add(body);
          const top = new THREE.Mesh(new THREE.CircleGeometry(r * 0.98, 48), new THREE.MeshStandardMaterial({ color: part.polarity! >= 0 ? MAT_COLOUR.magnetN : MAT_COLOUR.magnetS, roughness: 0.5 }));
          top.rotation.x = -Math.PI / 2;
          top.position.y = h / 2 + 1e-4;
          g.add(top);
        } else {
          const [sx, sy, sz] = [part.size[0] * u, part.size[1] * u, part.size[2] * u];
          const up = (part.polarity ?? 1) >= 0;
          const north = new THREE.Mesh(new THREE.BoxGeometry(sx, sz / 2, sy), new THREE.MeshStandardMaterial({ color: MAT_COLOUR.magnetN, roughness: 0.45, metalness: 0.4 }));
          const south = new THREE.Mesh(new THREE.BoxGeometry(sx, sz / 2, sy), new THREE.MeshStandardMaterial({ color: MAT_COLOUR.magnetS, roughness: 0.45, metalness: 0.4 }));
          north.position.y = up ? sz / 4 : -sz / 4;
          south.position.y = up ? -sz / 4 : sz / 4;
          g.add(north, south);
        }
        break;
      }
      case 'coil': {
        const r = part.size[0] * u;
        const t = Math.max(part.size[1] * u, r * 0.06);
        const m = new THREE.Mesh(new THREE.TorusGeometry(r, t, 20, 72), steel(MAT_COLOUR.copper, 0.4, 0.7));
        m.rotation.x = Math.PI / 2;
        g.add(m);
        break;
      }
      case 'solenoid': {
        const r = part.size[0] * u, ro = part.size[1] * u, len = part.size[2] * u;
        const mat = steel(MAT_COLOUR.copper, 0.45, 0.65);
        const outer = new THREE.Mesh(new THREE.CylinderGeometry(ro, ro, len, 64, 1, true), mat);
        const inner = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 64, 1, true), new THREE.MeshStandardMaterial({ color: 0x1b2433, roughness: 0.8, side: THREE.BackSide }));
        g.add(outer, inner);
        // winding bands, so the coil reads as a coil
        const turns = Math.min(40, Math.max(8, Math.round(len / (ro * 0.12))));
        for (let i = 0; i < turns; i++) {
          const band = new THREE.Mesh(new THREE.TorusGeometry((r + ro) / 2, (ro - r) / 2.4, 8, 48), steel(0xc07a3c, 0.5, 0.6));
          band.rotation.x = Math.PI / 2;
          band.position.y = -len / 2 + ((i + 0.5) * len) / turns;
          g.add(band);
        }
        break;
      }
      case 'plate':
      case 'electrode':
      case 'reflector': {
        const isRound = part.kind !== 'electrode' && part.size[0] === part.size[1];
        const mat = part.role === 'superconductor'
          ? new THREE.MeshStandardMaterial({ color: MAT_COLOUR.superconductor, roughness: 0.25, metalness: 0.5, emissive: 0x0a2240, emissiveIntensity: 0.6 })
          : steel(col, 0.3, 0.9);
        const m = isRound
          ? new THREE.Mesh(new THREE.CylinderGeometry(part.size[0] * u, part.size[0] * u, part.size[2] * u, 64), mat)
          : new THREE.Mesh(new THREE.BoxGeometry(part.size[0] * u, part.size[2] * u, part.size[1] * u), mat);
        g.add(m);
        break;
      }
      case 'yoke': {
        const [sx, sy, sz] = [part.size[0] * u, part.size[1] * u, part.size[2] * u];
        const mat = new THREE.MeshStandardMaterial({ color: MAT_COLOUR.iron, roughness: 0.45, metalness: 0.75, emissive: 0x11161f, emissiveIntensity: 1 });
        const base = new THREE.Mesh(new THREE.BoxGeometry(sx, sz * 0.35, sy), mat);
        base.position.y = -sz * 0.32;
        const legL = new THREE.Mesh(new THREE.BoxGeometry(sx * 0.22, sz * 0.8, sy), mat);
        legL.position.set(-sx * 0.39, sz * 0.08, 0);
        const legR = legL.clone();
        legR.position.x = sx * 0.39;
        const winding = new THREE.Mesh(new THREE.TorusGeometry(sx * 0.3, sx * 0.12, 12, 40), steel(MAT_COLOUR.copper, 0.5, 0.6));
        winding.rotation.x = Math.PI / 2;
        winding.position.y = sz * 0.05;
        g.add(base, legL, legR, winding);
        break;
      }
      case 'transducer': {
        const r = part.size[0] * u, h = part.size[2] * u;
        const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, h, 48), steel(0x6b7585, 0.5, 0.6));
        const face = new THREE.Mesh(new THREE.CircleGeometry(r * 0.92, 48), new THREE.MeshStandardMaterial({ color: 0xcfd8e3, roughness: 0.3, metalness: 0.8 }));
        face.rotation.x = -Math.PI / 2;
        face.position.y = h / 2 + 1e-4;
        g.add(body, face);
        break;
      }
      case 'laser': {
        const r = part.size[0] * u;
        const objective = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.5, r, part.size[2] * u, 48), steel(0x2d3542, 0.4, 0.8));
        g.add(objective);
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(r * 0.02, r * 0.5, 2.2, 32, 1, true),
          new THREE.MeshBasicMaterial({ color: 0x66ff99, transparent: true, opacity: 0.16, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
        );
        beam.position.y = 1.1;
        const beam2 = beam.clone();
        beam2.scale.y = -1;
        beam2.position.y = -1.1;
        g.add(beam, beam2);
        break;
      }
      case 'rotor': {
        const r = part.size[0] * u;
        const disc = new THREE.Group();
        for (let i = 0; i < 2; i++) {
          const blade = new THREE.Mesh(
            new THREE.BoxGeometry(r * 2, r * 0.05, r * 0.22),
            new THREE.MeshStandardMaterial({ color: 0x2b3444, roughness: 0.5, metalness: 0.4 }),
          );
          blade.rotation.y = (i * Math.PI) / 2;
          disc.add(blade);
        }
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.12, r * 0.14, 24), steel(0x4a5668));
        disc.add(hub);
        this.rotors.push(disc);
        g.add(disc);
        break;
      }
      case 'envelope': {
        const r = part.size[0] * u;
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(r, 48, 32),
          new THREE.MeshPhysicalMaterial({ color: 0xff6b6b, roughness: 0.25, metalness: 0, transparent: true, opacity: 0.55, clearcoat: 1 }),
        );
        m.scale.y = 1.15;
        g.add(m);
        break;
      }
    }
    void app;
    return g;
  }

  /* ------------------------------------------------------------ the object */

  setObject(o: LevObject, colour = 0x7ce0ff) {
    this.levObject = o;
    this.clear(this.objectGroup);
    const u = this.unit;
    const s = Math.max(o.size * u, 0.012);
    const t = Math.max(o.thickness * u, 0.004);
    const mat = new THREE.MeshPhysicalMaterial({
      color: colour, roughness: 0.3, metalness: 0.45, clearcoat: 0.6,
      emissive: new THREE.Color(colour).multiplyScalar(0.12),
    });
    let mesh: THREE.Object3D;
    switch (o.shape) {
      case 'sphere': mesh = new THREE.Mesh(new THREE.SphereGeometry(s / 2, 48, 32), mat); break;
      case 'cube': mesh = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), mat); break;
      case 'disk':
      case 'cylinder': mesh = new THREE.Mesh(new THREE.CylinderGeometry(s / 2, s / 2, t, 48), mat); break;
      case 'plate': mesh = new THREE.Mesh(new THREE.BoxGeometry(s, t, s), mat); break;
    }
    const holder = new THREE.Group();
    holder.add(mesh);
    // A faint halo makes a small object findable in a big scene, but on a
    // large one it just washes the apparatus out, so it is only added when
    // the object is actually small in view space.
    if (Math.max(s, t) < 0.09) {
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(s, t) * 2.2, 24, 16),
        new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      holder.add(halo);
    }
    this.objectGroup.add(holder);
    this.objectMesh = holder;
  }

  /** place the object at a height in metres, upright */
  setObjectHeight(z: number) {
    this.objectHeight = z;
    if (this.objectMesh) this.objectMesh.position.set(0, z * this.unit, 0);
  }

  /**
   * Re-fit the camera now that the solved height is known. An object can
   * float well outside the apparatus — an induction-levitated disc sits two
   * coil radii up — so the framing has to be revisited once it is placed.
   */
  refit() {
    if (this.app && this.show === 'apparatus') this.frameApparatus(this.app);
  }

  /* -------------------------------------------------------------- the field */

  /**
   * Trace magnetic field lines by integrating dr/ds = B̂ with RK4 in both
   * directions from a set of seeds. Each line is coloured by log|B| along its
   * own length, so the structure stays visible across the decades of field
   * strength a magnet spans over a few centimetres.
   */
  setFieldLines(enabled: boolean, seeds?: Vec3[], zFloor?: number) {
    this.clear(this.fieldGroup);
    if (!enabled || !this.field || !this.app || this.field.sources.length === 0) return;
    const app = this.app, field = this.field, u = this.unit;
    const floor = zFloor ?? -app.scale * 1.2;
    const box = app.scale * 1.7;
    const step = app.scale / 90;
    const list = seeds ?? this.defaultSeeds(app);
    const bAt = (p: Vec3) => field.B(p);
    const unitB = (p: Vec3): Vec3 | null => {
      const b = bAt(p);
      const n = Math.hypot(b[0], b[1], b[2]);
      if (!Number.isFinite(n) || n < 1e-12) return null;
      return [b[0] / n, b[1] / n, b[2] / n];
    };
    const magnitudes: number[] = [];
    const polylines: { pts: number[]; mags: number[] }[] = [];
    for (const seed of list) {
      for (const dir of [1, -1]) {
        const pts: number[] = [];
        const mags: number[] = [];
        let p: Vec3 = [...seed] as Vec3;
        for (let i = 0; i < 520; i++) {
          const b = bAt(p);
          const mag = Math.hypot(b[0], b[1], b[2]);
          if (!Number.isFinite(mag) || mag < 1e-12) break;
          pts.push(p[0] * u, p[2] * u, -p[1] * u);
          mags.push(mag);
          magnitudes.push(mag);
          // RK4 on the unit field
          const k1 = unitB(p);
          if (!k1) break;
          const p2: Vec3 = [p[0] + (dir * step * k1[0]) / 2, p[1] + (dir * step * k1[1]) / 2, p[2] + (dir * step * k1[2]) / 2];
          const k2 = unitB(p2) ?? k1;
          const p3: Vec3 = [p[0] + (dir * step * k2[0]) / 2, p[1] + (dir * step * k2[1]) / 2, p[2] + (dir * step * k2[2]) / 2];
          const k3 = unitB(p3) ?? k2;
          const p4: Vec3 = [p[0] + dir * step * k3[0], p[1] + dir * step * k3[1], p[2] + dir * step * k3[2]];
          const k4 = unitB(p4) ?? k3;
          const next: Vec3 = [
            p[0] + ((dir * step) / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
            p[1] + ((dir * step) / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
            p[2] + ((dir * step) / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
          ];
          if (Math.abs(next[0]) > box || Math.abs(next[1]) > box || Math.abs(next[2]) > box * 1.3) break;
          if (next[2] < floor) break;
          if (field.isInsideAny(next)) break;
          p = next;
        }
        if (pts.length >= 6) polylines.push({ pts, mags });
      }
    }
    if (!magnitudes.length) return;
    magnitudes.sort((a, b) => a - b);
    const lo = Math.log10(Math.max(magnitudes[Math.floor(magnitudes.length * 0.02)], 1e-9));
    const hi = Math.log10(Math.max(magnitudes[Math.floor(magnitudes.length * 0.98)], 1e-8));
    const span = Math.max(hi - lo, 0.3);
    const c = new THREE.Color();
    for (const line of polylines) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(line.pts, 3));
      const colours = new Float32Array(line.mags.length * 3);
      for (let i = 0; i < line.mags.length; i++) {
        fieldColour((Math.log10(line.mags[i]) - lo) / span, c);
        colours[i * 3] = c.r;
        colours[i * 3 + 1] = c.g;
        colours[i * 3 + 2] = c.b;
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
      this.fieldGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false,
      })));
    }
  }

  /** seeds chosen from the apparatus geometry, so lines start where the flux is */
  private defaultSeeds(app: Apparatus): Vec3[] {
    const seeds: Vec3[] = [];
    const s = app.scale;
    for (const part of app.parts) {
      if (part.kind !== 'magnet' && part.kind !== 'coil' && part.kind !== 'solenoid') continue;
      const r = Math.max(part.size[0], part.size[2]) * 0.55;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        seeds.push([part.center[0] + r * Math.cos(a) * 0.9, part.center[1] + r * Math.sin(a) * 0.9, part.center[2] + part.size[2] * 0.62]);
      }
    }
    // seeds in the working volume: a close ring where the object sits, and a
    // wider one to pick up the return flux
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      seeds.push([s * 0.18 * Math.cos(a), s * 0.18 * Math.sin(a), s * 0.06]);
      seeds.push([s * 0.4 * Math.cos(a), s * 0.4 * Math.sin(a), s * 0.2]);
      seeds.push([s * 0.75 * Math.cos(a), s * 0.75 * Math.sin(a), s * 0.05]);
    }
    return seeds.slice(0, 120);
  }

  /**
   * A vertical slice of |B| through y = 0, drawn as a texture sampled from the
   * real field. This is the picture that makes a gradient legible: field lines
   * show direction, the slice shows where the energy actually lives.
   */
  setFieldSlice(enabled: boolean) {
    this.clear(this.sliceGroup);
    if (!enabled || !this.field || !this.app || this.field.sources.length === 0) return;
    const app = this.app, field = this.field;
    const N = 192;
    const half = app.scale * 0.72;
    const z0 = -app.scale * 0.05, z1 = app.scale * 0.95;
    const data = new Uint8Array(N * N * 4);
    const vals = new Float64Array(N * N);
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < N; j++) {
      const z = z0 + ((z1 - z0) * j) / (N - 1);
      for (let i = 0; i < N; i++) {
        const x = -half + (2 * half * i) / (N - 1);
        const p: Vec3 = [x, 0, z];
        const v = field.isInsideAny(p) ? NaN : Math.hypot(...field.B(p));
        vals[j * N + i] = v;
        if (Number.isFinite(v) && v > 0) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
      }
    }
    if (!Number.isFinite(lo) || hi <= 0) return;
    const l0 = Math.log10(Math.max(lo, hi * 1e-5)), l1 = Math.log10(hi);
    const c = new THREE.Color();
    for (let k = 0; k < N * N; k++) {
      const v = vals[k];
      if (!Number.isFinite(v) || v <= 0) {
        data[k * 4 + 3] = 0;
        continue;
      }
      const t = (Math.log10(v) - l0) / Math.max(l1 - l0, 0.3);
      fieldColour(t, c);
      data[k * 4] = Math.round(c.r * 255);
      data[k * 4 + 1] = Math.round(c.g * 255);
      data[k * 4 + 2] = Math.round(c.b * 255);
      // fade the weak field out entirely, so the slice reads as a glow around
      // the magnets rather than a bright rectangle across the scene
      data[k * 4 + 3] = Math.round(210 * Math.pow(Math.min(1, Math.max(0, t)), 2.6));
    }
    const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    const u = this.unit;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * half * u, (z1 - z0) * u),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.9, alphaTest: 0.04 }),
    );
    plane.position.set(0, ((z0 + z1) / 2) * u, 0);
    this.sliceGroup.add(plane);
  }

  /**
   * Net-force arrows on a grid in the y = 0 plane: the force the chosen
   * object would feel there, gravity included. Green points up (it would
   * rise), red points down (it would fall), and length is log-scaled.
   */
  setForceArrows(enabled: boolean, forceAt: ((p: Vec3) => Vec3) | null) {
    this.clear(this.arrowGroup);
    if (!enabled || !forceAt || !this.app) return;
    const app = this.app, u = this.unit;
    const n = 9;
    const half = app.scale * 0.8;
    const z0 = app.scale * 0.03, z1 = app.scale * 1.25;
    const samples: { p: Vec3; f: Vec3; mag: number }[] = [];
    for (let j = 0; j < n; j++) {
      const z = z0 + ((z1 - z0) * j) / (n - 1);
      for (let i = 0; i < n; i++) {
        const x = -half + (2 * half * i) / (n - 1);
        const p: Vec3 = [x, 0, z];
        if (this.field?.isInsideAny(p)) continue;
        const f = forceAt(p);
        const mag = Math.hypot(f[0], f[1], f[2]);
        if (!Number.isFinite(mag) || mag <= 0) continue;
        samples.push({ p, f, mag });
      }
    }
    if (!samples.length) return;
    const mags = samples.map((s) => s.mag).sort((a, b) => a - b);
    const ref = mags[Math.floor(mags.length * 0.9)] || 1;
    const geo = new THREE.ConeGeometry(0.012, 0.07, 8);
    geo.translate(0, 0.035, 0);
    const up = new THREE.MeshBasicMaterial({ color: 0x5ef08f, transparent: true, opacity: 0.8 });
    const down = new THREE.MeshBasicMaterial({ color: 0xf0685e, transparent: true, opacity: 0.7 });
    const meshUp = new THREE.InstancedMesh(geo, up, samples.length);
    const meshDown = new THREE.InstancedMesh(geo, down, samples.length);
    let nu = 0, nd = 0;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const dirScene = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const spacing = (2 * half * u) / (n - 1);
    for (const s of samples) {
      const len = Math.min(1.25, 0.3 + 0.7 * Math.log10(1 + (9 * s.mag) / ref)) * spacing * 0.9;
      dirScene.set(s.f[0], s.f[2], -s.f[1]).normalize();
      q.setFromUnitVectors(yAxis, dirScene);
      m4.compose(new THREE.Vector3(s.p[0] * u, s.p[2] * u, -s.p[1] * u), q, new THREE.Vector3(1, len / 0.07, 1));
      if (s.f[2] > 0) meshUp.setMatrixAt(nu++, m4);
      else meshDown.setMatrixAt(nd++, m4);
    }
    meshUp.count = nu;
    meshDown.count = nd;
    meshUp.instanceMatrix.needsUpdate = true;
    meshDown.instanceMatrix.needsUpdate = true;
    this.arrowGroup.add(meshUp, meshDown);
  }

  /**
   * The standing wave in an acoustic levitator: discs at the pressure nodes,
   * where particles collect, and a column shaded by the pressure amplitude.
   * The node spacing is λ/2 and is drawn from the real wavelength, so the
   * picture and the number in the report cannot disagree.
   */
  setAcousticField(enabled: boolean, p: { cavity: number; wavelength: number; aperture: number } | null) {
    this.clear(this.sliceGroup);
    if (!enabled || !p) return;
    const u = this.unit;
    const r = p.aperture * 0.46 * u;
    const nodes = Math.max(1, Math.round((2 * p.cavity) / p.wavelength));
    for (let i = 1; i < nodes; i++) {
      const z = (i * p.wavelength) / 2;
      const disc = new THREE.Mesh(
        new THREE.CircleGeometry(r, 48),
        new THREE.MeshBasicMaterial({ color: 0x7ce0ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
      );
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = z * u;
      this.sliceGroup.add(disc);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r * 0.97, r, 64),
        new THREE.MeshBasicMaterial({ color: 0xaef0ff, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = z * u;
      this.sliceGroup.add(ring);
    }
    // the standing wave itself, as a shaded column
    const N = 128;
    const data = new Uint8Array(N * 4);
    const k = (2 * Math.PI) / p.wavelength;
    const c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const z = (p.cavity * i) / (N - 1);
      const amp = Math.abs(Math.cos(k * z));
      fieldColour(amp, c);
      data[i * 4] = Math.round(c.r * 255);
      data[i * 4 + 1] = Math.round(c.g * 255);
      data[i * 4 + 2] = Math.round(c.b * 255);
      data[i * 4 + 3] = Math.round(70 * amp + 10);
    }
    const tex = new THREE.DataTexture(data, 1, N, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    const column = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.92, r * 0.92, p.cavity * u, 48, 1, true),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    column.position.y = (p.cavity / 2) * u;
    this.sliceGroup.add(column);
  }

  /* ----------------------------------------------------- energy landscape */

  /**
   * The energy landscape as a rotatable surface: height is the potential
   * energy U(x, z), so a minimum is a basin and a saddle is a mountain pass.
   * The marked point is the equilibrium, and the arrow is the direction the
   * object escapes along when it is a saddle rather than a basin.
   */
  setEnergy(solution: LevSolution | null) {
    this.clear(this.energyGroup);
    this.clear(this.markerGroup);
    if (!solution?.landscape) return;
    const L = solution.landscape;
    const { nx, nz, U } = L;
    const finite = Array.from(U).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (finite.length < 10) return;
    /*
     * The potential near a magnet is orders of magnitude larger than the
     * structure around the equilibrium, so a linear height map renders the
     * interesting part as a flat sheet with one spike. Instead the surface is
     * centred on the energy at the equilibrium and passed through a tanh with
     * a robust scale — the shape near the trap is preserved and the extremes
     * are compressed rather than clipped. Heights are therefore qualitative;
     * the numbers that matter are the stiffnesses in the report.
     */
    const median = finite[Math.floor(finite.length / 2)];
    let centre = median;
    if (solution.equilibriumHeight !== null) {
      const j = Math.round(Math.min(nz - 1, Math.max(0, ((solution.equilibriumHeight - L.z0) / Math.max(L.z1 - L.z0, 1e-30)) * (nz - 1))));
      const v = U[j * nx + Math.round((nx - 1) / 2)];
      if (Number.isFinite(v)) centre = v;
    }
    const devs = finite.map((v) => Math.abs(v - centre)).sort((a, b) => a - b);
    const scale = Math.max(devs[Math.floor(devs.length * 0.35)], 1e-30);
    const map = (v: number) => (Number.isFinite(v) ? 0.5 + 0.5 * Math.tanh((v - centre) / scale) : 1);
    const geo = new THREE.PlaneGeometry(2.4, 2.4, nx - 1, nz - 1);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colours = new Float32Array(nx * nz * 3);
    const c = new THREE.Color();
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = j * nx + i;
        const t = map(U[idx]);
        pos.setZ(idx, t * 0.9);
        energyColour(t, c);
        colours[idx * 3] = c.r;
        colours[idx * 3 + 1] = c.g;
        colours[idx * 3 + 2] = c.b;
      }
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
    geo.rotateX(-Math.PI / 2);
    geo.computeVertexNormals();
    const surface = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide, flatShading: false,
    }));
    surface.position.y = 0.35;
    const wire = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.08 }));
    wire.position.y = 0.3505;
    this.energyGroup.add(surface, wire);

    // mark the equilibrium
    if (solution.equilibriumHeight !== null) {
      const fz = (solution.equilibriumHeight - L.z0) / Math.max(L.z1 - L.z0, 1e-30);
      const x = 0;
      const idx = Math.round(Math.min(nz - 1, Math.max(0, fz * (nz - 1)))) * nx + Math.round((nx - 1) / 2);
      const t = map(U[idx]);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.035, 24, 16),
        new THREE.MeshStandardMaterial({ color: 0xffc46b, emissive: 0x7a4a00, emissiveIntensity: 1.2, roughness: 0.3 }),
      );
      marker.position.set(x, 0.35 + t * 0.9 + 0.035, (fz - 0.5) * 2.4);
      this.markerGroup.add(marker);
      const stable = solution.stability?.stable ?? false;
      if (!stable) {
        // an arrow along the softest direction: how it escapes
        const horizontal = (solution.stability?.stiffness[0] ?? -1) < 0;
        const dir = horizontal ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, -1, 0);
        const arrow = new THREE.ArrowHelper(dir, marker.position, 0.45, 0xff5c5c, 0.1, 0.06);
        this.markerGroup.add(arrow);
        const arrow2 = new THREE.ArrowHelper(dir.clone().negate(), marker.position, 0.45, 0xff5c5c, 0.1, 0.06);
        if (horizontal) this.markerGroup.add(arrow2);
      }
    }
  }

  setShow(show: LevShow) {
    this.show = show;
    const apparatus = show === 'apparatus';
    this.apparatusGroup.visible = apparatus;
    this.fieldGroup.visible = apparatus;
    this.sliceGroup.visible = apparatus;
    this.arrowGroup.visible = apparatus;
    this.objectGroup.visible = apparatus;
    this.energyGroup.visible = !apparatus;
    this.markerGroup.visible = !apparatus;
    if (this.trail) this.trail.visible = apparatus;
    if (!apparatus) {
      // frame the surface from its bounding sphere rather than a fixed
      // position, so the whole landscape fits whatever its shape
      const target = new THREE.Vector3(0, 0.78, 0);
      const radius = 1.85;
      const dist = radius / Math.sin((this.camera.fov * Math.PI) / 360);
      const dir = new THREE.Vector3(0.52, 0.64, 0.57).normalize();
      this.controls.target.copy(target);
      this.camera.position.copy(target).addScaledVector(dir, dist);
    } else if (this.app) {
      this.frameApparatus(this.app);
    }
    this.controls.update();
  }

  get showing() {
    return this.show;
  }

  /* --------------------------------------------------------- the 6-DOF run */

  setRun(run: LevDynRun | null) {
    this.run = run;
    if (this.trail) {
      this.fieldGroup.parent?.remove(this.trail);
      this.scene.remove(this.trail);
      this.trail.geometry.dispose();
      this.trailMat?.dispose();
      this.trail = null;
      this.trailMat = null;
    }
    if (!run || run.count < 2) return;
    const u = this.unit;
    const pts: number[] = [];
    for (let i = 0; i < run.count; i++) {
      const o = i * N_LEV_FIELDS;
      pts.push(run.samples[o + LF.x] * u, run.samples[o + LF.z] * u, -run.samples[o + LF.y] * u);
    }
    const geo = new LineGeometry();
    geo.setPositions(pts);
    this.trailMat = new LineMaterial({ color: 0xffc46b, linewidth: 1.6, transparent: true, opacity: 0.8 });
    this.trailMat.resolution.copy(this.resolution);
    this.trail = new Line2(geo, this.trailMat);
    this.trail.computeLineDistances();
    this.trail.visible = this.show === 'apparatus';
    this.scene.add(this.trail);
  }

  get duration() {
    return this.run?.duration ?? 0;
  }

  /** place the object from the run at time t, interpolating between samples */
  setTime(t: number) {
    this.time = t;
    const run = this.run;
    if (!run || !this.objectMesh || run.count < 1) return;
    const u = this.unit;
    let i = 0;
    while (i < run.count - 1 && run.samples[(i + 1) * N_LEV_FIELDS + LF.t] <= t) i++;
    const a = i * N_LEV_FIELDS;
    const b = Math.min(i + 1, run.count - 1) * N_LEV_FIELDS;
    const ta = run.samples[a + LF.t], tb = run.samples[b + LF.t];
    const f = tb > ta ? Math.min(1, Math.max(0, (t - ta) / (tb - ta))) : 0;
    const lerp = (k: number) => run.samples[a + k] + f * (run.samples[b + k] - run.samples[a + k]);
    this.objectMesh.position.set(lerp(LF.x) * u, lerp(LF.z) * u, -lerp(LF.y) * u);
    const q = new THREE.Quaternion(lerp(LF.q1), lerp(LF.q3), -lerp(LF.q2), lerp(LF.q0)).normalize();
    this.objectMesh.quaternion.copy(q);
  }

  sampleAt(t: number): Float64Array | null {
    const run = this.run;
    if (!run || run.count < 1) return null;
    let i = 0;
    while (i < run.count - 1 && run.samples[(i + 1) * N_LEV_FIELDS + LF.t] <= t) i++;
    return run.samples.subarray(i * N_LEV_FIELDS, (i + 1) * N_LEV_FIELDS);
  }

  get currentTime() {
    return this.time;
  }

  /** the object currently shown, if any */
  get shownObject() {
    return this.levObject;
  }
}
