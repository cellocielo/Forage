import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Save } from './Save';

const mocks = vi.hoisted(() => ({ saveWord: vi.fn(), waitForMeaning: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/captures', () => ({ saveWord: mocks.saveWord }));
vi.mock('@/lib/meaning', () => ({ waitForMeaning: mocks.waitForMeaning }));

const MEANING = {
  word: 'ephemeral',
  outcome: 'new_word',
  partOfSpeech: 'adjective',
  definition: 'lasting a very short time',
  otherMeanings: [],
};

afterEach(cleanup);

describe('Save', () => {
  it('saves a tapped word from a shared passage with its sentence, then shows its meaning', async () => {
    mocks.saveWord.mockResolvedValue({ ok: true, word: 'ephemeral', clientCaptureId: 'c1' });
    mocks.waitForMeaning.mockResolvedValue(MEANING);
    const user = userEvent.setup();
    render(
      <Save
        shared={{ text: 'We met once. Fame is ephemeral, she said.', word: '', pageTitle: 'Story', sourceUrl: 'https://s.example' }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'ephemeral' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mocks.saveWord).toHaveBeenCalledWith(
      {},
      {
        word: 'ephemeral',
        sentence: 'Fame is ephemeral, she said.',
        pageTitle: 'Story',
        sourceUrl: 'https://s.example',
        source: 'android',
      },
    );
    expect(await screen.findByText('lasting a very short time')).toBeTruthy();
    expect(screen.getByText('Saved "ephemeral" to Forage')).toBeTruthy();
  });

  it('saves a typed word with no sentence, and shows errors', async () => {
    mocks.saveWord.mockResolvedValue({ ok: false, reason: 'retryable', message: 'Couldn\'t save "gist". Try again.', word: 'gist' });
    const user = userEvent.setup();
    render(<Save shared={null} />);

    await user.type(screen.getByLabelText('Word'), 'gist');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(mocks.saveWord).toHaveBeenCalledWith({}, expect.objectContaining({ word: 'gist', sentence: null, source: 'manual' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Couldn\'t save "gist". Try again.');
  });

  it('says so when the word was just saved', async () => {
    mocks.saveWord.mockResolvedValue({ ok: true, word: 'gist', clientCaptureId: 'c0', duplicate: true });
    mocks.waitForMeaning.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<Save shared={{ text: 'gist', word: 'gist', pageTitle: null, sourceUrl: null }} />);

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Already saved.')).toBeTruthy();
    expect(await screen.findByText('Its meaning will be ready when you practice it.')).toBeTruthy();
  });
});
