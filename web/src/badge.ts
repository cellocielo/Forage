import type { SupabaseClient } from '@supabase/supabase-js';
import { countReadyWords } from '@/lib/ready';
import { DEFAULT_SETTINGS, loadSettings, practiceOffReason } from '@/lib/settings';

/**
 * Stands in for the extension's lib/badge.ts: the number of ready words goes on the
 * installed app's icon, where the device supports it.
 */
export async function refreshBadge(client: SupabaseClient, now: Date = new Date()): Promise<void> {
  if (!('setAppBadge' in navigator)) return;
  try {
    const { data } = await client.auth.getSession();
    const settings = data.session ? ((await loadSettings(client)) ?? DEFAULT_SETTINGS) : null;
    const count =
      settings && settings.badgeEnabled && !practiceOffReason(settings, now)
        ? await countReadyWords(client, now, settings.dailyCap)
        : 0;
    if (count > 0) await navigator.setAppBadge(count);
    else await navigator.clearAppBadge();
  } catch {
    // The badge is a nicety; never let it break practice.
  }
}
