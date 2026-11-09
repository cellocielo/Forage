-- Meaning on save: right after saving, the page shows what the word means in that sentence,
-- plus a short list of its other common meanings (from enrichment prompt enrich-v11).

alter table public.senses
  add column other_meanings jsonb not null default '[]'::jsonb check (jsonb_typeof(other_meanings) = 'array');

-- Same as before, plus other_meanings.
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
    frames, frame_choices, scenarios, hint_partners, hint_example, hint_starter, usage_choice,
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
    p_enrichment -> 'usage_choice',
    coalesce(p_enrichment -> 'other_meanings', '[]'::jsonb),
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

-- Enrich new captures right away instead of waiting up to a minute for the cron job, so the
-- meaning shows while the reader is still on the page. pg_net sends the request after this
-- transaction commits, so the worker can claim the new rows. Retries still run on the cron job.
create function public.request_enrichment_on_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.request_enrichment();
  return null;
exception when others then
  -- Never block saving a word; the cron job picks it up within a minute.
  raise warning 'request_enrichment_on_insert: %', sqlerrm;
  return null;
end;
$$;

revoke execute on function public.request_enrichment_on_insert() from public, anon, authenticated;

create trigger captures_request_enrichment
  after insert on public.captures
  for each statement
  execute function public.request_enrichment_on_insert();
