import { describe, expect, it } from 'vitest';
import { readShare, wordsIn } from './share';

describe('readShare', () => {
  it('is null without shared text', () => {
    expect(readShare('')).toBeNull();
  });

  it('takes a single shared word as the word to save', () => {
    expect(readShare('?text=%E2%80%9Cephemeral%E2%80%9D')).toEqual({
      text: 'ephemeral',
      word: 'ephemeral',
      pageTitle: null,
      sourceUrl: null,
    });
  });

  it('keeps a shared passage for picking the word, and moves a trailing link to the source', () => {
    const text = 'Fame is ephemeral, she said. https://example.com/story';
    expect(readShare(`?title=Story&text=${encodeURIComponent(text)}`)).toEqual({
      text: 'Fame is ephemeral, she said',
      word: '',
      pageTitle: 'Story',
      sourceUrl: 'https://example.com/story',
    });
  });

  it('prefers the url parameter over a link in the text', () => {
    expect(readShare('?text=word%20https://a.example&url=https://b.example')?.sourceUrl).toBe('https://b.example');
  });
});

describe('wordsIn', () => {
  it('finds words with their places, keeping apostrophes and hyphens inside words', () => {
    expect(wordsIn("It's well-known.")).toEqual([
      { word: "It's", start: 0, end: 4 },
      { word: 'well-known', start: 5, end: 15 },
    ]);
  });
});
