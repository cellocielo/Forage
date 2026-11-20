import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import {
  buildUserMessage,
  type CaptureToEnrich,
  enrichCapture,
  type EnrichDeps,
  generateMeaning,
  generatePractice,
  type Meaning,
  type Practice,
  type SenseNeedingPractice,
  type SensePractice,
  generateVariety,
  PermanentEnrichmentError,
  sentenceHash,
  toFrame,
  toFrameChoice,
} from './enrich.ts';

/** A frame as the model sends it, with two wrong endings for the multiple-choice version. */
const f = (sentence: string) => ({
  sentence,
  wrong_endings: ['everyone still talks about them', 'it lasted for decades'],
  why: 'Ephemeral means it did not last.',
});

const MEANING: Meaning = {
  lemma: 'ephemeral',
  part_of_speech: 'adjective',
  definition: 'Lasting for a very short time.',
  register: 'formal',
  uses_previous_sentence: false,
  other_meanings: [{ part_of_speech: 'noun', definition: 'A plant that lives for only a short season.' }],
};

// What the practice step sends: frames mark the meaning in [brackets], which generatePractice blanks.
const PRACTICE: Practice = {
  paraphrase: "Something that doesn't last long.",
  examples: ['The fireworks were ephemeral.', 'Her interest in chess was ephemeral.'],
  frames: [
    f('Their fame was ephemeral because [nobody remembered them a year later].'),
    f('The joy of a new phone is ephemeral; [after a week it feels ordinary].'),
  ],
  scenarios: [
    { register: 'neutral', situation: 'Tell a friend why a viral trend faded so fast.' },
    { register: 'formal', situation: 'Write to your manager about a short-lived sales spike.' },
    { register: 'informal', situation: 'Text your sister about a snowman that melted by noon.' },
  ],
  hints: {
    partners: ['ephemeral nature', 'ephemeral beauty', 'purely ephemeral'],
    example: 'Cherry blossoms are ephemeral, lasting only a week.',
    starter: 'Most internet fame is ephemeral, so',
  },
  usage_choices: [
    {
      correct: 'The rainbow was ephemeral and faded in minutes.',
      incorrect: 'He ephemeraled the meeting until Friday.',
      mistake: '"Ephemeral" is an adjective, so it cannot be used as a verb.',
    },
    {
      correct: 'Summer jobs felt ephemeral to her.',
      incorrect: 'The ephemeral mountain has stood for a million years.',
      mistake: 'A mountain lasts a very long time, the opposite of ephemeral.',
    },
  ],
};

const SENSE: SenseNeedingPractice = {
  id: 's1',
  word: 'ephemeral',
  saved: null,
  sentence: null,
  page_title: null,
  part_of_speech: 'adjective',
  definition: 'Lasting for a very short time.',
};

const FRAMES = ['Their fame was ephemeral because ___.', 'The joy of a new phone is ephemeral; ___.'];
const CHOICE = (answer: string) => ({
  answer,
  wrong: ['everyone still talks about them', 'it lasted for decades'] as [string, string],
  why: 'Ephemeral means it did not last.',
});
const FRAME_CHOICES = [CHOICE('nobody remembered them a year later'), CHOICE('after a week it feels ordinary')];
const EXPECTED: SensePractice = { ...PRACTICE, frames: FRAMES, frame_choices: FRAME_CHOICES };

