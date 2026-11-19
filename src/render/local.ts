/**
 * Local view: a metre-scale world in the launch site's East-North-Up frame
 * (three.js X = east, Y = up, Z = south). All geometry — terrain patches, the
 * regional and planetary meshes and the trajectory — is placed from exact
 * geodetic coordinates, so Earth's curvature and the geoid are real.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { BODIES, type BodyId } from '../physics/bodies';
import { ecefToEnu, geodeticToEcef } from '../physics/geodesy';
import { sampleGrid, type GridData } from '../physics/environment';
import { ussa1976 } from '../physics/atmosphere/ussa1976';
import { JupiterAtmosphere, MarsAtmosphere } from '../physics/atmosphere/planetary';
import { F, N_FIELDS, type SimResult } from '../physics/simulation';
import type { ObjectSpec } from '../physics/objects';
import type { Vec3 } from '../physics/vec3';
import { tileLat, tileLon, bilinearPx, type Patch } from './tiles';
import { blackbody, buildObjectModel, buildParachute } from './objects3d';
import { glowTexture } from './globe';
import { textureUrl } from '../app/data';

const DEG = Math.PI / 180;

export interface Site {
  body: BodyId;
  lat: number;
  lon: number;
  groundMSL: number;
  geoidN: number;
  /** surveyed launch-site height enforced by the physics (blended into the mesh the same way) */
  groundOverride: number | null;
  overrideRadius: number;
}

export interface RunVisual {
  key: string;
  result: SimResult;
  object: ObjectSpec;
  color: number;
  primary: boolean;
  spinAxisENU: Vec3 | null;
}

export type CameraMode = 'follow' | 'free' | 'ground' | 'side' | 'top';

interface RunState {
  vis: RunVisual;
  trail: Line2;
  trailMat: LineMaterial;
  ghost: Line2;
  model: THREE.Object3D;
  holder: THREE.Group;
  chute: THREE.Group | null;
  size: number;
  times: Float64Array;
  enu: Float32Array;
  machCross: number | null;
}

const waterVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying vec3 vPosW;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;
const waterFragment = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uMask;
  uniform vec3 uSun;
  uniform float uTime;
  uniform vec3 uSky;
  varying vec2 vUv;
  varying vec3 vPosW;
  void main() {
    #include <logdepthbuf_fragment>
    float m = texture2D(uMask, vUv).r;
    if (m < 0.5) discard;
    vec2 p = vPosW.xz;
    float t = uTime;
    vec3 n = normalize(vec3(
      0.06 * (sin(p.x * 0.05 + t * 1.3) + 0.6 * sin(p.x * 0.13 - p.y * 0.07 + t * 2.1) + 0.3 * sin(p.x * 0.9 + t * 3.7)),
      1.0,
      0.06 * (cos(p.y * 0.045 + t * 1.1) + 0.6 * sin(p.y * 0.11 + p.x * 0.05 + t * 1.7) + 0.3 * cos(p.y * 0.8 - t * 3.1))));
    vec3 V = normalize(cameraPosition - vPosW);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 deep = vec3(0.01, 0.06, 0.11);
    vec3 col = mix(deep, uSky, fres);
    vec3 H = normalize(uSun + V);
    col += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, H), 0.0), 350.0) * 3.0 * step(0.0, uSun.y);
    gl_FragColor = vec4(col, 0.9);
  }
