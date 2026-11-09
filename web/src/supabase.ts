import { createClient } from '@supabase/supabase-js';

// Stands in for the extension's lib/supabase.ts: the session lives in this site's localStorage.
export const supabase = createClient(import.meta.env.WXT_SUPABASE_URL, import.meta.env.WXT_SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export type ForageClient = typeof supabase;
