-- Enrichment (PRD E1-E4): the enrich-captures Edge Function claims pending captures,
-- reuses a cached sense when it can, and otherwise asks the LLM for one.

create type public.word_register as enum ('formal', 'neutral', 'informal', 'literary', 'technical');

-- Normalized dictionary forms. Contains no personal data, so any signed-in user can read it.
create table public.lemmas (
  id         uuid primary key default gen_random_uuid(),
  lemma      text not null unique check (char_length(lemma) between 1 and 100),
  created_at timestamptz not null default now()
);

-- One sense of a lemma as used in a particular context. Shared across users through the
-- cache (E3), but readable only by users who captured it (see policy below).
create table public.senses (
  id             uuid primary key default gen_random_uuid(),
  lemma_id       uuid not null references public.lemmas (id) on delete cascade,
  part_of_speech text not null check (part_of_speech in (
    'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition',
    'conjunction', 'interjection', 'determiner', 'phrase'
  )),
  definition     text not null check (char_length(definition) <= 500),
  register       public.word_register not null,
  paraphrase     text not null check (char_length(paraphrase) <= 500),
  examples       text[] not null check (cardinality(examples) = 2),
  model          text not null,
  prompt_version text not null,
  created_at     timestamptz not null default now()
);

create index senses_lemma_idx on public.senses (lemma_id);

alter table public.captures
  add constraint captures_lemma_id_fkey foreign key (lemma_id) references public.lemmas (id) on delete set null,
  add column sense_id              uuid references public.senses (id) on delete set null,
  add column enrichment_attempts   integer not null default 0,
  add column enrichment_claimed_at timestamptz;

create index captures_sense_idx on public.captures (sense_id);
-- Cache lookups: same word in the same sentence, already enriched.
create index captures_sentence_hash_idx on public.captures (sentence_hash)
  where enrichment_status = 'done';

alter table public.lemmas enable row level security;
alter table public.senses enable row level security;

create policy "Signed-in users can read lemmas"
  on public.lemmas for select
  to authenticated
  using (true);

create policy "Users can read senses of their own captures"
  on public.senses for select
  to authenticated
  using (exists (
    select 1 from public.captures c
    where c.sense_id = senses.id and c.user_id = (select auth.uid())
  ));

-- No insert/update policies: only the Edge Function (secret key, bypasses RLS) writes these.

-- Atomically claims a batch for one worker. Also reclaims captures stuck in 'processing'
-- (a worker that crashed) and retries failures, up to 3 attempts in total.
create function public.claim_captures_for_enrichment(batch_size integer default 10)
returns setof public.captures
language sql
set search_path = ''
as $$
  update public.captures c
  set enrichment_status = 'processing',
      enrichment_claimed_at = now(),
      enrichment_attempts = c.enrichment_attempts + 1
  where c.id in (
    select id from public.captures
    where enrichment_attempts < 3
      and (
        enrichment_status in ('pending', 'failed')
        or (enrichment_status = 'processing' and enrichment_claimed_at < now() - interval '5 minutes')
      )
    order by created_at
    limit batch_size
    for update skip locked
  )
  returning c.*;
$$;

-- A sense already generated for this word in this sentence by the current prompt version.
create function public.find_cached_sense(p_word text, p_sentence_hash text, p_prompt_version text)
returns table (lemma_id uuid, sense_id uuid)
language sql
stable
set search_path = ''
as $$
  select c.lemma_id, c.sense_id
  from public.captures c
  join public.senses s on s.id = c.sense_id
  where c.sentence_hash = p_sentence_hash
    and c.enrichment_status = 'done'
    and lower(c.word) = lower(p_word)
    and s.prompt_version = p_prompt_version
  limit 1;
$$;

-- Saves a freshly generated sense and marks the capture done, in one transaction.
create function public.save_capture_enrichment(
  p_capture_id uuid,
  p_sentence_hash text,
  p_enrichment jsonb,
  p_model text,
  p_prompt_version text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_lemma_id uuid;
  v_sense_id uuid;
begin
  insert into public.lemmas (lemma)
  values (p_enrichment ->> 'lemma')
  on conflict (lemma) do update set lemma = excluded.lemma
  returning id into v_lemma_id;

  insert into public.senses (lemma_id, part_of_speech, definition, register, paraphrase, examples, model, prompt_version)
  values (
    v_lemma_id,
    p_enrichment ->> 'part_of_speech',
    p_enrichment ->> 'definition',
    (p_enrichment ->> 'register')::public.word_register,
    p_enrichment ->> 'paraphrase',
    array(select jsonb_array_elements_text(p_enrichment -> 'examples')),
    p_model,
    p_prompt_version
  )
  returning id into v_sense_id;

  update public.captures
  set lemma_id = v_lemma_id,
      sense_id = v_sense_id,
      sentence_hash = p_sentence_hash,
      enrichment_status = 'done',
      enrichment_error = null
  where id = p_capture_id;

  return v_sense_id;
end;
$$;

-- These run only from the Edge Function with the secret key.
revoke execute on function public.claim_captures_for_enrichment(integer) from public, anon, authenticated;
revoke execute on function public.find_cached_sense(text, text, text) from public, anon, authenticated;
revoke execute on function public.save_capture_enrichment(uuid, text, jsonb, text, text) from public, anon, authenticated;
