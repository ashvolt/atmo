import { h } from './dom';
import { F, type SimSummary } from '../physics/simulation';
import { fmt } from '../render/coords';
import type { ObjectSpec } from '../physics/objects';

const item = (k: string, big = false) => {
  const v = h('div', { class: 'v' });
  const bar = h('div', { class: 'hud-bar' }, h('div'));
  const el = h('div', { class: `hud-item${big ? ' big' : ''}` }, h('div', { class: 'k' }, k), v);
  return { el, v, bar, setBar(f: number) { (bar.firstChild as HTMLElement).style.width = `${Math.min(100, Math.max(0, f * 100))}%`; } };
};

export class Hud {
  private el = document.getElementById('hud')!;
  private time = h('div', { class: 'hud-time' });
  private medium = h('span', { class: 'hud-medium' });
  private items = {
    alt: item('Height above ground', true),
    speed: item('Speed', true),
    vz: item('Vertical speed'),
    mach: item('Mach'),
    range: item('Downrange'),
    msl: item('Altitude (MSL)'),
    g: item('Local gravity |g|'),
    load: item('Felt load (drag)'),
    rho: item('Air density'),
    tair: item('Air temperature'),
    drag: item('Drag force'),
    cd: item('Drag coeff. Cd'),
    tw: item('Surface temp.'),
    q: item('Heat flux (stag.)'),
  };
  private regime = h('div', { class: 'regime' });

  constructor() {
    this.el.classList.add('glass');
    const grid = h('div', { class: 'hud-grid' });
    for (const it of Object.values(this.items)) grid.append(it.el);
    this.items.speed.el.append(this.items.speed.bar);
    this.items.alt.el.append(this.items.alt.bar);
    this.el.append(h('div', {}, this.medium, this.time), grid, this.regime);
  }

  show(v: boolean) {
    this.el.classList.toggle('show', v);
  }

  update(row: Float64Array, s: SimSummary, obj: ObjectSpec, scale: number) {
    const I = this.items;
    this.time.textContent = `T+ ${fmt.time(row[F.t])}`;
    const rho = row[F.rho];
    const medium = row[F.medium] === 1 ? 'water' : row[F.qStag] > 1e5 ? 'plasma' : rho < 1e-7 ? 'space' : 'air';
    this.medium.className = `hud-medium ${medium}`;
    this.medium.textContent = medium === 'water' ? 'UNDERWATER' : medium === 'plasma' ? 'PLASMA SHEATH' : medium === 'space' ? 'NEAR-VACUUM' : row[F.chute] > 0.05 ? 'UNDER CANOPY' : 'IN AIR';
    I.alt.v.innerHTML = `${unit(fmt.len(row[F.hAGL]))}`;
    I.alt.setBar(row[F.hAGL] / Math.max(s.maxAltitudeAGL, 1e-6));
    I.speed.v.innerHTML = `${unit(fmt.speed(row[F.speed]))} <small>${(row[F.speed] * 3.6).toFixed(row[F.speed] < 10 ? 2 : 0)} km/h · ${(row[F.speed] * 2.23694).toFixed(row[F.speed] < 10 ? 2 : 0)} mph</small>`;
    I.speed.setBar(row[F.speed] / Math.max(s.maxSpeed, 1e-9));
    I.vz.v.innerHTML = unit(`${row[F.vUp] >= 0 ? '+' : ''}${fmt.num(row[F.vUp], 3)} m/s`);
    I.mach.v.textContent = row[F.medium] === 1 || rho === 0 ? '—' : row[F.mach].toFixed(3);
    I.range.v.innerHTML = unit(fmt.len(row[F.downrange]));
    I.msl.v.innerHTML = unit(fmt.len(row[F.hMSL]));
    I.g.v.innerHTML = unit(`${row[F.gLocal].toFixed(5)} m/s²`);
    I.load.v.innerHTML = unit(`${row[F.gLoad].toFixed(row[F.gLoad] < 10 ? 3 : 1)} g`);
    I.rho.v.innerHTML = unit(rho === 0 ? '0 kg/m³' : `${fmt.num(rho, 3)} kg/m³`);
    I.tair.v.innerHTML = unit(`${(row[F.Tair] - 273.15).toFixed(1)} °C`);
    I.drag.v.innerHTML = unit(`${fmt.num(row[F.drag], 3)} N`);
    I.cd.v.textContent = row[F.cd] ? row[F.cd].toFixed(3) : '—';
    I.tw.v.innerHTML = unit(`${(row[F.Tw] - 273.15).toFixed(row[F.Tw] > 1000 ? 0 : 1)} °C`);
    I.q.v.innerHTML = unit(row[F.qStag] > 0 ? `${fmt.num(row[F.qStag] / 1e3, 3)} kW/m²` : '0');
    const kn = row[F.kn];
    const regime = row[F.medium] === 1 ? 'Liquid (sea water, buoyancy + added mass)' : rho === 0 ? 'Vacuum — gravity only' : kn < 0.01 ? 'Continuum flow' : kn < 10 ? 'Transitional (rarefied) flow' : 'Free-molecular flow';
    const flow = row[F.mach] < 0.8 ? 'subsonic' : row[F.mach] < 1.2 ? 'transonic' : row[F.mach] < 5 ? 'supersonic' : 'hypersonic';
    const massLine = row[F.mass] < obj.mass * 0.999 ? ` · mass ${((row[F.mass] / obj.mass) * 100).toFixed(1)} % (ablating)` : '';
    const spin = row[F.spin] > 0 ? ` · spin ${((row[F.spin] * 60) / (2 * Math.PI)).toFixed(0)} rpm, C_L ${row[F.cl].toFixed(3)}` : '';
    this.regime.innerHTML = `<b>${regime}</b>${rho > 0 && row[F.medium] === 0 ? `, ${flow}` : ''} · Re ${fmt.num(row[F.re], 3)} · Kn ${fmt.num(kn, 2)}${massLine}${spin}` +
      (scale > 1.5 ? `<br>Model drawn ×${scale >= 100 ? Math.round(scale).toLocaleString() : scale.toFixed(1)} actual size for visibility` : '');
  }
}

