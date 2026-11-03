import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSaveWordListener, requestSaveWord, SAVE_WORD } from './messaging';

function fakeClient() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  return {
    upsert,
    client: {
      from: () => ({ upsert }),
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } }, error: null }) },
    } as unknown as SupabaseClient,
  };
}

describe('createSaveWordListener', () => {
  it('saves the capture and responds asynchronously', async () => {
    const { client, upsert } = fakeClient();
    const sendResponse = vi.fn();
    const listener = createSaveWordListener(client);

    const keepOpen = listener(
      { type: SAVE_WORD, capture: { word: 'ephemeral' } },
      { id: browser.runtime.id },
      sendResponse,
    );

    expect(keepOpen).toBe(true);
    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
    expect(sendResponse.mock.calls[0]![0]).toMatchObject({ ok: true, word: 'ephemeral' });
    expect(upsert).toHaveBeenCalledOnce();
  });

  it('ignores other messages and other extensions', () => {
    const { client, upsert } = fakeClient();
    const listener = createSaveWordListener(client);
    const sendResponse = vi.fn();

    expect(listener({ type: 'other' }, { id: browser.runtime.id }, sendResponse)).toBeUndefined();
    expect(listener({ type: SAVE_WORD, capture: { word: 'x' } }, { id: 'someone-else' }, sendResponse)).toBeUndefined();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('calls onSaved after a successful save, but not after a failure', async () => {
    const { client } = fakeClient();
    const onSaved = vi.fn();
    const sendResponse = vi.fn();

    createSaveWordListener(client, onSaved)(
      { type: SAVE_WORD, capture: { word: 'ephemeral' } },
      { id: browser.runtime.id },
      sendResponse,
    );
    await vi.waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ ok: true })));

    const failing = { auth: { getSession: () => Promise.reject(new Error('offline')) } } as unknown as SupabaseClient;
    const onFailedSave = vi.fn();
    const failedResponse = vi.fn();
    createSaveWordListener(failing, onFailedSave)(
      { type: SAVE_WORD, capture: { word: 'x' } },
      { id: browser.runtime.id },
      failedResponse,
    );
    await vi.waitFor(() => expect(failedResponse).toHaveBeenCalled());
    expect(onFailedSave).not.toHaveBeenCalled();
  });

  it('responds with an error if saving throws', async () => {
    const client = { auth: { getSession: () => Promise.reject(new Error('offline')) } } as unknown as SupabaseClient;
    const sendResponse = vi.fn();

    createSaveWordListener(client)({ type: SAVE_WORD, capture: { word: 'x' } }, { id: browser.runtime.id }, sendResponse);

    await vi.waitFor(() => expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: false, reason: 'rejected' })));
  });
});

describe('requestSaveWord', () => {
  it('sends a save-word message to the background', async () => {
    const send = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ ok: true, word: 'x', clientCaptureId: 'c' } as never);

    await expect(requestSaveWord({ word: 'x' })).resolves.toMatchObject({ ok: true });
    expect(send).toHaveBeenCalledWith({ type: SAVE_WORD, capture: { word: 'x' } });
  });

  it('turns a messaging failure into an error result', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockRejectedValue(new Error('Extension context invalidated'));

    await expect(requestSaveWord({ word: 'x' })).resolves.toMatchObject({ ok: false, reason: 'rejected' });
  });
});
