import katex from 'katex';
import { h, modal } from './dom';
import { CLAIMS, CLAIM_STATUS_LABEL, IMPOSSIBILITY_STEPS, type Claim } from '../physics/em/claims';
import { COOLING_LABEL } from '../physics/em/engineering';
import { EARNSHAW_ESCAPE, TIER_LABEL, LEV_MODES, type LevMode } from '../physics/em/levitation';
import { MODE_LABEL, MODE_SHORT } from '../app/levscenario';
import type { LevSolution, Requirement } from '../physics/em/solve';
import type { ValidationResult } from '../validation/cases';

const tex = (s: string, display = true) => katex.renderToString(s, { displayMode: display, throwOnError: false });

/** engineering notation with a unit, chosen so the number stays readable */
export function fmtVal(v: number, unit: string): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '—';
  const a = Math.abs(v);
  const prefixes: [number, string][] = [
    [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'],
  ];
  if (unit === '' || unit === '×' || unit === 'dB') return `${+v.toPrecision(4)}${unit ? ' ' + unit : ''}`;
  if (a === 0) return `0 ${unit}`;
  if (a >= 1e12 || a < 1e-12) return `${v.toExponential(3)} ${unit}`;
  for (const [f, p] of prefixes) {
    if (a >= f) return `${+(v / f).toPrecision(4)} ${p}${unit}`;
  }
  return `${v.toExponential(3)} ${unit}`;
}

const reqRows = (list: Requirement[]) =>
  list.map((r) => h('tr', { class: r.binding ? 'binding' : '' },
    h('td', {}, r.label, r.note ? h('div', { class: 'hint' }, r.note) : null),
    h('td', { class: 'num' }, fmtVal(r.value, r.unit))));

/* ------------------------------------------------------------ verdict card */

export function verdictCard(s: LevSolution): string {
  const v = s.verdict;
  const cls = v.works ? 'works' : v.possible ? 'partial' : 'impossible';
  const badge = v.works ? '✓ IT LEVITATES' : v.possible ? '△ NOT AS SET UP' : '✗ IMPOSSIBLE';
  const st = s.stability;
  const freq = st && st.stable
    ? `${st.frequencies.map((f) => (Number.isFinite(f) ? f.toPrecision(3) : '—')).join(' / ')} Hz`
    : st
      ? `${st.unstableDirections} unstable direction${st.unstableDirections === 1 ? '' : 's'}`
      : '—';
  return `
    <div class="verdict ${cls}">
      <div class="badge">${badge}</div>
      <h4>${v.headline}</h4>
      <div class="tier">${TIER_LABEL[v.tier]} — ${v.tierNote}</div>
      <div class="kv">
        <span>Mass</span><span>${fmtVal(s.mass, 'kg')}</span>
        <span>Weight to beat</span><span>${fmtVal(s.weight, 'N')}</span>
        ${s.equilibriumHeight !== null ? `<span>Equilibrium height</span><span>${fmtVal(s.equilibriumHeight, 'm')}</span>` : ''}
        <span>Stability</span><span>${freq}</span>
        <span>Earnshaw</span><span>${s.earnshaw.escapes ? 'escaped' : 'applies'}</span>
      </div>
      <div class="why">${v.reason}</div>
    </div>`;
}

/* ----------------------------------------------------- the full report modal */

export function showLevReport(s: LevSolution) {
  const body = h('div', {});
  body.append(
    h('h2', {}, `${MODE_LABEL[s.mode]} — ${s.objectName}`),
    h('div', { class: 'sub' }, `${s.apparatusName}. ${s.verdict.headline}`),
    h('div', { html: verdictCard(s) }),
  );

  if (s.requirements.length) {
    body.append(h('h4', {}, 'What it requires'),
      h('table', { class: 'reqtable' }, ...reqRows(s.requirements)));
  }
  if (s.achieved.length) {
    body.append(h('h4', {}, 'What this apparatus delivers'),
      h('table', { class: 'reqtable' }, ...reqRows(s.achieved)));
  }
  if (s.explanation.length) {
    body.append(h('h4', {}, 'Why'), ...s.explanation.map((p) => h('p', {}, p)));
  }
  body.append(
    h('h4', {}, 'Earnshaw’s theorem, for this mode'),
    h('p', { class: s.earnshaw.escapes ? 'escape-yes' : 'escape-no' }, s.earnshaw.how),
  );
  if (s.warnings.length) {
    body.append(h('h4', {}, 'Caveats and known limitations'),
      h('ul', {}, ...s.warnings.map((w) => h('li', { class: w.startsWith('KNOWN LIMITATION') ? 'limit' : '' }, w))));
  }
  modal(body);
}

