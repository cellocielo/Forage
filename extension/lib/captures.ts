import type { SupabaseClient } from '@supabase/supabase-js';

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
  | { ok: true; word: string; clientCaptureId: string }
  | { ok: false; reason: 'signed-out' | 'invalid' | 'error'; message: string };

function clip(value: string | null | undefined, max: number): string | null {
  const trimmed = value?.replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function saveWord(
  client: SupabaseClient,
  input: CaptureInput,
): Promise<SaveWordResult> {
  const word = clip(input.word, Infinity);
  if (!word || word.length > MAX_WORD) {
    return { ok: false, reason: 'invalid', message: 'Select a word or short phrase to save.' };
  }

  const { data, error: sessionError } = await client.auth.getSession();
  const userId = data.session?.user.id;
  if (sessionError || !userId) {
    return { ok: false, reason: 'signed-out', message: 'Sign in to Forage to save words.' };
  }

  const clientCaptureId = input.clientCaptureId ?? crypto.randomUUID();
  const sourceUrl = input.sourceUrl && input.sourceUrl.length <= MAX_SOURCE_URL ? input.sourceUrl : null;

  // ignoreDuplicates makes a retried capture a no-op: there is no update policy on captures.
  const { error } = await client.from('captures').upsert(
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
    return { ok: false, reason: 'error', message: `Couldn't save "${word}". Try again.` };
  }
  return { ok: true, word, clientCaptureId };
}