`;

export class LocalView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private skyScene = new THREE.Scene();
  private skyCamera: THREE.PerspectiveCamera;
  private sky: Sky;
  private starDome: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private sunLight: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private terrain = new THREE.Group();
  private planetGroup = new THREE.Group();
  private launchGroup = new THREE.Group();
  private runsGroup = new THREE.Group();
  private fx = new THREE.Group();
  private site: Site | null = null;
  private originEcef: Vec3 = [0, 0, 0];
  private sunLocal = new THREE.Vector3(0, 1, 0);
  private runs: RunState[] = [];
  private resolution = new THREE.Vector2(1, 1);
  private loader = new THREE.TextureLoader();
  private plasma: THREE.Sprite;
  private machCone: THREE.Mesh<THREE.ConeGeometry, THREE.MeshBasicMaterial>;
  private particles: { pts: THREE.Points; vel: Float32Array; life: number; age: number; gravity: number }[] = [];
  private rings: { mesh: THREE.Mesh; age: number; life: number; maxR: number }[] = [];
  private water: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  /** current playback time [s] */
  time = 0;
  private lastT = 0;
  private cameraMode: CameraMode = 'follow';
  private focus = new THREE.Vector3();
  private impactShown = new Set<string>();
  private aim: THREE.Group;
  private aimHandle: THREE.Mesh;
  private aimState = { visible: false, release: new THREE.Vector3(), az: 90, el: 45, speed: 20 };
  private preview: Line2 | null = null;
  private dragging = false;
  private raycaster = new THREE.Raycaster();
  onAim: ((az: number, el: number, speed: number) => void) | null = null;
  onScale: ((s: number) => void) | null = null;
  private dayTextures = new Map<BodyId, THREE.Texture>();

  constructor(private canvas: HTMLCanvasElement, private maxAniso: number) {
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 5e7);
    this.camera.position.set(-40, 25, 60);
    this.skyCamera = new THREE.PerspectiveCamera(55, 1, 1, 2e6);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.05;
    this.controls.maxDistance = 3e7;
    this.controls.maxPolarAngle = Math.PI * 0.995;

    this.sky = new Sky();
    this.sky.scale.setScalar(1e5);
    const su = this.sky.material.uniforms;
    su.turbidity.value = 3;
    su.rayleigh.value = 1.2;
    su.mieCoefficient.value = 0.004;
    su.mieDirectionalG.value = 0.85;
    this.skyScene.add(this.sky);
    const starTex = this.loader.load(textureUrl('stars.jpg'));
    starTex.colorSpace = THREE.SRGBColorSpace;
    this.starDome = new THREE.Mesh(new THREE.SphereGeometry(9e4, 64, 32), new THREE.MeshBasicMaterial({ map: starTex, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.skyScene.add(this.starDome);

    this.sunLight = new THREE.DirectionalLight(0xffffff, 3);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight, this.sunLight.target);
    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x4a4236, 0.7);
    this.scene.add(this.hemi);
    this.scene.add(this.planetGroup, this.terrain, this.launchGroup, this.runsGroup, this.fx);

    this.plasma = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('#ffffff', '#ff8a3d'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.plasma.visible = false;
    this.fx.add(this.plasma);
    this.machCone = new THREE.Mesh(
      new THREE.ConeGeometry(1, 1, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xbfe4ff, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.machCone.visible = false;
    this.fx.add(this.machCone);

    // aim gizmo
    this.aim = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 12), new THREE.MeshBasicMaterial({ color: 0xffc46b, depthTest: false, transparent: true, opacity: 0.9 }));
    shaft.position.y = 0.5;
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.25, 16), new THREE.MeshBasicMaterial({ color: 0xffc46b, depthTest: false }));
    head.position.y = 1.0;
    this.aimHandle = new THREE.Mesh(new THREE.SphereGeometry(0.14, 20, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.85 }));
    this.aimHandle.position.y = 1.15;
    const arrow = new THREE.Group();
    arrow.add(shaft, head, this.aimHandle);
    arrow.name = 'arrow';
    this.aim.add(arrow);
    this.aim.renderOrder = 30;
    this.aim.traverse((o) => (o.renderOrder = 30));
    this.aim.visible = false;
    this.scene.add(this.aim);
    this.bindAim();
  }

  /* ---------------- site & terrain ---------------- */

  private toLocal(lat: number, lon: number, h: number, out = new THREE.Vector3()): THREE.Vector3 {
    const s = this.site!;
    const r = geodeticToEcef(lat * DEG, lon * DEG, h, BODIES[s.body].ellipsoid);
    const d = ecefToEnu([r[0] - this.originEcef[0], r[1] - this.originEcef[1], r[2] - this.originEcef[2]], s.lat * DEG, s.lon * DEG);
    return out.set(d[0], d[2], -d[1]);
  }

  private dayTexture(body: BodyId) {
    let t = this.dayTextures.get(body);
    if (!t) {
      t = this.loader.load(textureUrl(body === 'earth' ? 'earth_day.jpg' : `${body}.jpg`));
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.maxAniso;
      this.dayTextures.set(body, t);
    }
    return t;
  }

  setSite(site: Site) {
    this.site = site;
    this.originEcef = geodeticToEcef(site.lat * DEG, site.lon * DEG, site.groundMSL + site.geoidN, BODIES[site.body].ellipsoid);
    this.clearGroup(this.terrain);
    this.clearGroup(this.planetGroup);
    this.groundGrids = [];
    if (this.water) {
      this.scene.remove(this.water);
      this.water.geometry.dispose();
      this.water = null;
    }
    this.buildPlanet(site.body);
    if (site.body !== 'earth') this.buildFlatGround(site.body);
    this.impactShown.clear();
  }

  private clearGroup(g: THREE.Group) {
    for (const c of [...g.children]) {
      g.remove(c);
      c.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else if (mat) {
          const anyMat = mat as THREE.MeshStandardMaterial;
          if (anyMat.map && !this.isSharedTexture(anyMat.map)) anyMat.map.dispose();
          mat.dispose();
        }
      });
    }
  }
  private isSharedTexture(t: THREE.Texture) {
    for (const v of this.dayTextures.values()) if (v === t) return true;
    return false;
  }

  /** Whole planet (low-res) for the horizon and views from space. */
  private buildPlanet(body: BodyId, hole?: { latS: number; latN: number; lonW: number; lonE: number }) {
    const segLon = 256, segLat = 128;
    const pos = new Float32Array((segLon + 1) * (segLat + 1) * 3);
    const uv = new Float32Array((segLon + 1) * (segLat + 1) * 2);
    const v = new THREE.Vector3();
    const sink = body === 'earth' ? -600 : -50;
    for (let j = 0; j <= segLat; j++) {
      const lat = -90 + (180 * j) / segLat;
      for (let i = 0; i <= segLon; i++) {
        const lon = -180 + (360 * i) / segLon;
        this.toLocal(lat, lon, sink + (body === 'earth' ? this.site!.geoidN : 0), v);
        const k = j * (segLon + 1) + i;
        pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
        uv[k * 2] = i / segLon; uv[k * 2 + 1] = j / segLat;
      }
    }
    const idx: number[] = [];
    const inside = (la: number, lo: number) => hole && la > hole.latS && la < hole.latN && lo > hole.lonW && lo < hole.lonE;
    for (let j = 0; j < segLat; j++)
      for (let i = 0; i < segLon; i++) {
        const la0 = -90 + (180 * j) / segLat, la1 = -90 + (180 * (j + 1)) / segLat;
        const lo0 = -180 + (360 * i) / segLon, lo1 = -180 + (360 * (i + 1)) / segLon;
        if (inside(la0, lo0) && inside(la1, lo1) && inside(la0, lo1) && inside(la1, lo0)) continue;
        const a = j * (segLon + 1) + i, b = a + 1, c = a + segLon + 1, d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: this.dayTexture(body), roughness: 1, metalness: 0 }));
    m.receiveShadow = false;
    m.name = 'planet';
    this.planetGroup.add(m);
  }

  /** Regional mesh from the global 0.25° grid with the 8k day texture (Earth). */
  buildRegional(globalElev: GridData, oceanGrid: GridData, hole: { latS: number; latN: number; lonW: number; lonE: number }) {
    const s = this.site!;
    if (s.body !== 'earth') return;
    // replace the planet mesh with one that has a hole for the regional mesh
    const span = 9;
    const latS = Math.max(-89.9, s.lat - span), latN = Math.min(89.9, s.lat + span);
    const lspan = Math.min(179, span / Math.max(Math.cos(s.lat * DEG), 0.12));
    const lonW = s.lon - lspan, lonE = s.lon + lspan;
    this.clearGroup(this.planetGroup);
    this.buildPlanet('earth', { latS: latS + 1.5, latN: latN - 1.5, lonW: lonW + 1.5, lonE: lonE - 1.5 });
    const n = 220;
    const pos = new Float32Array((n + 1) * (n + 1) * 3);
    const uv = new Float32Array((n + 1) * (n + 1) * 2);
    const v = new THREE.Vector3();
    for (let j = 0; j <= n; j++) {
      const lat = latS + ((latN - latS) * j) / n;
      for (let i = 0; i <= n; i++) {
        let lon = lonW + ((lonE - lonW) * i) / n;
        const ocean = sampleGrid(oceanGrid, lat, lon) > 0.5;
        let e = sampleGrid(globalElev, lat, lon);
        if (ocean || e < 0) e = Math.max(e, 0);
        this.toLocal(lat, lon, e - 40 + s.geoidN, v);
        const k = j * (n + 1) + i;
        pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
        lon = ((lon + 540) % 360) - 180;
        uv[k * 2] = (lon + 180) / 360; uv[k * 2 + 1] = (lat + 90) / 180;
      }
    }
    const idx: number[] = [];
    const inside = (la: number, lo: number) => la > hole.latS && la < hole.latN && lo > hole.lonW && lo < hole.lonE;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const la0 = latS + ((latN - latS) * j) / n, la1 = latS + ((latN - latS) * (j + 1)) / n;
        const lo0 = lonW + ((lonE - lonW) * i) / n, lo1 = lonW + ((lonE - lonW) * (i + 1)) / n;
        if (inside(la0, lo0) && inside(la1, lo1) && inside(la0, lo1) && inside(la1, lo0)) continue;
        const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: this.dayTexture('earth'), roughness: 1 }));
    m.name = 'regional';
    this.planetGroup.add(m);
  }

  /** Terrain mesh for a tile patch. `hole`: finer patch footprint to cut out. */
  addPatch(p: Patch, opts: { segments: number; sink: number; hole?: Patch; water: boolean }) {
    const s = this.site!;
    const S = opts.segments;
    const pos = new Float32Array((S + 1) * (S + 1) * 3);
    const uv = new Float32Array((S + 1) * (S + 1) * 2);
    const lat = new Float32Array((S + 1) * (S + 1));
    const lon = new Float32Array((S + 1) * (S + 1));
    const v = new THREE.Vector3();
    for (let j = 0; j <= S; j++) {
      const py = (j / S) * p.W;
      const la = tileLat(p.y0 + py / 256, p.z);
      for (let i = 0; i <= S; i++) {
        const px = (i / S) * p.W;
        const lo = tileLon(p.x0 + px / 256, p.z);
        const e = this.siteBlend(la, lo, bilinearPx(p.elev, p.W, px - 0.5, py - 0.5));
        this.toLocal(la, lo, e + s.geoidN + opts.sink, v);
        const k = j * (S + 1) + i;
        pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
        uv[k * 2] = px / p.W; uv[k * 2 + 1] = 1 - py / p.W;
        lat[k] = la; lon[k] = lo;
      }
    }
    const idx: number[] = [];
    const h = opts.hole;
    const inside = (k: number) => !!h && lat[k] < h.latN && lat[k] > h.latS && lon[k] > h.lonW && lon[k] < h.lonE;
    for (let j = 0; j < S; j++)
      for (let i = 0; i < S; i++) {
        const a = j * (S + 1) + i, b = a + 1, c = a + S + 1, d = c + 1;
        if (inside(a) && inside(b) && inside(c) && inside(d)) continue;
        idx.push(a, d, b, a, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    const tex = new THREE.CanvasTexture(p.imagery);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.maxAniso;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, metalness: 0 });
    addDetail(mat, (p.W / 256) * tileMetres(p) / 6);
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    this.terrain.add(mesh);
    if (opts.water) this.addWater(p);
  }

  /** Same blending as physics/environment SiteOverrideTerrain (radius 40 m). */
  private siteBlend(lat: number, lon: number, e: number): number {
    const s = this.site!;
    if (s.groundOverride === null) return e;
    const R = s.overrideRadius;
    const dy = (lat - s.lat) * 111_195;
    let dl = lon - s.lon;
    if (dl > 180) dl -= 360;
    if (dl < -180) dl += 360;
    const d = Math.hypot(dy, dl * 111_195 * Math.cos(s.lat * DEG));
    if (d <= R) return s.groundOverride;
    if (d >= 2 * R) return e;
    const w = (d - R) / R;
    const sm = w * w * (3 - 2 * w);
    return s.groundOverride * (1 - sm) + e * sm;
  }

  /** Terrain height (local Y, metres) under a local point, from the loaded patches; null if unknown. */
  groundBelow(x: number, z: number): number | null {
    const s = this.site;
    if (!s || !this.groundGrids.length) return null;
    const R = 6371000;
    const lat = s.lat + (-z / R) / DEG;
    const lon = s.lon + (x / (R * Math.max(Math.cos(s.lat * DEG), 0.05))) / DEG;
    for (const g of this.groundGrids) {
      const xi = (lon - g.lon0) / g.dLon, yi = (lat - g.lat0) / g.dLat;
      if (xi >= 0 && yi >= 0 && xi <= g.nLon - 1 && yi <= g.nLat - 1) {
        const e = Math.max(this.siteBlend(lat, lon, sampleGrid(g, lat, lon, false)), 0);
        return e - s.groundMSL - (x * x + z * z) / (2 * R);
      }
    }
    return null;
  }
  private groundGrids: GridData[] = [];
  setGroundGrids(g: GridData[]) {
    this.groundGrids = g;
  }

  private addWater(p: Patch) {
    const s = this.site!;
    const gr = p.grid;
    let any = false;
    for (let k = 0; k < gr.ocean.length; k += 7) if (gr.ocean[k]) { any = true; break; }
    if (!any) return;
    const S = 160;
    const pos = new Float32Array((S + 1) * (S + 1) * 3);
    const uv = new Float32Array((S + 1) * (S + 1) * 2);
    const v = new THREE.Vector3();
    for (let j = 0; j <= S; j++)
      for (let i = 0; i <= S; i++) {
        const la = gr.lat0 + (j / S) * gr.dLat * (gr.nLat - 1);
        const lo = gr.lon0 + (i / S) * gr.dLon * (gr.nLon - 1);
        this.toLocal(la, lo, s.geoidN, v);
        const k = j * (S + 1) + i;
        pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
        uv[k * 2] = i / S; uv[k * 2 + 1] = j / S;
      }
    const idx: number[] = [];
    for (let j = 0; j < S; j++)
      for (let i = 0; i < S; i++) {
        const a = j * (S + 1) + i, b = a + 1, c = a + S + 1, d = c + 1;
        idx.push(a, d, b, a, c, d);
      }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    const maskData = new Uint8Array(gr.nLon * gr.nLat);
    for (let k = 0; k < maskData.length; k++) maskData[k] = gr.ocean[k] ? 255 : 0;
    const mask = new THREE.DataTexture(maskData, gr.nLon, gr.nLat, THREE.RedFormat);
    mask.magFilter = THREE.LinearFilter;
    mask.needsUpdate = true;
    const mat = new THREE.ShaderMaterial({
      vertexShader: waterVertex,
      fragmentShader: waterFragment,
      uniforms: { uMask: { value: mask }, uSun: { value: this.sunLocal }, uTime: { value: 0 }, uSky: { value: new THREE.Color(0.45, 0.62, 0.82) } },
      transparent: true,
      depthWrite: false,
    });
    if (this.water) {
      this.scene.remove(this.water);
      this.water.geometry.dispose();
    }
    this.water = new THREE.Mesh(g, mat);
    this.water.renderOrder = 3;
    this.scene.add(this.water);
  }

  /** Procedural ground disc for bodies without web terrain. */
  private buildFlatGround(body: BodyId) {
    const s = this.site!;
    const base = body === 'moon' ? '#8d8a85' : body === 'mars' ? '#a5603a' : '#c9a77a';
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const g = c.getContext('2d')!;
    g.fillStyle = base;
    g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 60000; i++) {
      const v = Math.random();
      g.fillStyle = `rgba(${v > 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.08})`;
      const r = Math.random() * 3;
      g.fillRect(Math.random() * 1024, Math.random() * 1024, r, r);
    }
    if (body === 'moon')
      for (let i = 0; i < 70; i++) {
        const x = Math.random() * 1024, y = Math.random() * 1024, r = 4 + Math.random() ** 3 * 60;
        const grd = g.createRadialGradient(x, y, r * 0.6, x, y, r);
        grd.addColorStop(0, 'rgba(0,0,0,0.18)');
        grd.addColorStop(0.85, 'rgba(255,255,255,0.12)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
      }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(40, 40);
    tex.anisotropy = this.maxAniso;
    if (body === 'jupiter') return; // no surface: the cloud deck is the planet mesh
    const R = 20000, S = 160;
    const pos = new Float32Array((S + 1) * (S + 1) * 3);
    const uv = new Float32Array((S + 1) * (S + 1) * 2);
    const v = new THREE.Vector3();
    const ell = BODIES[body].ellipsoid;
    const dLat = (R / ell.a) / DEG;
    for (let j = 0; j <= S; j++)
      for (let i = 0; i <= S; i++) {
        const la = s.lat - dLat + (2 * dLat * j) / S;
        const lo = s.lon + (-dLat + (2 * dLat * i) / S) / Math.max(Math.cos(s.lat * DEG), 0.05);
        this.toLocal(la, lo, s.groundMSL, v);
        const k = j * (S + 1) + i;
        pos[k * 3] = v.x; pos[k * 3 + 1] = v.y; pos[k * 3 + 2] = v.z;
        uv[k * 2] = i / S; uv[k * 2 + 1] = j / S;
      }
    const idx: number[] = [];
    for (let j = 0; j < S; j++)
      for (let i = 0; i < S; i++) {
        const a = j * (S + 1) + i, b = a + 1, cc = a + S + 1, d = cc + 1;
        idx.push(a, d, b, a, cc, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1 }));
    m.receiveShadow = true;
    this.terrain.add(m);
  }

  /* ---------------- launch structure ---------------- */

  setLaunch(mode: 'drop' | 'throw', heightAGL: number, az: number, el: number, speed: number) {
    this.clearGroup(this.launchGroup);
    const pad = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.1, 48), new THREE.MeshBasicMaterial({ color: 0x5cc8ff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.05;
    this.launchGroup.add(pad);
    const rel = new THREE.Vector3(0, Math.max(heightAGL, 0.01), 0);
    if (mode === 'drop' && heightAGL > 3 && heightAGL <= 1500) {
      const w = Math.min(Math.max(heightAGL * 0.06, 3), 40);
      const winTex = windowTexture();
      winTex.repeat.set(3, Math.max(1, heightAGL / 4));
      const tower = new THREE.Mesh(new THREE.BoxGeometry(w, heightAGL, w), new THREE.MeshStandardMaterial({ color: 0xe9edf3, roughness: 0.45, metalness: 0.25, map: winTex, emissiveMap: winTex, emissive: new THREE.Color(0x2a2210) }));
      // the tower stands north-east of the drop point, away from the default camera
      tower.position.set(w / 2 + 1.5, heightAGL / 2, -(w / 2 + 1.5));
      tower.castShadow = tower.receiveShadow = true;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(w + 3.2, 0.4, w * 0.8), new THREE.MeshStandardMaterial({ color: 0x5b6270, roughness: 0.6 }));
      deck.position.set(w / 2 + 0.2, heightAGL - 0.2, -(w / 2 + 0.2));
      deck.castShadow = true;
      this.launchGroup.add(tower, deck);
    } else if (mode === 'drop' && heightAGL > 1500 && heightAGL < 60000) {
      const gondola = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, 2.2), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.4, metalness: 0.5 }));
      gondola.position.set(-2.5, heightAGL + 1.1, 0);
      const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40;
        pts.push(new THREE.Vector2(Math.sin(t * Math.PI) ** 0.8 * 60 * (0.3 + 0.7 * t), t * 160));
      }
      const balloon = new THREE.Mesh(new THREE.LatheGeometry(pts, 64), new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.92, side: THREE.DoubleSide }));
      balloon.position.set(-2.5, heightAGL + 60, 0);
      const tether = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 58), new THREE.MeshBasicMaterial({ color: 0xcccccc }));
      tether.position.set(-2.5, heightAGL + 31, 0);
      this.launchGroup.add(gondola, balloon, tether);
    } else if (mode === 'throw') {
      this.launchGroup.add(thrower(az));
    }
    this.aimState.release.copy(rel);
    this.aimState.az = az;
    this.aimState.el = el;
    this.aimState.speed = speed;
    this.aimState.visible = mode === 'throw';
    this.updateAimGizmo();
  }

  /* ---------------- aim gizmo ---------------- */

  private aimScale() {
    return Math.max(this.camera.position.distanceTo(this.aimState.release) * 0.18, 0.5);
  }
  private speedToLen(v: number) {
    return 0.35 + 0.65 * Math.min(Math.log10(1 + v) / 4.7, 1.4);
  }
  private lenToSpeed(l: number) {
    const x = Math.max(l - 0.35, 0) / 0.65;
    return Math.max(0, 10 ** (x * 4.7) - 1);
  }
  /** hide the aim arrow while a run is being played back */
  hideAim = false;
  private updateAimGizmo() {
    const a = this.aimState;
    this.aim.visible = a.visible && !this.hideAim;
    if (!a.visible) return;
    this.aim.position.copy(a.release);
    const dir = new THREE.Vector3(Math.cos(a.el * DEG) * Math.sin(a.az * DEG), Math.sin(a.el * DEG), -Math.cos(a.el * DEG) * Math.cos(a.az * DEG));
    const arrow = this.aim.getObjectByName('arrow')!;
    arrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const s = this.aimScale();
    arrow.scale.set(s, s * this.speedToLen(a.speed), s);
  }
  setAimParams(az: number, el: number, speed: number) {
    Object.assign(this.aimState, { az, el, speed });
    this.updateAimGizmo();
  }

  private bindAim() {
    const ndc = new THREE.Vector2();
    const toNdc = (e: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    };
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.aim.visible || !this.active) return;
      toNdc(e);
      this.raycaster.setFromCamera(ndc, this.camera);
      if (this.raycaster.intersectObject(this.aimHandle, false).length) {
        this.dragging = true;
        this.controls.enabled = false;
        this.canvas.setPointerCapture(e.pointerId);
        e.stopPropagation();
      }
    }, { capture: true });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      toNdc(e);
      this.raycaster.setFromCamera(ndc, this.camera);
      const n = new THREE.Vector3();
      this.camera.getWorldDirection(n);
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, this.aimState.release);
      const p = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(plane, p)) return;
      const d = p.sub(this.aimState.release);
      const len = d.length() / this.aimScale();
      const e2 = d.x, n2 = -d.z, u2 = d.y;
      const az = ((Math.atan2(e2, n2) / DEG) + 360) % 360;
      const el = Math.atan2(u2, Math.hypot(e2, n2)) / DEG;
      const speed = this.lenToSpeed(len);
      Object.assign(this.aimState, { az, el, speed });
      this.updateAimGizmo();
      this.onAim?.(az, el, speed);
    });
    const up = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.controls.enabled = true;
      this.canvas.releasePointerCapture(e.pointerId);
    };
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }
  active = false;

  setPreview(res: SimResult | null) {
    if (this.preview) {
      this.scene.remove(this.preview);
      this.preview.geometry.dispose();
      (this.preview.material as LineMaterial).dispose();
      this.preview = null;
    }
    if (!res || res.count < 2) return;
    const pos: number[] = [];
    for (let i = 0; i < res.count; i++) {
      const o = i * N_FIELDS;
      pos.push(res.samples[o + F.east], res.samples[o + F.up], -res.samples[o + F.north]);
    }
    const g = new LineGeometry();
    g.setPositions(pos);
    const m = new LineMaterial({ color: 0xffc46b, linewidth: 2, dashed: true, dashSize: 1, gapSize: 0.6, transparent: true, opacity: 0.85, worldUnits: false });
    m.resolution.copy(this.resolution);
    m.dashScale = 1 / Math.max(this.aimScale() * 0.15, 0.01);
    this.preview = new Line2(g, m);
    this.preview.computeLineDistances();
    this.scene.add(this.preview);
  }

  /* ---------------- runs ---------------- */

  setRuns(list: RunVisual[]) {
    for (const r of this.runs) {
      this.runsGroup.remove(r.trail, r.ghost, r.holder);
      r.trail.geometry.dispose();
      r.trailMat.dispose();
      r.ghost.geometry.dispose();
      (r.ghost.material as LineMaterial).dispose();
    }
    this.runs = [];
    this.impactShown.clear();
    for (const p of [...this.particles]) this.fx.remove(p.pts);
    this.particles = [];
    for (const v of list) this.runs.push(this.buildRun(v));
    this.time = 0;
    this.lastT = 0;
  }

  private buildRun(vis: RunVisual): RunState {
    const res = vis.result;
    const n = res.count;
    const times = new Float64Array(n);
    const enu = new Float32Array(n * 3);
    const pos: number[] = [];
    const col: number[] = [];
    let vmax = 1;
    for (let i = 0; i < n; i++) vmax = Math.max(vmax, res.samples[i * N_FIELDS + F.speed]);
    const base = new THREE.Color(vis.color);
    let machCross: number | null = null;
    for (let i = 0; i < n; i++) {
      const o = i * N_FIELDS;
      times[i] = res.samples[o + F.t];
      const x = res.samples[o + F.east], y = res.samples[o + F.up], z = -res.samples[o + F.north];
      enu[i * 3] = x; enu[i * 3 + 1] = y; enu[i * 3 + 2] = z;
      pos.push(x, y, z);
      if (vis.primary) {
        const c = speedColor(res.samples[o + F.speed] / vmax);
        col.push(c.r, c.g, c.b);
      } else col.push(base.r, base.g, base.b);
      if (machCross === null && i > 0 && res.samples[o + F.mach] >= 1 && res.samples[o - N_FIELDS + F.mach] < 1 && res.samples[o + F.rho] > 1e-4) machCross = times[i];
    }
    const g = new LineGeometry();
    g.setPositions(pos.length >= 6 ? pos : [0, 0, 0, 0, 0.001, 0]);
    g.setColors(col.length >= 6 ? col : [1, 1, 1, 1, 1, 1]);
    const trailMat = new LineMaterial({ vertexColors: true, linewidth: vis.primary ? 3.2 : 2.4, transparent: true, opacity: 0.95, worldUnits: false });
    trailMat.resolution.copy(this.resolution);
    const trail = new Line2(g, trailMat);
    trail.frustumCulled = false;
    const gg = new LineGeometry();
    gg.setPositions(pos.length >= 6 ? pos : [0, 0, 0, 0, 0.001, 0]);
    const ghostMat = new LineMaterial({ color: vis.color, linewidth: 1.2, transparent: true, opacity: 0.22, worldUnits: false });
    ghostMat.resolution.copy(this.resolution);
    const ghost = new Line2(gg, ghostMat);
    ghost.frustumCulled = false;
    const holder = new THREE.Group();
    const model = buildObjectModel(vis.object);
    holder.add(model);
    let chute: THREE.Group | null = null;
    if (vis.object.parachute) {
      chute = buildParachute(vis.primary ? 0xff4d4d : vis.color);
      chute.visible = false;
      holder.add(chute);
    }
    this.runsGroup.add(ghost, trail, holder);
    return { vis, trail, trailMat, ghost, model, holder, chute, size: Math.max(vis.object.length, 0.002), times, enu, machCross };
  }

  get duration() {
    return Math.max(0, ...this.runs.map((r) => r.times[r.times.length - 1] ?? 0));
  }

  private indexAt(r: RunState, t: number) {
    const ts = r.times;
    if (t <= ts[0]) return 0;
    if (t >= ts[ts.length - 1]) return ts.length - 1;
    let lo = 0, hi = ts.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (ts[m] <= t) lo = m;
      else hi = m;
    }
    return lo;
  }

  /** sample row (interpolated) of a run at time t */
  sampleAt(runIndex: number, t: number): Float64Array | null {
    const r = this.runs[runIndex];
    if (!r || !r.times.length) return null;
    const i = this.indexAt(r, t);
    const j = Math.min(i + 1, r.times.length - 1);
    const w = j > i ? (t - r.times[i]) / (r.times[j] - r.times[i]) : 0;
    const s = r.vis.result.samples;
    const out = new Float64Array(N_FIELDS);
    for (let k = 0; k < N_FIELDS; k++) out[k] = s[i * N_FIELDS + k] * (1 - w) + s[j * N_FIELDS + k] * w;
    out[F.medium] = s[i * N_FIELDS + F.medium];
    return out;
  }

  setTime(t: number) {
    this.time = t;
    const goingBack = t < this.lastT;
    if (goingBack) this.impactShown.clear();
    let primaryPos: THREE.Vector3 | null = null;
    this.runs.forEach((r, ri) => {
      const row = this.sampleAt(ri, t);
      if (!row) return;
      const p = new THREE.Vector3(row[F.east], row[F.up], -row[F.north]);
      r.holder.position.copy(p);
      const i = this.indexAt(r, t);
      (r.trail.geometry as LineGeometry).instanceCount = Math.max(0, i);
      // orientation: balls spin, people & capsules face the flow
      const vel = new THREE.Vector3(row[F.vx], row[F.vy], row[F.vz]);
      const vENU = ecefToEnu([vel.x, vel.y, vel.z], this.site!.lat * DEG, this.site!.lon * DEG);
      const vLocal = new THREE.Vector3(vENU[0], vENU[2], -vENU[1]);
      const id = r.vis.object.id;
      if (id === 'skydiver' || id === 'stratos' || id === 'headdown') {
        const h = new THREE.Vector3(vLocal.x, 0, vLocal.z);
        const yaw = h.lengthSq() > 1e-6 ? Math.atan2(h.x, h.z) + Math.PI : 0;
        r.model.rotation.set(id === 'headdown' ? -Math.PI / 2 : 0, yaw, Math.sin(t * 0.7) * 0.05);
      } else if (id === 'capsule') {
        if (vLocal.lengthSq() > 1e-6) r.model.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), vLocal.clone().normalize());
      } else if (id === 'feather') {
        r.model.rotation.set(-Math.PI / 2.4 + Math.sin(t * 2.1) * 0.5, t * 1.3, Math.sin(t * 1.7) * 0.6);
      } else if (id === 'coin') {
        r.model.rotation.set(t * 9, t * 3.1, 0);
      } else if (r.vis.spinAxisENU) {
        const ax = new THREE.Vector3(r.vis.spinAxisENU[0], r.vis.spinAxisENU[2], -r.vis.spinAxisENU[1]).normalize();
        const ang = row[F.spin] * t;
        r.model.quaternion.setFromAxisAngle(ax, ang % (Math.PI * 2));
      }
      // parachute
      if (r.chute) {
        const f = row[F.chute];
        r.chute.visible = f > 0.01;
        if (r.chute.visible && r.vis.object.parachute) {
          const D = Math.sqrt((4 * r.vis.object.parachute.cdA) / (Math.PI * 0.8)) / 2;
          r.chute.scale.setScalar(D * Math.max(f, 0.05) / Math.max(this.visualScale(r, p), 1));
          r.chute.position.set(0, D * 1.3 / Math.max(this.visualScale(r, p), 1), 0);
        }
      }
      // size exaggeration for visibility
      const sc = this.visualScale(r, p);
      r.holder.scale.setScalar(sc);
      if (r.vis.primary) {
        primaryPos = p;
        this.onScale?.(sc);
        this.updateEffects(r, row, p, sc);
      }
      // impact effects
      const end = r.times[r.times.length - 1];
      const outcome = r.vis.result.summary.outcome;
      if (t >= end && !this.impactShown.has(r.vis.key)) {
        this.impactShown.add(r.vis.key);
        if (outcome === 'impact' || outcome === 'seabed') this.spawnImpact(p, r, row);
      }
      const wEntry = r.vis.result.summary.waterEntryTime;
      if (wEntry !== null && t >= wEntry && !this.impactShown.has(r.vis.key + ':water')) {
        this.impactShown.add(r.vis.key + ':water');
        const rowW = this.sampleAt(ri, wEntry)!;
        this.spawnSplash(new THREE.Vector3(rowW[F.east], rowW[F.up], -rowW[F.north]), rowW[F.speed], r.vis.object.mass);
      }
      if (r.vis.primary && r.machCross !== null && t >= r.machCross && this.lastT < r.machCross) this.spawnRing(p, 30 * sc * r.size + 30, 1.2, 0xbfe4ff);
    });
    if (primaryPos) this.focus.copy(primaryPos);
    this.lastT = t;
  }

  private visualScale(r: RunState, p: THREE.Vector3) {
    const d = this.camera.position.distanceTo(p);
    const want = d * 0.022; // ≈ 1.2 % of the view height
    return Math.min(Math.max(1, want / r.size), 2e6);
  }

  private updateEffects(r: RunState, row: Float64Array, p: THREE.Vector3, sc: number) {
    const q = row[F.qStag];
    const Tw = row[F.Tw];
    const size = r.size * sc;
    const hot = q > 3e4 || Tw > 1000;
    this.plasma.visible = hot && row[F.medium] === 0;
    if (this.plasma.visible) {
      const k = Math.min(Math.max(Math.log10(Math.max(q, 1)) - 4, 0), 4);
      this.plasma.position.copy(p);
      this.plasma.scale.setScalar(size * (2.5 + k * 2.2));
      const c = blackbody(Math.max(Tw, 1200 + k * 1500));
      this.plasma.material.color.copy(c);
      this.plasma.material.opacity = Math.min(1, 0.35 + k * 0.2);
    }
    const M = row[F.mach];
    const showCone = M > 1.05 && M < 40 && row[F.rho] > 2e-4 && row[F.medium] === 0;
    this.machCone.visible = showCone;
    if (showCone) {
      const mu = Math.asin(1 / M);
      const len = size * 4.5;
      const vel = ecefToEnu([row[F.vx], row[F.vy], row[F.vz]], this.site!.lat * DEG, this.site!.lon * DEG);
      const dir = new THREE.Vector3(vel[0], vel[2], -vel[1]).normalize();
      this.machCone.scale.set(Math.tan(mu) * len, len, Math.tan(mu) * len);
      this.machCone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
      this.machCone.position.copy(p).addScaledVector(dir, -len / 2 + size * 0.5);
      this.machCone.material.opacity = Math.min(0.22, 0.06 + row[F.rho] * 0.2);
    }
    // the model itself glows with its wall temperature
    r.model.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && 'emissive' in m && m.emissive) {
        if (Tw > 800) {
          const c = blackbody(Tw);
          const f = Math.min((Tw - 800) / 1500, 1);
          m.emissive.setRGB(c.r * f, c.g * f, c.b * f);
          m.emissiveIntensity = 1 + f * 2;
        } else m.emissive.setRGB(0, 0, 0);
      }
    });
  }

  private spawnImpact(p: THREE.Vector3, r: RunState, row: Float64Array) {
    const E = 0.5 * row[F.mass] * row[F.speed] ** 2;
    const water = r.vis.result.summary.outcome === 'seabed';
    const count = Math.min(1500, 150 + Math.floor(Math.log10(1 + E) * 120));
    const spread = Math.max(0.3, Math.cbrt(E) * 0.05);
    this.spawnParticles(p, count, spread, water ? 0x8fb7d4 : 0xb59d7a, 2.5, water ? 4 : 9.81);
    if (E > 50) this.spawnRing(p, spread * 6, 1.6, water ? 0x9fd0ff : 0xffd7a0);
    // crater: Holsapple-style energy scaling D ≈ 0.27·E^0.29 cm (loose regolith), clamp
    if (!water && E > 200) {
      const D = Math.min(0.0027 * E ** 0.29, 5000);
      const decal = new THREE.Mesh(new THREE.CircleGeometry(D / 2, 48), new THREE.MeshBasicMaterial({ color: 0x1a140f, transparent: true, opacity: 0.55, depthWrite: false }));
      decal.rotation.x = -Math.PI / 2;
      decal.position.copy(p).add(new THREE.Vector3(0, 0.03, 0));
      this.fx.add(decal);
    }
  }

  private spawnSplash(p: THREE.Vector3, speed: number, mass: number) {
    const E = 0.5 * mass * speed * speed;
    this.spawnParticles(p, Math.min(1200, 200 + Math.floor(Math.log10(1 + E) * 100)), Math.max(0.4, Math.cbrt(E) * 0.04), 0xe8f6ff, 2, 9.81, true);
    this.spawnRing(p, Math.max(2, Math.cbrt(E) * 0.4), 2.5, 0xe8f6ff);
  }

  private spawnParticles(p: THREE.Vector3, n: number, spread: number, color: number, life: number, gravity: number, upward = false) {
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y + 0.02; pos[i * 3 + 2] = p.z;
      const a = Math.random() * Math.PI * 2, s = (0.3 + Math.random()) * spread * 4;
      vel[i * 3] = Math.cos(a) * s;
      vel[i * 3 + 1] = (upward ? 1.5 : 0.6 + Math.random()) * s * (0.5 + Math.random());
      vel[i * 3 + 2] = Math.sin(a) * s;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color, size: Math.max(spread * 0.08, 0.02), transparent: true, opacity: 0.9, depthWrite: false });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    this.fx.add(pts);
    this.particles.push({ pts, vel, life, age: 0, gravity });
  }

  private spawnRing(p: THREE.Vector3, maxR: number, life: number, color: number) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(p).add(new THREE.Vector3(0, 0.05, 0));
    this.fx.add(mesh);
    this.rings.push({ mesh, age: 0, life, maxR });
  }

  /* ---------------- camera ---------------- */

  setCameraMode(m: CameraMode) {
    this.cameraMode = m;
    if (m === 'top') {
      const ext = this.extent();
      this.camera.position.set(this.focus.x, Math.max(ext * 1.6, 30), this.focus.z + 0.01);
      this.controls.target.copy(this.focus);
    }
    if (m === 'side') this.frameAll();
  }

  private extent() {
    let ext = 10;
    for (const r of this.runs) {
      const s = r.vis.result.summary;
      ext = Math.max(ext, s.range, s.maxAltitudeAGL);
    }
    return ext;
  }

  /** Position the camera so the whole trajectory is visible from the side. */
  frameAll() {
    const r = this.runs.find((x) => x.vis.primary);
    if (!r || r.times.length < 2) return;
    const box = new THREE.Box3();
    for (let i = 0; i < r.times.length; i++) box.expandByPoint(new THREE.Vector3(r.enu[i * 3], r.enu[i * 3 + 1], r.enu[i * 3 + 2]));
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const R = Math.max(size.length(), 4);
    const horiz = new THREE.Vector3(size.x, 0, size.z);
    const side = horiz.lengthSq() > 1 ? new THREE.Vector3(-horiz.z, 0, horiz.x).normalize() : new THREE.Vector3(1, 0, 0.6).normalize();
    this.camera.position.copy(c).addScaledVector(side, R * 1.1).add(new THREE.Vector3(0, R * 0.45, 0));
    const gb = this.groundBelow(this.camera.position.x, this.camera.position.z);
    if (gb !== null) this.camera.position.y = Math.max(this.camera.position.y, gb + R * 0.15);
    this.controls.target.copy(c);
  }

  /** Put the camera near the release point looking at it (distance scaled to the object). */
  frameLaunch(heightAGL: number, objectLength = 0.2) {
    const h = Math.max(heightAGL, 1.5);
    const d = Math.min(Math.max(objectLength * 22, 9), 60);
    this.camera.position.set(-d * 0.6, h + d * 0.25, d * 0.8);
    this.controls.target.set(0, h, 0);
    this.focus.set(0, h, 0);
  }

  setSize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.skyCamera.aspect = w / h;
    this.skyCamera.updateProjectionMatrix();
    this.resolution.set(w, h);
    for (const r of this.runs) {
      r.trailMat.resolution.set(w, h);
      (r.ghost.material as LineMaterial).resolution.set(w, h);
    }
    if (this.preview) (this.preview.material as LineMaterial).resolution.set(w, h);
  }

  setSun(sunEcef: Vec3) {
    if (!this.site) return;
    const d = ecefToEnu(sunEcef, this.site.lat * DEG, this.site.lon * DEG);
    this.sunLocal.set(d[0], d[2], -d[1]).normalize();
  }

  update(dt: number) {
    if (!this.site) return;
    // camera follow
    if (this.cameraMode === 'follow' || this.cameraMode === 'ground' || this.cameraMode === 'side' || this.cameraMode === 'top') {
      const delta = this.focus.clone().sub(this.controls.target);
      if (this.cameraMode === 'follow') this.camera.position.add(delta);
      if (this.cameraMode === 'ground') {
        this.camera.position.set(-25, 1.7, 35);
      }
      this.controls.target.add(delta);
    }
    this.controls.update();
    // keep the camera above the terrain
    const gb = this.groundBelow(this.camera.position.x, this.camera.position.z);
    if (gb !== null && this.camera.position.y < gb + 1.2) this.camera.position.y = gb + 1.2;
    const camH = this.camera.position.y + this.site.groundMSL;
    const zTarget = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = Math.max(0.005, Math.min(zTarget * 0.002, 50));
    this.camera.updateProjectionMatrix();

    // atmosphere appearance at the camera altitude
    const s = this.site;
    // sky brightness follows the real air density at the camera (normalised to Earth sea level)
    const rhoRatio = s.body === 'earth' ? ussa1976(Math.max(camH, -400)).rho / 1.225 : s.body === 'mars' ? MARS_ATM.at(camH).rho / 1.225 : s.body === 'jupiter' ? JUPITER_ATM.at(camH).rho / 1.225 : 0;
    const su = this.sky.material.uniforms;
    su.sunPosition.value.copy(this.sunLocal).multiplyScalar(1000);
    const sunElev = this.sunLocal.y;
    su.rayleigh.value = s.body === 'earth' ? 2.6 * Math.min(rhoRatio, 1) ** 0.6 : s.body === 'mars' ? 0.3 * Math.min(rhoRatio / 0.016, 1) : s.body === 'jupiter' ? 1.5 * Math.min(rhoRatio / 0.13, 1) ** 0.6 : 0;
    su.turbidity.value = s.body === 'mars' ? 12 : s.body === 'earth' ? 1.5 + 2 * Math.min(rhoRatio, 1) : 1;
    su.mieCoefficient.value = (s.body === 'mars' ? 0.03 : 0.005) * Math.min(rhoRatio * 6, 1);
    this.sky.visible = s.body !== 'moon' && rhoRatio > 1e-4;
    // stars only where the sky is genuinely dark: high altitude (ρ/ρ0 ≲ 1e-4) or night
    this.starDome.material.opacity = Math.min(1, Math.max(0, 1 - rhoRatio ** 0.15 * 1.6) + Math.max(0, -sunElev * 4)) * 0.9;
    this.sunLight.position.copy(this.focus).addScaledVector(this.sunLocal, 5000);
    this.sunLight.target.position.copy(this.focus);
    const sunUp = THREE.MathUtils.smoothstep(sunElev, -0.04, 0.12);
    this.sunLight.intensity = 4.5 * sunUp * (s.body === 'mars' ? 0.55 : s.body === 'jupiter' ? 0.15 : 1);
    this.sunLight.color.setRGB(1, 0.75 + 0.25 * THREE.MathUtils.smoothstep(sunElev, 0, 0.3), 0.55 + 0.45 * THREE.MathUtils.smoothstep(sunElev, 0, 0.3));
    this.hemi.intensity = (0.2 + 0.9 * sunUp) * (s.body === 'moon' ? 0.15 : 1);
    const shadowR = Math.min(Math.max(zTarget * 0.6, 5), 3000);
    const sc = this.sunLight.shadow.camera;
    sc.left = -shadowR; sc.right = shadowR; sc.top = shadowR; sc.bottom = -shadowR;
    sc.near = 1; sc.far = 12000;
    sc.updateProjectionMatrix();

    // haze
    if (s.body === 'earth' || s.body === 'mars') {
      const under = this.water && this.camera.position.y + s.groundMSL < 0;
      const horizon = new THREE.Color().setHSL(0.58, 0.45, 0.62).multiplyScalar(0.15 + 0.85 * sunUp);
      if (s.body === 'mars') horizon.setRGB(0.75, 0.55, 0.4).multiplyScalar(0.3 + 0.7 * sunUp);
      // Koschmieder: visibility ≈ 3.9/β; clean air ≈ 100+ km at sea level, scaling with density
      const dens = (s.body === 'mars' ? 2e-5 : 4.5e-6) * Math.min(rhoRatio, 1.2);
      this.scene.fog = under ? new THREE.FogExp2(0x0b3550, 0.04) : new THREE.FogExp2(horizon, dens);
    } else this.scene.fog = null;

    // particles & rings
    for (const p of [...this.particles]) {
      p.age += dt;
      const a = p.pts.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) {
        p.vel[i * 3 + 1] -= p.gravity * dt;
        a.setXYZ(i, a.getX(i) + p.vel[i * 3] * dt, Math.max(a.getY(i) + p.vel[i * 3 + 1] * dt, -1e6), a.getZ(i) + p.vel[i * 3 + 2] * dt);
      }
      a.needsUpdate = true;
      (p.pts.material as THREE.PointsMaterial).opacity = Math.max(0, 0.9 * (1 - p.age / p.life));
      if (p.age > p.life) {
        this.fx.remove(p.pts);
        p.pts.geometry.dispose();
        this.particles.splice(this.particles.indexOf(p), 1);
      }
    }
    for (const r of [...this.rings]) {
      r.age += dt;
      const f = r.age / r.life;
      r.mesh.scale.setScalar(Math.max(r.maxR * f, 0.01));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 * (1 - f));
      if (f >= 1) {
        this.fx.remove(r.mesh);
        r.mesh.geometry.dispose();
        this.rings.splice(this.rings.indexOf(r), 1);
      }
    }
    if (this.water) this.water.material.uniforms.uTime.value += dt;
    this.updateAimGizmo();
  }

  render(renderer: THREE.WebGLRenderer) {
    renderer.toneMappingExposure = 0.62;
    this.skyCamera.quaternion.copy(this.camera.quaternion);
    this.skyCamera.fov = this.camera.fov;
    this.skyCamera.updateProjectionMatrix();
    renderer.autoClear = false;
    renderer.clear();
    renderer.render(this.skyScene, this.skyCamera);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }
}

let detailTex: THREE.Texture | null = null;
/** Tiling fine-scale noise that modulates the satellite imagery close to the camera (mip-maps average it out far away). */
function addDetail(mat: THREE.MeshStandardMaterial, repeat: number) {
  if (!detailTex) {
    const n = 256;
    const data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        let v = 0, amp = 0.5;
        for (let o = 1; o <= 32; o *= 2) {
          v += amp * (Math.sin((x * o * 2 * Math.PI) / n + o * 1.7) * Math.sin((y * o * 2 * Math.PI) / n + o * 2.3) + (Math.random() - 0.5) * 0.6);
          amp *= 0.55;
        }
        const c = Math.max(0, Math.min(255, 128 + v * 70));
        const k = (y * n + x) * 4;
        data[k] = data[k + 1] = data[k + 2] = c;
        data[k + 3] = 255;
      }
    detailTex = new THREE.DataTexture(data, n, n);
    detailTex.wrapS = detailTex.wrapT = THREE.RepeatWrapping;
    detailTex.generateMipmaps = true;
    detailTex.minFilter = THREE.LinearMipmapLinearFilter;
    detailTex.magFilter = THREE.LinearFilter;
    detailTex.needsUpdate = true;
  }
  const tex = detailTex;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDetail = { value: tex };
    sh.uniforms.uDetailRepeat = { value: repeat };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <map_pars_fragment>', `#include <map_pars_fragment>