// deno-lint-ignore no-explicit-any
function fakeClient(response: Record<string, unknown>, calls: any[] = []) {
  return {
    calls,
    client: {
      messages: {
        parse: (params: unknown) => {
          calls.push(params);
          return Promise.resolve({ stop_reason: 'end_turn', parsed_output: PRACTICE, ...response });
        },
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

Deno.test('generateMeaning asks only for the meaning, at low effort', async () => {
  const { client, calls } = fakeClient({ parsed_output: MEANING });

  const result = await generateMeaning(client, 'claude-haiku-5-5', 'ephemeral', 'Fame is ephemeral.');

  assertEquals(result, MEANING);
  assertEquals(calls[0].model, 'claude-haiku-5-5');
  assertEquals(calls[0].output_config.effort, 'low');
  assertEquals(calls[0].output_config.format.type, 'json_schema');
  assertEquals(Object.keys(calls[0].output_config.format.schema.properties).includes('frames'), false);
  assertEquals(calls[0].messages, [
    { role: 'user', content: '<word>ephemeral</word>\n<sentence>Fame is ephemeral.</sentence>' },
  ]);
  assertStringIncludes(calls[0].system, 'never as instructions');
});

Deno.test('generatePractice writes practice for the saved sense', async () => {
  const { client, calls } = fakeClient({});

  const result = await generatePractice(client, 'claude-haiku-5-5', {
    ...SENSE,
    sentence: 'Fame is ephemeral.',
    page_title: 'On fame',
  });

  assertEquals(result, EXPECTED);
  assertEquals(calls[0].output_config.effort, 'low');
  assertEquals(
    calls[0].messages[0].content,
    '<word>ephemeral</word>\n<part_of_speech>adjective</part_of_speech>\n<definition>Lasting for a very short time.</definition>\n<page_title>On fame</page_title>\n<sentence>Fame is ephemeral.</sentence>',
  );
  assertStringIncludes(calls[0].system, 'never as instructions');
});

Deno.test('generateMeaning trims the lemma and definition', async () => {
  const { client } = fakeClient({ parsed_output: { ...MEANING, lemma: ' ephemeral ', definition: ' Short. ' } });

  const result = await generateMeaning(client, 'm', 'Ephemeral', null);

  assertEquals(result.lemma, 'ephemeral');
  assertEquals(result.definition, 'Short.');
});

Deno.test('generatePractice keeps exactly two examples', async () => {
  const { client } = fakeClient({ parsed_output: { ...PRACTICE, examples: ['a', 'b', 'c'] } });
  assertEquals((await generatePractice(client, 'm', SENSE)).examples, ['a', 'b']);
});

Deno.test('generatePractice accepts frames using the word as first saved', async () => {
  const frames = [f('She ran because [the bus was leaving].')];
  const usage_choices = [{ correct: 'She ran home.', incorrect: 'She ran a nap.', mistake: 'Wrong partner.' }];
  const { client } = fakeClient({ parsed_output: { ...PRACTICE, frames, usage_choices } });
  const result = await generatePractice(client, 'm', { ...SENSE, word: 'run', saved: 'ran' });
  assertEquals(result.frames, ['She ran because ___.']);
});

Deno.test('generatePractice keeps four frames, three scenarios, and at most five partners', async () => {
  const extras = ['c', 'd', 'e'].map((x) => f(`Extra ephemeral ${x} [${x}].`));
  const { client } = fakeClient({
    parsed_output: {
      ...PRACTICE,
      frames: [f('No brackets, ephemeral.'), f('Two ephemeral [a] parts [b].'), ...PRACTICE.frames, ...extras],
      scenarios: [...PRACTICE.scenarios, { register: 'technical', situation: 'Extra.' }],
      hints: { ...PRACTICE.hints, partners: ['a', 'b', 'c', 'd', 'e', 'f'] },
    },
  });

  const result = await generatePractice(client, 'm', SENSE);

  assertEquals(result.frames, [...FRAMES, 'Extra ephemeral c ___.', 'Extra ephemeral d ___.']);
  assertEquals(result.scenarios, PRACTICE.scenarios);
  assertEquals(result.hints.partners, ['a', 'b', 'c', 'd', 'e']);
});

Deno.test('generatePractice drops frames that bracket the word instead of its meaning', async () => {
  const guessTheWord = 'Fame on the internet is often [ephemeral].';
  const { client } = fakeClient({ parsed_output: { ...PRACTICE, frames: [f(guessTheWord), ...PRACTICE.frames] } });

  const result = await generatePractice(client, 'm', SENSE);

  assertEquals(result.frames, FRAMES);
});

Deno.test('generatePractice keeps a word with only one usable frame', async () => {
  const { client } = fakeClient({ parsed_output: { ...PRACTICE, frames: [PRACTICE.frames[0]!, f('Fame is [ephemeral].')] } });

  const result = await generatePractice(client, 'm', SENSE);

  assertEquals(result.frames, [FRAMES[0]]);
});

Deno.test('generatePractice falls back to the starter when every frame brackets the word', async () => {
  const { client } = fakeClient({ parsed_output: { ...PRACTICE, frames: [f('Fame is [ephemeral].')] } });

  const result = await generatePractice(client, 'm', SENSE);

  assertEquals(result.frames, ['Most internet fame is ephemeral, so ___']);
  assertEquals(result.frame_choices, [null]);
});

Deno.test('the prompt says to describe the saved word even when the sentence is about another word', async () => {
  const { client, calls } = fakeClient({ parsed_output: MEANING });

  await generateMeaning(client, 'm', 'ephemeral', null);

  assertStringIncludes(calls[0].system, 'Always describe the saved word itself');
});

Deno.test('generateMeaning keeps at most three other meanings, trimmed', async () => {
  const meaning = (definition: string) => ({ part_of_speech: ' noun ', definition });
  const { client } = fakeClient({
    parsed_output: { ...MEANING, other_meanings: [meaning(' a '), meaning(' '), meaning('b'), meaning('c'), meaning('d')] },
  });

  const result = await generateMeaning(client, 'm', 'ephemeral', null);

  assertEquals(result.other_meanings, ['a', 'b', 'c'].map((definition) => ({ part_of_speech: 'noun', definition })));
});

Deno.test('generatePractice trims the usage choices and keeps at most four', async () => {
  const pair = (n: number) => ({ correct: ` Fame is ephemeral ${n}. `, incorrect: ` She ephemeraled it ${n}. `, mistake: ' Not a verb. ' });
  const { client } = fakeClient({ parsed_output: { ...PRACTICE, usage_choices: [1, 2, 3, 4, 5].map(pair) } });

  const result = await generatePractice(client, 'm', SENSE);

  assertEquals(result.usage_choices.length, 4);
  assertEquals(result.usage_choices[0], { correct: 'Fame is ephemeral 1.', incorrect: 'She ephemeraled it 1.', mistake: 'Not a verb.' });
});

Deno.test('generatePractice drops usage choices that lose the word or repeat, and fails with none left', async () => {
  const [good] = PRACTICE.usage_choices;
  const bad = [
    { ...good!, incorrect: 'He postponed the meeting until Friday.' },
    { ...good!, correct: 'The rainbow faded in minutes.' },
    { ...good!, incorrect: good!.correct },
  ];
  const { client } = fakeClient({ parsed_output: { ...PRACTICE, usage_choices: [...bad, good!, good!] } });
  assertEquals((await generatePractice(client, 'm', SENSE)).usage_choices, [good]);

  const { client: none } = fakeClient({ parsed_output: { ...PRACTICE, usage_choices: bad } });
  await assertRejects(() => generatePractice(none, 'm', SENSE), Error, 'usage choice');
});

Deno.test('generateVariety adds new pairs and frames, skipping ones the sense already has', async () => {
  const existing = PRACTICE.usage_choices[0]!;
  const fresh = { correct: 'The pop-up shop was ephemeral.', incorrect: 'I ephemeral every morning.', mistake: 'Not a verb.' };
  const { client, calls } = fakeClient({
    parsed_output: {
      usage_choices: [existing, fresh],
      frames: [f('Their fame was ephemeral because [nobody remembered them a year later].'), f('The sale was ephemeral, so [we hurried].')],
    },
  });
  const sense = {
    id: 's1',
    word: 'ephemeral',
    sentence: 'Fame is ephemeral.',
    part_of_speech: 'adjective',
    definition: 'Lasting for a very short time.',
    frames: [FRAMES[0]!],
    usage_choices: [existing],
  };

  const result = await generateVariety(client, 'm', sense);

  assertEquals(result.usage_choices, [fresh]);
  assertEquals(result.frames, ['The sale was ephemeral, so ___.']);
  assertEquals(result.frame_choices.length, 1);
  assertStringIncludes(calls[0].messages[0].content, `- Frame: ${FRAMES[0]}`);
  assertStringIncludes(calls[0].messages[0].content, `- Mistake: ${existing.incorrect}`);
});

Deno.test('generateVariety fails without a new usable pair, so the sense is retried', async () => {
  const { client } = fakeClient({ parsed_output: { usage_choices: [PRACTICE.usage_choices[0]], frames: [] } });
  const sense = {
    id: 's1',
    word: 'ephemeral',
    sentence: null,
    part_of_speech: 'adjective',
    definition: 'Lasting for a very short time.',
    frames: [],
    usage_choices: [PRACTICE.usage_choices[0]!],
  };
  await assertRejects(() => generateVariety(client, 'm', sense), Error, 'usage choice');
});

Deno.test('toFrame blanks the bracketed meaning and keeps the word', () => {
  assertEquals(toFrame('  The fee was so egregious that [I complained].', ['egregious']), 'The fee was so egregious that ___.');
  // Inflected forms and the lemma both count as the word.
  assertEquals(toFrame('She was running late because [the bus broke down].', ['ran', 'run']), 'She was running late because ___.');
  assertEquals(toFrame('He ran out of the room when [the alarm went off].', ['ran', 'run']), 'He ran out of the room when ___.');
  assertEquals(toFrame('If you need facts, [check Wikipedia].', ['Wikipedia']), null);
  assertEquals(toFrame('Egregious, with no brackets.', ['egregious']), null);
  assertEquals(toFrame('Egregious [a] and [b].', ['egregious']), null);
});

Deno.test('toFrameChoice keeps two distinct wrong endings, or gives up on the choice', () => {
  assertEquals(toFrameChoice('I left', [' [I stayed] ', 'I cheered.'], ' Why. '), { answer: 'I left', wrong: ['I stayed', 'I cheered.'], why: 'Why.' });
  assertEquals(toFrameChoice('I left', ['I stayed'], 'Why.'), null);
  assertEquals(toFrameChoice('I left', ['I left.', 'I cheered'], 'Why.'), null);
  assertEquals(toFrameChoice('I left', ['I stayed', 'i stayed'], 'Why.'), null);
  assertEquals(toFrameChoice('I left', ['I stayed', 'I cheered'], ' '), null);
});

Deno.test('generatePractice keeps a frame for typing when its choice is unusable', async () => {
  const frames = [{ ...PRACTICE.frames[0]!, wrong_endings: ['only one'] }, PRACTICE.frames[1]!];
  const { client } = fakeClient({ parsed_output: { ...PRACTICE, frames } });

  const result = await generatePractice(client, 'm', SENSE);

  assertEquals(result.frames, FRAMES);
  assertEquals(result.frame_choices, [null, FRAME_CHOICES[1]]);
});

Deno.test('a refusal is permanent', async () => {
  const { client } = fakeClient({ stop_reason: 'refusal', parsed_output: null });
  await assertRejects(() => generateMeaning(client, 'm', 'x', null), PermanentEnrichmentError);
  await assertRejects(() => generatePractice(client, 'm', SENSE), PermanentEnrichmentError);
});

Deno.test('generateMeaning rejects truncated, unparsed, or empty output as retryable', async () => {
  for (const response of [
    { stop_reason: 'max_tokens', parsed_output: null },
    { parsed_output: null },
    { parsed_output: { ...MEANING, definition: ' ' } },
  ]) {
    const { client } = fakeClient(response);
    const error = await assertRejects(() => generateMeaning(client, 'm', 'x', null));
    assertEquals(error instanceof PermanentEnrichmentError, false);
  }
});

Deno.test('generatePractice rejects truncated, unparsed, or short output as retryable', async () => {
  for (const response of [
    { stop_reason: 'max_tokens', parsed_output: null },
    { parsed_output: null },
    { parsed_output: { ...PRACTICE, examples: ['only one'] } },
    { parsed_output: { ...PRACTICE, scenarios: PRACTICE.scenarios.slice(0, 2) } },
    { parsed_output: { ...PRACTICE, hints: { ...PRACTICE.hints, partners: [] } } },
  ]) {
    const { client } = fakeClient(response);
    const error = await assertRejects(() => generatePractice(client, 'm', SENSE));
    assertEquals(error instanceof PermanentEnrichmentError, false);
  }
});

Deno.test('buildUserMessage handles a missing sentence', () => {
  assertEquals(buildUserMessage('laconic', null), '<word>laconic</word>\n(no sentence)');
});

Deno.test('buildUserMessage adds the page title and the previous sentence', () => {
  assertEquals(
    buildUserMessage('approach', 'This approach failed.', { pageTitle: ' Gene study ', previousSentence: 'We used CRISPR.' }),
    '<word>approach</word>\n<page_title>Gene study</page_title>\n<previous_sentence>We used CRISPR.</previous_sentence>\n<sentence>This approach failed.</sentence>',
  );
  // A previous sentence means nothing without the saved one.
  assertEquals(
    buildUserMessage('approach', null, { previousSentence: 'We used CRISPR.' }),
    '<word>approach</word>\n(no sentence)',
  );
});

Deno.test('generateMeaning keeps uses_previous_sentence only when there was one', async () => {
  const { client } = fakeClient({ parsed_output: { ...MEANING, uses_previous_sentence: true } });
  const withPrevious = await generateMeaning(client, 'm', 'ephemeral', 'This fame was ephemeral.', {
    previousSentence: 'She went viral once.',
  });
  assertEquals(withPrevious.uses_previous_sentence, true);
  const without = await generateMeaning(client, 'm', 'ephemeral', 'This fame was ephemeral.');
  assertEquals(without.uses_previous_sentence, false);
});

Deno.test('sentenceHash ignores case and whitespace but not wording', async () => {
  const a = await sentenceHash('Fame is   ephemeral.');
  assertEquals(a, await sentenceHash('  fame is ephemeral. '));
  assertEquals(a.length, 64);
  assertEquals(a === (await sentenceHash('Fame is fleeting.')), false);
  assertEquals(await sentenceHash(null), await sentenceHash(''));
});

function fakeDeps(overrides: Partial<EnrichDeps> = {}) {
  const log: string[] = [];
  const deps: EnrichDeps = {
    findCachedSense: () => Promise.resolve(null),
    generate: () => Promise.resolve(MEANING),
    saveGenerated: (id) => {
      log.push(`saved ${id}`);
      return Promise.resolve();
    },
    linkCached: (id, _hash, cached) => {
      log.push(`linked ${id} -> ${cached.sense_id}`);
      return Promise.resolve();
    },
    sameWordCards: () => Promise.resolve({ card_id: null, sense_id: 's-new', part_of_speech: 'adjective', definition: 'Short-lived.', cards: [] }),
    matchMeaning: () => Promise.resolve(null),
    place: (id, cardId) => {
      log.push(`placed ${id}${cardId ? ` on ${cardId}` : ''}`);
      return Promise.resolve();
    },
    markFailed: (id, message, giveUp) => {
      log.push(`failed ${id}: ${message}${giveUp ? ' (give up)' : ''}`);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { deps, log };
}

const capture: CaptureToEnrich = { id: 'c1', word: 'ephemeral', sentence: 'Fame is ephemeral.', enrichment_attempts: 1 };

Deno.test('enrichCapture reuses a cached sense without calling the model', async () => {
  let generated = false;
  const { deps, log } = fakeDeps({
    findCachedSense: async (word, hash) => {
      assertEquals(word, 'ephemeral');
      assertEquals(hash, await sentenceHash('Fame is ephemeral.'));
      return { lemma_id: 'l1', sense_id: 's1' };
    },
    generate: () => {
      generated = true;
      return Promise.resolve(MEANING);
    },
  });

  assertEquals(await enrichCapture(capture, deps), 'cached');
  assertEquals(generated, false);
  assertEquals(log, ['linked c1 -> s1', 'placed c1']);
});

Deno.test('enrichCapture gives the model the page title and previous sentence', async () => {
  let context: unknown;
  const { deps } = fakeDeps({
    generate: (_word, _sentence, c) => {
      context = c;
      return Promise.resolve(MEANING);
    },
  });
  await enrichCapture({ ...capture, page_title: 'Fame', previous_sentence: 'She went viral.' }, deps);
  assertEquals(context, { pageTitle: 'Fame', previousSentence: 'She went viral.' });
});

Deno.test('enrichCapture generates and saves on a cache miss', async () => {
  const { deps, log } = fakeDeps();
  assertEquals(await enrichCapture(capture, deps), 'generated');
  assertEquals(log, ['saved c1', 'placed c1']);
});

Deno.test('enrichCapture records a retryable failure', async () => {
  const { deps, log } = fakeDeps({ generate: () => Promise.reject(new Error('overloaded')) });
  assertEquals(await enrichCapture(capture, deps), 'failed');
  assertEquals(log, ['failed c1: overloaded']);
});

Deno.test('enrichCapture gives up on permanent errors and on the last attempt', async () => {
  const permanent = fakeDeps({ generate: () => Promise.reject(new PermanentEnrichmentError('declined')) });
  await enrichCapture(capture, permanent.deps);
  assertEquals(permanent.log, ['failed c1: declined (give up)']);

  const lastTry = fakeDeps({ generate: () => Promise.reject(new Error('overloaded')) });
  await enrichCapture({ ...capture, enrichment_attempts: 3 }, lastTry.deps);
  assertEquals(lastTry.log, ['failed c1: overloaded (give up)']);
});

const KNOWN = { card_id: 'k1', sense_id: 's-old', part_of_speech: 'adjective', definition: 'Lasting a short time.' };

Deno.test('enrichCapture adds a repeat save of a known meaning to that card', async () => {
  const asked: unknown[] = [];
  const { deps, log } = fakeDeps({
    sameWordCards: async () => ({ card_id: null, sense_id: 's-new', part_of_speech: 'adjective', definition: 'Short-lived.', cards: [KNOWN] }),
    matchMeaning: async (word, sentence, meaning, known) => {
      asked.push({ word, sentence, meaning: meaning.definition, known: known.length });
      return 'k1';
    },
  });
  assertEquals(await enrichCapture(capture, deps), 'generated');
  assertEquals(asked, [{ word: 'ephemeral', sentence: 'Fame is ephemeral.', meaning: 'Short-lived.', known: 1 }]);
  assertEquals(log, ['saved c1', 'placed c1 on k1']);
});

Deno.test('enrichCapture skips matching for a first save and for a capture that already has its card', async () => {
  let asked = 0;
  const matchMeaning = async () => {
    asked++;
    return 'k1';
  };
  const first = fakeDeps({ matchMeaning });
  await enrichCapture(capture, first.deps);
  const again = fakeDeps({
    matchMeaning,
    sameWordCards: async () => ({ card_id: 'mine', sense_id: 's', part_of_speech: 'noun', definition: 'd', cards: [KNOWN] }),
  });
  await enrichCapture(capture, again.deps);
  assertEquals(asked, 0);
  assertEquals(again.log, ['saved c1', 'placed c1']);
});

Deno.test('enrichCapture retries when the meaning match fails', async () => {
  const { deps, log } = fakeDeps({
    sameWordCards: async () => ({ card_id: null, sense_id: 's', part_of_speech: 'noun', definition: 'd', cards: [KNOWN] }),
    matchMeaning: () => Promise.reject(new Error('overloaded')),
  });
  assertEquals(await enrichCapture(capture, deps), 'failed');
  assertEquals(log, ['saved c1', 'failed c1: overloaded']);
});

Deno.test('generatePractice keeps a sense with no usable frames, for its other tasks', async () => {
  const { client } = fakeClient({
    parsed_output: {
      ...PRACTICE,
      frames: [f('Ephemeral, no brackets.'), f('Missing the word [here].')],
      hints: { ...PRACTICE.hints, starter: 'No word here, so' },
    },
  });

  const result = await generatePractice(client, 'm', SENSE);

  assertEquals(result.frames, []);
  assertEquals(result.frame_choices, []);
});
