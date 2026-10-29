import { beforeEach, describe, expect, it, vi } from 'vitest';
import { captureSelection } from './capture-selection';
import { requestSaveWord } from './messaging';

vi.mock('./messaging', () => ({ requestSaveWord: vi.fn() }));

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
    window.getSelection()?.removeAllRanges();
  });

  it('saves the selection and confirms with a toast', async () => {
    select('ephemeral');
    vi.mocked(requestSaveWord).mockResolvedValue({ ok: true, word: 'ephemeral', clientCaptureId: 'c' });

    await captureSelection(window);

    expect(requestSaveWord).toHaveBeenCalledWith(
      expect.objectContaining({ word: 'ephemeral', sentence: 'Fame is ephemeral.' }),
    );
    expect(toastText()).toBe('Saved "ephemeral" to Forage');
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
