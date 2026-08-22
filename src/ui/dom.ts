/**
 * The smallest possible component kit: functions that return elements.
 * No framework — five screens over one audio graph do not need a runtime.
 */

type Props = Record<string, unknown>;
export type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  children: Child[] | Child = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = String(value);
    else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'dataset' && typeof value === 'object') {
      Object.assign(node.dataset, value as Record<string, string>);
    } else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[] | Child): void {
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/** A number in the monospace face, with tabular figures. Numbers are content. */
export function num(value: string | number, unit?: string): HTMLElement {
  return el('span', { class: 'num' }, [String(value), unit ? el('span', { class: 'unit', text: unit }) : null]);
}

export interface ChipOptions {
  active?: boolean;
  hint?: string;
  onclick?: () => void;
  tag?: string;
}

export function chip(label: string, opts: ChipOptions = {}): HTMLButtonElement {
  return el(
    'button',
    {
      class: `chip${opts.active ? ' is-on' : ''}`,
      type: 'button',
      'aria-pressed': opts.active ? 'true' : 'false',
      title: opts.hint ?? '',
      onclick: opts.onclick,
    },
    [label, opts.tag ? el('span', { class: 'chip-tag', text: opts.tag }) : null],
  );
}

export interface FieldOptions {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  /** logarithmic slider for frequency-like values */
  log?: boolean;
  hint?: string;
  format?: (v: number) => string;
  oninput: (v: number) => void;
}

/** Label, slider, live readout. The workhorse of the Lab. */
export function field(opts: FieldOptions): HTMLElement {
  const { label, min, max, log } = opts;
  const toSlider = (v: number) =>
    log ? (Math.log(Math.max(min, v)) - Math.log(min)) / (Math.log(max) - Math.log(min)) : (v - min) / (max - min);
  const fromSlider = (u: number) =>
    log ? Math.exp(Math.log(min) + u * (Math.log(max) - Math.log(min))) : min + u * (max - min);
  const fmt = opts.format ?? ((v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2)));

  const readout = num(fmt(opts.value), opts.unit);
  const input = el('input', {
    type: 'range',
    min: '0',
    max: '1000',
    step: '1',
    value: String(Math.round(toSlider(opts.value) * 1000)),
    'aria-label': label,
    oninput: (e: Event) => {
      const u = Number((e.target as HTMLInputElement).value) / 1000;
      const raw = fromSlider(u);
      const stepped = opts.step ? Math.round(raw / opts.step) * opts.step : raw;
      const v = Math.min(max, Math.max(min, stepped));
      readout.replaceChildren(fmt(v), opts.unit ? el('span', { class: 'unit', text: opts.unit }) : '');
      opts.oninput(v);
    },
  });

  return el('label', { class: 'field' }, [
    el('span', { class: 'field-head' }, [el('span', { class: 'field-label', text: label }), readout]),
    input,
    opts.hint ? el('span', { class: 'field-hint', text: opts.hint }) : null,
  ]);
}

export function select<T extends string>(
  label: string,
  options: { value: T; label: string; hint?: string }[],
  value: T,
  onchange: (v: T) => void,
): HTMLElement {
  const node = el(
    'select',
    {
      'aria-label': label,
      onchange: (e: Event) => onchange((e.target as HTMLSelectElement).value as T),
    },
    options.map((o) => el('option', { value: o.value, selected: o.value === value, text: o.label })),
  );
  return el('label', { class: 'picker' }, [el('span', { class: 'field-label', text: label }), node]);
}

export function toggle(label: string, value: boolean, onchange: (v: boolean) => void, hint?: string): HTMLElement {
  return el('label', { class: `switch${value ? ' is-on' : ''}` }, [
    el('input', {
      type: 'checkbox',
      checked: value,
      // The wrapping <label> already names it, but the box is visually hidden
      // behind the drawn switch, so be explicit for screen readers.
      'aria-label': label,
      onchange: (e: Event) => onchange((e.target as HTMLInputElement).checked),
    }),
    el('span', { class: 'switch-body' }, [
      el('span', { class: 'field-label', text: label }),
      hint ? el('span', { class: 'field-hint', text: hint }) : null,
    ]),
    el('span', { class: 'switch-mark', 'aria-hidden': 'true' }),
  ]);
}

export function section(title: string, children: Child[], hint?: string): HTMLElement {
  return el('section', { class: 'block' }, [
    el('h2', { class: 'block-title' }, [title, hint ? el('span', { class: 'block-hint', text: hint }) : null]),
    ...children,
  ]);
}

/**
 * A collapsible group — the Lab's progressive disclosure.
 *
 * `open` state is remembered against the caller's set, keyed by an explicit id
 * rather than the summary text: the hint is part of that text and changes as you
 * edit, which would silently close the panel you were working in.
 */
export function accordion(
  id: string,
  title: string,
  body: HTMLElement,
  opts: { openSet?: Set<string>; hint?: string } = {},
): HTMLElement {
  const open = opts.openSet?.has(id) ?? false;
  const details = el('details', { class: 'fold', open, dataset: { fold: id } }, [
    el('summary', {}, [title, opts.hint ? el('span', { class: 'block-hint', text: opts.hint }) : null]),
    body,
  ]);
  if (opts.openSet) {
    const set = opts.openSet;
    details.addEventListener('toggle', () => {
      if (details.open) set.add(id);
      else set.delete(id);
    });
  }
  return details;
}

let toastTimer: number | null = null;

export function toast(message: string, kind: 'info' | 'warn' = 'info'): void {
  let host = document.getElementById('toast');
  if (!host) {
    host = el('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  host.textContent = message;
  host.dataset.kind = kind;
  host.classList.add('is-on');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => host!.classList.remove('is-on'), 3200);
}

export interface SheetOptions {
  title: string;
  body: Child[];
  onclose?: () => void;
  wide?: boolean;
}

/** A full-height panel. Used for the leaflet, settings, entry detail, library. */
export function openSheet(opts: SheetOptions): () => void {
  const existing = document.getElementById('sheet');
  if (existing) existing.remove();
  const close = () => {
    node.classList.remove('is-on');
    window.setTimeout(() => node.remove(), 220);
    document.removeEventListener('keydown', onKey);
    opts.onclose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  const node = el('div', { id: 'sheet', class: `sheet${opts.wide ? ' is-wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title }, [
    el('div', { class: 'sheet-scrim', onclick: close }),
    el('div', { class: 'sheet-body' }, [
      el('header', { class: 'sheet-head' }, [
        el('h2', { text: opts.title }),
        el('button', { class: 'icon', type: 'button', 'aria-label': 'Close', onclick: close }, ['✕']),
      ]),
      el('div', { class: 'sheet-scroll' }, opts.body),
    ]),
  ]);
  document.body.appendChild(node);
  requestAnimationFrame(() => node.classList.add('is-on'));
  document.addEventListener('keydown', onKey);
  return close;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function formatMinutes(seconds: number): string {
  const m = seconds / 60;
  return m >= 10 ? `${Math.round(m)} min` : `${m.toFixed(1).replace(/\.0$/, '')} min`;
}
