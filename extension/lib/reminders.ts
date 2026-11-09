import type { SupabaseClient } from '@supabase/supabase-js';
import { chooseTask, fetchNextCard, type PracticeCard } from './practice';
import { inQuietHours, loadSettings, practiceOffReason, type Settings, SPARE_MINUTES } from './settings';

/**
 * Reminders (P3) as system notifications, so macOS Focus and Do Not Disturb apply (T2).
 * Each shows the real prompt; clicking opens the practice card. They wait for a natural
 * break (T1), respect the timing settings (T5 to T8), and back off when ignored (T9).
 */

export const NOTIFICATION_ID = 'forage-reminder';
const STATE_KEY = 'forage:reminder-state';
const HOUR = 60 * 60 * 1000;
export const LATER_TODAY_HOURS = 3;
// T9: every 3 ignored reminders in a row double the gap, up to 8x.
const IGNORES_PER_BACKOFF = 3;
const MAX_BACKOFF = 8;

export interface ReminderState {
  lastShownAt: string | null;
  /** "Later today" / "Not today" (T8). */
  snoozedUntil: string | null;
  /** The last reminder got no click or button press yet. */
  awaitingResponse: boolean;
  ignoredStreak: number;
}

export const INITIAL_STATE: ReminderState = {
  lastShownAt: null,
  snoozedUntil: null,
  awaitingResponse: false,
  ignoredStreak: 0,
};

export async function loadReminderState(): Promise<ReminderState> {
  const stored = await browser.storage.local.get(STATE_KEY);
  return { ...INITIAL_STATE, ...(stored[STATE_KEY] as Partial<ReminderState> | undefined) };
}

async function saveReminderState(state: ReminderState): Promise<void> {
  await browser.storage.local.set({ [STATE_KEY]: state });
}

/** The minimum gap between reminders: the user's setting, stretched after ignored ones. */
export function reminderGapMs(settings: Settings, ignoredStreak: number): number {
  const backoff = Math.min(MAX_BACKOFF, 2 ** Math.floor(ignoredStreak / IGNORES_PER_BACKOFF));
  return settings.reminderEveryHours * HOUR * backoff;
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
}

/** For once-a-day reminders, the spare-minute answer (T4) sets when in the day it comes. */
export function inSpareMinuteWindow(settings: Settings, now: Date): boolean {
  if (settings.reminderEveryHours !== 24 || !settings.spareMinute) return true;
  const [start, end] = SPARE_MINUTES[settings.spareMinute].window;
  const t = now.getHours() * 60 + now.getMinutes();
  return t >= minutesOf(start) && t < minutesOf(end);
}

export type SkipReason =
  | 'not-set-up'
  | 'turned-off'
  | 'paused'
  | 'weekend'
  | 'quiet-hours'
  | 'snoozed'
  | 'too-soon'
  | 'outside-window';

/** Why no reminder should show now, or null if one may (T3: whether a word is due is checked after). */
export function skipReason(settings: Settings | null, state: ReminderState, now: Date): SkipReason | null {
  if (!settings) return 'not-set-up';
  if (!settings.cornerReminderEnabled) return 'turned-off';
  const off = practiceOffReason(settings, now);
  if (off) return off;
  if (inQuietHours(settings, now)) return 'quiet-hours';
  if (state.snoozedUntil && new Date(state.snoozedUntil) > now) return 'snoozed';
  const ignored = state.ignoredStreak + (state.awaitingResponse ? 1 : 0);
  if (state.lastShownAt && now.getTime() - new Date(state.lastShownAt).getTime() < reminderGapMs(settings, ignored)) {
    return 'too-soon';
  }
  if (!inSpareMinuteWindow(settings, now)) return 'outside-window';
  return null;
}

export interface ReminderContent {
  title: string;
  message: string;
}

/** The actual prompt, not a generic nudge (P3). */
export function reminderContent(card: PracticeCard): ReminderContent {
  const task = chooseTask(card);
  const message = task.type === 'scenario' && task.register ? `${task.prompt} (${task.register})` : task.prompt;
  return { title: `Practice "${card.word}"`, message };
}

export interface ReminderDeps {
  now?: Date;
  /** T1, T2: false while the user is mid-task or in fullscreen. */
  isGoodMoment(): Promise<boolean>;
  show(content: ReminderContent): Promise<void>;
}

/**
 * Shows a reminder if the settings allow one now, it's a good moment, and a word is ready.
 * Returns what happened, for logging and tests.
 */
export async function maybeRemind(client: SupabaseClient, deps: ReminderDeps): Promise<SkipReason | 'nothing-due' | 'busy' | 'shown'> {
  const now = deps.now ?? new Date();
  const { data } = await client.auth.getSession();
  if (!data.session) return 'not-set-up';

  const settings = await loadSettings(client);
  const state = await loadReminderState();
  const reason = skipReason(settings, state, now);
  if (reason) return reason;
  if (!(await deps.isGoodMoment())) return 'busy';

  const card = await fetchNextCard(client, now, settings!.dailyCap);
  if (!card) return 'nothing-due';

  await deps.show(reminderContent(card));
  await saveReminderState({
    ...state,
    lastShownAt: now.toISOString(),
    awaitingResponse: true,
    // The previous reminder got no response before this one: count it as ignored.
    ignoredStreak: state.awaitingResponse ? state.ignoredStreak + 1 : state.ignoredStreak,
  });
  return 'shown';
}

export type ReminderResponse = 'opened' | 'later-today' | 'not-today';

function nextMidnight(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
}

/** Records what the user did with a reminder. Any response resets the back-off. */
export async function respondToReminder(response: ReminderResponse, now: Date = new Date()): Promise<void> {
  const state = await loadReminderState();
  const snoozedUntil =
    response === 'later-today'
      ? new Date(Math.min(now.getTime() + LATER_TODAY_HOURS * HOUR, nextMidnight(now).getTime())).toISOString()
      : response === 'not-today'
        ? nextMidnight(now).toISOString()
        : state.snoozedUntil;
  await saveReminderState({ ...state, snoozedUntil, awaitingResponse: false, ignoredStreak: 0 });
}
