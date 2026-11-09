import type { SupabaseClient } from '@supabase/supabase-js';
import { waitForMeaning, type Meaning, type WaitOptions } from './meaning';

/** The content script asks the background for a saved word's meaning. */

export const LOOKUP_MEANING = 'forage:lookup-meaning';

export interface LookupMeaningMessage {
  type: typeof LOOKUP_MEANING;
  clientCaptureId: string;
}

/** Content-script side: asks the background for the meaning, never throws. */
export async function requestMeaning(clientCaptureId: string): Promise<Meaning | null> {
  try {
    const message: LookupMeaningMessage = { type: LOOKUP_MEANING, clientCaptureId };
    return (await browser.runtime.sendMessage(message)) ?? null;
  } catch {
    return null;
  }
}

/** Background side: runtime.onMessage listener that waits for the meaning. */
export function createLookupMeaningListener(client: SupabaseClient, options?: WaitOptions) {
  return (
    message: unknown,
    sender: { id?: string },
    sendResponse: (meaning: Meaning | null) => void,
  ): true | undefined => {
    if (sender.id !== browser.runtime.id) return;
    const lookup = message as Partial<LookupMeaningMessage> | null;
    if (lookup?.type !== LOOKUP_MEANING || typeof lookup.clientCaptureId !== 'string') return;
    waitForMeaning(client, lookup.clientCaptureId, options)
      .catch(() => null)
      .then(sendResponse);
    return true; // keep the channel open for the async response
  };
}
