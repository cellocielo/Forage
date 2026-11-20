-- More context for the meaning: the sentence before the saved one, for sentences that point back
-- ("This approach..."), and the page title (already saved) now goes to the model too.

alter table public.captures
  add column previous_sentence text check (char_length(previous_sentence) <= 2000);

-- Whether the meaning leaned on the previous sentence, so it's shown with the saved one.
-- On the sense, like the meaning itself: a cached sense is reused for the same sentence.
alter table public.senses
  add column uses_previous_sentence boolean not null default false;

-- Same as before, plus uses_previous_sentence.
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
    other_meanings, uses_previous_sentence, model, prompt_version
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
    coalesce((p_enrichment ->> 'uses_previous_sentence')::boolean, false),
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

