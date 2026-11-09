import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { headline, PANEL_HOST_ID, showMeaningPanel } from './meaning-panel';

const MEANING = {
  word: 'bank',
  outcome: 'new_word' as const,
  partOfSpeech: 'noun',
  definition: 'The land along the side of a river.',
  otherMeanings: [
    { partOfSpeech: 'noun', definition: 'A business that keeps money.' },
    { partOfSpeech: 'verb', definition: 'To tilt while turning.' },
  ],
};

describe('showMeaningPanel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.getElementById(PANEL_HOST_ID)?.remove();
  });

  const root = (host: HTMLElement) => host.shadowRoot!;

  it('says it saved and that the meaning is loading, without stealing focus', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    const { host } = showMeaningPanel('bank');

    expect(root(host).textContent).toContain('Saved "bank" to Forage');
    expect(root(host).textContent).toContain('Looking up its meaning');
    expect(root(host).querySelector('.panel')!.getAttribute('role')).toBe('status');
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it('shows the meaning here and a short list of other meanings', () => {
    const panel = showMeaningPanel('bank');
    panel.showMeaning(MEANING);

    const shadow = root(panel.host);
    expect(shadow.querySelector('.definition')!.textContent).toBe('The land along the side of a river.');
    expect([...shadow.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'noun A business that keeps money.',
      'verb To tilt while turning.',
    ]);
  });

  it('leaves out the other-meanings section when there are none', () => {
    const panel = showMeaningPanel('bank');
    panel.showMeaning({ ...MEANING, otherMeanings: [] });
    expect(root(panel.host).textContent).not.toContain('Other meanings');
  });

  it('says what saving did', () => {
    expect(headline('egregious', 'same_meaning')).toBe('Already learning "egregious". Added this example.');
    expect(headline('sanction', 'new_meaning')).toBe('New meaning of "sanction" saved.');
    expect(headline('bank', 'returned')).toBe('"bank" is back in your practice.');
    expect(headline('bank', 'duplicate')).toBe('Already saved.');
    expect(headline('bank', null)).toBe('Saved "bank" to Forage');

    const panel = showMeaningPanel('sanctioned');
    panel.showMeaning({ ...MEANING, word: 'sanction', outcome: 'new_meaning' });
    expect(root(panel.host).querySelector('.saved')!.textContent).toBe('New meaning of "sanction" saved.');
  });

  it('keeps "Already saved." for a double save', () => {
    const panel = showMeaningPanel('bank', document, { duplicate: true });
    panel.showMeaning(MEANING);
    expect(root(panel.host).querySelector('.saved')!.textContent).toBe('Already saved.');
  });

  it('renders text, not HTML', () => {
    const panel = showMeaningPanel('<img src=x>');
    panel.showMeaning({ ...MEANING, definition: '<img src=x onerror=alert(1)>' });
    expect(root(panel.host).querySelector('img')).toBeNull();
  });

  it('closes with the button, or by itself unless hovered', () => {
    const first = showMeaningPanel('bank');
    root(first.host).querySelector<HTMLButtonElement>('.close')!.click();
    expect(first.host.isConnected).toBe(false);

    const second = showMeaningPanel('bank');
    second.showMeaning(MEANING);
    const panel = root(second.host).querySelector('.panel')!;
    panel.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(60_000);
    expect(second.host.isConnected).toBe(true);
    panel.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(20_000);
    expect(second.host.isConnected).toBe(false);
  });
});
