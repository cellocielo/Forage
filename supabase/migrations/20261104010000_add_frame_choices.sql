-- Multiple-choice fill-in-the-blank (the "pick" task): each frame can come with its correct
-- ending and two wrong ones, so new words start with recognizing the meaning before writing it.
-- From enrichment prompt enrich-v8.

-- One entry per frame, in the same order; null where a frame has no usable choice.
alter table public.senses
  add column frame_choices jsonb check (
    frame_choices is null or jsonb_typeof(frame_choices) = 'array'
  );

alter table public.attempts
  drop constraint attempts_task_type_check,
  add constraint attempts_task_type_check check (task_type in ('choice', 'pick', 'frame', 'scenario', 'open'));

-- Same as before, plus frame_choices.
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
    frames, frame_choices, scenarios, hint_partners, hint_example, hint_starter, usage_choice, model, prompt_version
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

-- Re-enrich senses made before enrich-v8. Cards keep their schedule: the capture keeps its card,
-- and the trigger only creates one for captures that have none.
update public.captures c
set enrichment_status = 'pending', enrichment_attempts = 0, enrichment_error = null
from public.senses s
where s.id = c.sense_id and s.frame_choices is null;