uniform sampler2D uDetail;
uniform float uDetailRepeat;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
  diffuseColor.rgb *= 0.78 + 0.44 * texture2D(uDetail, vMapUv * uDetailRepeat).r;`);
  };
}

/** Ground size of one tile at the patch's latitude [m]. */
function tileMetres(p: Patch) {
  const lat = (p.latN + p.latS) / 2;
  return (40075016.7 * Math.cos((lat * Math.PI) / 180)) / 2 ** p.z;
}

const MARS_ATM = new MarsAtmosphere();
const JUPITER_ATM = new JupiterAtmosphere();

function speedColor(t: number): THREE.Color {
  const stops = [new THREE.Color(0x5cc8ff), new THREE.Color(0x7cffb2), new THREE.Color(0xffe15c), new THREE.Color(0xff8a3d), new THREE.Color(0xff3d6e)];
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  return stops[i].clone().lerp(stops[i + 1], x - i);
}

function windowTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#7d8796';
  g.fillRect(0, 0, 64, 64);
  for (let y = 4; y < 64; y += 16)
    for (let x = 4; x < 64; x += 20) {
      g.fillStyle = Math.random() > 0.55 ? '#ffd88a' : '#1c2735';
      g.fillRect(x, y, 12, 9);
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function thrower(az: number): THREE.Group {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0x3a6ea5, roughness: 0.7 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.75, 6, 12), skin);
  body.position.y = 1.0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), new THREE.MeshStandardMaterial({ color: 0xe0b48f, roughness: 0.6 }));
  head.position.y = 1.62;
  const legs = [-1, 1].map((s) => {
    const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.75, 4, 8), skin);
    l.position.set(s * 0.1, 0.42, 0);
    return l;
  });
  const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.6, 4, 8), skin);
  arm.position.set(0.22, 1.55, 0.05);
  arm.rotation.z = -0.4;
  g.add(body, head, ...legs, arm);
  g.position.set(-0.35, 0, 0.25);
  g.rotation.y = -az * DEG + Math.PI;
  g.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  return g;
}