function unit(s: string) {
  return s.replace(/ ([a-zA-Z°/²³%]+[a-zA-Z/²³]*)$/, ' <small>$1</small>');
}

export function summaryCard(s: SimSummary, vac: SimSummary | null, noRot: { dx: number; dir: string } | null, obj: ObjectSpec): string {
  const rows: [string, string][] = [
    ['Flight time', fmt.time(s.flightTime)],
    ['Impact speed', `${fmt.speed(s.impactSpeed)} (${(s.impactSpeed * 3.6).toFixed(1)} km/h)`],
    ['Impact angle', s.impactAngle >= 0 ? `${s.impactAngle.toFixed(1)}° below horizontal` : `${(-s.impactAngle).toFixed(1)}° above horizontal (hit rising ground)`],
    ['Impact energy', fmt.energy(s.impactEnergy)],
    ['Max height (AGL)', fmt.len(s.maxAltitudeAGL)],
    ['Distance (surface)', fmt.len(s.range)],
    ['Max speed', `${fmt.speed(s.maxSpeed)}${s.maxMach > 0.3 ? ` · Mach ${s.maxMach.toFixed(2)}` : ''}`],
    ['Max felt load', `${s.maxGLoad.toFixed(2)} g`],
    ['Local gravity at start', `${s.localG.toFixed(5)} m/s²`],
  ];
  if (s.maxTemp > 300) rows.push(['Peak surface temp.', `${(s.maxTemp - 273.15).toFixed(0)} °C`]);
  if (s.finalMass < obj.mass * 0.999) rows.push(['Mass remaining', `${((s.finalMass / obj.mass) * 100).toFixed(2)} %`]);
  if (s.chuteDeployTime !== null) rows.push(['Parachute opened', `T+${fmt.time(s.chuteDeployTime)}`]);
  if (s.waterEntryTime !== null) rows.push(['Hit the water', `T+${fmt.time(s.waterEntryTime)}`]);
  if (vac) rows.push(['In vacuum it would take', `${fmt.time(vac.flightTime)}, ${fmt.speed(vac.impactSpeed)}, ${fmt.len(vac.range)}`]);
  if (noRot) rows.push(['Coriolis deflection', `${fmt.len(noRot.dx)} ${noRot.dir}`]);
  return `<span class="close" onclick="this.parentElement.classList.remove('show')">✕</span>
    <h4>${obj.emoji} ${s.message}</h4>
    <div class="outcome">${s.outcome === 'impact' || s.outcome === 'seabed' ? `landed at ${fmt.latlon(s.impactLat, s.impactLon)}` : ''}</div>
    <div class="kv">${rows.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('')}</div>
    <div class="hint" style="margin-top:8px">${s.nSteps.toLocaleString()} adaptive steps · ${s.nEvals.toLocaleString()} force evaluations · ${s.wallTimeMs.toFixed(0)} ms</div>`;
}
