/**
 * Keeping sound alive when the screen goes dark.
 *
 * The heavy lifting is in engine.ts, which plays through a real <audio> element
 * so the OS classes this as media. This file adds the parts around it: the
 * lock-screen controls, Safari's audio session category, recovery after an
 * interruption (a phone call), and an optional screen-awake toggle for devices
 * where background audio still misbehaves.
 */
import type { Engine } from './engine.js';
import { totalSeconds } from '../core/types.js';

interface AudioSessionLike {
  type: 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record';
}

type WakeLockSentinel = {
  released: boolean;
  release(): Promise<void>;
  addEventListener?(type: 'release', listener: () => void): void;
};

let sentinel: WakeLockSentinel | null = null;

export function isStandaloneIOS(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return iOS && Boolean(standalone);
}

export async function requestWakeLock(): Promise<boolean> {
  const nav = navigator as unknown as { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> } };
  if (!nav.wakeLock) return false;
  try {
    sentinel = await nav.wakeLock.request('screen');
    sentinel.addEventListener?.('release', () => { sentinel = null; });
    return true;
  } catch {
    return false;
  }
}

export async function releaseWakeLock(): Promise<void> {
  try {
    await sentinel?.release();
  } catch {
    /* nothing to release */
  }
  sentinel = null;
}

export function wakeLockSupported(): boolean {
  return 'wakeLock' in navigator;
}

export function wakeLockActive(): boolean {
  return sentinel !== null && !sentinel.released;
}

function formatTitle(engine: Engine): string {
  const snap = engine.snapshot();
  if (!snap.script) return 'ADHD MED';
  const seg = snap.script.segments[snap.segIndex];
  const beat = seg?.layers.find((l) => !l.mute && l.kind === 'tone')?.beat;
  return beat ? `${snap.script.title} · ${beat.toFixed(1)} Hz` : snap.script.title;
}

/** Wire the OS media controls to the transport. Safe to call once at boot. */
export function attachBackground(engine: Engine): void {
  const audioSession = (navigator as unknown as { audioSession?: AudioSessionLike }).audioSession;
  if (audioSession) {
    // Ask for the media-playback category explicitly: survives screen lock and
    // ignores the ring/silent switch, instead of the ambient default.
    try {
      audioSession.type = 'playback';
    } catch {
      /* not settable here */
    }
  }

  const ms = navigator.mediaSession;
  if (ms) {
    ms.setActionHandler('play', () => void engine.play());
    ms.setActionHandler('pause', () => void engine.pause());
    ms.setActionHandler('stop', () => void engine.stop());
    ms.setActionHandler('nexttrack', () => void engine.skip(1));
    ms.setActionHandler('previoustrack', () => void engine.skip(-1));
    try {
      ms.setActionHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number') void engine.seek(details.seekTime);
      });
    } catch {
      /* older implementations */
    }
  }

  let lastTitle = '';
  engine.subscribe((snap) => {
    if (!ms) return;
    const title = formatTitle(engine);
    if (title !== lastTitle) {
      lastTitle = title;
      ms.metadata = new MediaMetadata({
        title,
        artist: 'ADHD MED',
        album: snap.script?.note?.slice(0, 60) ?? 'generative frequencies',
      });
    }
    ms.playbackState = snap.status === 'playing' ? 'playing' : 'paused';
    if (snap.script && 'setPositionState' in ms) {
      try {
        ms.setPositionState({
          duration: Math.max(1, totalSeconds(snap.script)),
          position: Math.min(snap.position, totalSeconds(snap.script)),
          playbackRate: 1,
        });
      } catch {
        /* position state is best-effort */
      }
    }
  });

  // An interruption (call, another app) suspends the context; nudge it back when
  // we return to the foreground and the user had it playing.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const snap = engine.snapshot();
    if (snap.status === 'playing') void engine.play();
  });

  const ctx = () => engine.context;
  const recover = () => {
    const c = ctx();
    if (!c) return;
    if (c.state !== 'running' && engine.snapshot().status === 'playing') void engine.play();
  };
  window.addEventListener('focus', recover);
  window.addEventListener('pageshow', recover);
}
