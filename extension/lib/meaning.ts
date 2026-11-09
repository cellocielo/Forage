import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Meaning on save: once a new word is enriched (a few seconds after saving), the page shows
 * what it means in that sentence plus its other common meanings. No browser APIs here, so the
 * web app shares it; the extension's messaging is in meaning-messages.ts.
 */

const POLL_INTERVAL_MS = 1500;
// Enrichment starts as soon as the word is saved and usually takes 5 to 15 seconds.
const POLL_TIMEOUT_MS = 45_000;
// Mirrors MAX_ATTEMPTS in the enrich-captures function.
const MAX_ENRICHMENT_ATTEMPTS = 3;

export interface OtherMeaning {
  partOfSpeech: string;
  definition: string;
}

/** What saving did, from the server (see place_capture). */
export type SaveOutcome = 'new_word' | 'new_meaning' | 'same_meaning' | 'returned' | 'duplicate';

export interface Meaning {
  word: string;
  outcome: SaveOutcome | null;
  partOfSpeech: string;
  definition: string;
  otherMeanings: OtherMeaning[];
}

export type OtherMeaningsColumn = Array<{ part_of_speech?: unknown; definition?: unknown }> | null;

/** senses.other_meanings as stored, keeping only entries with a definition. */
export function parseOtherMeanings(column: OtherMeaningsColumn): OtherMeaning[] {
  return (column ?? []).flatMap((m) =>
    typeof m.definition === 'string' && m.definition.trim()
      ? [{ partOfSpeech: typeof m.part_of_speech === 'string' ? m.part_of_speech : '', definition: m.definition }]
      : [],
  );
}

interface CaptureRow {
  word: string;
  enrichment_status: 'pending' | 'processing' | 'done' | 'failed';
  enrichment_attempts: number;
  save_outcome: SaveOutcome | null;
  lemmas: { lemma: string } | null;
  senses: {
    part_of_speech: string;
    definition: string;
    other_meanings: OtherMeaningsColumn;
  } | null;
}

export type MeaningCheck = { status: 'ready'; meaning: Meaning } | { status: 'waiting' } | { status: 'unavailable' };

/** One look at the capture: its meaning if enriched, or whether it's still worth waiting. */
export async function checkMeaning(client: SupabaseClient, clientCaptureId: string): Promise<MeaningCheck> {
  const { data, error } = await client
    .from('captures')
    .select(
      'word, enrichment_status, enrichment_attempts, save_outcome, lemmas ( lemma ), senses ( part_of_speech, definition, other_meanings )',
    )
    .eq('client_capture_id', clientCaptureId)
    .maybeSingle();
  if (error) return { status: 'waiting' };
  const row = data as unknown as CaptureRow | null;
  if (!row) return { status: 'unavailable' };

  if (row.enrichment_status === 'done' && row.senses) {
    const otherMeanings = parseOtherMeanings(row.senses.other_meanings);
    return {
      status: 'ready',
      meaning: {
        word: row.lemmas?.lemma ?? row.word,
        outcome: row.save_outcome,
        partOfSpeech: row.senses.part_of_speech,
        definition: row.senses.definition,
        otherMeanings,
      },
    };
  }
  if (row.enrichment_status === 'failed' && row.enrichment_attempts >= MAX_ENRICHMENT_ATTEMPTS) {
    return { status: 'unavailable' };
  }
  return { status: 'waiting' };
}

export interface WaitOptions {
  intervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Polls until the meaning is ready; null if it isn't ready in time or can't be made. */
export async function waitForMeaning(
  client: SupabaseClient,
  clientCaptureId: string,
  {
    intervalMs = POLL_INTERVAL_MS,
    timeoutMs = POLL_TIMEOUT_MS,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now = Date.now,
  }: WaitOptions = {},
): Promise<Meaning | null> {
  const deadline = now() + timeoutMs;
  for (;;) {
    const check = await checkMeaning(client, clientCaptureId);
    if (check.status === 'ready') return check.meaning;
    if (check.status === 'unavailable' || now() + intervalMs > deadline) return null;
    await sleep(intervalMs);
  }
}