/* ------------------------------------------------------------- build sheet */

export function showBuildSheet(s: LevSolution) {
  const b = s.build;
  const body = h('div', {});
  body.append(h('h2', {}, 'Build sheet'), h('div', { class: 'sub' }, `What it would take to levitate ${s.objectName} this way.`));
  if (!b && !s.servo) {
    body.append(
      h('p', {}, 'This mode needs no magnet to size — the hardware is the apparatus itself. These are the numbers that specify it.'),
      h('table', { class: 'reqtable' }, ...reqRows(s.requirements), ...reqRows(s.achieved)),
      h('div', { class: `tierline ${s.verdict.tier}` }, `${TIER_LABEL[s.verdict.tier]} — ${s.verdict.tierNote}`),
    );
    modal(body);
    return;
  }
  if (b) {
    const rows: [string, string, string?][] = [
      ['Target peak field', fmtVal(b.field, 'T')],
      ['Bore radius', fmtVal(b.bore, 'm')],
      ['Winding length', fmtVal(b.length, 'm')],
      ['Technology', COOLING_LABEL[b.tech]],
      ['Amp-turns', fmtVal(b.ampTurns, 'A·t'), 'NI = B√(L²+4r²)/μ₀'],
      ['Current density', fmtVal(b.currentDensity, 'A/m²'), 'what the Fabry relation demands for this field and bore'],
      ['Turns × current', `${b.turns} × ${fmtVal(b.current, 'A')}`],
      ['Wire', `AWG ${b.wire.gauge}${b.wire.strands > 1 ? ` × ${b.wire.strands} in parallel` : ''} (${fmtVal(b.wire.diameter, 'm')} dia.)`],
      ['Conductor length', fmtVal(b.conductorLength, 'm')],
      ['Conductor mass', fmtVal(b.conductorMass, 'kg')],
      ['Winding resistance', fmtVal(b.resistance, 'Ω')],
      ['Ohmic power', fmtVal(b.power, 'W'), b.tech === 'superconducting' ? 'zero: a superconductor carries DC without loss' : 'P = (B/μ₀G)²·ρa₁/λ, the Fabry relation'],
      ['Cooling water', `${fmtVal(b.coolingLitresPerMin, 'L/min')} for a 30 K rise`],
      ['Stored magnetic energy', fmtVal(b.storedEnergy, 'J')],
      ['Lorentz hoop stress', fmtVal(b.hoopStress, 'Pa'), `against ~250 MPa for hard copper — ${b.stressOk ? 'within reach' : 'needs reinforcement'}`],
      ['Conductor cost (indicative)', `$${Math.round(b.conductorCost).toLocaleString('en-US')}`],
      ['Electricity', `$${b.energyCostPerHour.toFixed(2)} per hour`],
    ];
    body.append(h('table', { class: 'reqtable' }, ...rows.map(([k, v, note]) =>
      h('tr', {}, h('td', {}, k, note ? h('div', { class: 'hint' }, note) : null), h('td', { class: 'num' }, v)))));
    body.append(h('div', { class: `tierline ${s.verdict.tier}` }, `${TIER_LABEL[b.tier]} — ${s.verdict.tierNote}`));
    if (b.warnings.length) body.append(h('ul', {}, ...b.warnings.map((w) => h('li', { class: 'limit' }, w))));
    body.append(h('p', { class: 'hint' }, 'The power figure is the Fabry relation B = μ₀G√(λP/ρa₁), the standard sizing law for resistive magnets (Montgomery 1969). It reproduces the 35 T / 20 MW NHMFL magnet to within a per cent, and it says the thing that matters: for a given bore the field is bought with power, and no amount of extra copper changes that.'));
  }
  if (s.servo) {
    const d = s.servo;
    body.append(h('h4', {}, 'Control loop'),
      h('table', { class: 'reqtable' },
        ...([
          ['Operating current', fmtVal(d.current, 'A')],
          ['Gap flux density', fmtVal(d.B, 'T')],
          ['Open-loop pole', `${fmtVal(d.unstablePole, '1/s')} (doubles every ${((Math.LN2 * 1000) / d.unstablePole).toFixed(0)} ms)`],
          ['Position stiffness', fmtVal(d.kx, 'N/m')],
          ['Current stiffness', fmtVal(d.ki, 'N/A')],
          ['Proportional gain', fmtVal(d.kp, 'A/m')],
          ['Derivative gain', fmtVal(d.kd, 'A·s/m')],
          ['Closed loop', `${d.bandwidth.toFixed(0)} Hz at ζ = ${d.damping}`],
          ['Sensor bandwidth needed', fmtVal(d.sensorBandwidth, 'Hz')],
          ['Current ripple per µm of sensor noise', fmtVal(d.currentNoise, 'A')],
        ] as [string, string][]).map(([k, v]) => h('tr', {}, h('td', {}, k), h('td', { class: 'num' }, v)))),
      h('p', { class: 'hint' }, 'Sensor noise becomes current ripple, and current ripple becomes force ripple. Maglev ride quality is as much a sensor problem as a magnet problem.'));
  }
  modal(body);
}

