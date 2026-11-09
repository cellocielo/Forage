import { beforeEach, describe, expect, it } from 'vitest';
import { getSelectionContext, sentenceAround } from './selection';

describe('sentenceAround', () => {
  const text = 'First sentence here. The quick fox was laconic! Last one? Yes.';

  it('returns only the sentence containing the span', () => {
    const start = text.indexOf('laconic');
    expect(sentenceAround(text, start, start + 'laconic'.length)).toBe('The quick fox was laconic!');
  });

  it('handles the first and last sentence', () => {
    expect(sentenceAround(text, 0, 5)).toBe('First sentence here.');
    const start = text.indexOf('Yes');
    expect(sentenceAround(text, start, start + 3)).toBe('Yes.');
  });

  it('keeps closing quotes with the sentence', () => {
    const quoted = 'He said "it was ephemeral." Then he left.';
    const start = quoted.indexOf('ephemeral');
    expect(sentenceAround(quoted, start, start + 9)).toBe('He said "it was ephemeral."');
  });

  it('returns the whole text when there is no terminator', () => {
    expect(sentenceAround('a heading with  words', 2, 9)).toBe('a heading with words');
  });
});

describe('getSelectionContext', () => {
  beforeEach(() => {
    document.title = 'Test page';
    document.body.innerHTML =
      '<article><p id="p">Intro text. Fame is <em>ephemeral</em> by nature. Outro.</p></article>';
    window.getSelection()?.removeAllRanges();
  });

  it('returns null when nothing is selected', () => {
    expect(getSelectionContext(window)).toBeNull();
  });

  it('captures the word, its sentence across inline elements, and the page', () => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('em')!);
    window.getSelection()!.addRange(range);

    expect(getSelectionContext(window)).toEqual({
      word: 'ephemeral',
      sentence: 'Fame is ephemeral by nature.',
      pageTitle: 'Test page',
      sourceUrl: window.location.href,
    });
  });
});
