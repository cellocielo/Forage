import type { SupabaseClient } from '@supabase/supabase-js';
import { captureWord } from './capture-queue';
import type { CaptureInput, SaveWordResult } from './captures';

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
    return { ok: false, reason: 'rejected', message: "Couldn't reach Forage. Try again." };
  }
}

/** Background side: runtime.onMessage listener that performs the save. */
export function createSaveWordListener(client: SupabaseClient, onSaved?: (result: SaveWordResult) => void) {
  return (
    message: unknown,
    sender: { id?: string },
    sendResponse: (result: SaveWordResult) => void,
  ): true | undefined => {
    if (sender.id !== browser.runtime.id || !isSaveWordMessage(message)) return;
    captureWord(client, message.capture)
      .catch((): SaveWordResult => ({ ok: false, reason: 'rejected', message: "Couldn't save. Try again." }))
      .then((result) => {
        sendResponse(result);
        if (result.ok) onSaved?.(result);
      });
    return true; // keep the channel open for the async response
  };
}
