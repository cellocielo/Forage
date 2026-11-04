import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import { Onboarding, Settings } from './Settings';

const mocks = vi.hoisted(() => ({ saveSettings: vi.fn(), refreshBadge: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/badge', () => ({ refreshBadge: mocks.refreshBadge }));
vi.mock('@/lib/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/settings')>()),
  saveSettings: mocks.saveSettings,
}));

beforeEach(() => mocks.saveSettings.mockResolvedValue(undefined));
afterEach(cleanup);

describe('Onboarding', () => {
  it('saves the defaults when skipped', async () => {
    const onDone = vi.fn();
    render(<Onboarding onDone={onDone} />);

    await userEvent.click(screen.getByRole('button', { name: 'Skip for now' }));

    expect(mocks.saveSettings).toHaveBeenCalledWith({}, DEFAULT_SETTINGS);
    expect(onDone).toHaveBeenCalledWith(DEFAULT_SETTINGS);
  });

  it('shows an error and stays put when saving fails', async () => {
    mocks.saveSettings.mockRejectedValueOnce(new Error('offline'));
    const onDone = vi.fn();
    render(<Onboarding onDone={onDone} />);

    await userEvent.click(screen.getByRole('button', { name: 'Evening' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('Settings', () => {
  function setup() {
    const onSaved = vi.fn();
    render(<Settings initial={DEFAULT_SETTINGS} onSaved={onSaved} onClose={vi.fn()} />);
    return { user: userEvent.setup(), onSaved };
  }

  it('saves every timing control and refreshes the badge', async () => {
    const { user, onSaved } = setup();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);

    await user.selectOptions(screen.getByLabelText('Spare minute'), 'commute');
    await user.selectOptions(screen.getByLabelText('How often'), 'Once a day');
    await user.clear(screen.getByLabelText('Words per day'));
    await user.type(screen.getByLabelText('Words per day'), '10');
    await user.click(screen.getByLabelText('Practice on weekends'));
    await user.click(screen.getByLabelText('Corner reminders'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const expected = {
      ...DEFAULT_SETTINGS,
      spareMinute: 'commute',
      reminderEveryHours: 24,
      dailyCap: 10,
      weekends: true,
      cornerReminderEnabled: false,
    };
    expect(mocks.saveSettings).toHaveBeenCalledWith({}, expected);
    expect(onSaved).toHaveBeenCalledWith(expected);
    expect(mocks.refreshBadge).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('pauses for a week right away and can resume', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: 'Pause for a week' }));

    const saved = mocks.saveSettings.mock.calls[0]![1];
    const days = (new Date(saved.pausedUntil).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeCloseTo(7, 1);
    expect(await screen.findByText(/Paused until/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Resume now' }));
    expect(mocks.saveSettings.mock.calls[1]![1].pausedUntil).toBeNull();
  });

  it('rejects quiet hours that start and end at the same time', async () => {
    const { user } = setup();
    const to = screen.getByLabelText('To');
    await user.clear(to);
    await user.type(to, '21:00');

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/different start and end/);
    expect(mocks.saveSettings).not.toHaveBeenCalled();
  });
});
