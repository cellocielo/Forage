-- Raw word captures from the extension, mobile, manual add, and imports.
-- Enrichment (lemma, sense) happens asynchronously and never blocks insert (PRD E4).

create type public.capture_source as enum ('extension', 'android', 'ios', 'manual', 'csv', 'readwise');
create type public.enrichment_status as enum ('pending', 'processing', 'done', 'failed');

create table public.captures (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,

  -- Generated on the client so offline-queued captures sync idempotently (PRD C3, 8 Reliability).
  client_capture_id uuid not null,

  word              text not null check (char_length(word) between 1 and 100),
  sentence          text check (char_length(sentence) <= 2000),
  page_title        text check (char_length(page_title) <= 500),
  source_url        text check (char_length(source_url) <= 2048),
  source            public.capture_source not null default 'extension',
  device            text check (char_length(device) <= 200),

  -- When the user captured it (may be earlier than created_at for offline captures).
  captured_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),

  -- Filled in by enrichment. FK to lemmas is added once that table exists.
  lemma_id          uuid,
  sentence_hash     text,
  enrichment_status public.enrichment_status not null default 'pending',
  enrichment_error  text,

  unique (user_id, client_capture_id)
);

create index captures_user_captured_at_idx on public.captures (user_id, captured_at desc);
create index captures_user_lemma_idx on public.captures (user_id, lemma_id);
create index captures_enrichment_pending_idx on public.captures (created_at)
  where enrichment_status in ('pending', 'failed');

alter table public.captures enable row level security;

create policy "Users can read their own captures"
  on public.captures for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own captures"
  on public.captures for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own captures"
  on public.captures for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- No update policy: clients don't edit raw captures. Enrichment runs with the
-- service role, which bypasses RLS. Sense corrections (PRD E5) belong on cards/senses.
