/**
 * Procedural 3-D models for the projectile presets. Every model is built at its
 * true physical size (metres); the local view may scale it up for visibility.
 */
import * as THREE from 'three';
import type { ObjectSpec } from '../physics/objects';

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

const baseballTex = () =>
  canvasTex(1024, 512, (g) => {
    g.fillStyle = '#f4f0e6';
    g.fillRect(0, 0, 1024, 512);
    g.strokeStyle = '#c0262d';
    g.lineWidth = 6;
    for (const off of [0, 512]) {
      g.beginPath();
      for (let x = 0; x <= 512; x += 4) {
        const y = 256 + Math.sin((x / 512) * Math.PI * 2) * 150;
        x === 0 ? g.moveTo(x + off, y) : g.lineTo(x + off, y);
      }
      g.stroke();
      g.setLineDash([3, 9]);
      for (const d of [-14, 14]) {
        g.beginPath();
        for (let x = 0; x <= 512; x += 4) {
          const y = 256 + Math.sin((x / 512) * Math.PI * 2) * 150 + d;
          x === 0 ? g.moveTo(x + off, y) : g.lineTo(x + off, y);
        }
        g.stroke();
      }
      g.setLineDash([]);
    }
  });

const footballTex = () =>
  canvasTex(1024, 512, (g) => {
    g.fillStyle = '#fafafa';
    g.fillRect(0, 0, 1024, 512);
    g.fillStyle = '#111';
    for (let r = 0; r < 5; r++)
      for (let c = 0; c < 8; c++) {
        const x = c * 128 + (r % 2) * 64 + 32, y = r * 110 + 40;
        g.beginPath();
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
          g.lineTo(x + Math.cos(a) * 30, y + Math.sin(a) * 26);
        }
        g.fill();
      }
  });

const basketballTex = () =>
  canvasTex(1024, 512, (g) => {
    g.fillStyle = '#d4631f';
    g.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.12})`;
      g.fillRect(Math.random() * 1024, Math.random() * 512, 2, 2);
    }
    g.strokeStyle = '#1b0d05';
    g.lineWidth = 7;
    g.beginPath(); g.moveTo(0, 256); g.lineTo(1024, 256); g.stroke();
    for (const x of [256, 768]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 512); g.stroke(); }
    for (const x of [0, 512, 1024]) { g.beginPath(); g.ellipse(x, 256, 120, 256, 0, 0, Math.PI * 2); g.stroke(); }
  });

const tennisTex = () =>
  canvasTex(512, 256, (g) => {
    g.fillStyle = '#d6f046';
    g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 9000; i++) {
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.15})`;
      g.fillRect(Math.random() * 512, Math.random() * 256, 1.5, 1.5);
    }
    g.strokeStyle = '#ffffff';
    g.lineWidth = 7;
    g.beginPath();
    for (let x = 0; x <= 512; x += 3) g.lineTo(x, 128 + Math.sin((x / 512) * Math.PI * 4) * 70);
    g.stroke();
  });

