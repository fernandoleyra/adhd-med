/**
 * DJ — two ways to get a session, and they are different things.
 *
 * QUICK is the one that always works: goal, feel, time, and a single action at
 * the end of the choices that plays exactly what the line above it says. No
 * network, no key, no waiting. Presets are the same thing with the choices
 * already made.
 *
 * SET is a DJ set. You say where you are — typed, spoken, or as a colour — and
 * a model plans a session that moves: the beat travels, carriers glide, the bed
 * comes and goes. Without a key it still answers, from the scripted arcs, and
 * says so.
 *
 * The rule both paths obey: the thing you pressed is the thing you hear, and
 * the button that plays it sits at the end of the choices rather than above
 * them.
 */
import { aiAvailable, AiError, aiLabel, requestSession } from '../ai/client.js';
import { colourLine, readColour, PALETTE_HUES, type ColourReading } from '../core/colour.js';
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
import { dictate, voiceSupported, type Dictation } from '../ui/voice.js';
import { isOffline } from '../pwa/offline.js';
import { drawSphere, readInk } from '../viz/marks.js';

type Path = 'quick' | 'set';

interface DjState {
  path: Path;
  text: string;
  goal: GoalId;
  moods: MoodId[];
  minutes: number;
  /** the chosen colour, or null for none */
  hue: number | null;
  busy: boolean;
}

/** "Focus · restless · 25 min" — what the choices add up to, in one line. */
function quickSummary(state: DjState): string {
  const goal = GOALS.find((g) => g.id === state.goal)?.label ?? 'Focus';
  const moods = state.moods.length ? ` · ${state.moods.join(', ')}` : '';
  return `${goal}${moods} · ${state.minutes} min`;
}

