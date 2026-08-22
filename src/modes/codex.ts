/**
 * CODEX — the catalogue.
 *
 * Numbers from physics, astronomy, protocol and folklore, each shown with the
 * exact arithmetic that makes it audible and a label saying how much weight it
 * can bear. The tier is the honest part of the design: measured, protocol, lore,
 * drawn as solid, dashed and dotted strokes so you can see it at a glance.
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
import { chip, clear, el, section, toast } from '../ui/dom.js';
import { openLibrary } from '../ui/library.js';
import { playScript, sessionCard } from '../ui/player.js';
import { drawNumberSigil } from '../viz/marks.js';

const TIERS: Tier[] = ['measured', 'protocol', 'lore'];
const stack: string[] = [];

function entryRow(e: CodexEntry, onchange: () => void): HTMLElement {
  const math = entryMath(e);
  const sigil = el('canvas', { 'aria-hidden': 'true' });
  const inStack = stack.includes(e.id);

  const row = el('div', { class: 'card' }, [
    el('div', { class: 'entry' }, [
      sigil,
      el('div', {}, [
        el('div', { class: 'card-head' }, [
          el('h3', { class: 'card-title', text: e.name }),
          el('span', { class: 'tier', 'data-tier': e.tier, text: e.tier }),
        ]),
        el('p', { class: 'card-note', text: e.note }),
        math ? el('ul', { class: 'derive' }, math.lines.map((l) => el('li', { text: l }))) : null,
        e.stages
          ? el('ul', { class: 'derive' }, e.stages.map((s) =>
              el('li', { text: `${s.label}: ${s.beat}${s.beatTo && s.beatTo !== s.beat ? `→${s.beatTo}` : ''} Hz over ${s.carrier} Hz · ${s.minutes} min` }),
            ))
          : null,
        el('div', { class: 'row', style: { marginTop: 'var(--s3)' } }, [
          el('button', {
            class: 'ghost',
            type: 'button',
            onclick: () => playScript(entryScript(e, { method: store.settings.method })),
          }, ['Play']),
          el('button', {
            class: 'ghost',
            type: 'button',
            onclick: () => {
              const i = stack.indexOf(e.id);
              if (i >= 0) stack.splice(i, 1);
              else stack.push(e.id);
              onchange();
            },
          }, [inStack ? 'Remove from stack' : 'Add to stack']),
        ]),
        el('p', { class: 'meta field-hint', text: `source: ${e.source}` }),
      ]),
    ]),
  ]);

  requestAnimationFrame(() => {
    const value = e.value ?? (e.stages?.[0]?.beat ?? 1);
    drawNumberSigil(sigil, value, math?.carrier.k ?? 3, e.tier, 52);
  });
  return row;
}

export function renderCodex(host: HTMLElement): void {
  let query = '';
  let tier: Tier | null = null;
  const list = el('div');
  const stackBar = el('div');
  const rebuild = () => {
    const entries = searchEntries(query).filter((e) => (tier ? e.tier === tier : true));
    clear(list);
    if (!entries.length) list.appendChild(el('p', { class: 'lead', text: 'Nothing matches. Try “schumann”, “gateway”, “solfeggio”, “40”.' }));
    entries.forEach((e) => list.appendChild(entryRow(e, rebuild)));

    clear(stackBar);
    if (stack.length) {
      const entries = stack.map((id) => ENTRIES.find((e) => e.id === id)!).filter(Boolean);
      const script = stackScript(entries, { method: store.settings.method });
      stackBar.append(
        el('div', { class: 'badges' }, entries.map((e) => el('span', { class: 'badge is-accent', text: e.name }))),
        script
          ? sessionCard(script, {
              onplay: () => playScript(script),
              actionLabel: 'Play the stack',
              extra: [
                el('button', {
                  class: 'ghost',
                  type: 'button',
                  onclick: () => {
                    stack.length = 0;
                    rebuild();
                  },
                }, ['Clear stack']),
              ],
            })
          : el('p', { class: 'field-hint', text: 'Those entries are protocols rather than single numbers — play them one at a time.' }),
      );
    }
  };

  const search = el('input', {
    type: 'text',
    placeholder: 'search the catalogue',
    'aria-label': 'Search the catalogue',
    oninput: (ev: Event) => {
      query = (ev.target as HTMLInputElement).value;
      rebuild();
    },
  });

  const tierChips = el('div', { class: 'chips' });
  const buildTiers = () => {
    clear(tierChips);
    tierChips.appendChild(
      chip('everything', {
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
            toast(TIER_NOTES[t]);
          },
        }),
      ),
    );
  };
  buildTiers();
  rebuild();

  clear(host);
  host.append(
    el('div', { class: 'view' }, [
      section('Codex', [
        el('p', { class: 'lead' }, [
          'Any number can be heard: double or halve it until it lands in hearing range. That step is arithmetic, and the exponent is always shown. What the number ',
          el('em', { text: 'means' }),
          ' is a separate question, which is what the tiers are for.',
        ]),
        search,
        tierChips,
        el('ul', { class: 'derive', style: { marginTop: 'var(--s3)' } },
          TIERS.map((t) => el('li', { text: `${t} — ${TIER_NOTES[t]}` })),
        ),
      ]),
      stackBar,
      list,
      section('Where this comes from', [
        el('p', { class: 'field-hint', text: 'Every claim in this catalogue has a source, and the sources are all in one place.' }),
        el('div', { class: 'row' }, [
          el('button', { class: 'ghost', type: 'button', onclick: () => openLibrary() }, ['Open the library']),
        ]),
      ]),
    ]),
  );
}