const rockTex = (base: string) =>
  canvasTex(512, 256, (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 12000; i++) {
      const v = Math.random();
      g.fillStyle = `rgba(${v > 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.18})`;
      g.fillRect(Math.random() * 512, Math.random() * 256, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
  });

const dimpleNormal = () =>
  canvasTex(512, 256, (g) => {
    g.fillStyle = 'rgb(128,128,255)';
    g.fillRect(0, 0, 512, 256);
    for (let y = 8; y < 256; y += 14)
      for (let x = (y / 14) % 2 ? 7 : 0; x < 512; x += 14) {
        const grd = g.createRadialGradient(x, y, 0, x, y, 6);
        grd.addColorStop(0, 'rgb(128,128,230)');
        grd.addColorStop(1, 'rgb(128,128,255)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
      }
  });

const featherTex = () =>
  canvasTex(128, 512, (g) => {
    g.clearRect(0, 0, 128, 512);
    g.strokeStyle = '#efe9dc';
    for (let y = 40; y < 500; y += 3) {
      const w = Math.sin(((y - 30) / 480) * Math.PI) * 58;
      g.globalAlpha = 0.85;
      g.lineWidth = 1.4;
      g.beginPath(); g.moveTo(64, y); g.quadraticCurveTo(64 - w * 0.6, y - 10, 64 - w, y - 26); g.stroke();
      g.beginPath(); g.moveTo(64, y); g.quadraticCurveTo(64 + w * 0.6, y - 10, 64 + w, y - 26); g.stroke();
    }
    g.globalAlpha = 1;
    g.strokeStyle = '#d8cfbd';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(64, 10); g.lineTo(64, 510); g.stroke();
  });

function skydiver(spec: ObjectSpec, headDown: boolean): THREE.Group {
  const g = new THREE.Group();
  const suit = new THREE.MeshStandardMaterial({ color: spec.id === 'stratos' ? 0xf2f2f2 : 0xff5a36, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1d24, roughness: 0.5 });
  const visor = new THREE.MeshStandardMaterial({ color: 0xc9a227, metalness: 0.9, roughness: 0.15 });
  const limb = (len: number, r: number, m: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), m);
    mesh.castShadow = true;
    return mesh;
  };
  const torso = limb(0.55, 0.17, suit);
  torso.rotation.x = Math.PI / 2;
  g.add(torso);
  const head = new THREE.Mesh(new THREE.SphereGeometry(spec.id === 'stratos' ? 0.17 : 0.12, 24, 16), spec.id === 'stratos' ? suit : dark);
  head.position.set(0, 0.02, -0.5);
  g.add(head);
  if (spec.id === 'stratos') {
    const v = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 12, 0, Math.PI), visor);
    v.position.set(0, -0.06, -0.56);
    v.rotation.x = Math.PI / 2;
    g.add(v);
  }
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.45), dark);
  pack.position.set(0, 0.17, -0.02);
  g.add(pack);
  for (const s of [-1, 1]) {
    const arm = limb(0.5, 0.055, suit);
    arm.position.set(s * 0.36, 0, -0.38);
    arm.rotation.z = s * 1.1;
    arm.rotation.x = Math.PI / 2;
    g.add(arm);
    const leg = limb(0.7, 0.075, suit);
    leg.position.set(s * 0.17, 0.06, 0.55);
    leg.rotation.x = Math.PI / 2 - 0.35;
    leg.rotation.z = s * 0.25;
    g.add(leg);
  }
  // belly-to-earth: face down (−Y), head forward (−Z)
  if (headDown) g.rotation.x = -Math.PI / 2;
  return g;
}

function capsule(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(1.95, 3.2, 48, 1, true), new THREE.MeshStandardMaterial({ color: 0xd9dce3, metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide }));
  body.position.y = 1.6;
  const shield = new THREE.Mesh(new THREE.SphereGeometry(4.7, 48, 16, 0, Math.PI * 2, Math.PI - 0.43, 0.43), new THREE.MeshStandardMaterial({ color: 0x3a2a1f, roughness: 0.9 }));
  shield.position.y = 4.7 - 0.38;
  g.add(body, shield);
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}

