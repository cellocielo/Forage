import { assert, assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import { Rating, State } from 'ts-fsrs';
import type { CardRow } from '../_shared/scheduling.ts';
import {
  buildUserMessage,
  type CardToGrade,
  fillFrame,
  type GradeDeps,
  gradeAttempt,
  GradeRequestSchema,
  GradingRefusedError,
  generateVerdict,
  type PracticeSense,
  taskFor,
  type Verdict,
} from './grade.ts';

const NOW = new Date('2026-11-03T09:00:00.000Z');

const SENSE: PracticeSense = {
  id: 'sense-1',
  lemma: 'egregious',
  part_of_speech: 'adjective',
  definition: 'Shockingly bad.',
  frames: ["The judge's ruling was so egregious that ___.", 'Before the test, I checked ___ on Wikipedia.'],
  scenarios: [
    { register: 'formal', situation: 'Email the league office about a bad call.' },
    { register: 'informal', situation: 'Text your roommate about the repair bill.' },
  ],
};

const NEW_CARD: CardRow = {
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

const CARD: CardToGrade = { ...NEW_CARD, id: 'card-1', archived_at: null, sense: SENSE };

const VERDICT: Verdict = {
  sense: 'correct',
  grammar: 'correct',
  collocation: 'natural',
  tone: 'not_applicable',
  corrected_sentence: "The judge's ruling was so egregious that the crowd booed.",
  rationale: 'You show the ruling was shockingly bad by the crowd reacting to it.',
  score: 4,
};

const REQUEST = {
  card_id: '00000000-0000-4000-8000-000000000001',
  task_type: 'frame' as const,
  prompt_index: 0,
  answer: 'the crowd booed.',
  hints_used: 0,
};

function fakeDeps(overrides: Partial<GradeDeps> = {}) {
  const recorded: Array<Parameters<GradeDeps['record']>> = [];
  const verdicts: Array<Parameters<GradeDeps['verdict']>> = [];
  const deps: GradeDeps = {
    loadCard: () => Promise.resolve(CARD),
    verdict: (...args) => {
      verdicts.push(args);
      return Promise.resolve(VERDICT);
    },
    record: (...args) => {
      recorded.push(args);
      return Promise.resolve('attempt-1');
    },
    now: () => NOW,
    ...overrides,
  };
  return { deps, recorded, verdicts };
}

Deno.test('fillFrame puts the answer in an ending blank and keeps its punctuation once', () => {
  assertEquals(
    fillFrame("The judge's ruling was so egregious that ___.", 'the crowd booed.'),
    "The judge's ruling was so egregious that the crowd booed.",
  );
});

Deno.test('fillFrame puts the answer in a middle blank without its closing punctuation', () => {
  assertEquals(
    fillFrame('Before the test, I checked ___ on Wikipedia.', '  the dates of the war. '),
    'Before the test, I checked the dates of the war on Wikipedia.',
  );
});

Deno.test('taskFor rebuilds the prompt the learner saw, and rejects unknown ones', () => {
  assertEquals(taskFor(SENSE, 'frame', 1), { type: 'frame', prompt: SENSE.frames![1]! });
  assertEquals(taskFor(SENSE, 'scenario', 0), {
    type: 'scenario',
    prompt: 'Email the league office about a bad call.',
    register: 'formal',
  });
  assertEquals(taskFor(SENSE, 'open', 0), { type: 'open', prompt: 'Write a sentence using "egregious".' });
  assertEquals(taskFor(SENSE, 'frame', 2), null);
  assertEquals(taskFor({ ...SENSE, frames: null }, 'frame', 0), null);
  assertEquals(taskFor(SENSE, 'open', 1), null);
});

Deno.test('the request schema trims answers and rejects empty or oversized ones', () => {
  assertEquals(GradeRequestSchema.parse({ ...REQUEST, answer: '  hi  ' }).answer, 'hi');
  assert(!GradeRequestSchema.safeParse({ ...REQUEST, answer: '   ' }).success);
  assert(!GradeRequestSchema.safeParse({ ...REQUEST, answer: 'x'.repeat(501) }).success);
  assert(!GradeRequestSchema.safeParse({ ...REQUEST, hints_used: 4 }).success);
  assert(!GradeRequestSchema.safeParse({ ...REQUEST, card_id: 'nope' }).success);
});

Deno.test('buildUserMessage includes the learner part only for frames, and the register for scenarios', () => {
  const frame = buildUserMessage(SENSE, taskFor(SENSE, 'frame', 0)!, 'the crowd booed', 'full sentence');
  assertStringIncludes(frame, '<learner_part>the crowd booed</learner_part>');
  assertStringIncludes(frame, '<meaning>Shockingly bad.</meaning>');

  const scenario = buildUserMessage(SENSE, taskFor(SENSE, 'scenario', 1)!, 'yo', 'yo');
  assertStringIncludes(scenario, '<task type="scenario" register="informal">');
  assert(!scenario.includes('<learner_part>'));
});

Deno.test('gradeAttempt grades the filled frame, schedules the card, and records the attempt', async () => {
  const { deps, recorded, verdicts } = fakeDeps();

  const outcome = await gradeAttempt(REQUEST, deps);

  assert(outcome.ok);
  assertEquals(outcome.sentence, "The judge's ruling was so egregious that the crowd booed.");
  assertEquals(outcome.rating, Rating.Easy);
  assert(new Date(outcome.due) > NOW);
  assertEquals(verdicts[0]![3], outcome.sentence);

  const [card, newCard, attempt] = recorded[0]!;
  assertEquals(card.reps, 0);
  assertEquals(newCard.reps, 1);
  assertEquals(newCard.last_review, NOW.toISOString());
  assertEquals(attempt.answer, 'the crowd booed.');
  assertEquals(attempt.prompt, SENSE.frames![0]);
  assertEquals(attempt.sense_id, 'sense-1');
});

Deno.test('gradeAttempt applies the hint cap to the rating but keeps the score', async () => {
  const { deps } = fakeDeps();

  const outcome = await gradeAttempt({ ...REQUEST, hints_used: 3 }, deps);

  assert(outcome.ok);
  assertEquals(outcome.score, 4);
  assertEquals(outcome.rating, Rating.Hard);
});

Deno.test('gradeAttempt refuses cards that are missing, archived, not due, or prompts that do not exist', async () => {
  const cases: Array<[Partial<GradeDeps>, typeof REQUEST, number]> = [
    [{ loadCard: () => Promise.resolve(null) }, REQUEST, 404],
    [{ loadCard: () => Promise.resolve({ ...CARD, sense: null }) }, REQUEST, 404],
    [{ loadCard: () => Promise.resolve({ ...CARD, archived_at: NOW.toISOString() }) }, REQUEST, 409],
    [{ loadCard: () => Promise.resolve({ ...CARD, due: '2026-11-05T00:00:00.000Z' }) }, REQUEST, 409],
    [{}, { ...REQUEST, prompt_index: 2 }, 400],
  ];
  for (const [overrides, request, status] of cases) {
    const { deps, verdicts, recorded } = fakeDeps(overrides);
    const outcome = await gradeAttempt(request, deps);
    assertEquals(outcome.ok ? 200 : outcome.status, status);
    assertEquals(verdicts.length, 0, 'no model call for a refused request');
    assertEquals(recorded.length, 0);
  }
});

Deno.test('gradeAttempt reports a conflict when the card changed before recording', async () => {
  const { deps } = fakeDeps({ record: () => Promise.resolve(null) });
  const outcome = await gradeAttempt(REQUEST, deps);
  assertEquals(outcome.ok ? 200 : outcome.status, 409);
});

// deno-lint-ignore no-explicit-any
function fakeClient(response: Record<string, unknown>, calls: any[] = []) {
  return {
    messages: {
      parse: (params: unknown) => {
        calls.push(params);
        return Promise.resolve(response);
      },
    },
  } as unknown as Parameters<typeof generateVerdict>[0];
}

Deno.test('generateVerdict sends low effort, no sampling params, and returns the parsed verdict', async () => {
  // deno-lint-ignore no-explicit-any
  const calls: any[] = [];
  const client = fakeClient({ stop_reason: 'end_turn', parsed_output: VERDICT }, calls);

  const verdict = await generateVerdict(client, 'claude-haiku-5-5', SENSE, taskFor(SENSE, 'open', 0)!, 'x', 'x');

  assertEquals(verdict, VERDICT);
  assertEquals(calls[0].model, 'claude-haiku-5-5');
  assertEquals(calls[0].output_config.effort, 'low');
  assertEquals(calls[0].temperature, undefined);
});

Deno.test('generateVerdict handles refusals, truncation, schema misses, and bad scores', async () => {
  const task = taskFor(SENSE, 'open', 0)!;
  const run = (response: Record<string, unknown>) =>
    generateVerdict(fakeClient(response), 'm', SENSE, task, 'x', 'x');

  await assertRejects(() => run({ stop_reason: 'refusal', parsed_output: null }), GradingRefusedError);
  await assertRejects(() => run({ stop_reason: 'max_tokens', parsed_output: null }), Error, 'cut off');
  await assertRejects(() => run({ stop_reason: 'end_turn', parsed_output: null }), Error, 'schema');
  await assertRejects(() => run({ stop_reason: 'end_turn', parsed_output: { ...VERDICT, score: 5 } }), Error, 'out-of-range');
});
