/**
 * DJ — describe your state, get a session.
 *
 * The conversational field is the front door, but the scripted generator behind
 * it is the actual product: it runs offline, with no key, using the same arc
 * grammar the model is asked to follow. When the network or the key is missing
 * the field still works — the text is read by keyword and handed to the
 * generator, and the card says so plainly.
 */
import { aiAvailable, AiError, aiLabel, requestSession } from '../ai/client.js';
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
import { openSettings } from '../ui/settings.js';
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

  /**
   * Show the session and start it. One tap should make sound: the card below is
   * what you are already hearing, not a form to submit.
   */
  const show = (script: ReturnType<typeof generate>, badge?: string) => {
    playScript(script);
    clear(result);
    result.append(
      sessionCard(script, {
        detail: true,
        onplay: () => playScript(script),
        actionLabel: 'Restart',
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
    rows: '3',
    placeholder: 'How do you feel, and what do you need?',
    'aria-label': 'Tell the DJ how you feel and what you need',
    oninput: (e: Event) => {
      state.text = (e.target as HTMLTextAreaElement).value;
      askBtn.textContent = state.text.trim().length >= 3 ? 'Ask the DJ' : 'Play something';
    },
  });

  const askBtn = el('button', { class: 'primary', type: 'button' }, ['Play something']);
  askBtn.addEventListener('click', async () => {
    if (state.busy) return;
    const text = state.text.trim();
    // An empty field is not an error: build from whatever the chips say.
    if (text.length < 3) {
      show(
        generate({
          goal: state.goal,
          moods: state.moods,
          minutes: state.minutes,
          seed: Date.now() % 1e6,
          method: store.settings.method,
        }),
      );
      return;
    }
    const tags = inferTags(text);
    const hasAi = aiAvailable(store.settings);
    if (!hasAi) {
      const script = generate({ ...tags, seed: Date.now() % 1e6, method: store.settings.method });
      show(
        script,
        isOffline() ? 'offline · scripted' : 'scripted',
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
      show(script, `AI · ${store.settings.model}`);
    } catch (err) {
      const message = err instanceof AiError ? err.message : 'The DJ did not answer';
      const script = generate({ ...tags, seed: Date.now() % 1e6, method: store.settings.method });
      show(script, `scripted · ${message.toLowerCase()}`);
      toast(`${message}. Used the scripted DJ instead.`, 'warn');
    } finally {
      state.busy = false;
      askBtn.textContent = 'Ask the DJ';
      askBtn.disabled = false;
      // Whether this deployment has a hosted DJ is only learned by asking once.
      refreshBadge();
    }
  });

  // One badge, not a paragraph: it says which DJ will answer, and tapping it
  // goes where you would change that.
  const aiBadge = el('button', {
    class: 'badge',
    type: 'button',
    onclick: () => openSettings(),
  });
  const refreshBadge = () => {
    const ok = aiAvailable(settings);
    aiBadge.textContent = aiLabel(settings);
    aiBadge.classList.toggle('is-accent', ok);
    aiBadge.title = ok ? 'change the model' : 'add a key to use the conversational DJ';
  };
  refreshBadge();
  const aiNote = el('div', { class: 'badges', style: { margin: '0' } }, [aiBadge]);

  // --- tags ---
  const goalRow = el('div', { class: 'chips scroll' });
  const moodRow = el('div', { class: 'chips scroll' });
  const durRow = el('div', { class: 'chips scroll' });

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

  const diceBtn = el('button', {
    class: 'ghost',
    type: 'button',
    onclick: () => {
      const seed = Math.floor(Math.random() * 1e6);
      show(surprise(seed), `seed ${seed.toString(36)}`);
    },
  }, ['Roll the dice']);

  // --- presets ---
  const presetRow = el(
    'div',
    { class: 'chips scroll' },
    PRESETS.map((p) =>
      chip(p.name, {
        onclick: () => {
          const script = preset(p.id, store.settings.method);
          if (script) show(script, undefined);
        },
      }),
    ),
  );

  // --- saved ---
  const savedRow = el('div', { class: 'chips scroll' });
  const buildSaved = () => {
    const saved = store.get().saved;
    clear(savedRow);
    if (!saved.length) {
      return;
    }
    saved.forEach((s) =>
      savedRow.appendChild(
        chip(s.title, {
          onclick: async () => {
            const script = await decodeScript(s.payload);
            if (script) show(script);
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
        input,
        el('div', { class: 'row', style: { marginTop: 'var(--s3)' } }, [askBtn, aiNote]),
      ]),
      section('Goal', [goalRow]),
      section('Feel', [moodRow]),
      section('Time', [durRow, el('div', { class: 'row', style: { marginTop: 'var(--s3)' } }, [diceBtn])]),
      result,
      section('Presets', [presetRow]),
      ...(store.get().saved.length ? [section('Saved', [savedRow])] : []),
    ]),
  );
}
