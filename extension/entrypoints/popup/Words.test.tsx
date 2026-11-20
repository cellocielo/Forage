import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { WordEntry } from '@/lib/words';
import { Words } from './Words';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));
const words = vi.hoisted(() => ({ fetchWords: vi.fn(), removeWord: vi.fn() }));
vi.mock('@/lib/words', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/words')>()),
  ...words,
}));

const egregious: WordEntry = {
  key: 'card-1',
  word: 'egregious',
  partOfSpeech: 'adjective',
  definition: 'shockingly bad',
  otherMeanings: [{ partOfSpeech: 'adjective', definition: 'remarkably good (archaic)' }],
  contexts: [
    {
      sentence: 'The late fee was Egregious.',
      previousSentence: null,
      pageTitle: 'Bank fees',
      sourceUrl: 'https://example.com/fees',
      capturedAt: new Date('2026-11-10T12:00:00Z'),
      saved: 'egregious',
    },
  ],
};
const wary: WordEntry = {
  key: 'card-2',
  word: 'wary',
  partOfSpeech: null,
  definition: null,
  otherMeanings: [],
  contexts: [{ sentence: null, previousSentence: null, pageTitle: null, sourceUrl: null, capturedAt: new Date(), saved: 'wary' }],
};

beforeEach(() => {
  words.fetchWords.mockResolvedValue([egregious, wary]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Words', () => {
  it('shows the meaning with the sentence and page it was saved from', async () => {
    const user = userEvent.setup();
    render(<Words />);

    await user.click(await screen.findByText('egregious'));

    expect(screen.getByText('shockingly bad').closest('details')?.open).toBe(true);
    expect(screen.getByText('Egregious').tagName).toBe('MARK');
    const link = screen.getByRole('link', { name: 'Bank fees' });
    expect(link.getAttribute('href')).toBe('https://example.com/fees#:~:text=The%20late%20fee%20was%20Egregious.');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.getByText('remarkably good (archaic)')).toBeTruthy();
  });

  it('shows the sentence before when the meaning leaned on it', async () => {
    const context = { ...egregious.contexts[0]!, previousSentence: 'They charged me twice.' };
    words.fetchWords.mockResolvedValue([{ ...egregious, contexts: [context] }]);
    const user = userEvent.setup();
    render(<Words />);
    await user.click(await screen.findByText('egregious'));

    const before = screen.getByText('They charged me twice.');
    expect(before.className).toBe('before');
    expect(before.closest('blockquote')?.textContent).toBe('They charged me twice. The late fee was Egregious.');
  });

  it("says when a meaning isn't ready", async () => {
    const user = userEvent.setup();
    render(<Words />);
    await user.click(await screen.findByText('wary'));
    expect(screen.getByText(/meaning isn't ready yet/).closest('details')?.open).toBe(true);
  });

  it('searches', async () => {
    const user = userEvent.setup();
    render(<Words />);

    await user.type(await screen.findByLabelText('Search'), 'late fee');
    expect(screen.getByText('egregious')).toBeTruthy();
    expect(screen.queryByText('wary')).toBeNull();

    await user.clear(screen.getByLabelText('Search'));
    await user.type(screen.getByLabelText('Search'), 'zzz');
    expect(screen.getByText('No saved words match "zzz".')).toBeTruthy();
  });

  it('says how to save a first word', async () => {
    words.fetchWords.mockResolvedValue([]);
    render(<Words />);
    expect(await screen.findByText(/No words yet/)).toBeTruthy();
  });

  it('retries after an error', async () => {
    words.fetchWords.mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    render(<Words />);

    await user.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('egregious')).toBeTruthy();
  });

  it('removes a word after confirming', async () => {
    words.removeWord.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Words />);
    await user.click(await screen.findByText('egregious'));

    await user.click(screen.getByRole('button', { name: 'Remove egregious' }));
    expect(words.removeWord).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(words.removeWord).toHaveBeenCalledWith(expect.anything(), 'card-1');
    expect(screen.queryByText('egregious')).toBeNull();
    expect(screen.getByText('wary')).toBeTruthy();
  });

  it('keeps a word when removing is cancelled', async () => {
    const user = userEvent.setup();
    render(<Words />);
    await user.click(await screen.findByText('egregious'));

    await user.click(screen.getByRole('button', { name: 'Remove egregious' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(words.removeWord).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Remove egregious' })).toBeTruthy();
  });

  it('says when removing fails', async () => {
    words.removeWord.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    render(<Words />);
    await user.click(await screen.findByText('egregious'));

    await user.click(screen.getByRole('button', { name: 'Remove egregious' }));
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('egregious')).toBeTruthy();
  });

  it('goes back to practice', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Words onClose={onClose} />);
    await user.click(screen.getByRole('button', { name: 'Back to practice' }));
    expect(onClose).toHaveBeenCalled();
  });
});
