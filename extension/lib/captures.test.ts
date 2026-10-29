import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { saveWord } from './captures';

function fakeClient({ userId = 'user-1' as string | null, upsertError = null as unknown } = {}) {
  const upsert = vi.fn().mockResolvedValue({ error: upsertError });
  const from = vi.fn(() => ({ upsert }));
  const getSession = vi.fn().mockResolvedValue({
    data: { session: userId ? { user: { id: userId } } : null },
    error: null,
  });
  const client = { from, auth: { getSession } } as unknown as SupabaseClient;
  return { client, from, upsert };
}

describe('saveWord', () => {
  it('upserts into captures keyed on user_id,client_capture_id', async () => {
    const { client, from, upsert } = fakeClient();
    const capturedAt = new Date('2026-10-27T12:00:00Z');

    const result = await saveWord(client, {
      word: '  ephemeral ',
      sentence: 'Fame is   ephemeral.',
      pageTitle: 'An essay',
      sourceUrl: 'https://example.com/essay',
      clientCaptureId: 'cap-1',
      capturedAt,
    });

    expect(result).toEqual({ ok: true, word: 'ephemeral', clientCaptureId: 'cap-1' });
    expect(from).toHaveBeenCalledWith('captures');
    expect(upsert).toHaveBeenCalledWith(
      {
        user_id: 'user-1',
        client_capture_id: 'cap-1',
        word: 'ephemeral',
        sentence: 'Fame is ephemeral.',
        page_title: 'An essay',
        source_url: 'https://example.com/essay',
        source: 'extension',
        captured_at: '2026-10-27T12:00:00.000Z',
      },
      { onConflict: 'user_id,client_capture_id', ignoreDuplicates: true },
    );
  });

  it('generates a client_capture_id when none is given', async () => {
    const { client, upsert } = fakeClient();

    const result = await saveWord(client, { word: 'laconic' });

    const row = upsert.mock.calls[0]![0];
    expect(row.client_capture_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result).toMatchObject({ ok: true, clientCaptureId: row.client_capture_id });
    expect(row).toMatchObject({ sentence: null, page_title: null, source_url: null });
  });

  it('clips optional fields to the column limits and drops oversized URLs', async () => {
    const { client, upsert } = fakeClient();

    await saveWord(client, {
      word: 'word',
      sentence: 'a'.repeat(2500),
      pageTitle: 't'.repeat(600),
      sourceUrl: `https://example.com/${'x'.repeat(2100)}`,
    });

    const row = upsert.mock.calls[0]![0];
    expect(row.sentence).toHaveLength(2000);
    expect(row.page_title).toHaveLength(500);
    expect(row.source_url).toBeNull();
  });

  it.each(['', '   ', 'x'.repeat(101)])('rejects invalid word %j without a request', async (word) => {
    const { client, upsert } = fakeClient();

    const result = await saveWord(client, { word });

    expect(result).toMatchObject({ ok: false, reason: 'invalid' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('reports signed-out without a request', async () => {
    const { client, upsert } = fakeClient({ userId: null });

    const result = await saveWord(client, { word: 'ephemeral' });

    expect(result).toMatchObject({ ok: false, reason: 'signed-out' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('maps a database error to a retryable message', async () => {
    const { client } = fakeClient({ upsertError: { message: 'boom' } });

    const result = await saveWord(client, { word: 'ephemeral' });

    expect(result).toEqual({ ok: false, reason: 'error', message: `Couldn't save "ephemeral". Try again.` });
  });
});
