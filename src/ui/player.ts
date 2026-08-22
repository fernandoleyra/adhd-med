/**
 * The session: the card that explains it, the transport that plays it, the
 * mini-bar that follows you between modes, and the sheet that opens from it.
 */
import { engine } from '../audio/engine.js';
import { isStandaloneIOS, releaseWakeLock, requestWakeLock, wakeLockSupported } from '../audio/background.js';
import { auditScript } from '../core/ranges.js';
import { bandLabel } from '../core/octave.js';
import {
  needsHeadphones,
  segmentStarts,
  soundingFreq,
  totalSeconds,
  type Script,
  type Segment,
} from '../core/types.js';
import { shareUrl } from '../core/codec.js';
import { store } from '../store.js';
import { drawHeatmap, drawTimeline } from '../viz/marks.js';
import { drawWordSigil } from '../viz/marks.js';
import { chip, clear, el, field, formatClock, formatMinutes, num, openSheet, toast, toggle } from './dom.js';

export function announce(text: string): void {
  const live = document.getElementById('live');
  if (live) live.textContent = text;
}

/** One line describing what a segment is doing, in numbers. */
export function segmentSummary(seg: Segment): string {
  const tones = seg.layers.filter((l) => !l.mute && l.kind === 'tone');
  const lead = tones.sort((a, b) => b.gain - a.gain)[0];
  const noise = seg.layers.find((l) => !l.mute && l.kind === 'noise');
  if (!lead) return noise ? `${noise.color} noise` : 'silence';
  const beat = lead.method === 'tone' ? 'no beat' : `${lead.beat.toFixed(lead.beat < 10 ? 2 : 1)} Hz`;
  const parts = [`${beat} · ${soundingFreq(lead).toFixed(0)} Hz ${lead.method}`];
  if (tones.length > 1) parts.push(`+${tones.length - 1} layer${tones.length > 2 ? 's' : ''}`);
  if (noise) parts.push(`${noise.color} bed`);
  return parts.join(' · ');
}

export interface CardOptions {
  /** show the per-segment rationale rows */
  detail?: boolean;
  /** called when the user presses the main action */
  onplay?: () => void;
  actionLabel?: string;
  extra?: HTMLElement[];
}

/** The "prescription": the arc drawn, then explained segment by segment. */
export function sessionCard(script: Script, opts: CardOptions = {}): HTMLElement {
  const strip = el('canvas', { class: 'strip', 'aria-hidden': 'true' });
  const heat = el('canvas', { class: 'strip', 'aria-hidden': 'true' });
  const notes = auditScript(script);
  const starts = segmentStarts(script);

  const card = el('div', { class: 'card' }, [
    el('div', { class: 'card-head' }, [
      el('h3', { class: 'card-title', text: script.title }),
      el('span', { class: 'tier', 'data-tier': 'measured' }, [formatMinutes(totalSeconds(script))]),
    ]),
    script.note ? el('p', { class: 'card-note', text: script.note }) : null,
    strip,
    heat,
    el('div', { class: 'badges' }, [
      needsHeadphones(script)
        ? el('span', { class: 'badge is-accent', text: 'headphones' })
        : el('span', { class: 'badge', text: 'speaker-safe' }),
      ...notes.map((n) => el('span', { class: 'badge is-warn', text: n })),
    ]),
    opts.detail
      ? el(
          'div',
          {},
          script.segments.map((seg, i) =>
            el('div', { class: 'segrow' }, [
              el('div', {}, [
                el('strong', { text: seg.label ?? `segment ${i + 1}` }),
                seg.why ? el('div', { class: 'why', text: seg.why }) : null,
              ]),
              el('div', { class: 'meta' }, [
                segmentSummary(seg),
                el('br'),
                `${formatClock(starts[i]!)} → ${formatClock(starts[i]! + seg.dur)}`,
              ]),
            ]),
          ),
        )
      : null,
    el('div', { class: 'row', style: { marginTop: 'var(--s3)' } }, [
      opts.onplay
        ? el('button', { class: 'primary', type: 'button', onclick: opts.onplay }, [opts.actionLabel ?? 'Begin'])
        : null,
      ...(opts.extra ?? []),
    ]),
  ]);

  // Canvases need layout before they can be sized.
  requestAnimationFrame(() => {
    const w = strip.parentElement?.clientWidth ?? 320;
    drawTimeline(strip, script, { width: w, height: 116, labels: true });
    drawHeatmap(heat, script, w, 72);
  });
  return card;
}

