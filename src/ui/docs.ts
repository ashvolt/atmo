import katex from 'katex';
import 'katex/dist/katex.min.css';
import { h, modal } from './dom';
import { F } from '../physics/simulation';
import type { ObjectSpec } from '../physics/objects';
import { MATERIALS } from '../physics/objects';
import type { ValidationResult } from '../validation/cases';
import { WGS84 } from '../physics/constants';

const tex = (s: string, display = true) => katex.renderToString(s, { displayMode: display, throwOnError: false });
const n = (v: number, d = 4) => (Number.isFinite(v) ? (Math.abs(v) >= 1e5 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(d - 1) : (+v.toPrecision(d)).toString()) : '—');

export function showEquations(row: Float64Array | null, obj: ObjectSpec | null, body: string) {
  const live = (lines: string[]) => (row ? h('div', { class: 'eq-live' }, lines.join('\n')) : null);
  const r = row ?? new Float64Array(64);
  const A = obj?.area ?? 0;
  const m = obj?.mass ?? 1;
  const v = r[F.airspeed];
  const fd = 0.5 * r[F.rho] * r[F.cd] * A * v * v;
  const blocks: [string, string, string[], HTMLElement | null][] = [
    [
      'Gravity — EGM2008 spherical harmonics',
      String.raw`V(r,\varphi,\lambda)=\frac{GM}{r}\sum_{n=0}^{N}\left(\frac{a}{r}\right)^{n}\sum_{m=0}^{n}\bar P_{nm}(\sin\varphi)\left[\bar C_{nm}\cos m\lambda+\bar S_{nm}\sin m\lambda\right],\qquad \mathbf g=\nabla V`,
      [
        `Earth's gravitational potential is expanded in 65 341 coefficient pairs of NGA's EGM2008 model (truncated at degree N = 360, ≈ 55 km resolution; the simulator uses N chosen in Numerics). Associated Legendre functions are evaluated with the Holmes–Featherstone recursion (u^m factored out) so the field is exact and finite at the poles. The gradient is analytic and verified against finite differences of the potential.`,
        `Normal (reference) gravity on the WGS 84 ellipsoid follows Somigliana's closed formula; it is used for comparison and validation:`,
      ],
      live([`|g| here = ${n(r[F.gLocal], 7)} m/s²   (gravitation ${n(r[F.gGrav], 7)} m/s² minus the centrifugal part)`]),
    ],
    ['Normal gravity (Somigliana)', String.raw`\gamma(\varphi)=\gamma_e\,\frac{1+k\sin^2\varphi}{\sqrt{1-e^2\sin^2\varphi}},\quad k=\frac{b\,\gamma_p}{a\,\gamma_e}-1,\quad \gamma_e=9.780\,325\,3359,\ \gamma_p=9.832\,184\,9378\ \mathrm{m/s^2}`, [], null],
    [
      'Equation of motion in the rotating (Earth-fixed) frame',
      String.raw`(m+C_a\rho V_b)\,\dot{\mathbf v}=(m-\rho V_b)\big(\mathbf g-\boldsymbol\Omega\times(\boldsymbol\Omega\times\mathbf r)\big)+\mathbf F_D+\mathbf F_M-2m\,\boldsymbol\Omega\times\mathbf v`,
      [
        `Integrated in ECEF coordinates, so the atmosphere and the ground are at rest and Earth's rotation appears as the centrifugal and Coriolis terms (Ω = ${WGS84.omega} rad/s). Buoyancy (ρV_b) and the added mass of the displaced fluid (C_a ρ V_b, ½ for a sphere) matter in water and for very light objects.`,
      ],
      live([`Coriolis acceleration |2Ω×v| = ${n(r[F.coriolis], 4)} m/s²`, `buoyancy force = ${n(r[F.buoy], 4)} N   (weight = ${n(m * r[F.gLocal], 4)} N)`]),
    ],
    [
      'Aerodynamic drag',
      String.raw`\mathbf F_D=-\tfrac12\,\rho\,C_D(\mathrm{Re},M,\mathrm{Kn})\,A\,|\mathbf u|\,\mathbf u,\qquad \mathbf u=\mathbf v-\mathbf v_{wind},\quad \mathrm{Re}=\frac{\rho u D}{\mu},\ M=\frac{u}{a},\ \mathrm{Kn}=\frac{\lambda}{D}`,
      [
        `C_D combines the measured smooth-sphere drag curve (Clift, Grace & Weber 1978, including the drag crisis at Re ≈ 3.5×10⁵), compressibility from wind-tunnel data (Miller & Bailey 1979; Bailey & Hiatt 1972; Hoerner 1965) and rarefied flow: a sin² bridge in log Kn from continuum (Kn < 0.01) to the exact free-molecular result of Schaaf & Chambré. Raindrops use drag derived from Gunn & Kinzer's 1949 measurements; baseballs and golf balls use fits to tracking-radar data.`,
      ],
      live([
        `ρ = ${n(r[F.rho])} kg/m³, u = ${n(v)} m/s, A = ${n(A)} m², Re = ${n(r[F.re])}, M = ${n(r[F.mach])}, Kn = ${n(r[F.kn])}`,
        `C_D = ${n(r[F.cd])}`,
        `F_D = ½ × ${n(r[F.rho])} × ${n(r[F.cd])} × ${n(A)} × ${n(v)}² = ${n(fd)} N  →  ${n(fd / m)} m/s² on ${n(m)} kg`,
      ]),
    ],
    [
      'Magnus lift (spinning balls)',
      String.raw`\mathbf F_M=\tfrac12\,\rho\,A\,C_L(S)\,u^2\,\frac{\boldsymbol\omega\times\mathbf u}{|\boldsymbol\omega\times\mathbf u|},\qquad S=\frac{r\omega}{u},\qquad \dot\omega=-\frac{C_M\rho u A r^2}{I}\,\omega`,
      [`C_L(S) from Sawicki, Hubbard & Stronge (2003) / Nathan (2008); baseball and golf use their tracking-data fits. Spin decays under aerodynamic torque (≈ 3–5 %/s).`],
      live([`spin = ${n((r[F.spin] * 60) / (2 * Math.PI))} rpm, C_L = ${n(r[F.cl])}`]),
    ],
    [
      'Atmosphere — U.S. Standard Atmosphere 1976',
      String.raw`\frac{dp}{dz}=-\rho g,\quad p=\rho\frac{R^*T}{M},\quad T=T_b+L_b(H-H_b),\quad H=\frac{r_0 z}{r_0+z}`,
      [
        `Seven geopotential layers to 86 km are evaluated in closed form; 86–1000 km uses the 1976 diffusion model, anchored exactly to the published density tables. Weather options re-integrate the hydrostatic equation with a shifted temperature profile; humidity lowers the density through the virtual-temperature effect. Mars uses the NASA Glenn MGS model; Jupiter the Galileo-probe profile with an adiabatic interior.`,
      ],
      live([`T = ${n(r[F.Tair] - 273.15)} °C, p = ${n(r[F.pAir])} Pa, ρ = ${n(r[F.rho])} kg/m³  (${body})`]),
    ],
    [
      'Aerodynamic heating & ablation',
      String.raw`\dot q_s=k\sqrt{\rho/r_n}\,V^3\ \ (\text{Sutton–Graves}),\qquad m c\,\dot T_w=\big(\tfrac12\dot q_s A\big)\Big(1-\frac{T_w}{T_r}\Big)-\varepsilon\sigma A_s(T_w^4-T_0^4),\qquad \dot m=-\frac{\dot Q_{net}}{Q^*}\ (T_w\ge T_{abl})`,
      [`k = 1.7415×10⁻⁴ kg^½/m for air. In free-molecular flow the input tends to Λ·½ρV³ (Λ ≈ 1). The body heats as a thin skin; when it reaches its ablation temperature further heat removes mass with the material's effective heat of ablation Q* (8 MJ/kg for stone and iron, as in meteor physics).`],
      live([`q̇ = ${n(r[F.qStag] / 1000)} kW/m², heat input = ${n(r[F.heatW])} W, T_wall = ${n(r[F.Tw] - 273.15)} °C, mass = ${n(r[F.mass])} kg${obj ? ` (${MATERIALS[obj.material]?.name})` : ''}`]),
    ],
    [
      'Numerical integration',
      String.raw`\mathbf y_{n+1}=\mathbf y_n+h\sum_{i=1}^{7}b_i\mathbf k_i,\qquad \mathrm{err}=\Big\|\frac{h\sum_i e_i\mathbf k_i}{\mathrm{atol}+\mathrm{rtol}\,|\mathbf y|}\Big\|_{2}\le1`,
      [`Dormand–Prince 5(4) with FSAL and 4th-order dense output; step size adapts to keep the local error within tolerance (default rtol = 10⁻¹⁰). Ground impact, water entry, parachute deployment, apogee and burn-up are located as roots of event functions on the dense output (Illinois method) to better than 1 ns.`],
      null,
    ],
  ];
  const body2 = h('div', {});
  body2.append(h('h2', {}, 'The physics, equation by equation'), h('div', { class: 'sub' }, row ? `Live values are taken at the current playback time T+${row[F.t].toFixed(2)} s.` : 'Run a simulation to see live values for each equation.'));
  for (const [title, eq, paras, liveEl] of blocks) {
    const b = h('div', { class: 'eq-block' }, h('h4', {}, title), h('div', { html: tex(eq) }), ...paras.map((p) => h('p', {}, p)));
    if (liveEl) b.append(liveEl);
    body2.append(b);
  }
  modal(body2);
}

