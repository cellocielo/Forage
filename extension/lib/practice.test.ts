import { describe, expect, it, vi } from 'vitest';
import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import {
  chooseTask,
  describeNextReview,
  disputeAttempt,
  easierTask,
  fetchExtraCard,
  fetchNextCard,
  hintSteps,
  submitAttempt,
  type PracticeCard,
} from './practice';

const CARD: PracticeCard = {
  id: 'card-1',
  state: 0,
  stability: 0,
  reps: 0,
  word: 'egregious',
  partOfSpeech: 'adjective',
  frames: ['It was so egregious that ___.', 'An egregious error, and ___.'],
  scenarios: [
    { register: 'formal', situation: 'Email the league office.' },
    { register: 'neutral', situation: 'Tell a friend.' },
    { register: 'informal', situation: 'Text your roommate.' },
  ],
  usageChoice: null,
  frameChoices: [],
  hints: { partners: ['an egregious error', 'egregious behavior'], example: 'It was egregious.', starter: 'The call was' },
  definition: 'shockingly bad',
  otherMeanings: [{ partOfSpeech: 'adjective', definition: 'remarkable (old use)' }],
  examples: ['The fee was egregious.', 'It was egregious.'],
};

const CHOICE = {
  correct: 'The referee made an egregious error.',
  incorrect: 'She gave an egregious speech that everyone loved.',
  mistake: '"Egregious" means shockingly bad.',
};

const PICK = { answer: 'I complained', wrong: ['I cheered', 'I said thanks'] as [string, string], why: 'Bad things get complaints.' };

describe('chooseTask', () => {
  it('gives new and weak words a frame, rotating with each review', () => {
    expect(chooseTask(CARD)).toEqual({ type: 'frame', index: 0, prompt: CARD.frames[0] });
    expect(chooseTask({ ...CARD, state: 2, stability: 3, reps: 3 })).toMatchObject({ type: 'frame', index: 1 });
  });

  it('gives mid-stability words a scenario with its register', () => {
    expect(chooseTask({ ...CARD, state: 2, stability: 10, reps: 4 })).toEqual({
      type: 'scenario',
      index: 1,
      prompt: 'Tell a friend.',
      register: 'neutral',
    });
  });

  it('gives strong words an open prompt', () => {
    expect(chooseTask({ ...CARD, state: 2, stability: 30 })).toEqual({
      type: 'open',
      index: 0,
      prompt: 'Write a sentence using "egregious".',
    });
  });

  it('falls back a level when the sense lacks that scaffold', () => {
    expect(chooseTask({ ...CARD, frames: [] })).toMatchObject({ type: 'scenario' });
    expect(chooseTask({ ...CARD, frames: [], scenarios: [] })).toMatchObject({ type: 'open' });
  });

  it('starts new words on picking an ending, then rotates through a usage choice and typing', () => {
    const card = { ...CARD, usageChoice: CHOICE, frameChoices: [PICK, null] };
    const tasks = [0, 1, 2, 3].map((reps) => chooseTask({ ...card, state: reps ? 2 : 0, stability: 2, reps }));
    expect(tasks.map((t) => [t.type, t.index])).toEqual([
      ['pick', 0],
      ['choice', 0],
      ['frame', 0],
      ['pick', 0],
    ]);
    expect([...tasks[0]!.options!].sort()).toEqual(['I cheered', 'I complained', 'I said thanks']);
    expect(tasks[0]!.prompt).toBe(CARD.frames[0]);
  });

  it('skips tasks the word lacks in the rotation', () => {
    const tasks = [0, 1].map((reps) => chooseTask({ ...CARD, frameChoices: [null, PICK], reps, state: 2, stability: 2 }));
    expect(tasks.map((t) => [t.type, t.index])).toEqual([
      ['pick', 1],
      ['frame', 1],
    ]);
  });

  it('offers both sentences in a choice, in an order that varies by card', () => {
    const orders = ['a', 'b', 'c', 'd', 'e', 'f'].map(
      (id) => chooseTask({ ...CARD, id, usageChoice: CHOICE, reps: 0, state: 2, stability: 2 }).options!,
    );
    for (const options of orders) expect([...options].sort()).toEqual([CHOICE.correct, CHOICE.incorrect].sort());
    expect(new Set(orders.map((o) => o[0])).size).toBe(2);
  });
});

