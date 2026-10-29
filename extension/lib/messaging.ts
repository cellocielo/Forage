import type { SupabaseClient } from '@supabase/supabase-js';
import { saveWord, type CaptureInput, type SaveWordResult } from './captures';

export const SAVE_WORD = 'forage:save-word';

export interface SaveWordMessage {
  type: typeof SAVE_WORD;
  capture: CaptureInput;
}

function isSaveWordMessage(message: unknown): message is SaveWordMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as SaveWordMessage).type === SAVE_WORD &&
    typeof (message as SaveWordMessage).capture?.word === 'string'
  );
}

/** Content-script side: asks the background to save, never throws. */
export async function requestSaveWord(capture: CaptureInput): Promise<SaveWordResult> {
  try {
    const message: SaveWordMessage = { type: SAVE_WORD, capture };
    return await browser.runtime.sendMessage(message);
  } catch {
    return { ok: false, reason: 'error', message: "Couldn't reach Forage. Try again." };
  }
}

/** Background side: runtime.onMessage listener that performs the save. */
export function createSaveWordListener(client: SupabaseClient) {
  return (
    message: unknown,
    sender: { id?: string },
    sendResponse: (result: SaveWordResult) => void,
  ): true | undefined => {
    if (sender.id !== browser.runtime.id || !isSaveWordMessage(message)) return;
    saveWord(client, message.capture)
      .catch((): SaveWordResult => ({ ok: false, reason: 'error', message: "Couldn't save. Try again." }))
      .then(sendResponse);
    return true; // keep the channel open for the async response
  };
}
