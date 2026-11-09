/**
 * When to send a push reminder to a phone. Mirrors the extension's lib/reminders.ts and
 * lib/settings.ts (skipReason, practiceOffReason, inQuietHours, inSpareMinuteWindow), but in
 * the user's saved time zone, since this runs on the server. Keep the two in step.
 */

export interface ReminderSettings {
  reminder_every_hours: number;
  daily_cap: number;
  weekends: boolean;
  quiet_start: string; // "HH:MM" or "HH:MM:SS", local
  quiet_end: string;
  time_zone: string;
  paused_until: string | null;
  spare_minute: 'morning' | 'commute' | 'lunch' | 'evening' | null;
  corner_reminder_enabled: boolean;
}

export interface ReminderState {
  last_sent_at: string | null;
  awaiting_response: boolean;
  ignored_streak: number;
}

export const INITIAL_STATE: ReminderState = { last_sent_at: null, awaiting_response: false, ignored_streak: 0 };

const HOUR = 60 * 60 * 1000;
// T9: every 3 ignored reminders in a row double the gap, up to 8x.
const IGNORES_PER_BACKOFF = 3;
const MAX_BACKOFF = 8;

const SPARE_MINUTE_WINDOWS: Record<NonNullable<ReminderSettings['spare_minute']>, [string, string]> = {
  morning: ['07:00', '10:00'],
  commute: ['17:00', '19:00'],
  lunch: ['12:00', '14:00'],
  evening: ['18:00', '21:00'],
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The day of the week (0 = Sunday) and minutes past midnight in a time zone. */
export function localClock(now: Date, timeZone: string): { day: number; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    return localClock(now, 'UTC');
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return { day: WEEKDAYS.indexOf(get('weekday')), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

/** Midnight today in the time zone, for counting today's reviews against the daily cap. */
export function startOfLocalDay(now: Date, timeZone: string): Date {
  const { minutes } = localClock(now, timeZone);
  return new Date(now.getTime() - minutes * 60_000 - now.getUTCSeconds() * 1000 - now.getUTCMilliseconds());
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
}

export type SkipReason = 'turned-off' | 'paused' | 'weekend' | 'quiet-hours' | 'too-soon' | 'outside-window';

export function reminderGapMs(settings: ReminderSettings, ignoredStreak: number): number {
  const backoff = Math.min(MAX_BACKOFF, 2 ** Math.floor(ignoredStreak / IGNORES_PER_BACKOFF));
  return settings.reminder_every_hours * HOUR * backoff;
}

/** Why no reminder should go out now, or null if one may (whether a word is ready is checked after). */
export function skipReason(settings: ReminderSettings, state: ReminderState, now: Date): SkipReason | null {
  if (!settings.corner_reminder_enabled) return 'turned-off';
  if (settings.paused_until && new Date(settings.paused_until) > now) return 'paused';

  const { day, minutes } = localClock(now, settings.time_zone);
  if (!settings.weekends && (day === 0 || day === 6)) return 'weekend';

  const quietStart = minutesOf(settings.quiet_start);
  const quietEnd = minutesOf(settings.quiet_end);
  const quiet = quietStart < quietEnd ? minutes >= quietStart && minutes < quietEnd : minutes >= quietStart || minutes < quietEnd;
  if (quiet) return 'quiet-hours';

  const ignored = state.ignored_streak + (state.awaiting_response ? 1 : 0);
  if (state.last_sent_at && now.getTime() - new Date(state.last_sent_at).getTime() < reminderGapMs(settings, ignored)) {
    return 'too-soon';
  }

  if (settings.reminder_every_hours === 24 && settings.spare_minute) {
    const [start, end] = SPARE_MINUTE_WINDOWS[settings.spare_minute];
    if (minutes < minutesOf(start) || minutes >= minutesOf(end)) return 'outside-window';
  }
  return null;
}

/** After sending: an unanswered previous reminder counts as ignored. */
export function stateAfterSending(state: ReminderState, now: Date): ReminderState {
  return {
    last_sent_at: now.toISOString(),
    awaiting_response: true,
    ignored_streak: state.awaiting_response ? state.ignored_streak + 1 : state.ignored_streak,
  };
}

/** Words ready now: due, within what's left of today's cap. */
export function readyCount(due: number, reviewedToday: number, dailyCap: number): number {
  return Math.min(due, Math.max(0, dailyCap - reviewedToday));
}

export interface PushMessage {
  title: string;
  body: string;
  /** Opened on tap, relative to the app. */
  url: string;
}

export function reminderMessage(word: string, ready: number): PushMessage {
  const others = ready - 1;
  return {
    title: `Time to practice "${word}"`,
    body: others > 0 ? `${others} more word${others === 1 ? '' : 's'} ready after it. Tap to start.` : 'Tap to start.',
    url: './?from=reminder',
  };
}

export const TEST_MESSAGE: PushMessage = {
  title: 'Forage notifications are on',
  body: "You'll get a reminder like this when words are ready to practice.",
  url: './',
};
