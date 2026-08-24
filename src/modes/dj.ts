/**
 * DJ — pick and play.
 *
 * Goal, feel, time, optionally a colour, and one action at the end of those
 * choices that plays exactly what the line above it says. No network, no key,
 * no waiting, nothing to configure: every session is arithmetic this device
 * does itself. Presets are the same thing with the choices already made.
 *
 * The rule: the thing you pressed is the thing you hear, and the button that
 * plays it sits at the end of the choices rather than above them.
 */
import { colourLine, readColour, PALETTE_HUES, type ColourReading } from '../core/colour.js';
import { decodeScript } from '../core/codec.js';
import {
  DURATIONS,
  generate,
  GOALS,
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

interface DjState {
  goal: GoalId;
  moods: MoodId[];
  minutes: number;
  /** the chosen colour, or null for none */
  hue: number | null;
}

/** "Focus · restless · 25 min · violet" — the choices, in one line. */
function summary(state: DjState): string {
  const goal = GOALS.find((g) => g.id === state.goal)?.label ?? 'Focus';
  const moods = state.moods.length ? ` · ${state.moods.join(', ')}` : '';
  const colour = state.hue === null ? '' : ` · ${readColour(state.hue).name}`;
  return `${goal}${moods} · ${state.minutes} min${colour}`;
}

export function renderDj(host: HTMLElement): void {
  const state: DjState = { goal: 'focus', moods: [], minutes: 25, hue: null };
  const result = el('div');

  const reading = (): ColourReading | null => (state.hue === null ? null : readColour(state.hue));

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

  // --- the choices ---

  const goalRow = el('div', { class: 'chips scroll' });
  const moodRow = el('div', { class: 'chips scroll' });
  const durRow = el('div', { class: 'chips scroll' });
  const hueRow = el('div', { class: 'chips scroll' });
  const colourNote = el('p', { class: 'field-hint' });

  const playLabel = el('span', { text: summary(state) });
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
        root: reading()?.folded.hz,
        seed: Date.now() % 1e6,
        method: store.settings.method,
      }),
    ),
  );

  /**
   * Every chip writes into the same line above the button, so the connection
   * between choosing and hearing is visible before anything plays.
   */
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

    // The colour is a real conversion, so it shows its arithmetic: one line on
    // screen, the full derivation and its exponent on hover.
    const colour = reading();
    colourNote.textContent = colour ? colourLine(colour) : 'sets the carrier · light, folded into hearing';
    colourNote.title = colour ? colour.lines.join(' · ') : '';
    hueRow.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('is-on', state.hue === Number((c as HTMLElement).dataset.hue));
    });

    playLabel.textContent = summary(state);
  };

  PALETTE_HUES.forEach((hue) => {
    const swatch = chip(readColour(hue).name, {
      onclick: () => {
        state.hue = state.hue === hue ? null : hue;
        fill();
      },
    });
    swatch.dataset.hue = String(hue);
    swatch.style.setProperty('--swatch', `hsl(${hue} 62% 52%)`);
    swatch.classList.add('swatch');
    hueRow.appendChild(swatch);
  });
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

  clear(host);
  host.append(
    el('div', { class: 'view' }, [
      section('Goal', [goalRow]),
      section('Feel', [moodRow], 'optional'),
      section('Time', [durRow]),
      section('Colour', [hueRow, colourNote], 'optional'),
      // The action lives here, at the end of the choices it acts on.
      el('div', { class: 'commit' }, [playBtn, dice]),
      result,
      section('Presets', [presetRow]),
      ...(saved.length ? [section('Saved', [savedRow])] : []),
    ]),
  );
}
