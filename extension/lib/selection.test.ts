import { beforeEach, describe, expect, it } from 'vitest';
import { getSelectionContext, lastSentence, sentenceAround, sentenceBefore } from './selection';

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

describe('sentenceBefore', () => {
  const text = 'We tried a new method. This approach  worked well. Then we stopped.';

  it('returns the sentence before the one at start', () => {
    const start = text.indexOf('approach');
    expect(sentenceBefore(text, start)).toBe('We tried a new method.');
  });

  it('is null for the first sentence', () => {
    expect(sentenceBefore(text, text.indexOf('new'))).toBeNull();
  });

  it('keeps closing quotes', () => {
    const quoted = 'She said "it\'s over." That ended it.';
    expect(sentenceBefore(quoted, quoted.indexOf('ended'))).toBe('She said "it\'s over."');
  });
});

describe('lastSentence', () => {
  it('returns the last sentence, with or without a terminator', () => {
    expect(lastSentence('One. Two is here.  ')).toBe('Two is here.');
    expect(lastSentence('One. Two without end')).toBe('Two without end');
    expect(lastSentence('   ')).toBeNull();
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
      previousSentence: 'Intro text.',
      pageTitle: 'Test page',
      sourceUrl: window.location.href,
    });
  });

  it('takes the previous sentence from the paragraph before when the word opens one', () => {
    document.body.innerHTML =
      '<article><p>We used a new method. It was fast.</p><p>This <em>approach</em> worked.</p></article>';
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('em')!);
    window.getSelection()!.addRange(range);

    expect(getSelectionContext(window)?.previousSentence).toBe('It was fast.');
  });

  it('has no previous sentence at the start of the first paragraph', () => {
    document.body.innerHTML = '<article><h2>Methods</h2><p>This <em>approach</em> worked.</p></article>';
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('em')!);
    window.getSelection()!.addRange(range);

    expect(getSelectionContext(window)?.previousSentence).toBeNull();
  });
});
