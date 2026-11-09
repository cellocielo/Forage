import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkMeaning, waitForMeaning } from './meaning';
import { createLookupMeaningListener, LOOKUP_MEANING } from './meaning-messages';

const DONE = {
  word: 'banks',
  enrichment_status: 'done',
  enrichment_attempts: 1,
  save_outcome: 'same_meaning',
  lemmas: { lemma: 'bank' },
  senses: {
    part_of_speech: 'noun',
    definition: 'The land along the side of a river.',
    other_meanings: [{ part_of_speech: 'noun', definition: 'A business that keeps money.' }, { definition: '' }],
  },
};
const PENDING = { ...DONE, enrichment_status: 'processing', lemmas: null, senses: null };

function fakeClient(...rows: unknown[]) {
  const maybeSingle = vi.fn();
  for (const row of rows) maybeSingle.mockResolvedValueOnce({ data: row, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  return { eq, client: { from: () => ({ select: () => ({ eq }) }) } as unknown as SupabaseClient };
}

const BANK = {
  word: 'bank',
  outcome: 'same_meaning',
  partOfSpeech: 'noun',
  definition: 'The land along the side of a river.',
  otherMeanings: [{ partOfSpeech: 'noun', definition: 'A business that keeps money.' }],
};

describe('checkMeaning', () => {
  it('returns the meaning once enriched, using the dictionary form', async () => {
    const { client, eq } = fakeClient(DONE);
    expect(await checkMeaning(client, 'c1')).toEqual({ status: 'ready', meaning: BANK });
    expect(eq).toHaveBeenCalledWith('client_capture_id', 'c1');
  });

  it('waits while enrichment is running or retrying, and gives up once it has failed for good', async () => {
    const { client } = fakeClient(PENDING, { ...PENDING, enrichment_status: 'failed' }, { ...PENDING, enrichment_status: 'failed', enrichment_attempts: 3 }, null);
    expect((await checkMeaning(client, 'c')).status).toBe('waiting');
    expect((await checkMeaning(client, 'c')).status).toBe('waiting');
    expect((await checkMeaning(client, 'c')).status).toBe('unavailable');
    expect((await checkMeaning(client, 'c')).status).toBe('unavailable');
  });
});

describe('waitForMeaning', () => {
  it('polls until the meaning is ready', async () => {
    const { client } = fakeClient(PENDING, PENDING, DONE);
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await waitForMeaning(client, 'c', { sleep, intervalMs: 10 })).toEqual(BANK);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('stops at the timeout', async () => {
    const { client } = fakeClient(PENDING, PENDING, PENDING, PENDING);
    let t = 0;
    const result = await waitForMeaning(client, 'c', {
      intervalMs: 10,
      timeoutMs: 25,
      now: () => t,
      sleep: async (ms) => {
        t += ms;
      },
    });
    expect(result).toBeNull();
  });
});

describe('createLookupMeaningListener', () => {
  it('answers lookups from this extension only', async () => {
    const { client } = fakeClient(DONE);
    const listener = createLookupMeaningListener(client);
    const sendResponse = vi.fn();

    expect(listener({ type: LOOKUP_MEANING, clientCaptureId: 'c' }, { id: 'someone-else' }, sendResponse)).toBeUndefined();
    expect(listener({ type: 'other' }, { id: browser.runtime.id }, sendResponse)).toBeUndefined();
    expect(listener({ type: LOOKUP_MEANING, clientCaptureId: 'c' }, { id: browser.runtime.id }, sendResponse)).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(BANK));
  });
});
