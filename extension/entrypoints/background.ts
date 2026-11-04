import { isAuthStorageKey, refreshBadge } from '@/lib/badge';
import { flushQueue } from '@/lib/capture-queue';
import { createSaveWordListener } from '@/lib/messaging';
import { maybeRemind, NOTIFICATION_ID, type ReminderContent, respondToReminder } from '@/lib/reminders';
import { supabase } from '@/lib/supabase';

const MENU_ID = 'forage-save-word';
const SAVE_COMMAND = 'save-word';
const SYNC_ALARM = 'forage-sync-captures';
const BADGE_AFTER_SAVE_ALARM = 'forage-badge-after-save';
// Enrichment runs every minute, and the card appears once it finishes.
const BADGE_AFTER_SAVE_MINUTES = 2;
// T1: coming back after a minute without input counts as a natural break.
const IDLE_SECONDS = 60;

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

  // Reminders (P3) wait for a natural break (T1): returning after a pause, or closing a tab.
  browser.idle.setDetectionInterval(IDLE_SECONDS);
  browser.idle.onStateChanged.addListener((state) => {
    if (state === 'active') remind();
  });
  browser.tabs.onRemoved.addListener(() => remind());

  browser.notifications.onClicked.addListener((id) => {
    if (id !== NOTIFICATION_ID) return;
    browser.notifications.clear(id);
    respondToReminder('opened');
    openPractice();
  });
  browser.notifications.onButtonClicked.addListener((id, buttonIndex) => {
    if (id !== NOTIFICATION_ID) return;
    browser.notifications.clear(id);
    respondToReminder(buttonIndex === 0 ? 'later-today' : 'not-today');
  });

  flushQueue(supabase);
  refreshBadge(supabase);
});

let reminding: Promise<unknown> | null = null;

/** One check at a time, so a burst of closed tabs can't show two reminders. */
function remind() {
  reminding ??= maybeRemind(supabase, { isGoodMoment, show: showReminder })
    .catch((error) => console.warn('Forage: reminder check failed', error))
    .finally(() => {
      reminding = null;
    });
}

// T2: never over fullscreen video, presentations, or a locked screen.
async function isGoodMoment(): Promise<boolean> {
  const [window, idle] = await Promise.all([browser.windows.getLastFocused(), browser.idle.queryState(IDLE_SECONDS)]);
  return window.state !== 'fullscreen' && idle !== 'locked';
}

async function showReminder({ title, message }: ReminderContent) {
  await browser.notifications.create(NOTIFICATION_ID, {
    type: 'basic',
    iconUrl: browser.runtime.getURL('/icon/128.png'),
    title,
    message,
    contextMessage: 'Click to answer',
    buttons: [{ title: 'Later today' }, { title: 'Not today' }],
    priority: 0,
  });
}

/** Opens the practice card: the toolbar popup if Chrome allows it here, else a small window. */
async function openPractice() {
  try {
    await browser.action.openPopup();
  } catch {
    await browser.windows.create({ url: browser.runtime.getURL('/popup.html'), type: 'popup', width: 380, height: 640 });
  }
}

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
