/**
 * CODEX — the catalogue, as a list you can scan.
 *
 * One line per number: its mark, its name, its tier, and the arithmetic that
 * makes it audible. Everything else — the note, the source, the full
 * derivation — is one tap away, because forty entries of prose is not a list.
 */
import {
  ENTRIES,
  entryMath,
  entryScript,
  searchEntries,
  stackScript,
  TIER_NOTES,
  type CodexEntry,
  type Tier,
} from '../core/codex.js';
import { store } from '../store.js';
import { chip, clear, el, openSheet, section } from '../ui/dom.js';
import { playScript, sessionCard } from '../ui/player.js';
import { drawNumberSigil } from '../viz/marks.js';

const TIERS: Tier[] = ['measured', 'protocol', 'lore'];
const stack: string[] = [];

/** The whole entry, on demand. */
function openEntry(e: CodexEntry, onchange: () => void): void {
  const math = entryMath(e);
  const sigil = el('canvas', { 'aria-hidden': 'true', style: { width: '96px', height: '96px' } });
  const inStack = stack.includes(e.id);

  let close: () => void = () => undefined;
  close = openSheet({
    title: e.name,
    body: [
      el('div', { style: { display: 'flex', gap: 'var(--s4)', alignItems: 'flex-start' } }, [
        sigil,
        el('div', { style: { flex: '1 1 160px' } }, [
          el('span', { class: 'tier', 'data-tier': e.tier, text: e.tier }),
          math ? el('ul', { class: 'derive', style: { marginTop: 'var(--s2)' } }, math.lines.map((l) => el('li', { text: l }))) : null,
        ]),
      ]),
      el('p', { class: 'card-note', text: e.note }),
      e.stages
        ? el('ul', { class: 'derive' }, e.stages.map((s) =>
            el('li', { text: `${s.label} · ${s.beat}${s.beatTo && s.beatTo !== s.beat ? `→${s.beatTo}` : ''} Hz over ${s.carrier} Hz · ${s.minutes} min` }),
          ))
        : null,
      el('p', { class: 'field-hint', text: `${TIER_NOTES[e.tier]}` }),
      el('p', { class: 'field-hint', text: `source: ${e.source}` }),
      el('div', { class: 'row', style: { marginTop: 'var(--s4)' } }, [
        el('button', {
          class: 'primary',
          type: 'button',
          onclick: () => {
            playScript(entryScript(e, { method: store.settings.method }));
            close();
          },
        }, ['Play']),
        el('button', {
          class: 'ghost',
          type: 'button',
          onclick: (ev: Event) => {
            const i = stack.indexOf(e.id);
            if (i >= 0) stack.splice(i, 1);
            else stack.push(e.id);
            (ev.currentTarget as HTMLElement).textContent = stack.includes(e.id) ? 'In stack' : 'Stack';
            onchange();
          },
        }, [inStack ? 'In stack' : 'Stack']),
      ]),
    ],
  });
  requestAnimationFrame(() => drawNumberSigil(sigil, e.value ?? e.stages?.[0]?.beat ?? 1, math?.carrier.k ?? 3, e.tier, 96));
}

/** One scannable row. */
function entryRow(e: CodexEntry, onchange: () => void): HTMLElement {
  const math = entryMath(e);
  const sigil = el('canvas', { 'aria-hidden': 'true' });
  const numbers = math
    ? `${math.carrier.hz.toFixed(math.carrier.hz < 100 ? 2 : 1)} Hz · beat ${math.beat.hz.toFixed(2)}`
    : `${e.stages?.length ?? 0} stages`;

  const row = el(
    'button',
    {
      class: `codex-row${stack.includes(e.id) ? ' is-stacked' : ''}`,
      type: 'button',
      'aria-label': `${e.name}, ${e.tier}`,
      onclick: () => openEntry(e, onchange),
    },
    [
      sigil,
      el('span', { class: 'codex-name' }, [e.name, el('span', { class: 'codex-num', text: numbers })]),
      el('span', { class: 'tier', 'data-tier': e.tier, text: e.tier.slice(0, 4) }),
    ],
  );

  requestAnimationFrame(() =>
    drawNumberSigil(sigil, e.value ?? e.stages?.[0]?.beat ?? 1, math?.carrier.k ?? 3, e.tier, 34),
  );
  return row;
}

export function renderCodex(host: HTMLElement): void {
  let query = '';
  let tier: Tier | null = null;
  const list = el('div', { class: 'codex-list' });
  const stackBar = el('div');

  const rebuild = () => {
    const entries = searchEntries(query).filter((e) => (tier ? e.tier === tier : true));
    clear(list);
    entries.forEach((e) => list.appendChild(entryRow(e, rebuild)));
    if (!entries.length) list.appendChild(el('p', { class: 'field-hint', text: 'nothing matches' }));

    clear(stackBar);
    if (stack.length) {
      const picked = stack.map((id) => ENTRIES.find((x) => x.id === id)!).filter(Boolean);
      const script = stackScript(picked, { method: store.settings.method });
      if (script) {
        stackBar.appendChild(
          sessionCard(script, {
            onplay: () => playScript(script),
            actionLabel: 'Play stack',
            extra: [
              el('button', {
                class: 'ghost',
                type: 'button',
                onclick: () => {
                  stack.length = 0;
                  rebuild();
                },
              }, ['Clear']),
            ],
          }),
        );
      }
    }
  };

  const search = el('input', {
    type: 'search',
    placeholder: 'search',
    'aria-label': 'Search the catalogue',
    oninput: (ev: Event) => {
      query = (ev.target as HTMLInputElement).value;
      rebuild();
    },
  });

  const tierChips = el('div', { class: 'chips scroll' });
  const buildTiers = () => {
    clear(tierChips);
    tierChips.appendChild(
      chip('all', {
        active: tier === null,
        onclick: () => {
          tier = null;
          buildTiers();
          rebuild();
        },
      }),
    );
    TIERS.forEach((t) =>
      tierChips.appendChild(
        chip(t, {
          active: tier === t,
          hint: TIER_NOTES[t],
          onclick: () => {
            tier = t;
            buildTiers();
            rebuild();
          },
        }),
      ),
    );
    tierChips.appendChild(
      el('button', {
        class: 'chip',
        type: 'button',
        'aria-label': 'What the tiers mean',
        onclick: () =>
          openSheet({
            title: 'Tiers',
            body: TIERS.map((t) =>
              el('div', { class: 'ref' }, [
                el('span', { class: 'tier', 'data-tier': t, text: t }),
                el('p', { class: 'why', text: TIER_NOTES[t] }),
              ]),
            ),
          }),
      }, ['?']),
    );
  };
  buildTiers();
  rebuild();

  clear(host);
  host.append(
    el('div', { class: 'view' }, [
      section('Codex', [search, tierChips]),
      stackBar,
      list,
    ]),
  );
}
