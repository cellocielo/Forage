-- "Choose the correct usage" material per sense (PRD P8c), from enrichment prompt enrich-v6.
-- enrich-v6 also fixes senses that described another word in the source sentence (a capture
-- of "interjection" from "'Hi' is a casual interjection" was enriched as "hi").

alter table public.senses
  add column usage_choice jsonb check (
    usage_choice is null
    or (
      jsonb_typeof(usage_choice) = 'object'
      and jsonb_typeof(usage_choice -> 'correct') = 'string'
      and jsonb_typeof(usage_choice -> 'incorrect') = 'string'
      and jsonb_typeof(usage_choice -> 'mistake') = 'string'
      and char_length(usage_choice ->> 'correct') <= 500
      and char_length(usage_choice ->> 'incorrect') <= 500
      and char_length(usage_choice ->> 'mistake') <= 500
    )
  );

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
    frames, scenarios, hint_partners, hint_example, hint_starter, usage_choice, model, prompt_version
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
    p_enrichment -> 'usage_choice',
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

-- Re-enrich senses made before enrich-v6. Cards keep their schedule: the capture keeps its card,
-- and the trigger only creates one for captures that have none.
update public.captures c
set enrichment_status = 'pending', enrichment_attempts = 0, enrichment_error = null
from public.senses s
where s.id = c.sense_id and s.usage_choice is null;
