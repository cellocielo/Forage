-- Saving a word you already have:
--   same word, same sentence, minutes apart  -> ignored ("Already saved")
--   same word, same meaning, new sentence    -> joins the existing card as another example,
--                                               which comes up for practice a little sooner
--   same word, a different meaning           -> a new card for that meaning
--   same meaning, but mastered or archived   -> back into practice, at a harder level
-- Enrichment now decides this before a capture is marked done, so the card trigger knows
-- whether to make a new card.

-- The card a capture belongs to. The card's own capture_id is the first one, whose sense
-- it practices; later saves of the same meaning point here too. Deliberately not a foreign
-- key: a second link between cards and captures would make the API's cards -> captures
-- embeds ambiguous. A card is deleted only with its first capture, and the readers below
-- join through cards, so a stale id just matches nothing.
alter table public.captures
  add column card_id uuid,
  add column save_outcome text check (save_outcome in ('new_word', 'new_meaning', 'same_meaning', 'returned', 'duplicate'));

create index captures_card_idx on public.captures (card_id);

update public.captures c
set card_id = k.id
from public.cards k
where k.capture_id = c.id;

-- As before, but no longer marks the capture done: place_capture does that.
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
      enrichment_error = null
  where id = p_capture_id;

  return v_sense_id;
end;
$$;

-- The new capture's meaning, and the user's existing cards for the same word with theirs.
create function public.same_word_cards(p_capture_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    -- Set when re-enriching a capture that already has its card: nothing to place.
    'card_id', c.card_id,
    'sense_id', s.id,
    'part_of_speech', s.part_of_speech,
    'definition', s.definition,
    'cards', coalesce((
      select jsonb_agg(jsonb_build_object(
        'card_id', k.id,
        'sense_id', ks.id,
        'part_of_speech', ks.part_of_speech,
        'definition', ks.definition
      ) order by k.created_at)
      from public.cards k
      join public.captures kc on kc.id = k.capture_id
      join public.senses ks on ks.id = kc.sense_id
      where k.user_id = c.user_id
        and kc.lemma_id = c.lemma_id
        and kc.id <> c.id
    ), '[]'::jsonb)
  )
  from public.captures c
  join public.senses s on s.id = c.sense_id
  where c.id = p_capture_id;
$$;

-- Marks an enriched capture done: either a new card (p_card_id null; the trigger makes it)
-- or another example on the user's existing card for this meaning.
create function public.place_capture(p_capture_id uuid, p_card_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_capture public.captures;
  v_card public.cards;
  v_outcome text;
begin
  select * into v_capture from public.captures where id = p_capture_id;
  if not found then
    return null;
  end if;

  if p_card_id is null then
    v_outcome := case when exists (
      select 1 from public.cards k
      join public.captures kc on kc.id = k.capture_id
      where k.user_id = v_capture.user_id and kc.lemma_id = v_capture.lemma_id and kc.id <> v_capture.id
    ) then 'new_meaning' else 'new_word' end;

    update public.captures
    set enrichment_status = 'done', enrichment_error = null, save_outcome = v_outcome
    where id = p_capture_id;
    return v_outcome;
  end if;

  -- Only ever merge into this user's own card for this word.
  select k.* into v_card
  from public.cards k
  join public.captures kc on kc.id = k.capture_id
  where k.id = p_card_id and k.user_id = v_capture.user_id and kc.lemma_id = v_capture.lemma_id
  for update of k;
  if not found then
    raise exception 'place_capture: card % is not this user''s card for this word', p_card_id;
  end if;

  if exists (
    -- The same sentence saved again within minutes: a double save, so leave the card alone.
    select 1 from public.captures o
    where o.card_id = v_card.id
      and o.id <> v_capture.id
      and o.sentence_hash = v_capture.sentence_hash
      and abs(extract(epoch from o.captured_at - v_capture.captured_at)) < 600
  ) then
    v_outcome := 'duplicate';
  elsif v_card.archived_at is not null or (v_card.state = 2 and v_card.stability >= 21) then
    -- Mastered (strong enough for open prompts) or archived: saving it again means it matters
    -- or isn't as solid as it seemed. Due now, and at most 10 days' stability, which is the
    -- scenario level: harder than a new word, easier than an open prompt.
    v_outcome := 'returned';
    update public.cards
    set due = now(),
        stability = least(stability, 10),
        archived_at = null,
        snoozed_until = null
    where id = v_card.id;
  else
    -- Meeting it again suggests it matters: halve the wait, keeping progress.
    v_outcome := 'same_meaning';
    update public.cards
    set due = now() + (due - now()) / 2
    where id = v_card.id and due > now();
  end if;

  update public.captures
  set enrichment_status = 'done', enrichment_error = null, card_id = v_card.id, save_outcome = v_outcome
  where id = p_capture_id;
  return v_outcome;
end;
$$;

revoke execute on function public.same_word_cards(uuid) from public, anon, authenticated;
revoke execute on function public.place_capture(uuid, uuid) from public, anon, authenticated;

-- New cards only for captures that weren't merged into an existing card.
create or replace function public.create_card_for_capture()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_card_id uuid;
begin
  if new.card_id is not null then
    return new;
  end if;

  insert into public.cards (user_id, capture_id)
  values (new.user_id, new.id)
  on conflict (capture_id) do nothing
  returning id into v_card_id;

  if v_card_id is null then
    select id into v_card_id from public.cards where capture_id = new.id;
  end if;
  -- Only card_id changes, so this doesn't fire the enrichment_status trigger again.
  update public.captures set card_id = v_card_id where id = new.id;
  return new;
end;
$$;