/* -------------------------------------------------------- Earnshaw explorer */

export function showEarnshaw(s: LevSolution | null) {
  const body = h('div', {});
  body.append(
    h('h2', {}, 'Earnshaw’s theorem — and the five ways out'),
    h('div', { class: 'sub' }, 'Why no arrangement of magnets can hold another magnet still, and why a lump of graphite is different.'),
    h('div', { class: 'eq-block' },
      h('h4', {}, 'The theorem'),
      h('div', { html: tex(String.raw`\nabla^2 B_i = 0 \;\Rightarrow\; U=-\mathbf m\cdot\mathbf B \;\Rightarrow\; \nabla^2 U = 0 \;\Rightarrow\; k_x + k_y + k_z = 0`) }),
      h('p', {}, 'In a region with no currents, every Cartesian component of B is a harmonic function. For a fixed magnetic moment the interaction energy is a linear combination of those components, so it is harmonic too — and the trace of its Hessian, which is the sum of the three stiffnesses, is exactly zero.'),
      h('p', {}, 'That is the whole argument. Positive stiffness in one direction must be paid for with negative stiffness in another. There is no clever geometry, no number of magnets, and no strength of field that avoids it.'),
      s ? h('div', { class: 'eq-live' }, liveTrace(s)) : null),
    h('div', { class: 'eq-block' },
      h('h4', {}, 'The escape clause'),
      h('div', { html: tex(String.raw`U=-\frac{\chi V}{2\mu_0}B^2,\qquad \nabla^2(B^2)=2|\nabla\mathbf B|^2\ \ge 0`) }),
      h('p', {}, 'If the moment is induced rather than fixed, the energy depends on B² instead of B — and B² is not harmonic. Its Laplacian is a sum of squares, so it is never negative. A function with a non-negative Laplacian can have a minimum but never a maximum.'),
      h('p', {}, 'So a diamagnet (χ < 0), whose energy rises with B², can sit in a genuine minimum and is stable. A paramagnet (χ > 0) would need a maximum of B², which cannot exist. The sign of one susceptibility decides the whole question.')),
    h('h4', {}, 'What each mode breaks'),
  );
  const table = h('table', { class: 'reqtable earnshaw' });
  for (const m of LEV_MODES as readonly LevMode[]) {
    const e = EARNSHAW_ESCAPE[m];
    table.append(h('tr', { class: e.escapes ? 'escape-yes' : 'escape-no' },
      h('td', { style: 'white-space:nowrap' }, `${MODE_SHORT[m]} ${MODE_LABEL[m]}`),
      h('td', {}, e.escapes ? '✓ ' : '✗ ', e.how)));
  }
  body.append(table);
  body.append(h('p', { class: 'hint' }, 'Open the energy surface in the 3-D view to see this directly: for a fixed dipole the equilibrium is a mountain pass, and the escape direction is drawn as an arrow. For a diamagnet it is a basin.'));
  modal(body);
}

