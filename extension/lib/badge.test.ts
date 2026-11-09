import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { countReadyWords, isAuthStorageKey, refreshBadge } from './badge';

type CountResult = { count: number | null; error: { message: string } | null };

/**
 * A cards query builder that records each filter call. The "due" query is the one with
 * .lte('due'); the "reviewed today" query is the one with .gte('last_review').
 */
function fakeClient({
  due = { count: 0, error: null } as CountResult,
  reviewedToday = { count: 0, error: null } as CountResult,
  signedIn = true,
  settings = null as Record<string, unknown> | null,
} = {}) {
  const queries: Array<Array<[string, ...unknown[]]>> = [];
  const from = vi.fn((table: string) => {
    const calls: Array<[string, ...unknown[]]> = [['from', table]];
    queries.push(calls);
    if (table === 'user_settings') {
      const settingsBuilder = {
        select: () => settingsBuilder,
        maybeSingle: () => Promise.resolve({ data: settings, error: null }),
      };
      return settingsBuilder;
    }
    const builder = {
      then(resolve: (value: CountResult) => unknown, reject: (reason: unknown) => unknown) {
        const isDue = calls.some(([name, column]) => name === 'lte' && column === 'due');
        return Promise.resolve(isDue ? due : reviewedToday).then(resolve, reject);
      },
    } as Record<string, unknown>;
    for (const name of ['select', 'is', 'lte', 'gte', 'or']) {
      builder[name] = (...args: unknown[]) => {
        calls.push([name, ...args]);
        return builder;
      };
    }
    return builder;
  });
  const getSession = vi.fn().mockResolvedValue({
    data: { session: signedIn ? { user: { id: 'user-1' } } : null },
    error: null,
  });
  const client = { from, auth: { getSession } } as unknown as SupabaseClient;
  return { client, from, queries };
}

const badgeText = () => browser.action.getBadgeText({});

beforeEach(() => fakeBrowser.reset());

describe('countReadyWords', () => {
  const now = new Date(2026, 10, 2, 14, 30); // local time, 2:30 PM

  it('counts due, unsnoozed, unarchived cards', async () => {
    const { client, queries } = fakeClient({ due: { count: 3, error: null } });

    expect(await countReadyWords(client, now)).toBe(3);

    const dueQuery = queries.find((q) => q.some(([n, c]) => n === 'lte' && c === 'due'))!;
    const iso = now.toISOString();
    expect(dueQuery).toEqual([
      ['from', 'cards'],
      ['select', 'id', { count: 'exact', head: true }],
      ['is', 'archived_at', null],
      ['lte', 'due', iso],
      ['or', `snoozed_until.is.null,snoozed_until.lte."${iso}"`],
    ]);
  });

  it('counts reviews since local midnight against the cap', async () => {
    const { client, queries } = fakeClient({
      due: { count: 10, error: null },
      reviewedToday: { count: 2, error: null },
    });

    expect(await countReadyWords(client, now, 5)).toBe(3);

    const reviewedQuery = queries.find((q) => q.some(([n]) => n === 'gte'))!;
    expect(reviewedQuery).toContainEqual(['gte', 'last_review', new Date(2026, 10, 2).toISOString()]);
  });

  it('never exceeds the daily cap and never goes below zero', async () => {
    expect(await countReadyWords(fakeClient({ due: { count: 40, error: null } }).client, now, 5)).toBe(5);
    expect(
      await countReadyWords(
        fakeClient({ due: { count: 4, error: null }, reviewedToday: { count: 7, error: null } }).client,
        now,
        5,
      ),
    ).toBe(0);
  });

  it('throws when a count query fails', async () => {
    const { client } = fakeClient({ due: { count: null, error: { message: 'boom' } } });
    await expect(countReadyWords(client, now)).rejects.toThrow('boom');
  });
});

const SETTINGS_ROW = {
  spare_minute: null,
  reminder_every_hours: 5,
  daily_cap: 5,
  weekends: false,
  quiet_start: '21:00:00',
  quiet_end: '08:00:00',
  paused_until: null,
  badge_enabled: true,
  end_of_reading_enabled: true,
  corner_reminder_enabled: true,
};

describe('refreshBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 3, 14, 0)); // a Tuesday
  });
  afterEach(() => vi.useRealTimers());

  it('shows the number of ready words', async () => {
    await refreshBadge(fakeClient({ due: { count: 2, error: null } }).client);
    expect(await badgeText()).toBe('2');
  });

  it('clears the badge when nothing is ready', async () => {
    await browser.action.setBadgeText({ text: '4' });
    await refreshBadge(fakeClient({ due: { count: 0, error: null } }).client);
    expect(await badgeText()).toBe('');
  });

  it('clears the badge and skips the query when signed out', async () => {
    await browser.action.setBadgeText({ text: '4' });
    const { client, from } = fakeClient({ signedIn: false, due: { count: 3, error: null } });

    await refreshBadge(client);

    expect(await badgeText()).toBe('');
    expect(from).not.toHaveBeenCalled();
  });

  it('keeps the last count when the query fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await browser.action.setBadgeText({ text: '4' });

    await refreshBadge(fakeClient({ due: { count: null, error: { message: 'offline' } } }).client);

    expect(await badgeText()).toBe('4');
  });

  it('runs one more refresh when asked during a refresh, ending on the latest count', async () => {
    const first = fakeClient({ due: { count: 1, error: null } });
    const second = fakeClient({ due: { count: 3, error: null } });

    const a = refreshBadge(first.client);
    const b = refreshBadge(second.client); // folded into the running refresh
    await Promise.all([a, b]);

    // The rerun uses the first caller's client; both are the same singleton in the app.
    // Each run reads settings, then the two counts.
    expect(first.from).toHaveBeenCalledTimes(6);
    expect(second.from).not.toHaveBeenCalled();
    expect(await badgeText()).toBe('1');
  });
});

describe('refreshBadge with settings', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => vi.useRealTimers());

  it('uses the daily cap from settings', async () => {
    vi.setSystemTime(new Date(2026, 10, 3, 14, 0));
    await refreshBadge(fakeClient({ due: { count: 9, error: null }, settings: { ...SETTINGS_ROW, daily_cap: 8 } }).client);
    expect(await badgeText()).toBe('8');
  });

  it('stays blank when the badge is off, while paused, and on weekends off', async () => {
    vi.setSystemTime(new Date(2026, 10, 3, 14, 0));
    const due = { count: 3, error: null };
    await refreshBadge(fakeClient({ due, settings: { ...SETTINGS_ROW, badge_enabled: false } }).client);
    expect(await badgeText()).toBe('');

    const paused_until = new Date(2026, 10, 5).toISOString();
    await refreshBadge(fakeClient({ due, settings: { ...SETTINGS_ROW, paused_until } }).client);
    expect(await badgeText()).toBe('');

    vi.setSystemTime(new Date(2026, 10, 7, 14, 0)); // Saturday
    await refreshBadge(fakeClient({ due }).client);
    expect(await badgeText()).toBe('');
    await refreshBadge(fakeClient({ due, settings: { ...SETTINGS_ROW, weekends: true } }).client);
    expect(await badgeText()).toBe('3');
  });
});

describe('isAuthStorageKey', () => {
  it('matches the supabase-js session key only', () => {
    expect(isAuthStorageKey('sb-nigjvcmgyjoaqtbemvns-auth-token')).toBe(true);
    expect(isAuthStorageKey('forage:capture-queue')).toBe(false);
    expect(isAuthStorageKey('sb-abc-auth-token-code-verifier')).toBe(false);
  });
});
