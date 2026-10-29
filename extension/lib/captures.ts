import { isAuthRetryableFetchError, type SupabaseClient } from '@supabase/supabase-js';

// Mirrors the check constraints on public.captures.
const MAX_WORD = 100;
const MAX_SENTENCE = 2000;
const MAX_PAGE_TITLE = 500;
const MAX_SOURCE_URL = 2048;

export interface CaptureInput {
  word: string;
  sentence?: string | null;
  pageTitle?: string | null;
  sourceUrl?: string | null;
  // Pass the same id when retrying so the upsert stays idempotent (PRD C3).
  clientCaptureId?: string;
  capturedAt?: Date;
}

export type SaveWordResult =
  | { ok: true; word: string; clientCaptureId: string; queued?: boolean }
  | { ok: false; reason: 'invalid' | 'signed-out' | 'rejected'; message: string }
  // Offline or server trouble: safe to retry later with the same clientCaptureId.
  | { ok: false; reason: 'retryable'; message: string; word: string; userId?: string };

export interface SaveWordOptions {
  // Only save if this account is signed in (used when syncing queued captures).
  userId?: string;
}

function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

function clip(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function saveWord(
  client: SupabaseClient,
  input: CaptureInput,
  options: SaveWordOptions = {},
): Promise<SaveWordResult> {
  const word = clip(input.word, Infinity);
  if (!word || word.length > MAX_WORD) {
    return { ok: false, reason: 'invalid', message: 'Select a word or short phrase to save.' };
  }

  const { data, error: sessionError } = await client.auth.getSession();
  if (sessionError && isAuthRetryableFetchError(sessionError)) {
    // The access token expired and refreshing it needs the network.
    return { ok: false, reason: 'retryable', message: `Couldn't save "${word}". Try again.`, word };
  }
  const userId = data.session?.user.id;
  if (!userId || (options.userId && options.userId !== userId)) {
    return { ok: false, reason: 'signed-out', message: 'Sign in to Forage to save words.' };
  }

  const clientCaptureId = input.clientCaptureId ?? crypto.randomUUID();
  const sourceUrl = input.sourceUrl && input.sourceUrl.length <= MAX_SOURCE_URL ? input.sourceUrl : null;

  // ignoreDuplicates makes a retried capture a no-op: there is no update policy on captures.
  const { error, status } = await client.from('captures').upsert(
    {
      user_id: userId,
      client_capture_id: clientCaptureId,
      word,
      sentence: clip(input.sentence, MAX_SENTENCE),
      page_title: clip(input.pageTitle, MAX_PAGE_TITLE),
      source_url: sourceUrl,
      source: 'extension',
      captured_at: (input.capturedAt ?? new Date()).toISOString(),
    },
    { onConflict: 'user_id,client_capture_id', ignoreDuplicates: true },
  );

  if (error) {
    const message = `Couldn't save "${word}". Try again.`;
    return isRetryableStatus(status)
      ? { ok: false, reason: 'retryable', message, word, userId }
      : { ok: false, reason: 'rejected', message };
  }
  return { ok: true, word, clientCaptureId };
}