function liveTrace(s: LevSolution): string {
  const tr = s.achieved.find((r) => r.label.startsWith('Trace'));
  const st = s.stability;
  if (!st) return 'Solve a scenario to see the live numbers.';
  const sum = st.stiffness[0] + st.stiffness[1] + st.stiffness[2];
  return [
    `stiffnesses: ${st.stiffness.map((k) => k.toExponential(4)).join('   ')} N/m`,
    `sum = ${sum.toExponential(3)} N/m${tr ? '   (zero to machine precision — the theorem, measured)' : ''}`,
    `unstable directions: ${st.unstableDirections}  →  ${st.stable ? 'a true minimum' : st.escapeHint}`,
  ].join('\n');
}

/* ----------------------------------------------------------- myth-busting */

export function showMyths() {
  const body = h('div', {});
  body.append(
    h('h2', {}, 'Antigravity: the claims, and what measurement says'),
    h('div', { class: 'sub' }, 'Levitation is balancing gravity, and it works. Antigravity would be changing gravity, and there is no evidence it can be done. Here is the state of the evidence, claim by claim.'),
  );
  for (const step of IMPOSSIBILITY_STEPS) {
    body.append(h('div', { class: 'eq-block compact' }, h('h4', {}, step.title), h('p', {}, step.body)));
  }
  body.append(h('h4', {}, 'Claims versus evidence'));
  const table = h('table', { class: 'claims' },
    h('tr', {}, ...['Claim', 'When', 'What was claimed', 'What was measured', 'Bound', 'Status'].map((x) => h('th', {}, x))));
  const rank: Record<Claim['status'], number> = { established: 0, misidentified: 1, refuted: 2, unsupported: 3, forbidden: 4 };
  for (const c of [...CLAIMS].sort((a, b) => rank[a.status] - rank[b.status])) {
    table.append(h('tr', { class: `claim ${c.status}` },
      h('td', {}, h('b', {}, c.title), h('div', { class: 'hint' }, c.who)),
      h('td', {}, c.year),
      h('td', {}, c.claimed),
      h('td', {}, c.tested),
      h('td', {}, c.bound),
      h('td', {}, h('span', { class: `status ${c.status}` }, CLAIM_STATUS_LABEL[c.status]), h('div', { class: 'hint' }, c.verdict))));
  }
  body.append(table);
  body.append(h('h4', {}, 'Sources'));
  body.append(h('ul', { class: 'sources' }, ...CLAIMS.map((c) => h('li', {}, h('b', {}, c.title + ': '), c.source))));
  modal(body);
}

/* -------------------------------------------------------------- equations */

