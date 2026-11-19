/**
 * Global view: the planet as an exact ellipsoid mesh (vertices at geodetic
 * lat/lon), physically lit by the real Sun position, with an atmosphere glow,
 * clouds, starfield, gravity overlays and trajectories. Units: km.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { BODIES, type BodyId } from '../physics/bodies';
import { ecefToGeodetic, geodeticToEcef } from '../physics/geodesy';
import { sampleGrid, type GridData } from '../physics/environment';
import { ecefToScene, sceneToEcef } from './coords';
import { textureUrl } from '../app/data';
import type { Vec3 } from '../physics/vec3';

const DEG = Math.PI / 180;

export type HeatmapMode = 'off' | 'anomaly' | 'geoid' | 'gravity';

const earthVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vEast;
  varying vec3 vNorth;
  void main() {
    vUv = uv;
    float lon = (uv.x * 2.0 - 1.0) * PI;
    float lat = (uv.y - 0.5) * PI;
    // geodetic normal in scene coordinates (ECEF x, z, -y)
    vec3 n = vec3(cos(lat) * cos(lon), sin(lat), -cos(lat) * sin(lon));
    vNormalW = normalize(mat3(modelMatrix) * n);
    vEast = normalize(mat3(modelMatrix) * vec3(-sin(lon), 0.0, -cos(lon)));
    vNorth = normalize(mat3(modelMatrix) * vec3(-sin(lat) * cos(lon), cos(lat), sin(lat) * sin(lon)));
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;

const earthFragment = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uDay;
  uniform sampler2D uNight;
  uniform sampler2D uSpec;
  uniform sampler2D uNormal;
  uniform sampler2D uClouds;
  uniform sampler2D uHeat;
  uniform float uHeatOpacity;
  uniform vec3 uSunDir;
  uniform float uIsEarth;
  uniform float uCloudShift;
  uniform vec3 uRimColor;
  uniform float uNormalStrength;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vEast;
  varying vec3 vNorth;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 ng = normalize(vNormalW);
    vec3 nm = texture2D(uNormal, vUv).xyz * 2.0 - 1.0;
    vec3 n = normalize(ng * max(nm.z, 0.2) + (vEast * nm.x + vNorth * nm.y) * uNormalStrength);
    vec3 V = normalize(cameraPosition - vPosW);
    float NdL = dot(n, uSunDir);
    float NgL = dot(ng, uSunDir);
    vec3 day = texture2D(uDay, vUv).rgb;
    day = pow(day, vec3(2.2));
    float cloudShadow = uIsEarth * texture2D(uClouds, vUv + vec2(uCloudShift - 0.0015 * uSunDir.x, 0.0)).r;
    float dayMix = smoothstep(-0.08, 0.18, NgL);
    vec3 sunCol = mix(vec3(1.0, 0.55, 0.3), vec3(1.0, 0.98, 0.94), smoothstep(0.0, 0.35, NgL));
    vec3 lit = day * sunCol * (max(NdL, 0.0) * 1.15 + 0.02) * (1.0 - 0.45 * cloudShadow);
    // specular ocean glint
    float spec = texture2D(uSpec, vUv).r * uIsEarth;
    vec3 H = normalize(uSunDir + V);
    float glint = pow(max(dot(ng, H), 0.0), 140.0) * spec * 0.55 * smoothstep(0.0, 0.1, NgL);
    lit += sunCol * glint * (1.0 - cloudShadow);
    // city lights on the night side
    vec3 night = pow(texture2D(uNight, vUv).rgb, vec3(2.0)) * vec3(1.0, 0.82, 0.55) * 2.2 * uIsEarth;
    vec3 col = lit * dayMix + night * (1.0 - smoothstep(-0.25, 0.05, NgL)) * (1.0 - 0.7 * cloudShadow);
    // atmospheric rim & twilight
    float fres = pow(1.0 - max(dot(ng, V), 0.0), 3.0);
    float sunSide = smoothstep(-0.3, 0.5, NgL);
    col += uRimColor * fres * sunSide * 0.9;
    col += vec3(1.0, 0.45, 0.15) * fres * (1.0 - abs(NgL * 3.0)) * 0.25 * step(-0.33, NgL) * uIsEarth;
    // gravity overlay
    vec4 heat = texture2D(uHeat, vUv);
    col = mix(col, heat.rgb * (0.35 + 0.65 * max(NgL * 0.5 + 0.5, 0.0)), uHeatOpacity * heat.a);
    col = col / (1.0 + col * 0.15);
    gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
  }
`;

const atmoVertex = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;

const atmoFragment = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uSunDir;
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vPosW);
    float rim = 1.0 - abs(dot(n, V));
    float glow = pow(clamp(rim, 0.0, 1.0), 5.5) * 2.2;
    float sun = smoothstep(-0.35, 0.6, dot(n, uSunDir));
    vec3 col = mix(vec3(1.0, 0.45, 0.2), uColor, smoothstep(-0.1, 0.4, dot(n, uSunDir)));
    gl_FragColor = vec4(col * glow * sun * uStrength, glow * sun * uStrength);
  }
`;

const cloudFragment = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uClouds;
  uniform vec3 uSunDir;
  uniform float uShift;
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying vec3 vEast;
  varying vec3 vNorth;
  void main() {
    #include <logdepthbuf_fragment>
    float a = texture2D(uClouds, vUv + vec2(uShift, 0.0)).r;
    vec3 n = normalize(vNormalW);
    float d = dot(n, uSunDir);
    vec3 c = mix(vec3(1.0, 0.6, 0.4), vec3(1.0), smoothstep(0.0, 0.3, d)) * (max(d, 0.0) * 0.95 + 0.03);
    gl_FragColor = vec4(c, a * 0.92 * smoothstep(-0.25, 0.05, d) + a * 0.04);
  }
`;

interface Traj {
  line: Line2;
  material: LineMaterial;
}

const BODY_TEX: Record<BodyId, { day: string; rim: number; atmo: number; atmoStrength: number; normal: number }> = {
  earth: { day: 'earth_day.jpg', rim: 0x5aa8ff, atmo: 0x5ab0ff, atmoStrength: 1, normal: 0.35 },
  moon: { day: 'moon.jpg', rim: 0x000000, atmo: 0x000000, atmoStrength: 0, normal: 0 },
  mars: { day: 'mars.jpg', rim: 0xd98c5f, atmo: 0xe7a77d, atmoStrength: 0.35, normal: 0 },
  jupiter: { day: 'jupiter.jpg', rim: 0xc9b08d, atmo: 0xd8c3a0, atmoStrength: 0.45, normal: 0 },
};

export class GlobeView {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private loader = new THREE.TextureLoader();
  private planet!: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private clouds: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
  private atmosphere!: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private stars: THREE.Mesh;
  private sunSprite: THREE.Sprite;
  private sunDir = new THREE.Vector3(1, 0, 0);
  private trajs = new Map<string, Traj>();
  private markers = new THREE.Group();
  private launchMarker: THREE.Group;
  private impactMarker: THREE.Group;
  private objectSprite: THREE.Sprite;
  private body: BodyId = 'earth';
  private heatTextures = new Map<HeatmapMode, THREE.Texture>();
  private flight: { from: THREE.Vector3; to: THREE.Vector3; t0: number; dur: number } | null = null;
  private cloudShift = 0;
  private geoidGrid: GridData | null = null;
  private exaggeration = 0;
  resolution = new THREE.Vector2(1, 1);
  private textures = new Map<string, THREE.Texture>();
  private blank: THREE.DataTexture;
  private blankNormal: THREE.DataTexture;

  constructor(canvas: HTMLCanvasElement, maxAniso: number) {
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.0005, 2e7);
    this.camera.position.set(9000, 9000, 16000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.enablePan = false;
    this.controls.minDistance = BODIES.earth.ellipsoid.a / 1000 + 0.3;
    this.controls.maxDistance = 400000;
    this.controls.zoomSpeed = 1.2;
    this.maxAniso = maxAniso;

    this.blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
    this.blank.needsUpdate = true;
    this.blankNormal = new THREE.DataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);
    this.blankNormal.needsUpdate = true;

    // starfield
    const starTex = this.tex('stars.jpg', true);
    this.stars = new THREE.Mesh(
      new THREE.SphereGeometry(8e6, 64, 32),
      new THREE.MeshBasicMaterial({ map: starTex, side: THREE.BackSide, depthWrite: false, color: 0x8a8a8a }),
    );
    this.stars.renderOrder = -10;
    this.scene.add(this.stars);

    // sun glow
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('#fff8e7', '#ffcf7a'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.sunSprite.scale.setScalar(260000);
    this.scene.add(this.sunSprite);

    this.launchMarker = makePin(0x5cc8ff);
    this.impactMarker = makePin(0xff6b5c);
    this.impactMarker.visible = false;
    this.launchMarker.visible = false;
    this.markers.add(this.launchMarker, this.impactMarker);
    this.objectSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('#ffffff', '#ffb547'), depthTest: false, transparent: true, blending: THREE.AdditiveBlending, sizeAttenuation: false }));
    this.objectSprite.scale.setScalar(0.035);
    this.objectSprite.visible = false;
    this.objectSprite.renderOrder = 20;
    this.markers.add(this.objectSprite);
    this.scene.add(this.markers);

    this.buildPlanet('earth');
  }
  private maxAniso: number;

  private tex(name: string, srgb = false): THREE.Texture {
    let t = this.textures.get(name);
    if (!t) {
      t = this.loader.load(textureUrl(name));
      t.anisotropy = this.maxAniso;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(name, t);
    }
    return t;
  }

  /** Ellipsoid mesh with vertices at exact geodetic coordinates. */
  private planetGeometry(id: BodyId, extraHeight = 0, segLon = 512, segLat = 256): THREE.BufferGeometry {
    const ell = BODIES[id].ellipsoid;
    const pos = new Float32Array((segLon + 1) * (segLat + 1) * 3);
    const uv = new Float32Array((segLon + 1) * (segLat + 1) * 2);
    const idx: number[] = [];
    const v = new THREE.Vector3();
    for (let j = 0; j <= segLat; j++) {
      const lat = -90 + (180 * j) / segLat;
      for (let i = 0; i <= segLon; i++) {
        const lon = -180 + (360 * i) / segLon;
        let h = extraHeight;
        if (id === 'earth' && this.exaggeration > 0 && this.geoidGrid) h += sampleGrid(this.geoidGrid, lat, lon) * this.exaggeration;
        const r = geodeticToEcef(lat * DEG, lon * DEG, h, ell);
        ecefToScene(r, v);
        const k = j * (segLon + 1) + i;
        pos.set([v.x, v.y, v.z], k * 3);
        uv.set([i / segLon, j / segLat], k * 2);
        if (i < segLon && j < segLat) {
          const a = k, b = k + 1, c = k + segLon + 1, d = c + 1;
          idx.push(a, b, d, a, d, c);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  buildPlanet(id: BodyId) {
    this.body = id;
    const cfg = BODY_TEX[id];
    if (this.planet) {
      this.scene.remove(this.planet);
      this.planet.geometry.dispose();
      this.planet.material.dispose();
    }
    if (this.clouds) {
      this.scene.remove(this.clouds);
      this.clouds.geometry.dispose();
      this.clouds = null;
    }
    if (this.atmosphere) this.scene.remove(this.atmosphere);
    const isEarth = id === 'earth';
    const mat = new THREE.ShaderMaterial({
      vertexShader: earthVertex,
      fragmentShader: earthFragment,
      uniforms: {
        uDay: { value: this.tex(cfg.day) },
        uNight: { value: isEarth ? this.tex('earth_night.jpg') : this.blank },
        uSpec: { value: isEarth ? this.tex('earth_specular.jpg') : this.blank },
        uNormal: { value: isEarth ? this.tex('earth_normal.jpg') : this.blankNormal },
        uClouds: { value: isEarth ? this.tex('earth_clouds.jpg') : this.blank },
        uHeat: { value: this.blank },
        uHeatOpacity: { value: 0 },
        uSunDir: { value: this.sunDir },
        uIsEarth: { value: isEarth ? 1 : 0 },
        uCloudShift: { value: 0 },
        uRimColor: { value: new THREE.Color(cfg.rim) },
        uNormalStrength: { value: cfg.normal },
      },
    });
    this.planet = new THREE.Mesh(this.planetGeometry(id), mat);
    this.scene.add(this.planet);

    if (isEarth) {
      const cm = new THREE.ShaderMaterial({
        vertexShader: earthVertex,
        fragmentShader: cloudFragment,
        uniforms: { uClouds: { value: this.tex('earth_clouds.jpg') }, uSunDir: { value: this.sunDir }, uShift: { value: 0 } },
        transparent: true,
        depthWrite: false,
      });
      this.clouds = new THREE.Mesh(this.planetGeometry(id, 9000, 256, 128), cm);
      this.clouds.renderOrder = 2;
      this.scene.add(this.clouds);
    }
    const a = BODIES[id].ellipsoid.a / 1000;
    const thick = id === 'earth' ? 1.018 : id === 'jupiter' ? 1.012 : 1.02;
    this.atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(a * thick, 128, 64),
      new THREE.ShaderMaterial({
        vertexShader: atmoVertex,
        fragmentShader: atmoFragment,
        uniforms: { uSunDir: { value: this.sunDir }, uColor: { value: new THREE.Color(cfg.atmo) }, uStrength: { value: cfg.atmoStrength } },
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.atmosphere.scale.y = 1 - BODIES[id].ellipsoid.f;
    this.atmosphere.visible = cfg.atmoStrength > 0;
    this.scene.add(this.atmosphere);
    this.controls.minDistance = a + 0.3;
    this.applyHeat();
  }

  setGeoidGrid(g: GridData) {
    this.geoidGrid = g;
  }

  /** Exaggerate the geoid (the "Potsdam gravity potato"). 0 = true shape. */
  setGeoidExaggeration(x: number) {
    if (this.body !== 'earth') return;
    this.exaggeration = x;
    const old = this.planet.geometry;
    this.planet.geometry = this.planetGeometry('earth');
    old.dispose();
  }

  setSun(dirEcef: Vec3) {
    ecefToScene(dirEcef, this.sunDir).normalize();
    this.sunSprite.position.copy(this.sunDir).multiplyScalar(4e6);
  }
  get sunDirection() {
    return this.sunDir;
  }

  private heatMode: HeatmapMode = 'off';
  private heatOpacity = 0.75;
  setHeatmap(mode: HeatmapMode, texture?: THREE.Texture, opacity = 0.75) {
    this.heatMode = mode;
    this.heatOpacity = opacity;
    if (texture) this.heatTextures.set(mode, texture);
    this.applyHeat();
  }
  private applyHeat() {
    const u = this.planet.material.uniforms;
    const t = this.heatTextures.get(this.heatMode);
    u.uHeat.value = t ?? this.blank;
    u.uHeatOpacity.value = this.heatMode !== 'off' && this.body === 'earth' && t ? this.heatOpacity : 0;
    if (this.clouds) this.clouds.visible = this.heatMode === 'off';
  }

  /** Ray-pick the planet surface; returns geodetic lat/lon (deg). */
  pick(ndc: THREE.Vector2): { lat: number; lon: number } | null {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(this.planet, false)[0];
    if (!hit) return null;
    const g = ecefToGeodetic(sceneToEcef(hit.point), BODIES[this.body].ellipsoid);
    return { lat: g.lat / DEG, lon: g.lon / DEG };
  }

  /** Fly the camera to look down at (lat, lon) from `altKm` above it. */
  flyTo(lat: number, lon: number, altKm: number, dur = 2.2) {
    const ell = BODIES[this.body].ellipsoid;
    const to = ecefToScene(geodeticToEcef(lat * DEG, lon * DEG, altKm * 1000, ell));
    this.flight = { from: this.camera.position.clone(), to, t0: performance.now(), dur: dur * 1000 };
  }

  get altitudeKm(): number {
    return this.camera.position.length() - BODIES[this.body].ellipsoid.a / 1000;
  }

  setLaunch(lat: number, lon: number, hMSL: number) {
    placePin(this.launchMarker, lat, lon, hMSL, this.body);
    this.launchMarker.visible = true;
  }
  setImpact(lat: number | null, lon = 0, hMSL = 0) {
    this.impactMarker.visible = lat !== null;
    if (lat !== null) placePin(this.impactMarker, lat, lon, hMSL, this.body);
  }

  setObjectPosition(ecef: Vec3 | null) {
    this.objectSprite.visible = !!ecef;
    if (ecef) ecefToScene(ecef, this.objectSprite.position);
  }

  /** Trajectory polyline from ECEF samples [m]. */
  setTrajectory(id: string, ecef: Float32Array | number[], color: number, width = 2.5, dashed = false) {
    this.removeTrajectory(id);
    if (ecef.length < 6) return;
    const pos = new Float32Array(ecef.length);
    for (let i = 0; i < ecef.length; i += 3) {
      pos[i] = ecef[i] / 1000;
      pos[i + 1] = ecef[i + 2] / 1000;
      pos[i + 2] = -ecef[i + 1] / 1000;
    }
    const g = new LineGeometry();
    g.setPositions(pos);
    const m = new LineMaterial({ color, linewidth: width, transparent: true, opacity: dashed ? 0.6 : 0.95, dashed, dashSize: 50, gapSize: 30, worldUnits: false });
    m.resolution.copy(this.resolution);
    const line = new Line2(g, m);
    if (dashed) line.computeLineDistances();
    line.renderOrder = 5;
    this.scene.add(line);
    this.trajs.set(id, { line, material: m });
  }
  removeTrajectory(id: string) {
    const t = this.trajs.get(id);
    if (!t) return;
    this.scene.remove(t.line);
    t.line.geometry.dispose();
    t.material.dispose();
    this.trajs.delete(id);
  }
  clearTrajectories() {
    for (const id of [...this.trajs.keys()]) this.removeTrajectory(id);
  }

  setSize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.resolution.set(w, h);
    for (const t of this.trajs.values()) t.material.resolution.set(w, h);
  }

  update(dt: number) {
    if (this.flight) {
      const f = this.flight;
      const s = Math.min(1, (performance.now() - f.t0) / f.dur);
      const e = s < 0.5 ? 4 * s * s * s : 1 - (-2 * s + 2) ** 3 / 2;
      const r0 = f.from.length(), r1 = f.to.length();
      const dir = f.from.clone().normalize().lerp(f.to.clone().normalize(), e).normalize();
      // altitude: log-interpolate, with a lift in the middle for long flights
      const R = BODIES[this.body].ellipsoid.a / 1000;
      const ang = f.from.angleTo(f.to);
      const a0 = Math.max(r0 - R, 0.1), a1 = Math.max(r1 - R, 0.1);
      const lift = Math.sin(Math.PI * e) * ang * R * 0.6;
      const alt = Math.exp(Math.log(a0) * (1 - e) + Math.log(a1) * e) + lift;
      this.camera.position.copy(dir.multiplyScalar(R + alt));
      if (s >= 1) this.flight = null;
    }
    const alt = Math.max(this.altitudeKm, 0.01);
    const R = BODIES[this.body].ellipsoid.a / 1000;
    this.controls.rotateSpeed = Math.min(1, Math.max(0.0005, (alt / R) * 0.9));
    this.controls.zoomSpeed = 1.2;
    this.camera.near = Math.max(0.0005, alt * 0.0005);
    this.camera.far = 2e7;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.cloudShift = (this.cloudShift + dt * 0.0000035) % 1;
    if (this.clouds) this.clouds.material.uniforms.uShift.value = this.cloudShift;
    this.planet.material.uniforms.uCloudShift.value = this.cloudShift;
    this.stars.position.copy(this.camera.position);
    // pins keep a constant on-screen size
    for (const m of [this.launchMarker, this.impactMarker]) {
      const d = m.position.distanceTo(this.camera.position);
      m.scale.setScalar(Math.max(d * 0.018, 0.002));
    }
  }

  render(renderer: THREE.WebGLRenderer) {
    renderer.toneMappingExposure = 1.0;
    renderer.render(this.scene, this.camera);
  }
}

function makePin(color: number): THREE.Group {
  const g = new THREE.Group();
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1, 16), new THREE.MeshBasicMaterial({ color, depthTest: true }));
  cone.rotation.x = Math.PI;
  cone.position.y = 0.5;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 40), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.8 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.01;
  g.add(cone, ring);
  return g;
}

function placePin(pin: THREE.Group, lat: number, lon: number, h: number, body: BodyId) {
  const ell = BODIES[body].ellipsoid;
  ecefToScene(geodeticToEcef(lat * DEG, lon * DEG, h, ell), pin.position);
  const up = new THREE.Vector3(Math.cos(lat * DEG) * Math.cos(lon * DEG), Math.sin(lat * DEG), -Math.cos(lat * DEG) * Math.sin(lon * DEG));
  pin.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
}

export function glowTexture(inner: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.15, inner);
  grd.addColorStop(0.35, outer + 'aa');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/* ---------------- gravity heatmaps ---------------- */

export interface HeatLegend {
  title: string;
  unit: string;
  min: number;
  max: number;
  gradient: string;
}

const DIVERGING = ['#053061', '#2166ac', '#4393c3', '#92c5de', '#f7f7f7', '#f4a582', '#d6604d', '#b2182b', '#67001f'];
const TURBO = ['#30123b', '#4145ab', '#4675ed', '#39a2fc', '#1bcfd4', '#24eca6', '#61fc6c', '#a4fc3b', '#d1e834', '#f3c63a', '#fe9b2d', '#f36315', '#d93806', '#b11901', '#7a0402'];

function hexToRgb(h: string): [number, number, number] {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function ramp(stops: string[], t: number): [number, number, number] {
  const x = Math.min(Math.max(t, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const f = x - i;
  const a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function heatmapTexture(grid: GridData, mode: Exclude<HeatmapMode, 'off'>): { texture: THREE.Texture; legend: HeatLegend } {
  const { nLon, nLat } = grid;
  const c = document.createElement('canvas');
  c.width = nLon;
  c.height = nLat;
  const g = c.getContext('2d')!;
  const img = g.createImageData(nLon, nLat);
  let min: number, max: number, stops: string[], title: string, unit: string;
  if (mode === 'anomaly') { min = -250; max = 250; stops = DIVERGING; title = 'Gravity disturbance (EGM2008, n ≤ 360)'; unit = 'mGal'; }
  else if (mode === 'geoid') { min = -100; max = 80; stops = DIVERGING; title = 'Geoid height above WGS 84 ellipsoid'; unit = 'm'; }
  else { min = 9.776; max = 9.834; stops = TURBO; title = 'Surface gravity |g| on the ellipsoid (incl. rotation)'; unit = 'm/s²'; }
  const mid = mode === 'geoid' ? 0 : (min + max) / 2;
  for (let j = 0; j < nLat; j++) {
    for (let i = 0; i < nLon; i++) {
      const v = grid.data[j * nLon + i];
      let t: number;
      if (mode === 'gravity') t = (v - min) / (max - min);
      else t = v < mid ? 0.5 * (v - min) / (mid - min) : 0.5 + 0.5 * (v - mid) / (max - mid);
      const [r, gg, b] = ramp(stops, t);
      // canvas row 0 = top = north; grid row 0 = south
      const o = ((nLat - 1 - j) * nLon + i) * 4;
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.flipY = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  // the shader works in linear space and re-encodes: pre-linearise the sRGB ramp
  const lin = g.getImageData(0, 0, nLon, nLat);
  for (let k = 0; k < lin.data.length; k += 4) for (let ch = 0; ch < 3; ch++) lin.data[k + ch] = Math.round(255 * (lin.data[k + ch] / 255) ** 2.2);
  g.putImageData(lin, 0, 0);
  tex.needsUpdate = true;
  return { texture: tex, legend: { title, unit, min, max, gradient: `linear-gradient(90deg, ${stops.join(',')})` } };
}
