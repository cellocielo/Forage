import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { extensionStorage } from './supabase';

describe('extensionStorage', () => {
  beforeEach(() => fakeBrowser.reset());

  it('round-trips the session through browser.storage.local', async () => {
    expect(await extensionStorage.getItem('sb-auth')).toBeNull();

    await extensionStorage.setItem('sb-auth', '{"access_token":"t"}');
    expect(await extensionStorage.getItem('sb-auth')).toBe('{"access_token":"t"}');
    expect(await browser.storage.local.get('sb-auth')).toEqual({ 'sb-auth': '{"access_token":"t"}' });

    await extensionStorage.removeItem('sb-auth');
    expect(await extensionStorage.getItem('sb-auth')).toBeNull();
  });
});