/** Build the 3-D model for a preset (true size, centred at its centre of mass). */
export function buildObjectModel(spec: ObjectSpec): THREE.Object3D {
  const r = spec.length / 2;
  const sphere = (mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), mat);
    m.castShadow = true;
    return m;
  };
  switch (spec.id) {
    case 'baseball': return sphere(new THREE.MeshStandardMaterial({ map: baseballTex(), roughness: 0.75 }));
    case 'golf': return sphere(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, normalMap: dimpleNormal(), normalScale: new THREE.Vector2(1.2, 1.2) }));
    case 'football': return sphere(new THREE.MeshStandardMaterial({ map: footballTex(), roughness: 0.45 }));
    case 'basketball': return sphere(new THREE.MeshStandardMaterial({ map: basketballTex(), roughness: 0.85 }));
    case 'tennis': return sphere(new THREE.MeshStandardMaterial({ map: tennisTex(), roughness: 1 }));
    case 'bowling': return sphere(new THREE.MeshPhysicalMaterial({ color: 0x1d3b8f, roughness: 0.08, clearcoat: 1, metalness: 0.1 }));
    case 'cannonball': return sphere(new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.55, metalness: 0.8 }));
    case 'leadshot': return sphere(new THREE.MeshStandardMaterial({ color: 0x6d7178, roughness: 0.4, metalness: 0.9 }));
    case 'raindrop': return sphere(new THREE.MeshPhysicalMaterial({ color: 0xbfe8ff, roughness: 0, transmission: 0.95, thickness: 0.002, ior: 1.333, transparent: true, opacity: 0.9 }));
    case 'hail': return sphere(new THREE.MeshPhysicalMaterial({ color: 0xe8f6ff, roughness: 0.3, transmission: 0.6, thickness: 0.05, ior: 1.31 }));
    case 'meteoroid': case 'stonemeteor': {
      const geo = new THREE.IcosahedronGeometry(r, 4);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, i);
        v.multiplyScalar(1 + (Math.sin(v.x * 37 / r) * Math.cos(v.y * 23 / r) + Math.sin(v.z * 51 / r)) * 0.06);
        p.setXYZ(i, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: rockTex(spec.id === 'meteoroid' ? '#4a4038' : '#6b5d50'), roughness: 0.9, metalness: spec.id === 'meteoroid' ? 0.6 : 0.1 }));
      m.castShadow = true;
      return m;
    }
    case 'rock': {
      const geo = new THREE.DodecahedronGeometry(spec.length * 0.62, 1);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (1 + Math.sin(i * 7.1) * 0.12), p.getY(i) * (1 + Math.cos(i * 3.3) * 0.12), p.getZ(i));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: rockTex('#8a8580'), roughness: 0.95, flatShading: true }));
      m.castShadow = true;
      return m;
    }
    case 'coin': {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.00175, 48), new THREE.MeshStandardMaterial({ color: 0xd0d3d8, metalness: 1, roughness: 0.25 }));
      m.castShadow = true;
      return m;
    }
    case 'feather': {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.12), new THREE.MeshStandardMaterial({ map: featherTex(), transparent: true, alphaTest: 0.15, side: THREE.DoubleSide, roughness: 1 }));
      m.rotation.x = -Math.PI / 2.4;
      return m;
    }
    case 'skydiver': case 'stratos': return skydiver(spec, false);
    case 'headdown': return skydiver(spec, true);
    case 'capsule': return capsule();
    default: {
      // custom shapes
      const mat = new THREE.MeshStandardMaterial({ color: 0x5cc8ff, roughness: 0.4, metalness: 0.3 });
      let geo: THREE.BufferGeometry;
      if (spec.shape === 'cube') geo = new THREE.BoxGeometry(spec.length, spec.length, spec.length);
      else if (spec.shape === 'disk') geo = new THREE.CylinderGeometry(r, r, spec.length / 10, 48);
      else if (spec.shape === 'cylinder') geo = new THREE.CylinderGeometry(r, r, spec.length * 2, 32);
      else geo = new THREE.SphereGeometry(r, 48, 32);
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      return m;
    }
  }
}

/** Round parachute canopy (unit size; scale to the canopy diameter). */
export function buildParachute(color = 0xff4d4d): THREE.Group {
  const g = new THREE.Group();
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2.4),
    new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.8, transparent: true, opacity: 0.95 }),
  );
  canopy.castShadow = true;
  canopy.position.y = 1.4;
  g.add(canopy);
  const lineMat = new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.7 });
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    pts.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(Math.cos(a) * 0.97, 1.4 + 0.25, Math.sin(a) * 0.97));
  }
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  return g;
}

/** Approximate blackbody colour (linear RGB) for a temperature in K (Tanner Helland fit). */
export function blackbody(T: number): THREE.Color {
  const t = Math.min(Math.max(T, 1000), 40000) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
  else { r = 329.7 * (t - 60) ** -0.1332; g = 288.12 * (t - 60) ** -0.0755; b = 255; }
  const c = new THREE.Color(Math.min(Math.max(r, 0), 255) / 255, Math.min(Math.max(g, 0), 255) / 255, Math.min(Math.max(b, 0), 255) / 255);
  return c;
}