export function showValidation(run: (progress: (f: number) => void) => Promise<ValidationResult[]>) {
  const status = h('div', { class: 'sub' }, 'Running validation cases in the simulation worker…');
  const table = h('div');
  const body = h('div', {}, h('h2', {}, 'Validation report'), status, table,
    h('p', { class: 'hint' }, 'These cases run inside the app with exactly the code you are using. The full automated suite (gravity, atmosphere, integrator, real-world data) runs with `npm test`. Known model limitations are shown in amber with their measured size, never hidden.'));
  modal(body);
  run((f) => (status.textContent = `Running validation cases… ${Math.round(f * 100)} %`)).then((res) => {
    const pass = res.filter((r) => r.pass).length;
    status.innerHTML = `<b class="${pass === res.length ? 'pass' : 'fail'}">${pass} / ${res.length} cases within tolerance</b>`;
    const t = h('table', {}, h('tr', {}, ...['Area', 'Case', 'Reference', 'Expected', 'Model', 'Error', 'Tolerance', ''].map((x) => h('th', {}, x))));
    for (const r of res) {
      const limit = r.note?.startsWith('KNOWN LIMITATION');
      const err = r.errorKind === 'relative' ? `${(r.error * 100).toPrecision(2)} %` : `${r.error.toExponential(2)} ${r.unit}`;
      const tol = r.errorKind === 'relative' ? `${(r.tolerance * 100).toPrecision(2)} %` : `${r.tolerance.toExponential(0)} ${r.unit}`;
      t.append(h('tr', {},
        h('td', {}, r.group),
        h('td', {}, r.name, r.note ? h('div', { class: limit ? 'hint limit' : 'hint' }, r.note) : null),
        h('td', {}, r.reference, h('div', { class: 'hint' }, r.source)),
        h('td', { class: 'num' }, `${+r.expected.toPrecision(10)} ${r.unit}`),
        h('td', { class: 'num' }, `${+r.actual.toPrecision(10)} ${r.unit}`),
        h('td', { class: 'num' }, err),
        h('td', { class: 'num' }, tol),
        h('td', { class: r.pass ? (limit ? 'limit' : 'pass') : 'fail' }, r.pass ? (limit ? '≈' : '✔') : '✘')));
    }
    table.append(t);
  }).catch((e) => (status.textContent = `Validation failed: ${e.message}`));
}

