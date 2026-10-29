import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showToast } from './toast';

describe('showToast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.querySelectorAll('#forage-toast-host').forEach((el) => el.remove());
  });

  const toastIn = (host: HTMLElement) => host.shadowRoot!.querySelector<HTMLElement>('.toast')!;

  it('shows a polite status message that does not capture the pointer', () => {
    const host = showToast('Saved "ephemeral" to Forage');
    const toast = toastIn(host);

    expect(document.getElementById('forage-toast-host')).toBe(host);
    expect(toast.textContent).toBe('Saved "ephemeral" to Forage');
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.getAttribute('aria-live')).toBe('polite');
    expect(host.shadowRoot!.querySelector('style')!.textContent).toContain('pointer-events: none');
  });

  it('does not steal focus', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();

    showToast('Saved');

    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it('uses an alert role for errors', () => {
    const toast = toastIn(showToast('Sign in first', { variant: 'error' }));
    expect(toast.getAttribute('role')).toBe('alert');
    expect(toast.classList.contains('error')).toBe(true);
  });

  it('renders the message as text, not HTML', () => {
    const toast = toastIn(showToast('<img src=x onerror=alert(1)>'));
    expect(toast.querySelector('img')).toBeNull();
  });

  it('replaces an existing toast and dismisses itself', () => {
    showToast('first');
    const second = showToast('second', { durationMs: 1000 });
    expect(document.querySelectorAll('#forage-toast-host')).toHaveLength(1);

    vi.advanceTimersByTime(1000);
    expect(second.isConnected).toBe(false);
  });
});