export function showLevEquations(s: LevSolution | null) {
  const blocks: [string, string, string[]][] = [
    ['Force on an induced moment',
      String.raw`\mathbf F=\frac{\chi_{\mathrm{eff}} V}{2\mu_0}\nabla\!\left(B^2\right),\qquad \chi_{\mathrm{eff}}=\frac{\chi}{1+N\chi},\qquad \left|B\frac{\partial B}{\partial z}\right|=\frac{\mu_0\rho g}{|\chi|}`,
      ['A diamagnet is pushed towards weaker field. Setting the force equal to the weight cancels the volume from both sides, which is why the requirement is a property of the *material* — density over susceptibility — and not of the size of the object.',
        'N is the demagnetising factor (⅓ for a sphere). It is a rounding correction for ordinary diamagnets and decisive for a superconductor, where χ = −1 gives χ_eff = −3/2.']],
    ['Earnshaw and its escape clause',
      String.raw`\nabla^2 U = 0\ \ (\text{fixed }\mathbf m)\qquad\text{vs}\qquad \nabla^2\!\left(B^2\right)=2|\nabla\mathbf B|^2\ge 0`,
      ['Left: the three stiffnesses sum to zero, so every static equilibrium of a fixed moment is a saddle. Right: B² is subharmonic, so it can have a minimum. Those two lines separate the modes that work from the modes that cannot.']],
    ['Field of a circular loop',
      String.raw`\mathbf B(\mathbf r)=\frac{\mu_0 I}{4\pi}\oint\frac{d\boldsymbol\ell\times(\mathbf r-\boldsymbol\ell)}{|\mathbf r-\boldsymbol\ell|^{3}}`,
      ['Integrated along the conductor with the midpoint rule. For a closed analytic loop the integrand is periodic and analytic, so the rule converges geometrically and the node count is chosen from the distance to the wire to reach double precision. The closed-form elliptic-integral solution is kept as an independent check.']],
    ['Field of a uniformly magnetised block',
      String.raw`B_z=\frac{B_r}{4\pi}\sum_{i,j,k}(-1)^{i+j+k}\arctan\!\frac{u_i v_j}{w_k R_{ijk}}`,
      ['Exact, from the equivalent magnetic surface charge σ = M·n̂ on the pole faces. At the centre of a cube it returns 2B_r/3, i.e. a demagnetising factor of exactly ⅓ — which is how the implementation is checked.']],
    ['Meissner repulsion and flux pinning',
      String.raw`F=\frac{3\mu_0 m^2}{32\pi h^4},\qquad p_{\max}=\frac{B^2}{2\mu_0},\qquad \lambda=\frac{B}{\mu_0 J_c}`,
      ['A superconductor forces B⊥ = 0 on its surface, which an image dipole satisfies. The Maxwell stress caps the pressure; Bean’s model gives the depth the flux penetrates, and the pinning force density is J_c × B over that depth.']],
    ['Eddy currents',
      String.raw`\alpha(\omega)=-2\pi a^3\left[1-\frac{3}{q^2}+\frac{3\cot q}{q}\right],\quad q=\frac{(1-i)a}{\delta},\quad \delta=\sqrt{\frac{2}{\omega\mu_0\sigma}}`,
      ['One complex number carries both effects: the real part gives the time-averaged force, the imaginary part the dissipation. They cannot be separated, which is why induction levitation always heats what it lifts.']],
    ['Spin stabilisation',
      String.raw`U=+m|\mathbf B|+mgz,\qquad \frac{2\sqrt{I_\perp m B}}{I_s}<\omega_s<\frac{mB}{\kappa I_s\omega_{\mathrm{vib}}}`,
      ['A fast-spinning moment precesses quickly enough to stay anti-parallel to the local field, so the energy depends on the magnitude of B rather than its components — and |B|, unlike B_i, may have a local minimum (Wing’s theorem). Too slow and the top topples; too fast and the moment can no longer reorient as the top moves.']],
    ['Acoustic trapping',
      String.raw`U=\frac{\pi a^3 p_a^2}{3\rho_0c_0^2}\left[\frac{f_1-\tfrac32 f_2}{2}+\frac{\cos 2kz\,(f_1+\tfrac32 f_2)}{2}\right]`,
      ['Gor’kov’s time-averaged potential for a particle much smaller than the wavelength. Both the trapping force and the weight scale as a³, so the loudness needed does not depend on the particle size — about 160 dB for water in air.']],
    ['Optical forces',
      String.raw`F_{\mathrm{rad}}=\frac{2P}{c},\qquad F_{\mathrm{grad}}=\frac{2\pi n_m a^3}{c}\frac{m^2-1}{m^2+2}\nabla I`,
      ['Radiation pressure is a brutal exchange rate: lifting one gram takes 1.5 MW. The gradient force is what makes tweezers work, and it scales with the volume of the particle and the gradient of intensity, so a tight focus matters more than raw power.']],
    ['Servo suspension',
      String.raw`F=k\left(\frac{i}{x}\right)^2,\quad k_x=-\frac{2mg}{x_0},\quad \lambda=\sqrt{\frac{2g}{x_0}},\quad ms^2+k_ik_ds+(k_ik_p+k_x)=0`,
      ['The open-loop plant has a real unstable pole — 44 s⁻¹ at a 10 mm gap, so a disturbance doubles every 16 ms. The loop must be an order of magnitude faster than that, which is why Maglev control runs at kilohertz rates.']],
    ['Momentum and buoyancy',
      String.raw`P=\frac{(mg)^{3/2}}{\sqrt{2\rho A}},\qquad V=\frac{m}{\rho_{\mathrm{air}}-\rho_{\mathrm{gas}}}`,
      ['Hover power grows as the 3/2 power of weight and falls only as the square root of disc area. Buoyancy, by contrast, gets easier with size, because lift scales with volume and the envelope with area — the opposite of every magnetic mode.']],
  ];
  const body = h('div', {});
  body.append(h('h2', {}, 'The physics, equation by equation'),
    h('div', { class: 'sub' }, s ? `Live values are for ${s.objectName} on the ${s.apparatusName}.` : 'Solve a scenario to see live numbers.'));
  for (const [title, eq, paras] of blocks) {
    body.append(h('div', { class: 'eq-block' }, h('h4', {}, title), h('div', { html: tex(eq) }), ...paras.map((p) => h('p', {}, p))));
  }
  if (s) {
    const lines = [...s.requirements, ...s.achieved].map((r) => `${r.label.padEnd(44, ' ')} ${fmtVal(r.value, r.unit)}`);
    body.append(h('div', { class: 'eq-block' }, h('h4', {}, 'Live values'), h('div', { class: 'eq-live' }, lines.join('\n'))));
  }
  modal(body);
}

