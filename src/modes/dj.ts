/**
 * DJ — describe your state, get a session.
 *
 * The conversational field is the front door, but the scripted generator behind
 * it is the actual product: it runs offline, with no key, using the same arc
 * grammar the model is asked to follow. When the network or the key is missing
 * the field still works — the text is read by keyword and handed to the
 * generator, and the card says so plainly.
 */
import { aiAvailable, AiError, requestSession } from '../ai/client.js';
import { decodeScript } from '../core/codec.js';
import {
  DURATIONS,
  generate,
  GOALS,
  inferTags,
  MOODS,
  preset,
  PRESETS,
  surprise,
  type GoalId,
  type MoodId,
} from '../core/generate.js';
import { loadIntoLab } from './lab.js';
import { navigate } from '../router.js';
import { store } from '../store.js';
import { chip, clear, el, section, toast } from '../ui/dom.js';
import { playScript, sessionCard } from '../ui/player.js';
import { isOffline } from '../pwa/offline.js';

interface DjState {
  text: string;
  goal: GoalId;
  moods: MoodId[];
  minutes: number;
  busy: boolean;
}

export function renderDj(host: HTMLElement): void {
  const settings = store.settings;
  const state: DjState = { text: '', goal: 'focus', moods: [], minutes: 25, busy: false };
  const result = el('div');

  const show = (script: ReturnType<typeof generate>, badge?: string) => {
    clear(result);
    result.append(
      sessionCard(script, {
        detail: true,
        onplay: () => playScript(script),
        actionLabel: 'Begin',
        extra: [
          el('button', {
            class: 'ghost',
            type: 'button',
            onclick: () => {
              // Hand the session over first, then navigate: the Lab renders on
              // the route change, so the order matters.
              loadIntoLab(script);
              navigate('/lab');
            },
          }, ['Open in Lab']),
        ],
      }),
    );
    if (badge) {
      result.prepend(el('div', { class: 'badges' }, [el('span', { class: 'badge', text: badge })]));
    }
    result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // --- conversational field ---
  const input = el('textarea', {
    placeholder: 'Tell the DJ how you feel and what you need.\n\ne.g. “wired from too much coffee, need to write for an hour without spiralling”',
    'aria-label': 'Tell the DJ how you feel and what you need',
    oninput: (e: Event) => {
      state.text = (e.target as HTMLTextAreaElement).value;
      askBtn.disabled = state.busy || state.text.trim().length < 3;
    },
  });

  const askBtn = el('button', { class: 'primary', type: 'button', disabled: true }, ['Ask the DJ']);
  askBtn.addEventListener('click', async () => {
    if (state.busy) return;
    const text = state.text.trim();
    const tags = inferTags(text);
    const hasAi = aiAvailable(store.settings);
    if (!hasAi) {
      const script = generate({ ...tags, seed: Date.now() % 1e6, method: store.settings.method });
      script.title = `${script.title}`;
      show(
        script,
        isOffline()
          ? 'offline · scripted DJ · same grammar, no network'
          : 'scripted DJ · add a key in settings for the conversational one',
      );
      return;
    }
    state.busy = true;
    askBtn.disabled = true;
    askBtn.textContent = 'Thinking…';
    try {
      const script = await requestSession({
        text,
        minutes: tags.minutes,
        headphones: store.settings.headphones,
        apiKey: store.settings.apiKey,
        model: store.settings.model,
        proxyUrl: store.settings.proxyUrl || undefined,
      });
      show(script, `AI DJ · ${store.settings.model}`);
    } catch (err) {
      const message = err instanceof AiError ? err.message : 'The DJ did not answer';
      const script = generate({ ...tags, seed: Date.now() % 1e6, method: store.settings.method });
      show(script, `scripted fallback · ${message.toLowerCase()}`);
      toast(`${message}. Used the scripted DJ instead.`, 'warn');
    } finally {
      state.busy = false;
      askBtn.textContent = 'Ask the DJ';
      askBtn.disabled = state.text.trim().length < 3;
    }
  });

  const aiNote = el('p', { class: 'field-hint' }, [
    aiAvailable(settings)
      ? `Conversational DJ on · ${settings.proxyUrl ? 'via your proxy' : settings.model}. The arc it writes is validated and clamped like any other.`
      : 'No key set, so the field is read by keyword and handed to the scripted DJ. That path never needs a network.',
  ]);

  // --- tags ---
  const goalRow = el('div', { class: 'chips' });
  const moodRow = el('div', { class: 'chips' });
  const durRow = el('div', { class: 'chips' });

  const buildTags = () => {
    clear(goalRow);
    GOALS.forEach((g) =>
      goalRow.appendChild(
        chip(g.label, {
          active: state.goal === g.id,
          hint: g.hint,
          onclick: () => {
            state.goal = g.id;
            state.minutes = g.id === 'sleep' ? 45 : g.id === 'spark' ? 10 : state.minutes;
            buildTags();
          },
        }),
      ),
    );
    clear(moodRow);
    MOODS.forEach((m) =>
      moodRow.appendChild(
        chip(m.label, {
          active: state.moods.includes(m.id),
          hint: m.hint,
          onclick: () => {
            state.moods = state.moods.includes(m.id)
              ? state.moods.filter((x) => x !== m.id)
              : [...state.moods, m.id].slice(-3);
            buildTags();
          },
        }),
      ),
    );
    clear(durRow);
    DURATIONS.forEach((d) =>
      durRow.appendChild(
        chip(`${d} min`, {
          active: state.minutes === d,
          onclick: () => {
            state.minutes = d;
            buildTags();
          },
        }),
      ),
    );
  };
  buildTags();

  const buildBtn = el('button', {
    class: 'primary',
    type: 'button',
    onclick: () =>
      show(
        generate({
          goal: state.goal,
          moods: state.moods,
          minutes: state.minutes,
          seed: Date.now() % 1e6,
          method: store.settings.method,
        }),
        'scripted DJ',
      ),
  }, ['Build it']);

  const diceBtn = el('button', {
    class: 'ghost',
    type: 'button',
    onclick: () => {
      const seed = Math.floor(Math.random() * 1e6);
      show(surprise(seed), `seed ${seed.toString(36)} — same seed, same session`);
    },
  }, ['Roll the dice']);

  // --- presets ---
  const presetRow = el(
    'div',
    { class: 'chips' },
    PRESETS.map((p) =>
      chip(p.name, {
        onclick: () => {
          const script = preset(p.id, store.settings.method);
          if (script) show(script, 'preset');
        },
      }),
    ),
  );

  // --- saved ---
  const savedRow = el('div', { class: 'chips' });
  const buildSaved = () => {
    const saved = store.get().saved;
    clear(savedRow);
    if (!saved.length) {
      savedRow.appendChild(el('p', { class: 'field-hint', text: 'Nothing saved yet. Sessions you save live in this browser; links carry them anywhere.' }));
      return;
    }
    saved.forEach((s) =>
      savedRow.appendChild(
        chip(s.title, {
          onclick: async () => {
            const script = await decodeScript(s.payload);
            if (script) show(script, 'saved');
            else toast('That saved session could not be read.', 'warn');
          },
          tag: new Date(s.at).toLocaleDateString(),
        }),
      ),
    );
  };
  buildSaved();

  clear(host);
  host.append(
    el('div', { class: 'view' }, [
      section('DJ', [
        el('p', { class: 'lead', text: 'Say what you need. You get a session with its reasons attached.' }),
        input,
        el('div', { class: 'row', style: { marginTop: 'var(--s3)' } }, [askBtn]),
        aiNote,
      ]),
      section('Or pick it apart', [
        el('h3', { class: 'field-label', text: 'Goal' }),
        goalRow,
        el('h3', { class: 'field-label', style: { marginTop: 'var(--s4)' }, text: 'How you feel' }),
        moodRow,
        el('h3', { class: 'field-label', style: { marginTop: 'var(--s4)' }, text: 'Length' }),
        durRow,
        el('div', { class: 'row', style: { marginTop: 'var(--s4)' } }, [buildBtn, diceBtn]),
      ], 'works offline'),
      result,
      section('Presets', [presetRow]),
      section('Saved here', [savedRow]),
    ]),
  );
}
