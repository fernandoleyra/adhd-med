import { describe, expect, it } from 'vitest';
import refs from '../../src/data/references.json';

/**
 * The library is the app's receipt. These tests are for whoever adds the next
 * entry: they check the shape, not my taste.
 */

interface Ref {
  authors: string;
  year: number;
  title: string;
  container?: string;
  topic: string;
  why: string;
  link: string;
}

const topics = refs.topics as Record<string, string>;
const all = [...(refs.papers as Ref[]), ...(refs.books as Ref[]), ...(refs.documents as Ref[])];

describe('reference library', () => {
  it('is worth having', () => {
    expect(refs.papers.length).toBeGreaterThanOrEqual(20);
    expect(refs.books.length).toBeGreaterThanOrEqual(20);
    expect(refs.documents.length).toBeGreaterThanOrEqual(1);
  });

  it('gives every entry an author, a year, a reachable link and a reason to be there', () => {
    for (const r of all) {
      expect(r.authors.length, r.title).toBeGreaterThan(3);
      expect(r.year, r.title).toBeGreaterThan(1800);
      expect(r.year, r.title).toBeLessThanOrEqual(2027);
      expect(r.link, r.title).toMatch(/^https:\/\//);
      // The "why" is the point: a bare citation list is not a library.
      expect(r.why.length, r.title).toBeGreaterThan(30);
    }
  });

  it('files everything under a topic that exists', () => {
    for (const r of all) expect(topics[r.topic], `${r.title} → ${r.topic}`).toBeTruthy();
    // and every topic is actually used, so the filter chips are never dead ends
    for (const key of Object.keys(topics)) {
      expect(all.some((r) => r.topic === key), `topic "${key}" has no entries`).toBe(true);
    }
  });

  it('has no duplicates', () => {
    const titles = all.map((r) => r.title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
  });

  it('keeps the load-bearing sources: the meta-analysis, the ADHD trials, the negative result', () => {
    const titles = all.map((r) => `${r.authors} ${r.title}`.toLowerCase());
    const has = (needle: string) => titles.some((t) => t.includes(needle));
    expect(has('garcía-argibay')).toBe(true); // the anchor meta-analysis
    expect(has('kennel')).toBe(true); // pediatric ADHD pilot
    expect(has('söderlund')).toBe(true); // noise benefits inattentive listeners
    expect(has('failure to enhance')).toBe(true); // the negative result, kept on purpose
    expect(has('gateway process')).toBe(true); // the CIA/Hemi-Sync document
    expect(has('cosmic octave')).toBe(true); // the source of the lore tier
    expect(has('mozart effect')).toBe(true); // the cautionary tale
  });
});