describe('easierTask', () => {
  it('drops one level at a time to the easiest the word has', () => {
    const card = { ...CARD, usageChoice: CHOICE, frameChoices: [PICK], state: 2, stability: 30 };
    const open = chooseTask(card);
    const scenario = easierTask(card, open)!;
    const frame = easierTask(card, scenario)!;
    const pick = easierTask(card, frame)!;
    const choice = easierTask(card, pick)!;
    expect([open, scenario, frame, pick, choice].map((t) => t.type)).toEqual(['open', 'scenario', 'frame', 'pick', 'choice']);
    expect(easierTask(card, choice)).toBeNull();
  });

  it('skips levels the word lacks', () => {
    const card = { ...CARD, frames: [], state: 2, stability: 30 };
    expect(easierTask(card, chooseTask(card))?.type).toBe('scenario');
    expect(easierTask(card, easierTask(card, chooseTask(card))!)).toBeNull();
  });
});

describe('hintSteps', () => {
  it('orders partners, example, starter, capping from the second step', () => {
    expect(hintSteps(CARD)).toEqual([
      { label: 'Goes with', text: 'an egregious error · egregious behavior', cap: null },
      { label: 'Example', text: 'It was egregious.', cap: 'Solid' },
      { label: 'Start with', text: 'The call was…', cap: 'Shaky' },
    ]);
  });

  it('caps by position, matching how the grader counts hints', () => {
    const steps = hintSteps({ ...CARD, hints: { partners: [], example: 'Ex.', starter: 'Start' } });
    expect(steps.map((s) => [s.label, s.cap])).toEqual([
      ['Example', null],
      ['Start with', 'Solid'],
    ]);
  });
});

describe('describeNextReview', () => {
  it('reads naturally', () => {
    expect(describeNextReview(1)).toBe('tomorrow');
    expect(describeNextReview(4)).toBe('in 4 days');
    expect(describeNextReview(21)).toBe('in 3 weeks');
    expect(describeNextReview(90)).toBe('in 3 months');
  });
});

