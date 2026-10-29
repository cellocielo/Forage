import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { captureWord, flushQueue, QUEUE_KEY, readQueue, type QueuedCapture } from './capture-queue';

type UpsertResponse = { error: unknown; status: number };
const OK: UpsertResponse = { error: null, status: 201 };
const OFFLINE: UpsertResponse = { error: { message: 'TypeError: Failed to fetch' }, status: 0 };
const REJECTED: UpsertResponse = { error: { message: 'bad column' }, status: 400 };

function fakeClient(userId: string | null = 'user-1') {
  const upsert = vi.fn<(row: Record<string, unknown>) => Promise<UpsertResponse>>().mockResolvedValue(OK);
  const client = {
    from: () => ({ upsert }),
    auth: {
      getSession: async () => ({ data: { session: userId ? { user: { id: userId } } : null }, error: null }),
    },
  } as unknown as SupabaseClient;
  return { client, upsert };
}

function queued(id: string, overrides: Partial<QueuedCapture> = {}): QueuedCapture {
  return {
    word: `word-${id}`,
    sentence: null,
    pageTitle: null,
    sourceUrl: null,
    clientCaptureId: id,
    capturedAt: '2026-10-27T12:00:00.000Z',
    userId: 'user-1',
    ...overrides,
  };
}

const seed = (items: QueuedCapture[]) => browser.storage.local.set({ [QUEUE_KEY]: items });
const queuedIds = async () => (await readQueue()).map((item) => item.clientCaptureId);
const sentIds = (upsert: ReturnType<typeof fakeClient>['upsert']) =>
  upsert.mock.calls.map(([row]) => row.client_capture_id);

beforeEach(() => fakeBrowser.reset());

describe('captureWord', () => {
  it('saves directly when online and leaves the queue empty', async () => {
    const { client } = fakeClient();

    const result = await captureWord(client, { word: 'ephemeral' });

    expect(result).toMatchObject({ ok: true, word: 'ephemeral' });
    expect(result).not.toHaveProperty('queued');
    expect(await readQueue()).toEqual([]);
  });

  it('queues the capture with its id and time when offline', async () => {
    const { client, upsert } = fakeClient();
    upsert.mockResolvedValue(OFFLINE);
    const capturedAt = new Date('2026-10-27T09:30:00Z');

    const result = await captureWord(client, {
      word: ' laconic ',
      sentence: 'A laconic reply.',
      sourceUrl: 'https://example.com',
      capturedAt,
    });

    expect(result).toMatchObject({ ok: true, word: 'laconic', queued: true });
    const [item] = await readQueue();
    expect(item).toEqual({
      word: ' laconic ',
      sentence: 'A laconic reply.',
      pageTitle: null,
      sourceUrl: 'https://example.com',
      clientCaptureId: result.ok ? result.clientCaptureId : '',
      capturedAt: '2026-10-27T09:30:00.000Z',
      userId: 'user-1',
    });
    // The queued item reuses the id from the failed attempt, so a retry can't duplicate it.
    expect(item!.clientCaptureId).toBe(upsert.mock.calls[0]![0].client_capture_id);
  });

  it('does not queue a capture the server rejects', async () => {
    const { client, upsert } = fakeClient();
    upsert.mockResolvedValue(REJECTED);

    const result = await captureWord(client, { word: 'ephemeral' });

    expect(result).toMatchObject({ ok: false, reason: 'rejected' });
    expect(await readQueue()).toEqual([]);
  });

  it('does not queue when signed out', async () => {
    const { client } = fakeClient(null);

    const result = await captureWord(client, { word: 'ephemeral' });

    expect(result).toMatchObject({ ok: false, reason: 'signed-out' });
    expect(await readQueue()).toEqual([]);
  });

  it('sends waiting captures after a successful save', async () => {
    const { client, upsert } = fakeClient();
    await seed([queued('old')]);

    await captureWord(client, { word: 'new', clientCaptureId: 'new' });
    await flushQueue(client);

    expect(sentIds(upsert)).toEqual(['new', 'old']);
    expect(await readQueue()).toEqual([]);
  });
});

describe('flushQueue', () => {
  it('sends queued captures in order with their original time', async () => {
    const { client, upsert } = fakeClient();
    await seed([queued('a'), queued('b')]);

    await flushQueue(client);

    expect(sentIds(upsert)).toEqual(['a', 'b']);
    expect(upsert.mock.calls[0]![0].captured_at).toBe('2026-10-27T12:00:00.000Z');
    expect(await readQueue()).toEqual([]);
  });

  it('stops at the first capture that still cannot get through', async () => {
    const { client, upsert } = fakeClient();
    upsert.mockResolvedValueOnce(OK).mockResolvedValueOnce(OFFLINE);
    await seed([queued('a'), queued('b'), queued('c')]);

    await flushQueue(client);

    expect(sentIds(upsert)).toEqual(['a', 'b']);
    expect(await queuedIds()).toEqual(['b', 'c']);
  });

  it('drops captures the server rejects so they do not block the queue', async () => {
    const { client, upsert } = fakeClient();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    upsert.mockResolvedValueOnce(REJECTED).mockResolvedValueOnce(OK);
    await seed([queued('bad'), queued('good')]);

    await flushQueue(client);

    expect(await readQueue()).toEqual([]);
  });

  it('keeps captures from another account until that account signs in', async () => {
    const { client, upsert } = fakeClient('user-2');
    await seed([queued('mine', { userId: 'user-1' }), queued('theirs', { userId: 'user-2' })]);

    await flushQueue(client);

    expect(sentIds(upsert)).toEqual(['theirs']);
    expect(await queuedIds()).toEqual(['mine']);
  });

  it('keeps captures added while a flush is running', async () => {
    const { client, upsert } = fakeClient();
    await seed([queued('a')]);
    upsert.mockImplementationOnce(async () => {
      await seed([...(await readQueue()), queued('late')]);
      return OK;
    });

    await flushQueue(client);

    expect(await queuedIds()).toEqual(['late']);
  });

  it('runs one flush at a time', async () => {
    const { client, upsert } = fakeClient();
    await seed([queued('a')]);

    await Promise.all([flushQueue(client), flushQueue(client)]);

    expect(sentIds(upsert)).toEqual(['a']);
  });
});
