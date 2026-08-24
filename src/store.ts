/**
 * All persistent state, which is deliberately very little: preferences, saved
 * sessions, and an API key if the user chose to add one. It lives in this
 * browser only — there is no server to send it to.
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
  apiKey: string;
  model: string;
  proxyUrl: string;
  wakeLock: boolean;
  /** which of the DJ's two paths you were last on */
  djPath: 'quick' | 'set';
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

/**
 * Free models only. This app is free, so its DJ is too — and every id here can
 * return a schema-checked answer, which most free models cannot. The field
 * takes any typed id, but the hosted route refuses one that costs money.
 */
export const MODELS = [
  { id: 'z-ai/glm-5.2:free', label: 'GLM', note: 'holds the schema' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'Super', note: '120B, best sets' },
  { id: 'nvidia/nemotron-nano-9b-v2:free', label: 'Nano', note: '9B, quickest' },
  { id: 'openrouter/free', label: 'Auto', note: 'whichever is up' },
];

const DEFAULTS: State = {
  settings: {
    theme: 'system',
    method: 'binaural',
    volume: 0.25,
    headphones: true,
    seenLeaflet: false,
    experimental: false,
    apiKey: '',
    model: 'z-ai/glm-5.2:free',
    proxyUrl: '',
    wakeLock: false,
    djPath: 'quick',
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
