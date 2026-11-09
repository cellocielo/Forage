-- Graded practice attempts (PRD P1, P8-P11, G1) and the transaction that records one
-- together with the card's new FSRS schedule (S2).

create table public.attempts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  card_id        uuid not null references public.cards (id) on delete cascade,
  sense_id       uuid references public.senses (id) on delete set null,

  -- What the learner saw and wrote. For a frame, `answer` is only the part they typed and
  -- `sentence` is the frame with it filled in; otherwise the two are the same.
  task_type      text not null check (task_type in ('frame', 'scenario', 'open')),
  prompt         text not null check (char_length(prompt) <= 1000),
  answer         text not null check (char_length(answer) between 1 and 1000),
  sentence       text not null check (char_length(sentence) <= 2000),
  hints_used     smallint not null default 0 check (hints_used between 0 and 3),
  surface        text not null default 'badge' check (surface in ('badge', 'end_of_reading', 'corner', 'new_tab')),

  -- The grader's structured verdict (G1), its score, and the FSRS rating after the hint cap (P11).
  verdict        jsonb not null,
  score          smallint not null check (score between 1 and 4),
  rating         smallint not null check (rating between 1 and 4),
  -- ts-fsrs review log for this attempt: state, stability, difficulty and due before the review.
  review         jsonb not null,
  model          text not null,
  prompt_version text not null,

  disputed_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index attempts_user_created_idx on public.attempts (user_id, created_at desc);
create index attempts_card_created_idx on public.attempts (card_id, created_at desc);

alter table public.attempts enable row level security;

create policy "Users can read their own attempts"
  on public.attempts for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Only the grade-attempt Edge Function writes attempts, through record_attempt below.
revoke all on public.attempts from anon, authenticated;
grant select on public.attempts to authenticated;

-- Applies a review: moves the card to its new schedule and logs the attempt, atomically.
-- p_expected_reps guards against a double submit or two tabs grading the same card: if the
-- card was reviewed since it was read, nothing is written and the function returns null.
create function public.record_attempt(
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
  v_attempt_id uuid;
begin
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
  where id = p_card_id
    and user_id = p_user_id
    and reps = p_expected_reps
    and archived_at is null;

  if not found then
    return null;
  end if;

  insert into public.attempts (
    user_id, card_id, sense_id, task_type, prompt, answer, sentence, hints_used, surface,
    verdict, score, rating, review, model, prompt_version
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
    p_attempt -> 'verdict',
    (p_attempt ->> 'score')::smallint,
    (p_attempt ->> 'rating')::smallint,
    p_attempt -> 'review',
    p_attempt ->> 'model',
    p_attempt ->> 'prompt_version'
  )
  returning id into v_attempt_id;

  return v_attempt_id;
end;
$$;

revoke execute on function public.record_attempt(uuid, uuid, integer, jsonb, jsonb) from public, anon, authenticated;
