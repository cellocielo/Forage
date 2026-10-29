import { createClient, type SupportedStorage } from '@supabase/supabase-js';

// Session lives in extension storage so the popup and background share one sign-in.
export const extensionStorage: SupportedStorage = {
  async getItem(key) {
    const items = await browser.storage.local.get(key);
    return (items[key] as string | undefined) ?? null;
  },
  async setItem(key, value) {
    await browser.storage.local.set({ [key]: value });
  },
  async removeItem(key) {
    await browser.storage.local.remove(key);
  },
};

export const supabase = createClient(
  import.meta.env.WXT_SUPABASE_URL,
  import.meta.env.WXT_SUPABASE_ANON_KEY,
  {
    auth: {
      storage: extensionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  },
);

export type ForageClient = typeof supabase;
