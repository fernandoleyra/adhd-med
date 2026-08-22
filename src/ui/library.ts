/**
 * The library: the papers this app is built on, plus a shelf of the good books
 * about sound, brains and the long argument between number and meaning.
 * Data lives in src/data/references.json.
 */
import refs from '../data/references.json';
import { chip, el, openSheet } from './dom.js';

interface Ref {
  authors: string;
  year: number;
  title: string;
  container?: string;
  topic: string;
  why: string;
  link: string;
}

const TOPICS = refs.topics as Record<string, string>;
const PAPERS = refs.papers as Ref[];
const BOOKS = refs.books as Ref[];
const DOCS = refs.documents as Ref[];

function refRow(r: Ref, kind: 'paper' | 'book' | 'document'): HTMLElement {
  return el('div', { class: 'ref' }, [
    el('div', { class: 'cite' }, [
      `${r.authors} (${r.year}). `,
      el('em', { text: r.title }),
      r.container ? `. ${r.container}` : '',
      '.',
    ]),
    el('div', { class: 'why', text: r.why }),
    el('div', { class: 'meta' }, [
      kind,
      ' · ',
      TOPICS[r.topic] ?? r.topic,
      ' · ',
      el('a', { href: r.link, target: '_blank', rel: 'noopener noreferrer' }, ['open']),
    ]),
  ]);
}

export function openLibrary(initialTopic?: string): void {
  let topic: string | null = initialTopic ?? null;
  const list = el('div');

  const render = () => {
    const pick = <T extends Ref>(items: T[]) => (topic ? items.filter((i) => i.topic === topic) : items);
    const papers = pick(PAPERS);
    const docs = pick(DOCS);
    const books = pick(BOOKS);
    list.replaceChildren(
      ...(papers.length
        ? [el('h3', { class: 'block-title', text: `Papers · ${papers.length}` }), ...papers.map((r) => refRow(r, 'paper'))]
        : []),
      ...(docs.length
        ? [el('h3', { class: 'block-title', text: `Documents · ${docs.length}` }), ...docs.map((r) => refRow(r, 'document'))]
        : []),
      ...(books.length
        ? [el('h3', { class: 'block-title', text: `Books · ${books.length}` }), ...books.map((r) => refRow(r, 'book'))]
        : []),
    );
  };

  const filters = el('div', { class: 'chips', style: { marginBottom: 'var(--s4)' } });
  const rebuildFilters = () => {
    filters.replaceChildren(
      chip('everything', {
        active: topic === null,
        onclick: () => {
          topic = null;
          rebuildFilters();
          render();
        },
      }),
      ...Object.entries(TOPICS).map(([key, label]) =>
        chip(label, {
          active: topic === key,
          onclick: () => {
            topic = key;
            rebuildFilters();
            render();
          },
        }),
      ),
    );
  };
  rebuildFilters();
  render();

  openSheet({
    title: 'Library',
    wide: true,
    body: [el('p', { class: 'lead', text: refs.note }), filters, list],
  });
}

export function referenceCount(): number {
  return PAPERS.length + BOOKS.length + DOCS.length;
}
