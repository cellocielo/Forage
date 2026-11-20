import type { SupabaseClient } from '@supabase/supabase-js';
import { saveWord, type CaptureInput, type SaveWordResult } from './captures';

// Captures that couldn't reach Supabase wait here until they sync (PRD C3).
export const QUEUE_KEY = 'forage:capture-queue';

export interface QueuedCapture {
  word: string;
  sentence: string | null;
  /** Missing on captures queued before it was saved. */
  previousSentence?: string | null;
  pageTitle: string | null;
  sourceUrl: string | null;
  clientCaptureId: string;
  capturedAt: string;
  // Who was signed in when it was captured, so it never syncs into another account.
  userId: string | null;
}

export async function readQueue(): Promise<QueuedCapture[]> {
  const items = await browser.storage.local.get(QUEUE_KEY);
  return (items[QUEUE_KEY] as QueuedCapture[] | undefined) ?? [];
}

// Serializes read-modify-write of the queue within the background worker.
let queueLock: Promise<unknown> = Promise.resolve();
function updateQueue(change: (queue: QueuedCapture[]) => QueuedCapture[]): Promise<void> {
  const run = queueLock.then(async () => {
    await browser.storage.local.set({ [QUEUE_KEY]: change(await readQueue()) });
  });
  queueLock = run.catch(() => {});
  return run;
}

/** Saves a capture now, or queues it if Supabase can't be reached. */
export async function captureWord(client: SupabaseClient, input: CaptureInput): Promise<SaveWordResult> {
  const clientCaptureId = input.clientCaptureId ?? crypto.randomUUID();
  const capturedAt = input.capturedAt ?? new Date();
  const result = await saveWord(client, { ...input, clientCaptureId, capturedAt });

  if (result.ok) {
    // We're online, so this is a good moment to send anything still waiting.
    void flushQueue(client);
    return result;
  }
  if (result.reason !== 'retryable') return result;

  const queued: QueuedCapture = {
    word: input.word,
    sentence: input.sentence ?? null,
    previousSentence: input.previousSentence ?? null,
    pageTitle: input.pageTitle ?? null,
    sourceUrl: input.sourceUrl ?? null,
    clientCaptureId,
    capturedAt: capturedAt.toISOString(),
    userId: result.userId ?? null,
  };
  await updateQueue((queue) => [...queue, queued]);
  return { ok: true, word: result.word, clientCaptureId, queued: true };
}

let flushing: Promise<void> | null = null;

/** Sends queued captures in order; stops at the first one that still can't get through. */
export function flushQueue(client: SupabaseClient): Promise<void> {
  flushing ??= drain(client).finally(() => {
    flushing = null;
  });
  return flushing;
}

async function drain(client: SupabaseClient) {
  const done = new Set<string>();

  for (const item of await readQueue()) {
    const result = await saveWord(
      client,
      { ...item, capturedAt: new Date(item.capturedAt) },
      { userId: item.userId ?? undefined },
    );
    if (result.ok) {
      done.add(item.clientCaptureId);
    } else if (result.reason === 'retryable') {
      break;
    } else if (result.reason === 'invalid' || result.reason === 'rejected') {
      // Retrying can never succeed; drop it rather than block the queue forever.
      console.warn('Forage: dropping capture the server rejected', item.word);
      done.add(item.clientCaptureId);
    }
    // signed-out: keep it until its owner signs in again.
  }

  if (done.size > 0) {
    await updateQueue((queue) => queue.filter((item) => !done.has(item.clientCaptureId)));
  }
}
