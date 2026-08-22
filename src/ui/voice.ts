/**
 * Speaking instead of typing.
 *
 * The browser's own recogniser does the transcribing, so a voice note costs
 * nothing, needs no key, and the audio never leaves the device — what reaches
 * the DJ is the same text you would have typed. Where the API is missing (most
 * of Firefox, some embedded webviews) the button simply is not offered.
 */

interface Alternative {
  transcript: string;
}
interface Result {
  readonly length: number;
  isFinal: boolean;
  item(i: number): Alternative;
  [i: number]: Alternative;
}
interface ResultEvent extends Event {
  resultIndex: number;
  results: { readonly length: number; item(i: number): Result; [i: number]: Result };
}
interface Recogniser extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: ResultEvent) => void) | null;
  onerror: ((e: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
}
type RecogniserCtor = new () => Recogniser;

function ctor(): RecogniserCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecogniserCtor; webkitSpeechRecognition?: RecogniserCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function voiceSupported(): boolean {
  return ctor() !== null;
}

export interface Dictation {
  /** stop listening; the last text already delivered stands */
  stop(): void;
}

export interface DictateOptions {
  /** called as the transcript grows, interim results included */
  ontext(text: string, final: boolean): void;
  /** called once, whenever listening ends — including on error */
  onend(error?: string): void;
}

/**
 * Listen until stopped. Interim results are reported as they arrive so the
 * field fills in while you talk; `final` marks the phrases the recogniser has
 * committed to.
 */
export function dictate(opts: DictateOptions): Dictation | null {
  const Ctor = ctor();
  if (!Ctor) return null;

  const rec = new Ctor();
  rec.lang = navigator.language || 'en-US';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let settled = '';
  rec.onresult = (e) => {
    let pending = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i]!;
      const text = result[0]?.transcript ?? '';
      if (result.isFinal) settled += text;
      else pending += text;
    }
    opts.ontext(`${settled}${pending}`.trim(), pending === '');
  };
  rec.onerror = (e) => opts.onend(e.error ?? 'error');
  rec.onend = () => opts.onend();

  try {
    rec.start();
  } catch {
    // Already running, or the page is not allowed to listen.
    opts.onend('start');
    return null;
  }
  return { stop: () => rec.stop() };
}
