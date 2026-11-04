import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_SETTINGS, loadSettings, practiceOffReason } from './settings';

// S3 default; users can change it in settings (T5).
export const DAILY_CAP = DEFAULT_SETTINGS.dailyCap;

const BADGE_COLOR = '#2f3b2f';

function startOfLocalDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Words ready to practice now: due, not snoozed, not archived, and within what's left of
 * today's cap. RLS limits the counts to the signed-in user's cards.
 */
export async function countReadyWords(
  client: SupabaseClient,
  now: Date = new Date(),
  dailyCap: number = DAILY_CAP,
): Promise<number> {
  const nowIso = now.toISOString();

  const [due, reviewedToday] = await Promise.all([
    client
      .from('cards')
      .select('id', { count: 'exact', head: true })
      .is('archived_at', null)
      .lte('due', nowIso)
      .or(`snoozed_until.is.null,snoozed_until.lte."${nowIso}"`),
    client
      .from('cards')
      .select('id', { count: 'exact', head: true })
      .gte('last_review', startOfLocalDay(now).toISOString()),
  ]);
  if (due.error) throw new Error(due.error.message);
  if (reviewedToday.error) throw new Error(reviewedToday.error.message);

  const left = Math.max(0, dailyCap - (reviewedToday.count ?? 0));
  return Math.min(due.count ?? 0, left);
}

async function setBadge(count: number): Promise<void> {
  await browser.action.setBadgeText({ text: count > 0 ? String(count) : '' });
  if (count > 0) await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
}

let refreshing: Promise<void> | null = null;
let again = false;

/**
 * Shows the number of ready words on the toolbar icon (P1), or nothing when signed out.
 * Calls made while a refresh is running are folded into one more refresh, so the badge
 * always ends on the latest count.
 */
export function refreshBadge(client: SupabaseClient): Promise<void> {
  if (refreshing) {
    again = true;
    return refreshing;
  }
  refreshing = (async () => {
    do {
      again = false;
      await updateOnce(client);
    } while (again);
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function updateOnce(client: SupabaseClient): Promise<void> {
  try {
    const { data } = await client.auth.getSession();
    if (!data.session) {
      await setBadge(0);
      return;
    }
    const settings = (await loadSettings(client)) ?? DEFAULT_SETTINGS;
    // The badge is a surface users can turn off (D6), and it stays blank while paused or on weekends off (T6, T8).
    if (!settings.badgeEnabled || practiceOffReason(settings)) {
      await setBadge(0);
      return;
    }
    await setBadge(await countReadyWords(client, new Date(), settings.dailyCap));
  } catch (error) {
    // Offline or server trouble: keep the last count rather than flash an empty badge.
    console.warn('Forage: could not refresh the badge', error);
  }
}

/** True for the storage key supabase-js keeps the session under (sb-<ref>-auth-token). */
export function isAuthStorageKey(key: string): boolean {
  return /^sb-.+-auth-token$/.test(key);
}
