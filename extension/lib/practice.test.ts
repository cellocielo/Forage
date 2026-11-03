import { describe, expect, it, vi } from 'vitest';
import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import {
  chooseTask,
  describeNextReview,
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
  hints: { partners: ['an egregious error', 'egregious behavior'], example: 'It was egregious.', starter: 'The call was' },
};

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
});

describe('hintSteps', () => {
  it('orders partners, example, starter, capping from the second step', () => {
    expect(hintSteps(CARD)).toEqual([
      { label: 'Goes with', text: 'an egregious error · egregious behavior', cap: null },
      { label: 'Example', text: 'It was egregious.', cap: 'Good' },
      { label: 'Start with', text: 'The call was…', cap: 'Hard' },
    ]);
  });

  it('caps by position, matching how the grader counts hints', () => {
    const steps = hintSteps({ ...CARD, hints: { partners: [], example: 'Ex.', starter: 'Start' } });
    expect(steps.map((s) => [s.label, s.cap])).toEqual([
      ['Example', null],
      ['Start with', 'Good'],
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
    for (const name of ['select', 'is', 'lte', 'gte', 'or', 'order', 'limit']) {
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
        frames: CARD.frames,
        scenarios: CARD.scenarios,
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
});

describe('submitAttempt', () => {
  const task = chooseTask(CARD);

  it('sends the card, task and answer to grade-attempt', async () => {
    const result = { attempt_id: 'a1', rating: 3 };
    const invoke = vi.fn().mockResolvedValue({ data: result, error: null });
    const client = { functions: { invoke } } as unknown as SupabaseClient;

    expect(await submitAttempt(client, CARD, task, '  the crowd booed ', 2)).toEqual({ ok: true, result });
    expect(invoke).toHaveBeenCalledWith('grade-attempt', {
      body: { card_id: 'card-1', task_type: 'frame', prompt_index: 0, answer: 'the crowd booed', hints_used: 2 },
    });
  });

  it("shows the function's error message", async () => {
    const error = new FunctionsHttpError(Response.json({ error: 'This word was just practised' }, { status: 409 }));
    const client = { functions: { invoke: vi.fn().mockResolvedValue({ data: null, error }) } } as unknown as SupabaseClient;

    expect(await submitAttempt(client, CARD, task, 'x', 0)).toEqual({ ok: false, message: 'This word was just practised' });
  });

  it('falls back to a generic message when offline', async () => {
    const error = new FunctionsFetchError(new TypeError('Failed to fetch'));
    const client = { functions: { invoke: vi.fn().mockResolvedValue({ data: null, error }) } } as unknown as SupabaseClient;

    expect(await submitAttempt(client, CARD, task, 'x', 0)).toMatchObject({ ok: false, message: expect.stringContaining('connection') });
  });
});
