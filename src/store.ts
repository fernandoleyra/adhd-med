/**
 * All persistent state, which is deliberately very little: preferences and
 * saved sessions. It lives in this browser only — there is nowhere else for it
 * to go.
 */
import type { Method } from './core/types.js';

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  /** preferred delivery when a session doesn't specify */
  method: Method;
  volume: number;
  headphones: boolean;
  seenLeaflet: boolean;
  /** the user has opted into the open envelope at least once */
  experimental: boolean;
  wakeLock: boolean;
}

export interface SavedSession {
  id: string;
  title: string;
  payload: string;
  at: number;
}

export interface State {
  settings: Settings;
  saved: SavedSession[];
}

const KEY = 'adhdmed.v1';

const DEFAULTS: State = {
  settings: {
    theme: 'system',
    method: 'binaural',
    volume: 0.25,
    headphones: true,
    seenLeaflet: false,
    experimental: false,
    wakeLock: false,
  },
  saved: [],
};

type Listener = (s: State) => void;

class Store {
  private state: State;
  private listeners = new Set<Listener>();

  constructor() {
    this.state = this.read();
  }

  private read(): State {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return structuredClone(DEFAULTS);
      const parsed = JSON.parse(raw) as Partial<State>;
      return {
        settings: { ...DEFAULTS.settings, ...(parsed.settings ?? {}) },
        saved: Array.isArray(parsed.saved) ? parsed.saved.slice(0, 60) : [],
      };
    } catch {
      return structuredClone(DEFAULTS);
    }
  }

  private write(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.state));
    } catch {
      // Private mode, or storage full. The app keeps working for this session.
    }
  }

  get(): State {
    return this.state;
  }

  get settings(): Settings {
    return this.state.settings;
  }

  update(patch: Partial<Settings>): void {
    this.state = { ...this.state, settings: { ...this.state.settings, ...patch } };
    this.write();
    this.emit();
  }

  save(session: SavedSession): void {
    const saved = [session, ...this.state.saved.filter((s) => s.id !== session.id)].slice(0, 60);
    this.state = { ...this.state, saved };
    this.write();
    this.emit();
  }

  remove(id: string): void {
    this.state = { ...this.state, saved: this.state.saved.filter((s) => s.id !== id) };
    this.write();
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}

export const store = new Store();

/** Apply the theme choice to the document. */
export function applyTheme(theme: Settings['theme']): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
