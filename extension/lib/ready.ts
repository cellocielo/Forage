import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_SETTINGS } from './settings';

/** How many words are ready now. No browser APIs, so the web app shares it. */

// S3 default; users can change it in settings (T5).
export const DAILY_CAP = DEFAULT_SETTINGS.dailyCap;

export function startOfLocalDay(now: Date): Date {
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
