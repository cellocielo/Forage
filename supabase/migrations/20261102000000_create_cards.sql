-- Practice scaffolding on senses (PRD E7) and one FSRS card per enriched capture (S1).

-- Scaffolding. Nullable: senses from prompt enrich-v1 have none and get regenerated below.
alter table public.senses
  add column frames        text[] check (cardinality(frames) = 2),
  add column scenarios     jsonb check (
    case when scenarios is null then true
         when jsonb_typeof(scenarios) = 'array' then jsonb_array_length(scenarios) = 3
         else false end
  ),
  add column hint_partners text[] check (cardinality(hint_partners) between 1 and 5),
  add column hint_example  text check (char_length(hint_example) <= 500),
  add column hint_starter  text check (char_length(hint_starter) <= 200);

create or replace function public.save_capture_enrichment(
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

  insert into public.senses (
    lemma_id, part_of_speech, definition, register, paraphrase, examples,
    frames, scenarios, hint_partners, hint_example, hint_starter, model, prompt_version
  )
  values (
    v_lemma_id,
    p_enrichment ->> 'part_of_speech',
    p_enrichment ->> 'definition',
    (p_enrichment ->> 'register')::public.word_register,
    p_enrichment ->> 'paraphrase',
    array(select jsonb_array_elements_text(p_enrichment -> 'examples')),
    array(select jsonb_array_elements_text(p_enrichment -> 'frames')),
    p_enrichment -> 'scenarios',
    array(select jsonb_array_elements_text(p_enrichment -> 'hints' -> 'partners')),
    p_enrichment -> 'hints' ->> 'example',
    p_enrichment -> 'hints' ->> 'starter',
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

-- FSRS state for one captured word. Defaults are an empty FSRS card (state 0 = New), due now.
-- The grading Edge Function writes the schedule; users can only snooze or archive (S5).
create table public.cards (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  capture_id     uuid not null unique references public.captures (id) on delete cascade,

  due            timestamptz not null default now(),
  stability      double precision not null default 0,
  difficulty     double precision not null default 0,
  scheduled_days integer not null default 0,
  learning_steps integer not null default 0,
  reps           integer not null default 0,
  lapses         integer not null default 0,
  state          smallint not null default 0 check (state between 0 and 3),
  last_review    timestamptz,

  snoozed_until  timestamptz,
  archived_at    timestamptz,
  created_at     timestamptz not null default now()
);

-- "What's due for me next", skipping archived cards.
create index cards_user_due_idx on public.cards (user_id, due) where archived_at is null;

alter table public.cards enable row level security;

create policy "Users can read their own cards"
  on public.cards for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can snooze or archive their own cards"
  on public.cards for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Column-level privileges narrow the update policy to the two user controls.
revoke all on public.cards from anon, authenticated;
grant select on public.cards to authenticated;
grant update (snoozed_until, archived_at) on public.cards to authenticated;

-- A capture becomes a card once it has a sense to practice.
create function public.create_card_for_capture()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.cards (user_id, capture_id)
  values (new.user_id, new.id)
  on conflict (capture_id) do nothing;
  return new;
end;
$$;

create trigger captures_create_card
  after update of enrichment_status on public.captures
  for each row
  when (new.enrichment_status = 'done' and old.enrichment_status is distinct from 'done')
  execute function public.create_card_for_capture();

-- Clients may only fill in the capture itself. Enrichment columns (sense_id, lemma_id,
-- status, attempts) are the server's; otherwise a client could point a capture at
-- another user's sense and read it through the senses policy.
revoke insert on public.captures from anon, authenticated;
grant insert (user_id, client_capture_id, word, sentence, page_title, source_url, source, device, captured_at)
  on public.captures to authenticated;

-- Regenerate senses made before scaffolding existed; their cards get created when done.
update public.captures c
set enrichment_status = 'pending', enrichment_attempts = 0, enrichment_error = null
from public.senses s
where s.id = c.sense_id and s.frames is null;
