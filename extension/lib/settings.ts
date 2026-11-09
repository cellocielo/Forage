import type { SupabaseClient } from '@supabase/supabase-js';

/** T4: when the user usually has a spare minute, and the reminder window it sets. */
export const SPARE_MINUTES = {
  morning: { label: 'Morning coffee', window: ['07:00', '10:00'] },
  commute: { label: 'Commute', window: ['17:00', '19:00'] },
  lunch: { label: 'Lunch', window: ['12:00', '14:00'] },
  evening: { label: 'Evening', window: ['18:00', '21:00'] },
} as const;
export type SpareMinute = keyof typeof SPARE_MINUTES;

/** T5: hours between reminders; 24 means once a day. */
export const REMINDER_INTERVALS = [3, 5, 8, 24] as const;
export const MAX_DAILY_CAP = 20;
export const PAUSE_DAYS = 7;

export interface Settings {
  spareMinute: SpareMinute | null;
  reminderEveryHours: (typeof REMINDER_INTERVALS)[number];
  dailyCap: number;
  weekends: boolean;
  quietStart: string; // "HH:MM", local
  quietEnd: string;
  pausedUntil: string | null;
  badgeEnabled: boolean;
  endOfReadingEnabled: boolean;
  cornerReminderEnabled: boolean;
}

// Matches the column defaults in 20261104000000_create_user_settings.sql.
export const DEFAULT_SETTINGS: Settings = {
  spareMinute: null,
  reminderEveryHours: 5,
  dailyCap: 5,
  weekends: false,
  quietStart: '21:00',
  quietEnd: '08:00',
  pausedUntil: null,
  badgeEnabled: true,
  endOfReadingEnabled: true,
  cornerReminderEnabled: true,
};

interface SettingsRow {
  spare_minute: SpareMinute | null;
  reminder_every_hours: Settings['reminderEveryHours'];
  daily_cap: number;
  weekends: boolean;
  quiet_start: string;
  quiet_end: string;
  paused_until: string | null;
  badge_enabled: boolean;
  end_of_reading_enabled: boolean;
  corner_reminder_enabled: boolean;
}

const COLUMNS =
  'spare_minute, reminder_every_hours, daily_cap, weekends, quiet_start, quiet_end, paused_until, badge_enabled, end_of_reading_enabled, corner_reminder_enabled';

function fromRow(row: SettingsRow): Settings {
  return {
    spareMinute: row.spare_minute,
    reminderEveryHours: row.reminder_every_hours,
    dailyCap: row.daily_cap,
    weekends: row.weekends,
    // Postgres returns "21:00:00"; time inputs use "21:00".
    quietStart: row.quiet_start.slice(0, 5),
    quietEnd: row.quiet_end.slice(0, 5),
    pausedUntil: row.paused_until,
    badgeEnabled: row.badge_enabled,
    endOfReadingEnabled: row.end_of_reading_enabled,
    cornerReminderEnabled: row.corner_reminder_enabled,
  };
}

function toRow(settings: Settings, timeZone: string) {
  return {
    spare_minute: settings.spareMinute,
    reminder_every_hours: settings.reminderEveryHours,
    daily_cap: settings.dailyCap,
    weekends: settings.weekends,
    quiet_start: settings.quietStart,
    quiet_end: settings.quietEnd,
    time_zone: timeZone,
    paused_until: settings.pausedUntil,
    badge_enabled: settings.badgeEnabled,
    end_of_reading_enabled: settings.endOfReadingEnabled,
    corner_reminder_enabled: settings.cornerReminderEnabled,
  };
}

/** The user's settings, or null if they haven't finished or skipped onboarding yet. */
export async function loadSettings(client: SupabaseClient): Promise<Settings | null> {
  const { data, error } = await client.from('user_settings').select(COLUMNS).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? fromRow(data as SettingsRow) : null;
}

/** Creates or replaces the signed-in user's settings. RLS fills in and checks user_id. */
export async function saveSettings(
  client: SupabaseClient,
  settings: Settings,
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): Promise<void> {
  const { error } = await client.from('user_settings').upsert(toRow(settings, timeZone), { onConflict: 'user_id' });
  if (error) throw new Error(error.message);
}

/** Why ambient practice is off right now (T6, T8), or null when it's on. */
export function practiceOffReason(settings: Settings, now: Date = new Date()): 'paused' | 'weekend' | null {
  if (settings.pausedUntil && new Date(settings.pausedUntil) > now) return 'paused';
  const day = now.getDay();
  if (!settings.weekends && (day === 0 || day === 6)) return 'weekend';
  return null;
}

/** A week from now, for "Pause for a week" (T8). */
export function pauseForAWeek(now: Date = new Date()): string {
  return new Date(now.getTime() + PAUSE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h! * 60 + m!;
}

/** True when the local time falls in quiet hours (T7). The window may wrap past midnight. */
export function inQuietHours(settings: Pick<Settings, 'quietStart' | 'quietEnd'>, now: Date = new Date()): boolean {
  const t = now.getHours() * 60 + now.getMinutes();
  const start = minutesOf(settings.quietStart);
  const end = minutesOf(settings.quietEnd);
  return start < end ? t >= start && t < end : t >= start || t < end;
}
