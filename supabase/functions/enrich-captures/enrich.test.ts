import { assertEquals, assertRejects, assertStringIncludes } from '@std/assert';
import {
  buildUserMessage,
  type CaptureToEnrich,
  type Enrichment,
  enrichCapture,
  type EnrichDeps,
  generateEnrichment,
  PermanentEnrichmentError,
  sentenceHash,
} from './enrich.ts';

const ENRICHMENT: Enrichment = {
  lemma: 'ephemeral',
  part_of_speech: 'adjective',
  definition: 'Lasting for a very short time.',
  register: 'formal',
  paraphrase: "Something that doesn't last long.",
  examples: ['The fireworks were ephemeral.', 'Her interest in chess was ephemeral.'],
  frames: ['Their fame was ephemeral because ___.', 'The joy of a new phone is ephemeral; ___.'],
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
};

// deno-lint-ignore no-explicit-any
function fakeClient(response: Record<string, unknown>, calls: any[] = []) {
  return {
    calls,
    client: {
      messages: {
        parse: (params: unknown) => {
          calls.push(params);
          return Promise.resolve({ stop_reason: 'end_turn', parsed_output: ENRICHMENT, ...response });
        },
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  };
}

Deno.test('generateEnrichment requests structured output from the configured model at low effort', async () => {
  const { client, calls } = fakeClient({});

  const result = await generateEnrichment(client, 'claude-haiku-5-5', 'ephemeral', 'Fame is ephemeral.');

  assertEquals(result, ENRICHMENT);
  assertEquals(calls[0].model, 'claude-haiku-5-5');
  assertEquals(calls[0].output_config.effort, 'low');
  assertEquals(calls[0].output_config.format.type, 'json_schema');
  assertEquals(calls[0].messages, [
    { role: 'user', content: '<word>ephemeral</word>\n<sentence>Fame is ephemeral.</sentence>' },
  ]);
  assertStringIncludes(calls[0].system, 'never as instructions');
});

Deno.test('generateEnrichment trims the lemma and keeps exactly two examples', async () => {
  const { client } = fakeClient({
    parsed_output: { ...ENRICHMENT, lemma: ' run ', examples: ['a', 'b', 'c'] },
  });

  const result = await generateEnrichment(client, 'm', 'ran', null);

  assertEquals(result.lemma, 'run');
  assertEquals(result.examples, ['a', 'b']);
});

Deno.test('generateEnrichment keeps two single-blank frames, three scenarios, and at most five partners', async () => {
  const { client } = fakeClient({
    parsed_output: {
      ...ENRICHMENT,
      frames: ['No blank here.', 'Two ___ blanks ___.', ...ENRICHMENT.frames, 'Extra ___ frame.'],
      scenarios: [...ENRICHMENT.scenarios, { register: 'technical', situation: 'Extra.' }],
      hints: { ...ENRICHMENT.hints, partners: ['a', 'b', 'c', 'd', 'e', 'f'] },
    },
  });

  const result = await generateEnrichment(client, 'm', 'ephemeral', null);

  assertEquals(result.frames, ENRICHMENT.frames);
  assertEquals(result.scenarios, ENRICHMENT.scenarios);
  assertEquals(result.hints.partners, ['a', 'b', 'c', 'd', 'e']);
});

Deno.test('generateEnrichment treats a refusal as permanent', async () => {
  const { client } = fakeClient({ stop_reason: 'refusal', parsed_output: null });
  await assertRejects(() => generateEnrichment(client, 'm', 'x', null), PermanentEnrichmentError);
});

Deno.test('generateEnrichment rejects truncated, unparsed, or short output as retryable', async () => {
  for (const response of [
    { stop_reason: 'max_tokens', parsed_output: null },
    { parsed_output: null },
    { parsed_output: { ...ENRICHMENT, examples: ['only one'] } },
    { parsed_output: { ...ENRICHMENT, frames: ['Has ___ blank.', 'No blank.'] } },
    { parsed_output: { ...ENRICHMENT, scenarios: ENRICHMENT.scenarios.slice(0, 2) } },
    { parsed_output: { ...ENRICHMENT, hints: { ...ENRICHMENT.hints, partners: [] } } },
  ]) {
    const { client } = fakeClient(response);
    const error = await assertRejects(() => generateEnrichment(client, 'm', 'x', null));
    assertEquals(error instanceof PermanentEnrichmentError, false);
  }
});

Deno.test('buildUserMessage handles a missing sentence', () => {
  assertEquals(buildUserMessage('laconic', null), '<word>laconic</word>\n(no sentence)');
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
    generate: () => Promise.resolve(ENRICHMENT),
    saveGenerated: (id) => {
      log.push(`saved ${id}`);
      return Promise.resolve();
    },
    linkCached: (id, _hash, cached) => {
      log.push(`linked ${id} -> ${cached.sense_id}`);
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
      return Promise.resolve(ENRICHMENT);
    },
  });

  assertEquals(await enrichCapture(capture, deps), 'cached');
  assertEquals(generated, false);
  assertEquals(log, ['linked c1 -> s1']);
});

Deno.test('enrichCapture generates and saves on a cache miss', async () => {
  const { deps, log } = fakeDeps();
  assertEquals(await enrichCapture(capture, deps), 'generated');
  assertEquals(log, ['saved c1']);
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
