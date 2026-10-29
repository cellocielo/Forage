import { flushQueue } from '@/lib/capture-queue';
import { createSaveWordListener } from '@/lib/messaging';
import { supabase } from '@/lib/supabase';

const MENU_ID = 'forage-save-word';
const SAVE_COMMAND = 'save-word';
const SYNC_ALARM = 'forage-sync-captures';

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

  browser.runtime.onMessage.addListener(createSaveWordListener(supabase));

  // Sync offline captures when the worker wakes, when the network returns, and every few minutes.
  browser.alarms.get(SYNC_ALARM).then((alarm) => {
    if (!alarm) browser.alarms.create(SYNC_ALARM, { periodInMinutes: 5 });
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM) flushQueue(supabase);
  });
  addEventListener('online', () => flushQueue(supabase));
  flushQueue(supabase);
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
