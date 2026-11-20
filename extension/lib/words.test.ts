import { describe, expect, it, vi } from 'vitest';
import { fetchWords, filterWords, groupWords, removeWord, sourceLink, splitAround } from './words';

const sense = { part_of_speech: 'adjective', definition: 'shockingly bad', other_meanings: [] };

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cap-1',
    card_id: 'card-1',
    word: 'egregious',
    sentence: 'The late fee was egregious.',
    page_title: 'Bank fees',
    source_url: 'https://example.com/fees',
    captured_at: '2026-11-10T12:00:00Z',
    lemmas: { lemma: 'egregious' },
    senses: sense,
    ...overrides,
  };
}

describe('groupWords', () => {
  it('keeps one entry per card, newest save first, with every sentence', () => {
    const entries = groupWords([
      row({ id: 'cap-3', card_id: 'card-2', word: 'wary', lemmas: { lemma: 'wary' }, senses: null }),
      row({ id: 'cap-2', sentence: 'An egregious error.', captured_at: '2026-11-11T12:00:00Z' }),
      row(),
    ]);

    expect(entries.map((e) => e.key)).toEqual(['card-2', 'card-1']);
    expect(entries[0]).toMatchObject({ word: 'wary', definition: null, partOfSpeech: null });
    expect(entries[1]).toMatchObject({ word: 'egregious', definition: 'shockingly bad', partOfSpeech: 'adjective' });
    expect(entries[1]!.contexts.map((c) => c.sentence)).toEqual(['An egregious error.', 'The late fee was egregious.']);
  });

  it("uses the card's first save for the meaning", () => {
    const [entry] = groupWords([
      row({ id: 'cap-2', senses: { ...sense, definition: 'later wording' } }),
      row({ id: 'cap-1', senses: { ...sense, definition: 'first wording' } }),
    ]);
    expect(entry!.definition).toBe('first wording');
  });

  it('shows a repeated sentence once', () => {
    const [entry] = groupWords([row({ id: 'cap-2' }), row()]);
    expect(entry!.contexts).toHaveLength(1);
  });

  it('keys a capture without a card by the capture', () => {
    expect(groupWords([row({ card_id: null, senses: null })])[0]!.key).toBe('cap-1');
  });
});

describe('fetchWords', () => {
  it('reads captures newest first', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [row()], error: null });
    const order = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ order }));
    const client = { from: vi.fn(() => ({ select })) };

    const entries = await fetchWords(client as never);

    expect(client.from).toHaveBeenCalledWith('captures');
    expect(order).toHaveBeenCalledWith('captured_at', { ascending: false });
    expect(entries).toHaveLength(1);
  });

  it('throws when the read fails', async () => {
    const limit = vi.fn().mockResolvedValue({ data: null, error: new Error('offline') });
    const client = { from: () => ({ select: () => ({ order: () => ({ limit }) }) }) };
    await expect(fetchWords(client as never)).rejects.toThrow('offline');
  });
});

describe('groupWords previous sentence', () => {
  it('keeps the sentence before only when the meaning used it', () => {
    const used = groupWords([
      row({ previous_sentence: 'They charged me twice.', senses: { ...sense, uses_previous_sentence: true } }),
    ]);
    expect(used[0]!.contexts[0]!.previousSentence).toBe('They charged me twice.');

    const unused = groupWords([row({ previous_sentence: 'They charged me twice.' })]);
    expect(unused[0]!.contexts[0]!.previousSentence).toBeNull();
  });
});

describe('removeWord', () => {
  function client(result: { data: unknown; error: unknown }) {
    const select = vi.fn().mockResolvedValue(result);
    const or = vi.fn(() => ({ select }));
    const del = vi.fn(() => ({ or }));
    return { from: vi.fn(() => ({ delete: del })), or };
  }

  it("deletes every save on the word's card", async () => {
    const c = client({ data: [{ id: 'cap-1' }, { id: 'cap-2' }], error: null });
    await removeWord(c as never, 'card-1');
    expect(c.from).toHaveBeenCalledWith('captures');
    expect(c.or).toHaveBeenCalledWith('card_id.eq.card-1,id.eq.card-1');
  });

  it('throws when nothing was deleted', async () => {
    await expect(removeWord(client({ data: [], error: null }) as never, 'card-1')).rejects.toThrow();
  });

  it('throws when the delete fails', async () => {
    const c = client({ data: null, error: new Error('offline') });
    await expect(removeWord(c as never, 'card-1')).rejects.toThrow('offline');
  });
});

describe('filterWords', () => {
  const entries = groupWords([
    row(),
    row({ id: 'cap-2', card_id: 'card-2', word: 'wary', lemmas: { lemma: 'wary' }, sentence: 'Be wary.', page_title: 'Advice', senses: { ...sense, definition: 'cautious' } }),
  ]);

  it('matches the word, meaning, sentence, or page, ignoring case', () => {
    expect(filterWords(entries, 'WARY').map((e) => e.word)).toEqual(['wary']);
    expect(filterWords(entries, 'cautious').map((e) => e.word)).toEqual(['wary']);
    expect(filterWords(entries, 'late fee').map((e) => e.word)).toEqual(['egregious']);
    expect(filterWords(entries, 'bank').map((e) => e.word)).toEqual(['egregious']);
  });

  it('shows everything for an empty query', () => {
    expect(filterWords(entries, '  ')).toHaveLength(2);
  });
});

describe('splitAround', () => {
  it('finds the saved text regardless of case', () => {
    expect(splitAround('Egregious, truly.', 'egregious')).toEqual(['', 'Egregious', ', truly.']);
  });

  it('is null when the text is not in the sentence', () => {
    expect(splitAround('Nothing here.', 'wary')).toBeNull();
  });
});

describe('sourceLink', () => {
  it('links to the sentence with a text fragment', () => {
    expect(sourceLink('https://example.com/a', 'A well-known fact, & more.')).toBe(
      'https://example.com/a#:~:text=A%20well%2Dknown%20fact%2C%20%26%20more.',
    );
  });

  it('links a long sentence by its first and last words', () => {
    const sentence =
      'The committee, after weeks of deliberation and public comment, finally decided that the fee was egregious and should go.';
    expect(sourceLink('https://example.com/a', sentence)).toBe(
      'https://example.com/a#:~:text=The%20committee%2C%20after%20weeks,egregious%20and%20should%20go.',
    );
  });

  it('keeps an anchor and replaces an old text directive', () => {
    expect(sourceLink('https://example.com/a#intro:~:text=old', 'New one.')).toBe(
      'https://example.com/a#intro:~:text=New%20one.',
    );
  });

  it('links the page alone without a sentence', () => {
    expect(sourceLink('https://example.com/a', null)).toBe('https://example.com/a');
  });

  it("doesn't link pages that aren't on the web", () => {
    expect(sourceLink('chrome://extensions', 'x')).toBeNull();
    expect(sourceLink('javascript:alert(1)', 'x')).toBeNull();
    expect(sourceLink('not a url', 'x')).toBeNull();
    expect(sourceLink(null, 'x')).toBeNull();
  });
});