/** Load a script into the transport and start it. */
export function playScript(script: Script, opts: { announceText?: string } = {}): void {
  engine.setVolume(store.settings.volume);
  engine.load(script, { autoplay: true });
  announce(opts.announceText ?? `Playing ${script.title}. ${formatMinutes(totalSeconds(script))}.`);
  if (store.settings.wakeLock) void requestWakeLock();
}

// ---------- mini bar ----------

export function mountMini(node: HTMLElement): void {
  const sigil = el('canvas', { 'aria-hidden': 'true' });
  const title = el('div', { class: 'mini-title' });
  const meta = el('div', { class: 'mini-meta' });
  const play = el('button', { class: 'icon is-primary', type: 'button', 'aria-label': 'Play or pause' }, ['▶']);
  play.addEventListener('click', (e) => {
    e.stopPropagation();
    void engine.toggle();
  });
  clear(node);
  node.append(sigil, el('div', {}, [title, meta]), play);
  node.addEventListener('click', () => openSession());
  node.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') openSession();
  });

  let lastTitle = '';
  engine.subscribe((snap) => {
    node.classList.toggle('is-on', Boolean(snap.script));
    if (!snap.script) return;
    const seg = snap.script.segments[snap.segIndex];
    title.textContent = snap.script.title;
    meta.textContent = `${formatClock(snap.position)} / ${formatClock(snap.duration)} · ${
      seg ? segmentSummary(seg) : ''
    }`;
    play.textContent = snap.status === 'playing' ? '❙❙' : '▶';
    if (snap.script.title !== lastTitle) {
      lastTitle = snap.script.title;
      drawWordSigil(sigil, snap.script.title, 36);
    }
  });
}

// ---------- session sheet ----------

