/**
 * Hash routing. Required on GitHub Pages (no server rewrites), and it lets a
 * whole session ride in the fragment: #/play?m=1.<payload>
 */

export interface Route {
  path: string;
  params: URLSearchParams;
}

type Handler = (route: Route) => void;

export const ROUTES = ['/dj', '/lab', '/codex', '/logos', '/library', '/about', '/play'] as const;

export function parseHash(hash: string = location.hash): Route {
  const raw = hash.replace(/^#/, '') || '/dj';
  const q = raw.indexOf('?');
  const path = (q === -1 ? raw : raw.slice(0, q)) || '/dj';
  const params = new URLSearchParams(q === -1 ? '' : raw.slice(q + 1));
  return { path: path.startsWith('/') ? path : `/${path}`, params };
}

export function navigate(path: string, params?: Record<string, string>): void {
  const search = params ? `?${new URLSearchParams(params).toString()}` : '';
  const next = `#${path}${search}`;
  if (location.hash === next) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = next;
}

export function startRouter(handler: Handler): void {
  const run = () => handler(parseHash());
  window.addEventListener('hashchange', run);
  run();
}

/** Strip a long payload out of the address bar once it has been consumed. */
export function clearPayload(): void {
  const route = parseHash();
  if (!route.params.has('m')) return;
  history.replaceState(null, '', `${location.pathname}#${route.path}`);
}