/** A cards query builder: counts for the badge rules, then the card row. */
function fakeClient({ due = 1, reviewedToday = 0, row = null as unknown, error = null as unknown } = {}) {
  const calls: Array<[string, ...unknown[]]> = [];
  const from = vi.fn(() => {
    const own: Array<[string, ...unknown[]]> = [];
    const builder: Record<string, unknown> = {
      then(resolve: (v: unknown) => unknown) {
        const isDueCount = own.some(([n, c]) => n === 'lte' && c === 'due');
        const isReviewed = own.some(([n]) => n === 'gte');
        return Promise.resolve(
          isReviewed ? { count: reviewedToday, error: null } : isDueCount ? { count: due, error: null } : null,
        ).then(resolve);
      },
      maybeSingle: () => Promise.resolve({ data: row, error }),
    };
    for (const name of ['select', 'is', 'lte', 'gte', 'or', 'not', 'order', 'limit']) {
      builder[name] = (...args: unknown[]) => {
        own.push([name, ...args]);
        calls.push([name, ...args]);
        return builder;
      };
    }
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, from, calls };
}

describe('fetchNextCard', () => {
  const ROW = {
    id: 'card-1',
    state: 0,
    stability: 0,
    reps: 0,
    captures: {
      word: 'Egregiously',
      lemmas: { lemma: 'egregious' },
      senses: {
        part_of_speech: 'adjective',
        definition: CARD.definition,
        // The hint example repeats one here, so it's listed once.
        examples: ['The fee was egregious.', 'It was egregious.'],
        other_meanings: [{ part_of_speech: 'adjective', definition: 'remarkable (old use)' }, { definition: '' }],
        frames: CARD.frames,
        scenarios: CARD.scenarios,
        usage_choice: null,
        frame_choices: null,
        hint_partners: CARD.hints.partners,
        hint_example: CARD.hints.example,
        hint_starter: CARD.hints.starter,
      },
    },
  };

  it('returns the most overdue ready card, shown by its dictionary form', async () => {
    const { client, calls } = fakeClient({ row: ROW });

    expect(await fetchNextCard(client)).toEqual(CARD);
    expect(calls).toContainEqual(['order', 'due', { ascending: true }]);
    expect(calls).toContainEqual(['limit', 1]);
  });

  it('returns null without loading a card when today\'s cap is used up', async () => {
    const { client, calls } = fakeClient({ due: 3, reviewedToday: 5, row: ROW });

    expect(await fetchNextCard(client)).toBeNull();
    expect(calls.some(([n]) => n === 'order')).toBe(false);
  });

  it('throws when the card query fails', async () => {
    const { client } = fakeClient({ error: { message: 'boom' } });
    await expect(fetchNextCard(client)).rejects.toThrow('boom');
  });

  it('keeps practicing with the soonest-due word not yet seen, due or not', async () => {
    const { client, calls } = fakeClient({ due: 0, row: ROW });

    expect(await fetchExtraCard(client, new Date(), ['card-9', 'card-8'])).toEqual(CARD);
    expect(calls).toContainEqual(['not', 'id', 'in', '(card-9,card-8)']);
    expect(calls).toContainEqual(['order', 'due', { ascending: true }]);
    expect(calls.some(([n, c]) => n === 'lte' && c === 'due')).toBe(false);
  });
});

describe('submitAttempt', () => {
  const task = chooseTask(CARD);

  it('sends the card, task and answer to grade-attempt', async () => {
    const result = { attempt_id: 'a1', rating: 3 };
    const invoke = vi.fn().mockResolvedValue({ data: result, error: null });
    const client = { functions: { invoke } } as unknown as SupabaseClient;

    expect(await submitAttempt(client, CARD, task, '  the crowd booed ', 2, true)).toEqual({ ok: true, result });
    expect(invoke).toHaveBeenCalledWith('grade-attempt', {
      body: { card_id: 'card-1', task_type: 'frame', prompt_index: 0, answer: 'the crowd booed', hints_used: 2, easier: true, extra: false },
    });
  });

  it('sends the picked ending for a pick, with no hints', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { attempt_id: 'a1' }, error: null });
    const client = { functions: { invoke } } as unknown as SupabaseClient;
    const card = { ...CARD, frameChoices: [PICK] };

    await submitAttempt(client, card, chooseTask(card), 'I complained', 1);

    expect(invoke.mock.calls[0]![1].body).toMatchObject({ task_type: 'pick', prompt_index: 0, answer: 'I complained', hints_used: 0 });
  });

  it('sends the picked sentence for a choice, with no hints', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: { attempt_id: 'a1' }, error: null });
    const client = { functions: { invoke } } as unknown as SupabaseClient;
    const card = { ...CARD, usageChoice: CHOICE, reps: 0 };

    await submitAttempt(client, card, chooseTask(card), CHOICE.correct, 2);

    expect(invoke.mock.calls[0]![1].body).toMatchObject({ task_type: 'choice', answer: CHOICE.correct, hints_used: 0, easier: false });
  });

  it("shows the function's error message", async () => {
    const error = new FunctionsHttpError(Response.json({ error: 'This word was just practiced' }, { status: 409 }));
    const client = { functions: { invoke: vi.fn().mockResolvedValue({ data: null, error }) } } as unknown as SupabaseClient;

    expect(await submitAttempt(client, CARD, task, 'x', 0)).toEqual({ ok: false, message: 'This word was just practiced' });
  });

  it('falls back to a generic message when offline', async () => {
    const error = new FunctionsFetchError(new TypeError('Failed to fetch'));
    const client = { functions: { invoke: vi.fn().mockResolvedValue({ data: null, error }) } } as unknown as SupabaseClient;

    expect(await submitAttempt(client, CARD, task, 'x', 0)).toMatchObject({ ok: false, message: expect.stringContaining('connection') });
  });
});

describe('disputeAttempt', () => {
  it('asks dispute-attempt for a second opinion and reports its error message', async () => {
    const result = { rating: 4, changed: true };
    const invoke = vi.fn().mockResolvedValueOnce({ data: result, error: null }).mockResolvedValueOnce({
      data: null,
      error: new FunctionsHttpError(Response.json({ error: 'You already disputed this grade' }, { status: 409 })),
    });
    const client = { functions: { invoke } } as unknown as SupabaseClient;

    expect(await disputeAttempt(client, 'a1')).toEqual({ ok: true, result });
    expect(invoke).toHaveBeenCalledWith('dispute-attempt', { body: { attempt_id: 'a1' } });
    expect(await disputeAttempt(client, 'a1')).toEqual({ ok: false, message: 'You already disputed this grade' });
  });
});
