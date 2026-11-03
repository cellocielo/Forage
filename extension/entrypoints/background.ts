import { isAuthStorageKey, refreshBadge } from '@/lib/badge';
import { flushQueue } from '@/lib/capture-queue';
import { createSaveWordListener } from '@/lib/messaging';
import { supabase } from '@/lib/supabase';

const MENU_ID = 'forage-save-word';
const SAVE_COMMAND = 'save-word';
const SYNC_ALARM = 'forage-sync-captures';
const BADGE_AFTER_SAVE_ALARM = 'forage-badge-after-save';
// Enrichment runs every minute, and the card appears once it finishes.
const BADGE_AFTER_SAVE_MINUTES = 2;

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: MENU_ID,
      title: 'Save "%s" to Forage',
      contexts: ['selection'],
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_ID && tab?.id !== undefined) captureInTab(tab.id);
  });

  browser.commands.onCommand.addListener((command, tab) => {
    if (command === SAVE_COMMAND && tab?.id !== undefined) captureInTab(tab.id);
  });

  browser.runtime.onMessage.addListener(
    createSaveWordListener(supabase, () => {
      // A new word becomes a card once enriched; look again after that has had time to run.
      browser.alarms.create(BADGE_AFTER_SAVE_ALARM, { delayInMinutes: BADGE_AFTER_SAVE_MINUTES });
    }),
  );

  // Sync offline captures and refresh the badge when the worker wakes, when the network
  // returns, and every few minutes (cards come due as time passes).
  browser.alarms.get(SYNC_ALARM).then((alarm) => {
    if (!alarm) browser.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) {
      flushQueue(supabase);
      refreshBadge(supabase);
    } else if (alarm.name === BADGE_AFTER_SAVE_ALARM) {
      refreshBadge(supabase);
    }
  });
  addEventListener('online', () => {
    flushQueue(supabase);
    refreshBadge(supabase);
  });

  // The popup signs in and out; it shares the session through extension storage.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && Object.keys(changes).some(isAuthStorageKey)) refreshBadge(supabase);
  });

  flushQueue(supabase);
  refreshBadge(supabase);
});

async function captureInTab(tabId: number) {
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      files: ['/content-scripts/content.js'],
    });
  } catch (error) {
    // Restricted pages (chrome://, the Web Store, PDFs) can't be scripted.
    console.warn('Forage: cannot capture on this page', error);
  }
}
