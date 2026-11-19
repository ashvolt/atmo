type Attrs = Record<string, string | number | boolean | EventListener | undefined>;

/** Tiny hyperscript helper. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export class Store<T extends object> {
  private subs = new Set<(s: T, changed: Set<keyof T>) => void>();
  constructor(public state: T) {}
  set(patch: Partial<T>) {
    const changed = new Set<keyof T>();
    for (const k of Object.keys(patch) as (keyof T)[]) {
      if (this.state[k] !== patch[k]) changed.add(k);
    }
    if (!changed.size) return;
    this.state = { ...this.state, ...patch };
    for (const s of this.subs) s(this.state, changed);
  }
  subscribe(fn: (s: T, changed: Set<keyof T>) => void) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }
}

export function toast(msg: string, error = false, ms = 3500) {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.className = `show${error ? ' error' : ''}`;
  clearTimeout((toast as unknown as { t: number }).t);
  (toast as unknown as { t: number }).t = window.setTimeout(() => (el.className = ''), ms);
}

/** Section with collapsible header. */
export function section(title: string, body: HTMLElement, open = true): HTMLElement {
  const s = h('div', { class: `section${open ? '' : ' closed'}` });
  const head = h('h3', {}, title, h('span', { class: 'chev' }, '▾'));
  head.addEventListener('click', () => s.classList.toggle('closed'));
  s.append(head, h('div', { class: 'section-body' }, body));
  return s;
}

export function seg<T extends string>(options: { value: T; label: string; title?: string }[], value: T, onChange: (v: T) => void) {
  const el = h('div', { class: 'seg' });
  const btns = options.map((o) => {
    const b = h('button', { title: o.title ?? o.label, onclick: () => { set(o.value); onChange(o.value); } }, o.label);
    el.append(b);
    return { b, v: o.value };
  });
  const set = (v: T) => btns.forEach((x) => x.b.classList.toggle('on', x.v === v));
  set(value);
  return { el, set };
}

export function toggle(label: string, checked: boolean, onChange: (v: boolean) => void) {
  const input = h('input', { type: 'checkbox' }) as HTMLInputElement;
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  const el = h('label', { class: 'toggle' }, input, h('span', { class: 'sw' }), label);
  return { el, set: (v: boolean) => (input.checked = v) };
}

/**
 * Slider + number box. `log` maps the slider logarithmically between min and max.
 */
export function slider(o: {
  label: string; min: number; max: number; value: number; step?: number; unit?: string; log?: boolean;
  onChange: (v: number) => void; digits?: number;
}) {
  const range = h('input', { type: 'range', min: 0, max: 1000, step: 1 }) as HTMLInputElement;
  const num = h('input', { type: 'number', step: o.step ?? 'any' }) as HTMLInputElement;
  num.style.width = '86px';
  const toSlider = (v: number) => {
    if (o.log) return (1000 * Math.log(Math.max(v, o.min) / o.min)) / Math.log(o.max / o.min);
    return (1000 * (v - o.min)) / (o.max - o.min);
  };
  const fromSlider = (s: number) => {
    const f = s / 1000;
    const v = o.log ? o.min * (o.max / o.min) ** f : o.min + f * (o.max - o.min);
    return roundNice(v, o.step);
  };
  const set = (v: number) => {
    range.value = String(toSlider(v));
    num.value = String(+v.toPrecision(o.digits ?? 6));
  };
  range.addEventListener('input', () => {
    const v = fromSlider(+range.value);
    num.value = String(+v.toPrecision(o.digits ?? 6));
    o.onChange(v);
  });
  num.addEventListener('change', () => {
    const v = Number(num.value);
    if (!Number.isFinite(v)) return;
    range.value = String(toSlider(v));
    o.onChange(v);
  });
  set(o.value);
  const el = h('div', { class: 'row' }, h('label', {}, o.label), h('div', { class: 'grow' }, range), num, h('span', { class: 'unit' }, o.unit ?? ''));
  return { el, set };
}

function roundNice(v: number, step?: number) {
  if (step) return Math.round(v / step) * step;
  const p = 10 ** (Math.floor(Math.log10(Math.abs(v) || 1)) - 2);
  return Math.round(v / p) * p;
}

export function modal(content: HTMLElement): () => void {
  const root = document.getElementById('modal-root')!;
  const close = () => back.remove();
  const back = h('div', { class: 'modal-back', onclick: (e: Event) => { if (e.target === back) close(); } },
    h('div', { class: 'modal glass' }, h('span', { class: 'x', onclick: close }, '✕'), content));
  root.append(back);
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { close(); window.removeEventListener('keydown', esc); } };
  window.addEventListener('keydown', esc);
  return close;
}