export function renderDj(host: HTMLElement): void {
  const settings = store.settings;
  const state: DjState = {
    path: settings.djPath,
    text: '',
    goal: 'focus',
    moods: [],
    minutes: 25,
    hue: null,
    busy: false,
  };
  const result = el('div');
  const body = el('div');

  /** Show the session and start it: the card is what you are already hearing. */
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

  // ---------- the orb: which DJ is on, and whether it is ----------

  const orbCanvas = el('canvas', { 'aria-hidden': 'true' });
  const orbDot = el('i', { class: 'dot', 'aria-hidden': 'true' });
  const orb = el('button', {
    class: 'orb',
    type: 'button',
    onclick: () => openSettings(),
  }, [orbCanvas, el('span', { class: 'orb-label', text: 'AI' }), orbDot]);

  const refreshOrb = () => {
    const live = aiAvailable(settings);
    orb.classList.toggle('is-live', live);
    orbDot.classList.toggle('is-live', live);
    orb.setAttribute('aria-label', `${aiLabel(settings)} — open settings`);
    orb.title = aiLabel(settings);
  };
  requestAnimationFrame(() => drawSphere(orbCanvas, 22, readInk(orb)));
  refreshOrb();

  // ---------- quick ----------

  function buildQuick(): HTMLElement[] {
    const goalRow = el('div', { class: 'chips scroll' });
    const moodRow = el('div', { class: 'chips scroll' });
    const durRow = el('div', { class: 'chips scroll' });
    const playLabel = el('span', { text: quickSummary(state) });
    const playBtn = el('button', { class: 'primary wide', type: 'button' }, [
      el('span', { class: 'play-mark', 'aria-hidden': 'true', text: '▶' }),
      playLabel,
    ]);
    playBtn.addEventListener('click', () =>
      show(
        generate({
          goal: state.goal,
          moods: state.moods,
          minutes: state.minutes,
          seed: Date.now() % 1e6,
          method: store.settings.method,
        }),
      ),
    );

    // Every chip writes into the same line above the button, so the connection
    // between choosing and hearing is visible before anything plays.
    const sync = () => {
      playLabel.textContent = quickSummary(state);
    };

    const fill = () => {
      clear(goalRow);
      GOALS.forEach((g) =>
        goalRow.appendChild(
          chip(g.label, {
            active: state.goal === g.id,
            hint: g.hint,
            onclick: () => {
              state.goal = g.id;
              if (g.id === 'sleep') state.minutes = 45;
              if (g.id === 'spark') state.minutes = 10;
              fill();
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
              fill();
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
              fill();
            },
          }),
        ),
      );
      sync();
    };
    fill();

    const dice = el('button', {
      class: 'ghost',
      type: 'button',
      onclick: () => {
        const seed = Math.floor(Math.random() * 1e6);
        show(surprise(seed), `seed ${seed.toString(36)}`);
      },
    }, ['Roll the dice']);

    const presetRow = el('div', { class: 'chips scroll' },
      PRESETS.map((p) =>
        chip(p.name, {
          onclick: () => {
            const script = preset(p.id, store.settings.method);
            if (script) show(script);
          },
        }),
      ),
    );

    const savedRow = el('div', { class: 'chips scroll' });
    const saved = store.get().saved;
    saved.forEach((sv) =>
      savedRow.appendChild(
        chip(sv.title, {
          tag: new Date(sv.at).toLocaleDateString(),
          onclick: async () => {
            const script = await decodeScript(sv.payload);
            if (script) show(script);
            else toast('That saved session could not be read.', 'warn');
          },
        }),
      ),
    );

    return [
      section('Goal', [goalRow]),
      section('Feel', [moodRow], 'optional'),
      section('Time', [durRow]),
      // The action lives here, at the end of the choices it acts on.
      el('div', { class: 'commit' }, [playBtn, dice]),
      result,
      section('Presets', [presetRow]),
      ...(saved.length ? [section('Saved', [savedRow])] : []),
    ];
  }

  // ---------- set ----------

  function buildSet(): HTMLElement[] {
    const input = el('textarea', {
      rows: '3',
      placeholder: 'wired from coffee, need to write for an hour',
      'aria-label': 'Tell the DJ where you are',
      oninput: (e: Event) => {
        state.text = (e.target as HTMLTextAreaElement).value;
      },
    });

    // --- voice: the browser transcribes, so this costs nothing and stays here
    let listening: Dictation | null = null;
    const micBtn = el('button', {
      class: 'icon',
      type: 'button',
      'aria-label': 'Speak instead of typing',
      title: 'speak instead of typing',
      onclick: () => {
        if (listening) {
          listening.stop();
          return;
        }
        listening = dictate({
          ontext: (text) => {
            state.text = text;
            input.value = text;
          },
          onend: (err) => {
            listening = null;
            micBtn.classList.remove('is-on');
            if (err && err !== 'aborted') toast('Could not hear that. Type it instead.', 'warn');
          },
        });
        if (listening) micBtn.classList.add('is-on');
      },
    }, ['∿']);

    // --- colour: a real conversion, shown with its arithmetic
    const colourNote = el('p', { class: 'field-hint' });
    const hueRow = el('div', { class: 'chips scroll' });
    const readColourNow = (): ColourReading | null => (state.hue === null ? null : readColour(state.hue));

    const syncColour = () => {
      const reading = readColourNow();
      // One line on screen; the full derivation, exponent and all, on hover.
      colourNote.textContent = reading ? colourLine(reading) : 'sets the carrier · light, folded into hearing';
      colourNote.title = reading ? reading.lines.join(' · ') : '';
      hueRow.querySelectorAll('.chip').forEach((c) => {
        const hue = Number((c as HTMLElement).dataset.hue);
        c.classList.toggle('is-on', state.hue === hue);
      });
    };

    PALETTE_HUES.forEach((hue) => {
      const swatch = chip(readColour(hue).name, {
        onclick: () => {
          state.hue = state.hue === hue ? null : hue;
          syncColour();
        },
      });
      swatch.dataset.hue = String(hue);
      swatch.style.setProperty('--swatch', `hsl(${hue} 62% 52%)`);
      swatch.classList.add('swatch');
      hueRow.appendChild(swatch);
    });
    syncColour();

    const askBtn = el('button', { class: 'primary wide', type: 'button' }, [
      el('span', { class: 'play-mark', 'aria-hidden': 'true', text: '▶' }),
      el('span', { text: 'DJ a set' }),
    ]);

    askBtn.addEventListener('click', async () => {
      if (state.busy) return;
      const spoken = state.text.trim();
      const reading = readColourNow();
      const root = reading?.folded.hz;
      // A colour is an input on its own — enough to ask for a set with.
      const text = spoken.length >= 3 ? spoken : reading ? `Somewhere ${reading.name}.` : '';
      const tags = spoken.length >= 3
        ? inferTags(spoken)
        : { goal: state.goal, moods: state.moods, minutes: state.minutes };

      // No key, no network, or nothing given at all: the scripted arcs still
      // answer, and a chosen colour still tunes them.
      if (!aiAvailable(store.settings) || !text) {
        show(
          generate({ ...tags, root, seed: Date.now() % 1e6, method: store.settings.method }),
          !text ? undefined : isOffline() ? 'offline · scripted' : 'scripted',
        );
        refreshOrb();
        return;
      }

      state.busy = true;
      askBtn.disabled = true;
      askBtn.classList.add('is-busy');
      try {
        const script = await requestSession({
          text,
          minutes: tags.minutes,
          headphones: store.settings.headphones,
          apiKey: store.settings.apiKey,
          model: store.settings.model,
          proxyUrl: store.settings.proxyUrl || undefined,
          root,
          rootFrom: reading ? `${reading.name}, ${reading.wavelength.toFixed(0)} nm` : undefined,
        });
        show(script, aiLabel(store.settings));
      } catch (err) {
        const message = err instanceof AiError ? err.message : 'The DJ did not answer';
        show(
          generate({ ...tags, root, seed: Date.now() % 1e6, method: store.settings.method }),
          `scripted · ${message.toLowerCase()}`,
        );
        toast(`${message}. Used the scripted DJ instead.`, 'warn');
      } finally {
        state.busy = false;
        askBtn.disabled = false;
        askBtn.classList.remove('is-busy');
        // Whether this deployment has a hosted DJ is only learned by asking.
        refreshOrb();
      }
    });

    return [
      section('Say where you are', [
        input,
        el('div', { class: 'row', style: { marginTop: 'var(--s3)' } }, [
          ...(voiceSupported() ? [micBtn] : []),
          el('span', { class: 'field-hint', text: voiceSupported() ? 'type, or speak' : 'a sentence is enough' }),
        ]),
      ]),
      section('Colour', [hueRow, colourNote], 'optional'),
      el('div', { class: 'commit' }, [askBtn]),
      result,
    ];
  }

  // ---------- the two paths ----------

  const paths: { id: Path; label: string; hint: string }[] = [
    { id: 'quick', label: 'Quick', hint: 'pick and play — no network' },
    { id: 'set', label: 'AI set', hint: 'a session that moves, planned for you' },
  ];

  // Two buttons with a pressed state, not an ARIA tablist: there is one panel
  // below, not two, and "Quick, pressed" is what a screen reader should say.
  const switcher = el('div', { class: 'switch', role: 'group', 'aria-label': 'How to build the session' });
  const pathHint = el('p', { class: 'field-hint', style: { marginTop: 'var(--s2)' } });
  const fillSwitch = () => {
    clear(switcher);
    pathHint.textContent = paths.find((p) => p.id === state.path)!.hint;
    paths.forEach((p) =>
      switcher.appendChild(
        el('button', {
          class: `switch-tab ${state.path === p.id ? 'is-on' : ''}`,
          type: 'button',
          'aria-pressed': state.path === p.id ? 'true' : 'false',
          title: p.hint,
          onclick: () => {
            if (state.path === p.id) return;
            state.path = p.id;
            store.update({ djPath: p.id });
            fillSwitch();
            fillBody();
          },
        }, [p.label]),
      ),
    );
  };

  const fillBody = () => {
    clear(result);
    clear(body);
    body.append(...(state.path === 'quick' ? buildQuick() : buildSet()));
  };

  fillSwitch();
  fillBody();

  clear(host);
  host.append(
    el('div', { class: 'view' }, [
      el('div', { class: 'view-head' }, [
        el('h2', { class: 'view-title', text: 'DJ' }),
        orb,
      ]),
      switcher,
      pathHint,
      body,
    ]),
  );
}
