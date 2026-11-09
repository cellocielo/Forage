-- Practice additions: the "choose the correct usage" task (PRD P8c), "Easier, please" (P12),
-- and grade disputes with a second opinion from a stronger model (G3).

alter table public.attempts
  drop constraint attempts_task_type_check,
  add constraint attempts_task_type_check check (task_type in ('choice', 'frame', 'scenario', 'open')),
  -- The learner asked for an easier task than the card's scaffold level.
  add column easier boolean not null default false,
  -- The card's FSRS state before this review, so a dispute can redo the review with a new rating.
  add column card_before jsonb,
  -- G3: the second opinion and what it changed. disputed_at (already present) marks the case.
  add column dispute_verdict jsonb,
  add column dispute_score smallint check (dispute_score between 1 and 4),
  add column dispute_rating smallint check (dispute_rating between 1 and 4),
  add column dispute_model text,
  add column dispute_rescheduled boolean;

create index attempts_disputed_idx on public.attempts (disputed_at desc) where disputed_at is not null;

-- Same as before, plus card_before (read under the row lock) and the easier flag.
create or replace function public.record_attempt(
  p_user_id       uuid,
  p_card_id       uuid,
  p_expected_reps integer,
  p_card          jsonb,
  p_attempt       jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_before     jsonb;
  v_attempt_id uuid;
begin
  select jsonb_build_object(
           'due', c.due, 'stability', c.stability, 'difficulty', c.difficulty,
           'scheduled_days', c.scheduled_days, 'learning_steps', c.learning_steps,
           'reps', c.reps, 'lapses', c.lapses, 'state', c.state, 'last_review', c.last_review
         )
  into v_before
  from public.cards c
  where c.id = p_card_id
    and c.user_id = p_user_id
    and c.reps = p_expected_reps
    and c.archived_at is null
  for update;

  if v_before is null then
    return null;
  end if;

  update public.cards
  set due            = (p_card ->> 'due')::timestamptz,
      stability      = (p_card ->> 'stability')::double precision,
      difficulty     = (p_card ->> 'difficulty')::double precision,
      scheduled_days = (p_card ->> 'scheduled_days')::integer,
      learning_steps = (p_card ->> 'learning_steps')::integer,
      reps           = (p_card ->> 'reps')::integer,
      lapses         = (p_card ->> 'lapses')::integer,
      state          = (p_card ->> 'state')::smallint,
      last_review    = (p_card ->> 'last_review')::timestamptz
  where id = p_card_id;

  insert into public.attempts (
    user_id, card_id, sense_id, task_type, prompt, answer, sentence, hints_used, surface, easier,
    verdict, score, rating, review, card_before, model, prompt_version
  )
  values (
    p_user_id,
    p_card_id,
    (p_attempt ->> 'sense_id')::uuid,
    p_attempt ->> 'task_type',
    p_attempt ->> 'prompt',
    p_attempt ->> 'answer',
    p_attempt ->> 'sentence',
    (p_attempt ->> 'hints_used')::smallint,
    coalesce(p_attempt ->> 'surface', 'badge'),
    coalesce((p_attempt ->> 'easier')::boolean, false),
    p_attempt -> 'verdict',
    (p_attempt ->> 'score')::smallint,
    (p_attempt ->> 'rating')::smallint,
    p_attempt -> 'review',
    v_before,
    p_attempt ->> 'model',
    p_attempt ->> 'prompt_version'
  )
  returning id into v_attempt_id;

  return v_attempt_id;
end;
$$;

-- Logs a dispute's second opinion and, when given a new schedule, applies it. The schedule is
-- applied only if the card hasn't been reviewed since the disputed attempt (p_expected_reps);
-- otherwise the dispute is still logged. Returns null if the attempt was already disputed or
-- isn't the user's, else whether the card was rescheduled.
create function public.resolve_dispute(
  p_user_id       uuid,
  p_attempt_id    uuid,
  p_verdict       jsonb,
  p_score         smallint,
  p_rating        smallint,
  p_model         text,
  p_card          jsonb,
  p_expected_reps integer
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_card_id     uuid;
  v_rescheduled boolean := false;
begin
  select a.card_id into v_card_id
  from public.attempts a
  where a.id = p_attempt_id and a.user_id = p_user_id and a.disputed_at is null
  for update;

  if v_card_id is null then
    return null;
  end if;

  if p_card is not null then
    update public.cards
    set due            = (p_card ->> 'due')::timestamptz,
        stability      = (p_card ->> 'stability')::double precision,
        difficulty     = (p_card ->> 'difficulty')::double precision,
        scheduled_days = (p_card ->> 'scheduled_days')::integer,
        learning_steps = (p_card ->> 'learning_steps')::integer,
        reps           = (p_card ->> 'reps')::integer,
        lapses         = (p_card ->> 'lapses')::integer,
        state          = (p_card ->> 'state')::smallint,
        last_review    = (p_card ->> 'last_review')::timestamptz
    where id = v_card_id
      and user_id = p_user_id
      and reps = p_expected_reps
      and archived_at is null;
    v_rescheduled := found;
  end if;

  update public.attempts
  set disputed_at         = now(),
      dispute_verdict     = p_verdict,
      dispute_score       = p_score,
      dispute_rating      = p_rating,
      dispute_model       = p_model,
      dispute_rescheduled = v_rescheduled
  where id = p_attempt_id;

  return v_rescheduled;
end;
$$;

revoke execute on function public.resolve_dispute(uuid, uuid, jsonb, smallint, smallint, text, jsonb, integer)
  from public, anon, authenticated;
