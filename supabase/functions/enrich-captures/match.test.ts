import { assertEquals, assertStringIncludes } from '@std/assert';
import { buildMatchMessage, type KnownMeaning, matchMeaning } from './match.ts';

const KNOWN: KnownMeaning[] = [
  { card_id: 'k1', sense_id: 's1', part_of_speech: 'verb', definition: 'To punish a country with official rules.' },
  { card_id: 'k2', sense_id: 's2', part_of_speech: 'noun', definition: 'Official permission.' },
];
const NEW = { sense_id: 's9', part_of_speech: 'verb', definition: 'To officially approve something.' };

function fakeClient(sameAs: number | null) {
  const calls: Array<{ messages: Array<{ content: string }> }> = [];
  const client = {
    messages: {
      parse: (params: { messages: Array<{ content: string }> }) => {
        calls.push(params);
        return Promise.resolve({ stop_reason: 'end_turn', parsed_output: { same_as: sameAs } });
      },
    },
  };
  return { calls, client: client as unknown as Parameters<typeof matchMeaning>[0] };
}

Deno.test('matchMeaning returns the card the model picks, by its number', async () => {
  const { client, calls } = fakeClient(2);
  assertEquals(await matchMeaning(client, 'm', 'sanction', 'They sanctioned the plan.', NEW, KNOWN), 'k2');
  assertStringIncludes(calls[0]!.messages[0]!.content, '2. (noun) Official permission.');
});

Deno.test('matchMeaning returns null for a new meaning or an out-of-range number', async () => {
  assertEquals(await matchMeaning(fakeClient(null).client, 'm', 'sanction', null, NEW, KNOWN), null);
  assertEquals(await matchMeaning(fakeClient(5).client, 'm', 'sanction', null, NEW, KNOWN), null);
});

Deno.test('matchMeaning matches the same sense without asking the model', async () => {
  const { client, calls } = fakeClient(null);
  assertEquals(await matchMeaning(client, 'm', 'sanction', null, { ...NEW, sense_id: 's1' }, KNOWN), 'k1');
  assertEquals(calls.length, 0);
});

Deno.test('buildMatchMessage includes the new meaning and handles a missing sentence', () => {
  const message = buildMatchMessage('sanction', null, NEW, KNOWN);
  assertStringIncludes(message, '(no sentence)');
  assertStringIncludes(message, '<meaning_here>(verb) To officially approve something.</meaning_here>');
});
