import { assert, assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import { Rating, State } from 'ts-fsrs';
import type { CardRow } from '../_shared/scheduling.ts';
import {
  buildUserMessage,
  type CardToGrade,
  choiceVerdict,
  pickVerdict,
  fillFrame,
  generateSecondOpinion,
  type GradeDeps,
  type GradeRequest,
  gradeAttempt,
  GradeRequestSchema,
  GradingRefusedError,
  generateVerdict,
  needsSecondLook,
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
  usage_choices: [
    {
      correct: 'The referee made an egregious error.',
      incorrect: 'She gave an egregious speech that everyone loved.',
      mistake: '"Egregious" means shockingly bad, so it cannot praise a speech.',
    },
  ],
  frame_choices: [
    { answer: 'the crowd booed', wrong: ['everyone cheered', 'the fans thanked him'], why: 'Egregious means shockingly bad.' },
    null,
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
  unsure: false,
};

const REQUEST: GradeRequest = {
  card_id: '00000000-0000-4000-8000-000000000001',
  task_type: 'frame',
  prompt_index: 0,
  answer: 'the crowd booed.',
  hints_used: 0,
  easier: false,
  extra: false,
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

Deno.test('needsSecondLook flags low and unsure grades only', () => {
  assertEquals(needsSecondLook(VERDICT), false);
  assertEquals(needsSecondLook({ ...VERDICT, score: 3 }), false);
  assertEquals(needsSecondLook({ ...VERDICT, score: 2 }), true);
  assertEquals(needsSecondLook({ ...VERDICT, score: 1 }), true);
  assertEquals(needsSecondLook({ ...VERDICT, unsure: true }), true);
});

Deno.test('gradeAttempt has a low grade checked by the stronger model before showing it', async () => {
  const checked = { ...VERDICT, score: 3, rationale: 'Checked.' };
  const looks: unknown[] = [];
  const { deps, recorded } = fakeDeps({
    verdict: () => Promise.resolve({ ...VERDICT, score: 1 }),
    secondLook: (...args) => {
      looks.push(args);
      return Promise.resolve(checked);
    },
  });

  const outcome = await gradeAttempt(REQUEST, deps);

  assertEquals(looks.length, 1);
  assertEquals(outcome.ok && outcome.verdict, checked);
  assertEquals(recorded[0]![2].second_look, true);
  assertEquals(recorded[0]![2].score, 3);
});

Deno.test('gradeAttempt skips the second look for a confident good grade and for multiple choice', async () => {
  let looked = false;
  const secondLook = () => {
    looked = true;
    return Promise.resolve(VERDICT);
  };
  const { deps, recorded } = fakeDeps({ secondLook });
  await gradeAttempt(REQUEST, deps);
  // A wrong multiple-choice pick is checked against its answer key, not graded by a model.
  await gradeAttempt({ ...REQUEST, task_type: 'choice', answer: SENSE.usage_choices![0]!.incorrect }, deps);
  assertEquals(looked, false);
  assertEquals(recorded[0]![2].second_look, false);
  assertEquals(recorded[1]![2].score, 1);
});

Deno.test('gradeAttempt keeps the first grade when the second look fails', async () => {
  const low = { ...VERDICT, score: 2 };
  const { deps, recorded } = fakeDeps({
    verdict: () => Promise.resolve(low),
    secondLook: () => Promise.reject(new Error('overloaded')),
  });
  const outcome = await gradeAttempt(REQUEST, deps);
  assertEquals(outcome.ok && outcome.verdict, low);
  assertEquals(recorded[0]![2].second_look, false);
});

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

Deno.test('taskFor offers a choice task only when the sense has a usage pair', () => {
  assertEquals(taskFor(SENSE, 'choice', 0), { type: 'choice', prompt: 'Which sentence uses "egregious" correctly?' });
  assertEquals(taskFor({ ...SENSE, usage_choices: [null] }, 'choice', 0), null);
  assertEquals(taskFor(SENSE, 'choice', 1), null);
  const second = { correct: 'The fee was egregious.', incorrect: 'The egregious gift made her smile.', mistake: 'Egregious is bad.' };
  assertEquals(taskFor({ ...SENSE, usage_choices: [null, second] }, 'choice', 1)?.type, 'choice');
  assertEquals(taskFor(SENSE, 'choice', 1), null);
});

Deno.test('choiceVerdict scores the correct pick Good and the other Again, explaining the mistake', () => {
  const right = choiceVerdict(SENSE.usage_choices![0]!, SENSE.usage_choices![0]!.correct)!;
  assertEquals([right.score, right.sense, right.rationale], [3, 'correct', SENSE.usage_choices![0]!.mistake]);
  const wrong = choiceVerdict(SENSE.usage_choices![0]!, SENSE.usage_choices![0]!.incorrect)!;
  assertEquals([wrong.score, wrong.sense, wrong.corrected_sentence], [1, 'wrong', SENSE.usage_choices![0]!.correct]);
  assertEquals(choiceVerdict(SENSE.usage_choices![0]!, 'Something else.'), null);
});

Deno.test('gradeAttempt grades a choice without calling the model and ignores hints', async () => {
  const { deps, verdicts, recorded } = fakeDeps();

  const outcome = await gradeAttempt(
    { ...REQUEST, task_type: 'choice', answer: SENSE.usage_choices![0]!.correct, hints_used: 3 },
    deps,
  );

  assert(outcome.ok);
  assertEquals(outcome.rating, Rating.Good);
  assertEquals(verdicts.length, 0);
  assertEquals(recorded[0]![2].hints_used, 0);
  assertEquals(recorded[0]![2].sentence, SENSE.usage_choices![0]!.correct);
});

Deno.test('gradeAttempt rejects a choice that is neither sentence', async () => {
  const { deps, recorded } = fakeDeps();
  const outcome = await gradeAttempt({ ...REQUEST, task_type: 'choice', answer: 'Made up.' }, deps);
  assertEquals(outcome.ok ? 200 : outcome.status, 400);
  assertEquals(recorded.length, 0);
});

Deno.test('gradeAttempt records whether the learner asked for an easier task', async () => {
  const { deps, recorded } = fakeDeps();
  await gradeAttempt(GradeRequestSchema.parse({ ...REQUEST, easier: true }), deps);
  assertEquals(recorded[0]![2].easier, true);
  assertEquals(GradeRequestSchema.parse(REQUEST).easier, false);
});

Deno.test('generateSecondOpinion uses the beta API with default fallbacks and a fresh-grade note', async () => {
  // deno-lint-ignore no-explicit-any
  const calls: any[] = [];
  const client = {
    beta: {
      messages: {
        parse: (params: unknown) => {
          calls.push(params);
          return Promise.resolve({ stop_reason: 'end_turn', parsed_output: VERDICT });
        },
      },
    },
  } as unknown as Parameters<typeof generateSecondOpinion>[0];

  const verdict = await generateSecondOpinion(client, 'claude-opus-5-5', SENSE, taskFor(SENSE, 'open', 0)!, 'x', 'x');

  assertEquals(verdict, VERDICT);
  assertEquals(calls[0].model, 'claude-opus-5-5');
  assertEquals(calls[0].fallbacks, 'default');
  assertEquals(calls[0].betas, ['server-side-fallback-2026-07-01']);
  assertEquals(calls[0].output_config.effort, 'medium');
  assertStringIncludes(calls[0].system, 'the learner disagreed');

  await generateSecondOpinion(client, 'claude-opus-5-5', SENSE, taskFor(SENSE, 'open', 0)!, 'x', 'x', 'check');
  assertEquals(calls[1].output_config.effort, 'low');
  assertStringIncludes(calls[1].system, 'before the learner sees a grade');
});

Deno.test('taskFor offers a pick only for frames that have a choice', () => {
  assertEquals(taskFor(SENSE, 'pick', 0), { type: 'pick', prompt: SENSE.frames![0]! });
  assertEquals(taskFor(SENSE, 'pick', 1), null);
  assertEquals(taskFor({ ...SENSE, frame_choices: null }, 'pick', 0), null);
});

Deno.test('pickVerdict fills the frame with the right ending and explains it', () => {
  const choice = SENSE.frame_choices![0]!;
  const right = pickVerdict(SENSE.frames![0]!, choice, 'the crowd booed')!;
  assertEquals([right.score, right.rationale], [3, choice.why]);
  assertEquals(right.corrected_sentence, "The judge's ruling was so egregious that the crowd booed.");
  assertEquals(pickVerdict(SENSE.frames![0]!, choice, 'everyone cheered')!.score, 1);
  assertEquals(pickVerdict(SENSE.frames![0]!, choice, 'made up'), null);
});

Deno.test('gradeAttempt grades a pick without the model, recording the filled sentence', async () => {
  const { deps, verdicts, recorded } = fakeDeps();

  const outcome = await gradeAttempt({ ...REQUEST, task_type: 'pick', answer: 'everyone cheered', hints_used: 2 }, deps);

  assert(outcome.ok);
  assertEquals(outcome.rating, Rating.Again);
  assertEquals(verdicts.length, 0);
  assertEquals(recorded[0]![2].hints_used, 0);
  assertEquals(recorded[0]![2].sentence, "The judge's ruling was so egregious that everyone cheered.");
  assertEquals(outcome.verdict.corrected_sentence, "The judge's ruling was so egregious that the crowd booed.");
});

Deno.test('gradeAttempt accepts a word that is not due yet as extra practice', async () => {
  const { deps } = fakeDeps({ loadCard: () => Promise.resolve({ ...CARD, due: '2026-11-05T00:00:00.000Z' }) });
  const outcome = await gradeAttempt({ ...REQUEST, extra: true }, deps);
  assert(outcome.ok);
});