/* ------------------------------------------------------------- validation */

export function showEmValidation(run: (progress: (f: number) => void) => Promise<ValidationResult[]>) {
  const status = h('div', { class: 'sub' }, 'Running levitation validation in the simulation worker…');
  const host = h('div');
  const body = h('div', {}, h('h2', {}, 'Levitation validation report'), status, host,
    h('p', { class: 'hint' }, 'Analytic cases compare the code with a closed-form solution or an exact identity — any disagreement there is a bug. Measured cases compare the model with a published experiment, where a gap may be a real limitation of the model; those are labelled and shown in amber rather than hidden.'));
  modal(body);
  run((f) => (status.textContent = `Running validation cases… ${Math.round(f * 100)} %`)).then((res) => {
    const pass = res.filter((r) => r.pass).length;
    status.innerHTML = `<b class="${pass === res.length ? 'pass' : 'fail'}">${pass} / ${res.length} cases within tolerance</b>`;
    for (const kind of ['analytic', 'measured'] as const) {
      const rows = res.filter((r) => (r.kind ?? 'analytic') === kind);
      if (!rows.length) continue;
      const p = rows.filter((r) => r.pass).length;
      host.append(h('h4', {}, kind === 'analytic'
        ? `Against closed-form solutions and exact identities — ${p}/${rows.length}`
        : `Against published measurements — ${p}/${rows.length}`));
      const t = h('table', {}, h('tr', {}, ...['Area', 'Case', 'Reference', 'Expected', 'Model', 'Error', 'Tolerance', ''].map((x) => h('th', {}, x))));
      for (const r of rows) {
        const limit = r.note?.startsWith('KNOWN LIMITATION') || r.note?.startsWith('CALIBRATED');
        const err = r.errorKind === 'relative' ? `${(r.error * 100).toPrecision(2)} %` : `${r.error.toExponential(2)} ${r.unit}`;
        const tol = r.errorKind === 'relative' ? `${(r.tolerance * 100).toPrecision(2)} %` : `${r.tolerance.toExponential(2)} ${r.unit}`;
        t.append(h('tr', {},
          h('td', {}, r.group),
          h('td', {}, r.name, r.note ? h('div', { class: limit ? 'hint limit' : 'hint' }, r.note) : null),
          h('td', {}, r.reference, h('div', { class: 'hint' }, r.source)),
          h('td', { class: 'num' }, `${+r.expected.toPrecision(8)} ${r.unit}`),
          h('td', { class: 'num' }, `${+r.actual.toPrecision(8)} ${r.unit}`),
          h('td', { class: 'num' }, err),
          h('td', { class: 'num' }, tol),
          h('td', { class: r.pass ? (limit ? 'limit' : 'pass') : 'fail' }, r.pass ? (limit ? '≈' : '✔') : '✘')));
      }
      host.append(t);
    }
  }).catch((e) => (status.textContent = `Validation failed: ${e.message}`));
}
