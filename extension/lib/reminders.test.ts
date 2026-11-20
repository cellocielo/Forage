import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { PracticeCard } from './practice';
import {
  INITIAL_STATE,
  loadReminderState,
  maybeRemind,
  reminderContent,
  reminderGapMs,
  respondToReminder,
  skipReason,
} from './reminders';
import { DEFAULT_SETTINGS, type Settings } from './settings';

const mocks = vi.hoisted(() => ({ loadSettings: vi.fn(), fetchNextCard: vi.fn() }));
vi.mock('./settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./settings')>()),
  loadSettings: mocks.loadSettings,
}));
vi.mock('./practice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./practice')>()),
  fetchNextCard: mocks.fetchNextCard,
}));

const TUESDAY_2PM = new Date(2026, 10, 3, 14, 0);
const HOUR = 60 * 60 * 1000;
const at = (base: Date, hours: number) => new Date(base.getTime() + hours * HOUR);

const CARD: PracticeCard = {
  id: 'card-1',
  state: 0,
  stability: 0,
  reps: 0,
  word: 'egregious',
  partOfSpeech: 'adjective',
  frames: ['The fee was so egregious that ___.'],
  scenarios: [{ register: 'formal', situation: 'Email your landlord about the bill.' }],
  usageChoices: [],
  recent: [],
  frameChoices: [],
  hints: { partners: [], example: null, starter: null },
  definition: 'shockingly bad',
  otherMeanings: [],
  examples: [],
};

const client = {
  auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
} as unknown as SupabaseClient;

beforeEach(() => {
  fakeBrowser.reset();
  mocks.loadSettings.mockResolvedValue(DEFAULT_SETTINGS);
  mocks.fetchNextCard.mockResolvedValue(CARD);
});

describe('skipReason', () => {
  const s = (overrides: Partial<Settings> = {}) => ({ ...DEFAULT_SETTINGS, ...overrides });

  it('allows a reminder on a weekday afternoon with nothing recent', () => {
    expect(skipReason(s(), INITIAL_STATE, TUESDAY_2PM)).toBeNull();
  });

  it('respects every timing control', () => {
    expect(skipReason(null, INITIAL_STATE, TUESDAY_2PM)).toBe('not-set-up');
    expect(skipReason(s({ cornerReminderEnabled: false }), INITIAL_STATE, TUESDAY_2PM)).toBe('turned-off');
    expect(skipReason(s({ pausedUntil: at(TUESDAY_2PM, 24).toISOString() }), INITIAL_STATE, TUESDAY_2PM)).toBe('paused');
    expect(skipReason(s(), INITIAL_STATE, new Date(2026, 10, 7, 14, 0))).toBe('weekend');
    expect(skipReason(s(), INITIAL_STATE, new Date(2026, 10, 3, 22, 0))).toBe('quiet-hours');
    expect(skipReason(s(), { ...INITIAL_STATE, snoozedUntil: at(TUESDAY_2PM, 1).toISOString() }, TUESDAY_2PM)).toBe('snoozed');
  });

  it('waits the chosen number of hours between reminders', () => {
    const state = { ...INITIAL_STATE, lastShownAt: at(TUESDAY_2PM, -4).toISOString() };
    expect(skipReason(s({ reminderEveryHours: 5 }), state, TUESDAY_2PM)).toBe('too-soon');
    expect(skipReason(s({ reminderEveryHours: 3 }), state, TUESDAY_2PM)).toBeNull();
  });

  it('sends a once-a-day reminder only in the spare-minute window', () => {
    const daily = s({ reminderEveryHours: 24, spareMinute: 'evening' });
    expect(skipReason(daily, INITIAL_STATE, TUESDAY_2PM)).toBe('outside-window');
    expect(skipReason(daily, INITIAL_STATE, new Date(2026, 10, 3, 19, 0))).toBeNull();
  });
});

describe('reminderGapMs', () => {
  it('doubles the gap after every three ignored reminders, up to 8x', () => {
    expect([0, 2, 3, 6, 9, 30].map((n) => reminderGapMs(DEFAULT_SETTINGS, n) / HOUR)).toEqual([5, 5, 10, 20, 40, 40]);
  });
});

describe('reminderContent', () => {
  it('shows the real prompt, with the register for scenarios', () => {
    expect(reminderContent(CARD)).toEqual({ title: 'Practice "egregious"', message: 'The fee was so egregious that ___.' });
    expect(reminderContent({ ...CARD, state: 2, stability: 10 }).message).toBe('Email your landlord about the bill. (formal)');
  });
});

describe('maybeRemind', () => {
  const deps = (overrides = {}) => ({ now: TUESDAY_2PM, isGoodMoment: vi.fn().mockResolvedValue(true), show: vi.fn(), ...overrides });

  it('shows the next ready word and records it', async () => {
    const d = deps();
    expect(await maybeRemind(client, d)).toBe('shown');
    expect(d.show).toHaveBeenCalledWith(reminderContent(CARD));
    expect(mocks.fetchNextCard).toHaveBeenCalledWith(client, TUESDAY_2PM, DEFAULT_SETTINGS.dailyCap);
    expect(await loadReminderState()).toMatchObject({ lastShownAt: TUESDAY_2PM.toISOString(), awaitingResponse: true });
  });

  it('holds off when busy or when nothing is due', async () => {
    const busy = deps({ isGoodMoment: vi.fn().mockResolvedValue(false) });
    expect(await maybeRemind(client, busy)).toBe('busy');
    mocks.fetchNextCard.mockResolvedValue(null);
    const d = deps();
    expect(await maybeRemind(client, d)).toBe('nothing-due');
    expect(d.show).not.toHaveBeenCalled();
  });

  it('counts an unanswered reminder as ignored when the next one shows', async () => {
    await maybeRemind(client, deps());
    await maybeRemind(client, deps({ now: at(TUESDAY_2PM, 5) }));
    expect((await loadReminderState()).ignoredStreak).toBe(1);
  });
});

describe('respondToReminder', () => {
  it('snoozes for a few hours or the rest of the day, and resets the back-off', async () => {
    await maybeRemind(client, { now: TUESDAY_2PM, isGoodMoment: async () => true, show: vi.fn() });

    await respondToReminder('later-today', TUESDAY_2PM);
    expect(await loadReminderState()).toMatchObject({
      snoozedUntil: at(TUESDAY_2PM, 3).toISOString(),
      awaitingResponse: false,
      ignoredStreak: 0,
    });

    await respondToReminder('not-today', TUESDAY_2PM);
    expect((await loadReminderState()).snoozedUntil).toBe(new Date(2026, 10, 4).toISOString());
  });
});
