import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureSelection } from './capture-selection';
import { requestMeaning } from './meaning-messages';
import { requestSaveWord } from './messaging';

vi.mock('./messaging', () => ({ requestSaveWord: vi.fn() }));
vi.mock('./meaning-messages', () => ({ requestMeaning: vi.fn() }));

const panelText = () => document.getElementById('forage-meaning-host')?.shadowRoot?.querySelector('.panel')?.textContent;

const toastText = () =>
  document.getElementById('forage-toast-host')?.shadowRoot?.querySelector('.toast')?.textContent;

function select(text: string) {
  document.body.innerHTML = `<p>Fame is <b>${text}</b>.</p>`;
  const range = document.createRange();
  range.selectNodeContents(document.querySelector('b')!);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
}

describe('captureSelection', () => {
  beforeEach(() => {
    document.getElementById('forage-toast-host')?.remove();
    document.getElementById('forage-meaning-host')?.remove();
    window.getSelection()?.removeAllRanges();
  });

  it('saves the selection and shows its meaning here and its other meanings', async () => {
    select('ephemeral');
    vi.mocked(requestSaveWord).mockResolvedValue({ ok: true, word: 'ephemeral', clientCaptureId: 'c' });
    vi.mocked(requestMeaning).mockResolvedValue({
      word: 'ephemeral',
      outcome: 'new_word',
      partOfSpeech: 'adjective',
      definition: 'Lasting a very short time.',
      otherMeanings: [{ partOfSpeech: 'noun', definition: 'A short-lived plant.' }],
    });

    await captureSelection(window);

    expect(requestSaveWord).toHaveBeenCalledWith(
      expect.objectContaining({ word: 'ephemeral', sentence: 'Fame is ephemeral.' }),
    );
    expect(requestMeaning).toHaveBeenCalledWith('c');
    expect(panelText()).toContain('Saved "ephemeral" to Forage');
    expect(panelText()).toContain('Lasting a very short time.');
    expect(panelText()).toContain('A short-lived plant.');
  });

  it('says "Already saved." for a double save', async () => {
    select('ephemeral');
    vi.mocked(requestSaveWord).mockResolvedValue({ ok: true, word: 'ephemeral', clientCaptureId: 'c0', duplicate: true });
    vi.mocked(requestMeaning).mockResolvedValue(null);

    await captureSelection(window);

    expect(requestMeaning).toHaveBeenCalledWith('c0');
    expect(panelText()).toContain('Already saved.');
  });

  it('says the meaning will come later when it is not ready', async () => {
    select('ephemeral');
    vi.mocked(requestSaveWord).mockResolvedValue({ ok: true, word: 'ephemeral', clientCaptureId: 'c' });
    vi.mocked(requestMeaning).mockResolvedValue(null);

    await captureSelection(window);

    expect(panelText()).toContain('Its meaning will be ready in Forage soon.');
  });

  it('says when the word was queued to sync later', async () => {
    select('ephemeral');
    vi.mocked(requestSaveWord).mockResolvedValue({ ok: true, word: 'ephemeral', clientCaptureId: 'c', queued: true });

    await captureSelection(window);

    expect(toastText()).toBe(`Saved "ephemeral". It'll sync when you're back online.`);
  });

  it('shows the failure message from the background', async () => {
    select('ephemeral');
    vi.mocked(requestSaveWord).mockResolvedValue({
      ok: false,
      reason: 'signed-out',
      message: 'Sign in to Forage to save words.',
    });

    await captureSelection(window);

    expect(toastText()).toBe('Sign in to Forage to save words.');
  });

  it('asks for a selection when nothing is selected', async () => {
    await captureSelection(window);

    expect(requestSaveWord).not.toHaveBeenCalled();
    expect(toastText()).toBe('Select a word to save it to Forage.');
  });
});