export function openSession(): void {
  const snap = engine.snapshot();
  if (!snap.script) {
    toast('Nothing loaded yet — pick a session first.');
    return;
  }
  const body: HTMLElement[] = [];
  const strip = el('canvas', { class: 'strip', 'aria-hidden': 'true' });
  const clock = el('span', { class: 'clock' });
  const fill = el('div', { class: 'fill' });
  const scrub = el('div', { class: 'scrub', role: 'slider', 'aria-label': 'Seek' }, [
    el('div', { class: 'track' }),
    fill,
  ]);
  scrub.addEventListener('pointerdown', (e) => {
    const rect = scrub.getBoundingClientRect();
    const u = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    void engine.seek(u * engine.snapshot().duration);
  });

  const playBtn = el('button', { class: 'icon is-primary', type: 'button', 'aria-label': 'Play or pause', onclick: () => void engine.toggle() }, ['▶']);
  const segList = el('div');
  const volume = field({
    label: 'Volume',
    value: engine.volume,
    min: 0,
    max: 1,
    unit: '%',
    format: (v) => String(Math.round(v * 100)),
    hint: 'Louder is not stronger. A limiter sits after this, always.',
    oninput: (v) => {
      engine.setVolume(v);
      store.update({ volume: v });
    },
  });

  body.push(
    el('div', { class: 'card is-flat' }, [
      el('div', { class: 'card-head' }, [
        el('h3', { class: 'card-title', text: snap.script.title }),
        el('span', { class: 'tier', 'data-tier': 'measured' }, [formatMinutes(snap.duration)]),
      ]),
      snap.script.note ? el('p', { class: 'card-note', text: snap.script.note }) : null,
      strip,
      el('div', { class: 'transport' }, [
        el('button', { class: 'icon', type: 'button', 'aria-label': 'Previous segment', onclick: () => void engine.skip(-1) }, ['⇤']),
        playBtn,
        el('button', { class: 'icon', type: 'button', 'aria-label': 'Next segment', onclick: () => void engine.skip(1) }, ['⇥']),
        scrub,
        clock,
      ]),
      volume,
    ]),
    segList,
  );

  const share = el('button', { class: 'ghost', type: 'button', onclick: () => void copyShare(snap.script!) }, ['Copy link']);
  const save = el('button', {
    class: 'ghost',
    type: 'button',
    onclick: async () => {
      const payload = await shareUrl(snap.script!);
      store.save({
        id: `${Date.now().toString(36)}`,
        title: snap.script!.title,
        payload: payload.split('m=')[1] ?? '',
        at: Date.now(),
      });
      toast('Saved to this browser.');
    },
  }, ['Save']);
  const stop = el('button', { class: 'ghost', type: 'button', onclick: () => void engine.stop() }, ['Stop']);
  body.push(el('div', { class: 'row' }, [share, save, stop]));

  if (wakeLockSupported()) {
    body.push(
      toggle(
        'Keep the screen on',
        store.settings.wakeLock,
        (v) => {
          store.update({ wakeLock: v });
          if (v) void requestWakeLock();
          else void releaseWakeLock();
        },
        'A fallback for phones that stop audio when the screen sleeps. Costs battery.',
      ),
    );
  }
  if (isStandaloneIOS()) {
    body.push(
      el('p', { class: 'field-hint', style: { marginTop: 'var(--s3)' } }, [
        'On iPhone, installed-app audio can stop when the screen locks. If a session cuts out, open ADHD MED in Safari instead — the same page, without that bug.',
      ]),
    );
  }

  // The sheet's subscription is released when the sheet closes, not on the
  // next engine event — otherwise a paused session leaks a listener per open.
  let unsub: (() => void) | null = null;
  openSheet({ title: 'Session', body, onclose: () => unsub?.() });

  unsub = engine.subscribe((s) => {
    clock.textContent = `${formatClock(s.position)} / ${formatClock(s.duration)}`;
    fill.style.width = `${s.duration ? (s.position / s.duration) * 100 : 0}%`;
    playBtn.textContent = s.status === 'playing' ? '❙❙' : '▶';
    scrub.setAttribute('aria-valuetext', `${formatClock(s.position)} of ${formatClock(s.duration)}`);
    if (!s.script) return;
    const starts = segmentStarts(s.script);
    clear(segList);
    s.script.segments.forEach((seg, i) => {
      segList.appendChild(
        el('div', { class: `segrow${i === s.segIndex ? ' is-on' : ''}` }, [
          el('div', {}, [
            el('strong', { text: seg.label ?? `segment ${i + 1}` }),
            seg.why ? el('div', { class: 'why', text: seg.why }) : null,
            el('div', { class: 'why' }, [bandLabel(seg.layers.find((l) => l.kind === 'tone')?.beat ?? 0)]),
          ]),
          el('div', { class: 'meta' }, [
            segmentSummary(seg),
            el('br'),
            el('button', {
              class: 'ghost',
              type: 'button',
              style: { minHeight: '32px', padding: '0 10px', marginTop: '4px' },
              onclick: () => void engine.seek(starts[i]! + 0.2),
            }, ['jump']),
          ]),
        ]),
      );
    });
    const w = strip.parentElement?.clientWidth ?? 320;
    drawTimeline(strip, s.script, { width: w, height: 116, labels: true, position: s.position, active: s.segIndex });
  });
}

export async function copyShare(script: Script): Promise<void> {
  const url = await shareUrl(script);
  try {
    await navigator.clipboard.writeText(url);
    toast(`Link copied · ${url.length} characters`);
  } catch {
    openSheet({
      title: 'Share link',
      body: [
        el('p', { class: 'lead', text: 'Copy this — it contains the whole session. No account, no server.' }),
        el('textarea', { class: 'mono', rows: '5', readonly: true, text: url }),
      ],
    });
  }
}

/** A compact delivery-method switch, used in several modes. */
export function methodChips(current: string, onpick: (m: 'binaural' | 'monaural' | 'isochronic') => void): HTMLElement {
  const options: { id: 'binaural' | 'monaural' | 'isochronic'; hint: string }[] = [
    { id: 'binaural', hint: 'one tone per ear — needs headphones' },
    { id: 'monaural', hint: 'the beat is really in the air — speakers fine' },
    { id: 'isochronic', hint: 'a pulsed tone — the most assertive, speakers fine' },
  ];
  return el(
    'div',
    { class: 'chips' },
    options.map((o) => chip(o.id, { active: current === o.id, hint: o.hint, onclick: () => onpick(o.id) })),
  );
}

export { num };
