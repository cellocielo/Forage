-- More multiple-choice variety: several "which sentence is correct?" pairs and more frames per
-- sense, so practice doesn't keep showing the same few questions. Existing senses get more
-- through a background top-up (claim_senses_for_variety), run by enrich-captures.

-- Indexes stay stable once written, because the client sends the index it showed: a retired
-- pair is set to null rather than removed, like frame_choices.
alter table public.senses
  add column usage_choices jsonb not null default '[]'::jsonb check (jsonb_typeof(usage_choices) = 'array'),
  add column variety_attempts integer not null default 0,
  add column variety_claimed_at timestamptz;

update public.senses
set usage_choices = jsonb_build_array(usage_choice)
where usage_choice is not null;

-- Up to 4 frames from enrichment plus up to 4 from a top-up.
alter table public.senses drop constraint senses_frames_check;
alter table public.senses add constraint senses_frames_check check (cardinality(frames) between 0 and 8);

-- Same as before, plus usage_choices.
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
    frames, frame_choices, scenarios, hint_partners, hint_example, hint_starter, usage_choice, usage_choices,
    other_meanings, model, prompt_version
  )
  values (
    v_lemma_id,
    p_enrichment ->> 'part_of_speech',
    p_enrichment ->> 'definition',
    (p_enrichment ->> 'register')::public.word_register,
    p_enrichment ->> 'paraphrase',
    array(select jsonb_array_elements_text(p_enrichment -> 'examples')),
    array(select jsonb_array_elements_text(p_enrichment -> 'frames')),
    p_enrichment -> 'frame_choices',
    p_enrichment -> 'scenarios',
    array(select jsonb_array_elements_text(p_enrichment -> 'hints' -> 'partners')),
    p_enrichment -> 'hints' ->> 'example',
    p_enrichment -> 'hints' ->> 'starter',
    p_enrichment -> 'usage_choices' -> 0,
    coalesce(p_enrichment -> 'usage_choices', '[]'::jsonb),
    coalesce(p_enrichment -> 'other_meanings', '[]'::jsonb),
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

-- Senses someone is practicing that have only one usage pair: older senses, from before
-- enrichment wrote several.
create function public.senses_needing_variety()
returns setof public.senses
language sql
stable
set search_path = ''
as $$
  select s.*
  from public.senses s
  where jsonb_array_length(s.usage_choices) < 2
    and s.variety_attempts < 3
    and (s.variety_claimed_at is null or s.variety_claimed_at < now() - interval '5 minutes')
    and exists (
      select 1 from public.captures c
      join public.cards k on k.capture_id = c.id
      where c.sense_id = s.id and k.archived_at is null
    );
$$;

create function public.claim_senses_for_variety(batch_size integer default 5)
returns table (
  id uuid,
  word text,
  sentence text,
  part_of_speech text,
  definition text,
  frames text[],
  usage_choices jsonb
)
language sql
set search_path = ''
as $$
  with claimed as (
    update public.senses s
    set variety_claimed_at = now(),
        variety_attempts = s.variety_attempts + 1
    where s.id in (
      select n.id from public.senses_needing_variety() n
      order by n.created_at
      limit batch_size
    )
    returning s.*
  )
  select
    c.id,
    l.lemma,
    (select cap.sentence from public.captures cap where cap.sense_id = c.id order by cap.captured_at limit 1),
    c.part_of_speech,
    c.definition,
    coalesce(c.frames, '{}'),
    c.usage_choices
  from claimed c
  join public.lemmas l on l.id = c.lemma_id;
$$;

-- Appends to the sense, keeping existing indexes. frame_choices is padded with nulls so it
-- lines up with frames before the new ones go on.
create function public.save_sense_variety(
  p_sense_id uuid,
  p_usage_choices jsonb,
  p_frames text[],
  p_frame_choices jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_frames text[];
  v_choices jsonb;
begin
  select coalesce(frames, '{}'), coalesce(frame_choices, '[]'::jsonb)
  into v_frames, v_choices
  from public.senses where id = p_sense_id
  for update;
  if not found then
    return;
  end if;

  while jsonb_array_length(v_choices) < cardinality(v_frames) loop
    v_choices := v_choices || 'null'::jsonb;
  end loop;

  update public.senses
  set usage_choices = usage_choices || p_usage_choices,
      frames = (v_frames || p_frames)[1:8],
      frame_choices = (
        select coalesce(jsonb_agg(e order by i), '[]'::jsonb)
        from jsonb_array_elements(v_choices || p_frame_choices) with ordinality as t(e, i)
        where i <= 8
      )
  where id = p_sense_id;
end;
$$;

revoke execute on function public.senses_needing_variety() from public, anon, authenticated;
revoke execute on function public.claim_senses_for_variety(integer) from public, anon, authenticated;
revoke execute on function public.save_sense_variety(uuid, jsonb, text[], jsonb) from public, anon, authenticated;

-- The minute job also runs when older senses still need more variety, until they're done.
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
  ) and not exists (select 1 from public.senses_needing_variety()) then
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
