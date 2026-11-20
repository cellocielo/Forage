-- Meaning first: a new sense is saved as soon as its meaning is known, so the definition shows
-- within a couple of seconds of saving. Its practice material (examples, frames, scenarios,
-- hints, usage pairs) is written right after by a second step (claim_senses_for_practice), and
-- practice skips the word until then.

alter table public.senses
  add column practice_ready boolean not null default true,
  add column practice_attempts integer not null default 0,
  add column practice_claimed_at timestamptz;

-- Both are written by the practice step, so a meaning-only sense has none yet.
alter table public.senses alter column paraphrase drop not null;
alter table public.senses drop constraint senses_examples_check;
alter table public.senses add constraint senses_examples_check check (cardinality(examples) in (0, 2));

create index senses_practice_pending_idx on public.senses (created_at) where not practice_ready;

-- Saves a freshly generated meaning and links the capture to it, in one transaction. Like
-- save_capture_enrichment (kept for the previous function version), minus the practice material.
create function public.save_capture_meaning(
  p_capture_id uuid,
  p_sentence_hash text,
  p_meaning jsonb,
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
  values (p_meaning ->> 'lemma')
  on conflict (lemma) do update set lemma = excluded.lemma
  returning id into v_lemma_id;

  insert into public.senses (
    lemma_id, part_of_speech, definition, register, examples, other_meanings, uses_previous_sentence,
    practice_ready, model, prompt_version
  )
  values (
    v_lemma_id,
    p_meaning ->> 'part_of_speech',
    p_meaning ->> 'definition',
    (p_meaning ->> 'register')::public.word_register,
    '{}',
    coalesce(p_meaning -> 'other_meanings', '[]'::jsonb),
    coalesce((p_meaning ->> 'uses_previous_sentence')::boolean, false),
    false,
    p_model,
    p_prompt_version
  )
  returning id into v_sense_id;

  update public.captures
  set lemma_id = v_lemma_id,
      sense_id = v_sense_id,
      sentence_hash = p_sentence_hash,
      enrichment_error = null
  where id = p_capture_id;

  return v_sense_id;
end;
$$;

-- Senses whose practice material hasn't been written yet.
create function public.senses_needing_practice()
returns setof public.senses
language sql
stable
set search_path = ''
as $$
  select s.*
  from public.senses s
  where not s.practice_ready
    and s.practice_attempts < 3
    and (s.practice_claimed_at is null or s.practice_claimed_at < now() - interval '2 minutes');
$$;

create function public.claim_senses_for_practice(batch_size integer default 10)
returns table (
  id uuid,
  word text,
  saved text,
  sentence text,
  page_title text,
  part_of_speech text,
  definition text
)
language sql
set search_path = ''
as $$
  with claimed as (
    update public.senses s
    set practice_claimed_at = now(),
        practice_attempts = s.practice_attempts + 1
    where s.id in (
      select n.id from public.senses_needing_practice() n
      order by n.created_at
      limit batch_size
    )
    returning s.*
  )
  select
    c.id,
    l.lemma,
    src.word,
    src.sentence,
    src.page_title,
    c.part_of_speech,
    c.definition
  from claimed c
  join public.lemmas l on l.id = c.lemma_id
  left join lateral (
    select cap.word, cap.sentence, cap.page_title from public.captures cap
    where cap.sense_id = c.id order by cap.captured_at limit 1
  ) src on true;
$$;

create function public.save_sense_practice(p_sense_id uuid, p_practice jsonb)
returns void
language sql
set search_path = ''
as $$
  update public.senses
  set paraphrase = p_practice ->> 'paraphrase',
      examples = array(select jsonb_array_elements_text(p_practice -> 'examples')),
      frames = array(select jsonb_array_elements_text(p_practice -> 'frames')),
      frame_choices = p_practice -> 'frame_choices',
      scenarios = p_practice -> 'scenarios',
      hint_partners = array(select jsonb_array_elements_text(p_practice -> 'hints' -> 'partners')),
      hint_example = p_practice -> 'hints' ->> 'example',
      hint_starter = p_practice -> 'hints' ->> 'starter',
      usage_choice = p_practice -> 'usage_choices' -> 0,
      usage_choices = coalesce(p_practice -> 'usage_choices', '[]'::jsonb),
      practice_ready = true
  where id = p_sense_id;
$$;

revoke execute on function public.save_capture_meaning(uuid, text, jsonb, text, text) from public, anon, authenticated;
revoke execute on function public.senses_needing_practice() from public, anon, authenticated;
revoke execute on function public.claim_senses_for_practice(integer) from public, anon, authenticated;
revoke execute on function public.save_sense_practice(uuid, jsonb) from public, anon, authenticated;

-- The variety top-up is for senses that already have their practice material.
create or replace function public.senses_needing_variety()
returns setof public.senses
language sql
stable
set search_path = ''
as $$
  select s.*
  from public.senses s
  where s.practice_ready
    and jsonb_array_length(s.usage_choices) < 2
    and s.variety_attempts < 3
    and (s.variety_claimed_at is null or s.variety_claimed_at < now() - interval '5 minutes')
    and exists (
      select 1 from public.captures c
      join public.cards k on k.capture_id = c.id
      where c.sense_id = s.id and k.archived_at is null
    );
$$;

-- The minute job also runs when a sense is still waiting for its practice material (say, the
-- second step failed), and for the variety top-up.
create or replace function public.request_enrichment()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  if not exists (
    select 1 from public.captures
    where enrichment_attempts < 3
      and (
        enrichment_status in ('pending', 'failed')
        or (enrichment_status = 'processing' and enrichment_claimed_at < now() - interval '5 minutes')
      )
  ) and not exists (select 1 from public.senses_needing_practice())
    and not exists (select 1 from public.senses_needing_variety()) then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'enrich_secret_key';
  if v_url is null or v_key is null then
    raise warning 'request_enrichment: Vault secret project_url or enrich_secret_key is missing';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/enrich-captures',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke execute on function public.request_enrichment() from public, anon, authenticated;
