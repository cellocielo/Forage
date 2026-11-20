import { assert, assertEquals } from '@std/assert';
import { Rating, State } from 'ts-fsrs';
import { type CardRow, reviewCard } from '../_shared/scheduling.ts';
import type { PracticeSense, Verdict } from '../grade-attempt/grade.ts';
import { type AttemptToDispute, choiceQuestion, type DisputeDeps, disputeAttempt, taskForAttempt } from './dispute.ts';

const REVIEWED_AT = '2026-11-03T09:00:00.000Z';

const SENSE: PracticeSense = {
  id: 'sense-1',
  lemma: 'egregious',
  part_of_speech: 'adjective',
  definition: 'Shockingly bad.',
  frames: ['It was so egregious that ___.'],
  scenarios: [{ register: 'formal', situation: 'Email the league office.' }],
  usage_choices: [
    {
      correct: 'The referee made an egregious error.',
      incorrect: 'The referee made an egregious call that delighted everyone.',
      mistake: 'Egregious means shockingly bad.',
    },
  ],
  frame_choices: [{ answer: 'I left', wrong: ['I cheered', 'I clapped'], why: 'Bad things make you leave.' }],
};

const BEFORE: CardRow = {
  due: '2026-11-02T09:00:00.000Z',
  stability: 0,
  difficulty: 0,
  scheduled_days: 0,
  learning_steps: 0,
  reps: 0,
  lapses: 0,
  state: State.New,
  last_review: null,
};

const ATTEMPT: AttemptToDispute = {
  id: 'attempt-1',
  card_id: 'card-1',
  task_type: 'scenario',
  prompt: 'Email the league office.',
  answer: 'The call was egregious.',
  sentence: 'The call was egregious.',
  hints_used: 0,
  rating: Rating.Hard,
  reviewed_at: REVIEWED_AT,
  disputed_at: null,
  card_before: BEFORE,
  sense: SENSE,
};

const verdict = (score: number): Verdict => ({
  sense: 'correct',
  grammar: 'correct',
  collocation: 'natural',
  tone: 'fits',
  corrected_sentence: 'The call was egregious.',
  rationale: 'Clear and fitting.',
  score,
  unsure: false,
});

function fakeDeps({
  attempt = ATTEMPT as AttemptToDispute | null,
  score = 4,
  cardReps = 1 as number | null,
  pickIsCorrect = true,
} = {}) {
  const resolved: Array<Parameters<DisputeDeps['resolve']>> = [];
  const opinions: Array<unknown[]> = [];
  const retired: Array<Parameters<DisputeDeps['retireQuestion']>> = [];
  const deps: DisputeDeps = {
    reviewChoice: (...args) => {
      opinions.push(args);
      return Promise.resolve({ picked_is_correct: pickIsCorrect, reason: 'Checked.' });
    },
    retireQuestion: (...args) => {
      retired.push(args);
      return Promise.resolve();
    },
    loadAttempt: () => Promise.resolve(attempt),
    loadCardReps: () => Promise.resolve(cardReps),
    secondOpinion: (...args) => {
      opinions.push(args);
      return Promise.resolve(verdict(score));
    },
    resolve: (...args) => {
      resolved.push(args);
      return Promise.resolve(args[3] !== null);
    },
  };
  return { deps, resolved, opinions, retired };
}

const REQUEST = { attempt_id: '00000000-0000-4000-8000-000000000001' };

Deno.test('taskForAttempt restores the scenario register from the sense', () => {
  assertEquals(taskForAttempt(ATTEMPT, SENSE), { type: 'scenario', prompt: 'Email the league office.', register: 'formal' });
  assertEquals(taskForAttempt({ ...ATTEMPT, task_type: 'open', prompt: 'Write.' }, SENSE), { type: 'open', prompt: 'Write.' });
});

Deno.test('a higher second opinion redoes the review from the card before it, at the original time', async () => {
  const { deps, resolved, opinions } = fakeDeps({ score: 4 });

  const outcome = await disputeAttempt(REQUEST, deps);

  assert(outcome.ok);
  assertEquals([outcome.rating, outcome.changed, outcome.rescheduled], [Rating.Easy, true, true]);
  const expected = reviewCard(BEFORE, Rating.Easy, new Date(REVIEWED_AT)).card;
  assertEquals(outcome.due, expected.due);
  const [, , rating, newCard, expectedReps] = resolved[0]!;
  assertEquals([rating, newCard, expectedReps], [Rating.Easy, expected, 1]);
  assertEquals((opinions[0]![1] as { register?: string }).register, 'formal');
});

Deno.test('a second opinion that agrees logs the dispute without rescheduling', async () => {
  const { deps, resolved } = fakeDeps({ score: 2 });

  const outcome = await disputeAttempt(REQUEST, deps);

  assert(outcome.ok);
  assertEquals([outcome.changed, outcome.rescheduled, outcome.due], [false, false, null]);
  assertEquals([resolved[0]![3], resolved[0]![4]], [null, null]);
});

