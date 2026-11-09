import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  DEFAULT_SETTINGS,
  inQuietHours,
  loadSettings,
  pauseForAWeek,
  practiceOffReason,
  saveSettings,
} from './settings';

const ROW = {
  spare_minute: 'lunch',
  reminder_every_hours: 8,
  daily_cap: 10,
  weekends: true,
  quiet_start: '22:30:00',
  quiet_end: '07:00:00',
  paused_until: null,
  badge_enabled: false,
  end_of_reading_enabled: true,
  corner_reminder_enabled: false,
};

function fakeClient(result: { data?: unknown; error?: unknown } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: result.error ?? null });
  const builder = {
    select: vi.fn(() => builder),
    maybeSingle: vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null }),
    upsert,
  };
  const from = vi.fn(() => builder);
  return { client: { from } as unknown as SupabaseClient, from, upsert };
}

describe('loadSettings', () => {
  it('maps the row, trimming seconds from times', async () => {
    expect(await loadSettings(fakeClient({ data: ROW }).client)).toEqual({
      spareMinute: 'lunch',
      reminderEveryHours: 8,
      dailyCap: 10,
      weekends: true,
      quietStart: '22:30',
      quietEnd: '07:00',
      pausedUntil: null,
      badgeEnabled: false,
      endOfReadingEnabled: true,
      cornerReminderEnabled: false,
    });
  });

  it('returns null before onboarding, and throws on errors', async () => {
    expect(await loadSettings(fakeClient().client)).toBeNull();
    await expect(loadSettings(fakeClient({ error: { message: 'boom' } }).client)).rejects.toThrow('boom');
  });
});

describe('saveSettings', () => {
  it('upserts the row with the time zone', async () => {
    const { client, from, upsert } = fakeClient();
    await saveSettings(client, { ...DEFAULT_SETTINGS, spareMinute: 'evening' }, 'America/New_York');

    expect(from).toHaveBeenCalledWith('user_settings');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ spare_minute: 'evening', daily_cap: 5, quiet_start: '21:00', time_zone: 'America/New_York' }),
      { onConflict: 'user_id' },
    );
  });

  it('throws on errors', async () => {
    await expect(saveSettings(fakeClient({ error: { message: 'nope' } }).client, DEFAULT_SETTINGS)).rejects.toThrow('nope');
  });
});

describe('practiceOffReason', () => {
  const tuesday = new Date(2026, 10, 3, 14, 0);
  const saturday = new Date(2026, 10, 7, 14, 0);

  it('is off on weekends unless turned on', () => {
    expect(practiceOffReason(DEFAULT_SETTINGS, tuesday)).toBeNull();
    expect(practiceOffReason(DEFAULT_SETTINGS, saturday)).toBe('weekend');
    expect(practiceOffReason({ ...DEFAULT_SETTINGS, weekends: true }, saturday)).toBeNull();
  });

  it('is off while paused, and back on after', () => {
    const settings = { ...DEFAULT_SETTINGS, pausedUntil: pauseForAWeek(tuesday) };
    expect(practiceOffReason(settings, tuesday)).toBe('paused');
    expect(practiceOffReason(settings, new Date(2026, 10, 10, 15, 0))).toBeNull();
  });
});

describe('inQuietHours', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 3, h, m);

  it('handles windows that wrap past midnight', () => {
    expect([at(20, 59), at(21), at(2), at(7, 59), at(8)].map((t) => inQuietHours(DEFAULT_SETTINGS, t))).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
  });

  it('handles same-day windows', () => {
    const settings = { quietStart: '13:00', quietEnd: '14:00' };
    expect([at(12, 59), at(13, 30), at(14)].map((t) => inQuietHours(settings, t))).toEqual([false, true, false]);
  });
});