export function showCredits() {
  const li = (t: string) => h('li', { html: t });
  modal(h('div', {},
    h('h2', {}, 'Data sources & credits'),
    h('div', { class: 'sub' }, 'Every model and dataset used by the simulator, with its licence.'),
    h('ul', { style: 'line-height:1.8' },
      li('<b>Gravity:</b> EGM2008 (N. K. Pavlis et al., NGA, 2012) via ICGEM/GFZ Potsdam, truncated to degree 360. WGS 84 constants: NIMA TR8350.2.'),
      li('<b>Atmosphere:</b> U.S. Standard Atmosphere 1976 (NASA-TM-X-74335); upper-atmosphere species profile computed with the <code>ussa1976</code> Python package and anchored to the published density tables.'),
      li('<b>Elevation & bathymetry:</b> AWS Terrain Tiles (Mapzen/Tilezen): SRTM, GMTED2010, ETOPO1, NRCan CDEM, Australia DEM, EU-DEM and others — see tilezen/joerd attribution.'),
      li('<b>Satellite imagery:</b> Sentinel-2 cloudless — <a href="https://s2maps.eu" target="_blank" rel="noopener">s2maps.eu</a> by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2016), CC BY 4.0.'),
      li('<b>Planet textures:</b> Solar System Scope (<a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener">solarsystemscope.com</a>), CC BY 4.0, based on NASA imagery.'),
      li('<b>Places:</b> GeoNames cities15000, CC BY 4.0 (searched offline — your queries never leave the browser).'),
      li('<b>Planetary gravity:</b> Moon GRAIL GL0660B (Konopliv 2014), Mars MRO120D (Konopliv 2016), Jupiter Juno (Iess et al. 2018).'),
      li('<b>Drag & heating:</b> Clift, Grace & Weber (1978); Miller & Bailey (1979); Bailey & Hiatt (1972); Hoerner (1965); Schaaf & Chambré (1958); Gunn & Kinzer (1949); Sutton & Graves (1971); Nathan (2008, 2018); Smits & Smith (1994).'),
      li('<b>Magnetic fields:</b> circular-loop closed form from Simpson, Lane, Immer & Youngquist (NASA/TM-2001-210956); block-magnet surface-charge solution from Furlani, <i>Permanent Magnet and Electromechanical Devices</i> (2001); complete elliptic integrals by Carlson’s symmetric forms (Numer. Math. 33 (1979) 1).'),
      li('<b>Magnetic materials:</b> volume susceptibilities from J. F. Schenck, Med. Phys. 23 (1996) 815 and the CRC Handbook, 97th ed.; pyrolytic graphite anisotropy from Simon & Geim, J. Appl. Phys. 87 (2000) 6200; superconductor data from Wu et al. (1987), Murakami (2000), Lee & Larbalestier (2008) and Nagamatsu et al. (2001).'),
      li('<b>Levitation:</b> Earnshaw (1842); Berry & Geim, Eur. J. Phys. 18 (1997) 307; Berry, Proc. R. Soc. A 452 (1996) 1207; Simon, Heflinger & Ridgway, Am. J. Phys. 65 (1997) 286; Bean, Rev. Mod. Phys. 36 (1964) 31; Landau & Lifshitz, <i>Electrodynamics of Continuous Media</i> §59; Post & Ryutov, IEEE Trans. Appl. Supercond. 10 (2000) 901; Gor’kov (1962) and Bruus, Lab Chip 12 (2012) 1014; Ashkin, Phys. Rev. Lett. 24 (1970) 156; Montgomery, <i>Solenoid Magnet Design</i> (1969); Osborn, Phys. Rev. 67 (1945) 351.'),
      li('<b>Antigravity bounds:</b> Touboul et al. (MICROSCOPE), Phys. Rev. Lett. 129 (2022) 121102; Williams, Turyshev & Boggs, Phys. Rev. Lett. 93 (2004) 261101; Tajmar et al., Acta Astronautica 141 (2017) 8; Anderson et al. (ALPHA-g), Nature 621 (2023) 716; Everitt et al. (Gravity Probe B), Phys. Rev. Lett. 106 (2011) 221101.'),
      li('<b>Exact derivatives:</b> hyper-dual arithmetic after Fike & Alonso, AIAA 2011-886.'),
      li('<b>Rendering:</b> three.js, uPlot, KaTeX.'),
    ),
    h('p', { class: 'hint' }, 'Privacy: map tiles are requested from AWS and EOX for the area you view (no account or personal data is sent). All physics runs locally in your browser.')));
}