Deno.test('the second opinion still applies the hint cap', async () => {
  const { deps } = fakeDeps({ attempt: { ...ATTEMPT, hints_used: 3 }, score: 4 });
  const outcome = await disputeAttempt(REQUEST, deps);
  assert(outcome.ok);
  assertEquals([outcome.rating, outcome.changed], [Rating.Hard, false]);
});

Deno.test('a changed grade is logged but not applied if the card was reviewed again since', async () => {
  const { deps, resolved } = fakeDeps({ score: 4, cardReps: 2 });

  const outcome = await disputeAttempt(REQUEST, deps);

  assert(outcome.ok);
  assertEquals([outcome.changed, outcome.rescheduled], [true, false]);
  assertEquals(resolved[0]![3], null);
});

Deno.test('disputes are refused for missing, already disputed, already right, or retired questions, without a model call', async () => {
  const cases: Array<[AttemptToDispute | null, number]> = [
    [null, 404],
    [{ ...ATTEMPT, sense: null }, 404],
    [{ ...ATTEMPT, disputed_at: REVIEWED_AT }, 409],
    [{ ...ATTEMPT, task_type: 'choice', rating: Rating.Good }, 400],
    [{ ...ATTEMPT, task_type: 'choice', rating: Rating.Again, sense: { ...SENSE, usage_choices: [null] } }, 409],
  ];
  for (const [attempt, status] of cases) {
    const { deps, opinions } = fakeDeps({ attempt });
    const outcome = await disputeAttempt(REQUEST, deps);
    assertEquals(outcome.ok ? 200 : outcome.status, status);
    assertEquals(opinions.length, 0);
  }
});

Deno.test('a dispute that loses the race to another dispute reports a conflict', async () => {
  const { deps } = fakeDeps();
  deps.resolve = () => Promise.resolve(null);
  const outcome = await disputeAttempt(REQUEST, deps);
  assertEquals(outcome.ok ? 200 : outcome.status, 409);
});

const WRONG_CHOICE: AttemptToDispute = {
  ...ATTEMPT,
  task_type: 'choice',
  prompt: 'Which sentence uses "egregious" correctly?',
  answer: SENSE.usage_choices![0]!.incorrect,
  sentence: SENSE.usage_choices![0]!.incorrect,
  rating: Rating.Again,
};

Deno.test('a disputed choice that holds up counts as right, reschedules, and retires the question', async () => {
  const { deps, resolved, opinions, retired } = fakeDeps({ attempt: WRONG_CHOICE });

  const outcome = await disputeAttempt(REQUEST, deps);

  assert(outcome.ok);
  assertEquals([outcome.rating, outcome.changed, outcome.rescheduled], [Rating.Good, true, true]);
  assertEquals(opinions[0]!.slice(2), [
    [SENSE.usage_choices![0]!.correct, SENSE.usage_choices![0]!.incorrect],
    SENSE.usage_choices![0]!.correct,
    SENSE.usage_choices![0]!.incorrect,
  ]);
  assertEquals(resolved[0]![3], reviewCard(BEFORE, Rating.Good, new Date(REVIEWED_AT)).card);
  assertEquals(retired, [['sense-1', 'choice', 0]]);
});

Deno.test('a disputed choice that does not hold up stays wrong and keeps the question', async () => {
  const { deps, resolved, retired } = fakeDeps({ attempt: WRONG_CHOICE, pickIsCorrect: false });

  const outcome = await disputeAttempt(REQUEST, deps);

  assert(outcome.ok);
  assertEquals([outcome.rating, outcome.changed, outcome.verdict.corrected_sentence], [Rating.Again, false, SENSE.usage_choices![0]!.correct]);
  assertEquals(resolved[0]![3], null);
  assertEquals(retired.length, 0);
});

Deno.test('a disputed pick is judged as full sentences and retires only that frame', async () => {
  const attempt: AttemptToDispute = {
    ...ATTEMPT,
    task_type: 'pick',
    prompt: SENSE.frames![0]!,
    answer: 'I cheered',
    sentence: 'It was so egregious that I cheered.',
    rating: Rating.Again,
  };
  const { deps, opinions, retired } = fakeDeps({ attempt });

  await disputeAttempt(REQUEST, deps);

  assertEquals(opinions[0]![2], [
    'It was so egregious that I left.',
    'It was so egregious that I cheered.',
    'It was so egregious that I clapped.',
  ]);
  assertEquals(retired, [['sense-1', 'pick', 0]]);
});

Deno.test('choiceQuestion finds the pair the picked sentence came from', () => {
  const second = { correct: 'The fee was egregious.', incorrect: 'The egregious gift made her smile.', mistake: 'Egregious is bad.' };
  const sense = { ...SENSE, usage_choices: [null, second] };
  const attempt = { ...WRONG_CHOICE, answer: second.incorrect, sentence: second.incorrect };

  assertEquals(choiceQuestion(attempt, sense), { index: 1, options: [second.correct, second.incorrect], keyed: second.correct });
  assertEquals(choiceQuestion(WRONG_CHOICE, sense), null);
});
