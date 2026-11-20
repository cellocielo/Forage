import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GradeResult, PracticeCard } from '@/lib/practice';
import { Practice } from './Practice';

const mocks = vi.hoisted(() => ({
  fetchNextCard: vi.fn(),
  fetchExtraCard: vi.fn(),
  fetchNextPractice: vi.fn(),
  submitAttempt: vi.fn(),
  disputeAttempt: vi.fn(),
  refreshBadge: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/badge', () => ({ refreshBadge: mocks.refreshBadge }));
vi.mock('@/lib/practice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/practice')>()),
  fetchNextCard: mocks.fetchNextCard,
  fetchExtraCard: mocks.fetchExtraCard,
  fetchNextPractice: mocks.fetchNextPractice,
  submitAttempt: mocks.submitAttempt,
  disputeAttempt: mocks.disputeAttempt,
}));

const CARD: PracticeCard = {
  id: 'card-1',
  state: 0,
  stability: 0,
  reps: 0,
  word: 'egregious',
  partOfSpeech: 'adjective',
  frames: ["The judge's ruling was so egregious that ___."],
  scenarios: [{ register: 'formal', situation: 'Email the league office.' }],
  usageChoices: [],
  recent: [],
  frameChoices: [],
  hints: { partners: ['an egregious error'], example: 'The printer jam was egregious.', starter: 'The call was' },
  definition: 'shockingly bad',
  otherMeanings: [{ partOfSpeech: 'adjective', definition: 'remarkably good (old use)' }],
  examples: ['The fee was egregious.', 'He made an egregious mistake.'],
};

const RESULT: GradeResult = {
  attempt_id: 'a1',
  sentence: "The judge's ruling was so egregious that the crowd booed.",
  verdict: {
    sense: 'correct',
    grammar: 'correct',
    collocation: 'natural',
    tone: 'not_applicable',
    corrected_sentence: "The judge's ruling was so egregious that the whole crowd booed.",
    rationale: 'The crowd booing shows the ruling was shockingly bad.',
    score: 3,
  },
  score: 3,
  rating: 3,
  due: '2026-11-06T00:00:00.000Z',
  scheduled_days: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchNextCard.mockResolvedValue(CARD);
  mocks.fetchExtraCard.mockResolvedValue(null);
  mocks.fetchNextPractice.mockResolvedValue(null);
  mocks.submitAttempt.mockResolvedValue({ ok: true, result: RESULT });
});
afterEach(cleanup);

describe('Practice', () => {
  it('shows the word and its frame, then the grade after checking', async () => {
    const user = userEvent.setup();
    render(<Practice />);

    expect(await screen.findByText("The judge's ruling was so egregious that ___.")).toBeTruthy();
    expect(screen.getByRole('heading').textContent).toBe('egregious adjective');

    await user.type(screen.getByLabelText('Fill in the blank'), 'the crowd booed{Enter}');

    expect(mocks.submitAttempt).toHaveBeenCalledWith(
      {},
      CARD,
      expect.objectContaining({ type: 'frame', index: 0 }),
      'the crowd booed',
      0,
      false,
      false,
    );
    expect(await screen.findByText('Solid')).toBeTruthy();
    // The task stays on screen so the feedback has context.
    expect(screen.getByText("The judge's ruling was so egregious that ___.")).toBeTruthy();
    expect(screen.getByText(RESULT.verdict.rationale)).toBeTruthy();
    expect(screen.getByText(RESULT.verdict.corrected_sentence)).toBeTruthy();
    expect(screen.getByText('Next review in 3 days.')).toBeTruthy();
    expect(mocks.refreshBadge).toHaveBeenCalled();
  });

  it('reveals hints one at a time, says which ones cap the score, and reports how many were used', async () => {
    mocks.fetchNextCard.mockResolvedValue({ ...CARD, state: 2, stability: 10 });
    const user = userEvent.setup();
    render(<Practice />);
    await screen.findByText('Email the league office.');

    await user.click(screen.getByRole('button', { name: 'Stuck?' }));
    expect(screen.getByText('an egregious error')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Another hint (max Solid)' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Another hint (max Solid)' }));
    await user.click(screen.getByRole('button', { name: 'Another hint (max Shaky)' }));
    expect(screen.getByText('The call was…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /hint/i })).toBeNull();

    await user.type(screen.getByLabelText('Your sentence, using "egregious"'), 'x');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(mocks.submitAttempt.mock.calls[0]![4]).toBe(3);
  });

  it("doesn't offer a sentence starter on a fill-in-the-blank, which already has one", async () => {
    const user = userEvent.setup();
    render(<Practice />);
    await screen.findByLabelText('Fill in the blank');

    await user.click(screen.getByRole('button', { name: 'Stuck?' }));
    await user.click(screen.getByRole('button', { name: 'Another hint (max Solid)' }));
    expect(screen.queryByText('Start with')).toBeNull();
    expect(screen.queryByRole('button', { name: /hint/i })).toBeNull();
  });

  it('uses a sentence box for scenarios', async () => {
    mocks.fetchNextCard.mockResolvedValue({ ...CARD, state: 2, stability: 10 });
    render(<Practice />);

    expect(await screen.findByText('Email the league office.')).toBeTruthy();
    expect(screen.getByText('formal tone')).toBeTruthy();
    expect(screen.getByLabelText('Your sentence, using "egregious"').tagName).toBe('TEXTAREA');
  });

  it('keeps the answer and shows the error when grading fails', async () => {
    mocks.submitAttempt.mockResolvedValue({ ok: false, message: "Couldn't grade right now. Try again." });
    const user = userEvent.setup();
    render(<Practice />);

    await user.type(await screen.findByLabelText('Fill in the blank'), 'the crowd booed{Enter}');

    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't grade right now. Try again.");
    expect((screen.getByLabelText('Fill in the blank') as HTMLInputElement).value).toBe('the crowd booed');
  });

  it('shows other meanings and example sentences on request after answering', async () => {
    const user = userEvent.setup();
    render(<Practice />);
    await user.type(await screen.findByLabelText('Fill in the blank'), 'x{Enter}');

    await user.click(await screen.findByRole('button', { name: 'Other meanings' }));
    expect(screen.getByText('shockingly bad')).toBeTruthy();
    expect(screen.getByText('remarkably good (old use)')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Hide meanings' }));
    expect(screen.queryByText('shockingly bad')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Use it in a sentence' }));
    expect(screen.getByText('The fee was egregious.')).toBeTruthy();
    expect(screen.getByText('Example 1 of 2')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Another example' }));
    expect(screen.getByText('He made an egregious mistake.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Another example' }));
    expect(screen.getByText('The fee was egregious.')).toBeTruthy();
  });

  it('loads the next word after a result', async () => {
    const user = userEvent.setup();
    render(<Practice />);
    await user.type(await screen.findByLabelText('Fill in the blank'), 'x{Enter}');
    mocks.fetchNextCard.mockResolvedValue(null);

    await user.click(await screen.findByRole('button', { name: 'Next word' }));

    expect(await screen.findByText('All caught up')).toBeTruthy();
    expect(mocks.fetchNextCard).toHaveBeenCalledTimes(2);
  });

  it('offers to keep practicing words that are not due yet, each once', async () => {
    const NEXT = { ...CARD, id: 'card-2', word: 'laconic' };
    mocks.fetchNextCard.mockResolvedValue(null);
    mocks.fetchExtraCard.mockImplementation(async (_client: unknown, _now: Date, seen: string[]) =>
      !seen.includes('card-1') ? CARD : !seen.includes('card-2') ? NEXT : null,
    );
    const user = userEvent.setup();
    render(<Practice />);

    await user.click(await screen.findByRole('button', { name: 'Keep practicing' }));
    await user.type(await screen.findByLabelText('Fill in the blank'), 'x{Enter}');
    expect(mocks.submitAttempt.mock.calls[0]![6]).toBe(true);

    await user.click(await screen.findByRole('button', { name: 'Next word' }));
    expect((await screen.findByRole('heading')).textContent).toBe('laconic adjective');
    await user.type(screen.getByLabelText('Fill in the blank'), 'y{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Next word' }));

    expect(await screen.findByText("That's every word")).toBeTruthy();
  });

  it('does not offer to keep practicing when there are no other words', async () => {
    mocks.fetchNextCard.mockResolvedValue(null);
    render(<Practice />);

    expect(await screen.findByText('All caught up')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Keep practicing' })).toBeNull();
  });

  it('says roughly when the next word is due', async () => {
    mocks.fetchNextCard.mockResolvedValue(null);
    mocks.fetchNextPractice.mockResolvedValue({ kind: 'due', at: new Date(Date.now() + 3 * 60 * 60 * 1000) });
    render(<Practice />);

    expect(await screen.findByText('Next word due in about 3 hours.')).toBeTruthy();
  });

  it("mentions the reminder when one will come", async () => {
    mocks.fetchNextCard.mockResolvedValue(null);
    mocks.fetchNextPractice.mockResolvedValue({ kind: 'due', at: new Date(Date.now() + 3 * 60 * 60 * 1000) });
    render(<Practice remindsWhenReady />);

    expect(await screen.findByText("Next word due in about 3 hours. We'll remind you when it's ready.")).toBeTruthy();
  });

  it("says when today's limit is used up", async () => {
    mocks.fetchNextCard.mockResolvedValue(null);
    mocks.fetchNextPractice.mockResolvedValue({ kind: 'cap' });
    render(<Practice dailyCap={5} />);

    expect(await screen.findByText("You've done today's 5 words. More tomorrow.")).toBeTruthy();
  });

  it('still shows the caught-up screen if the next due time fails to load', async () => {
    mocks.fetchNextCard.mockResolvedValue(null);
    mocks.fetchNextPractice.mockRejectedValue(new Error('offline'));
    render(<Practice />);

    expect(await screen.findByText('All caught up')).toBeTruthy();
    expect(screen.queryByText(/Next word due/)).toBeNull();
  });

  it('says when nothing is ready, and offers a retry when loading fails', async () => {
    mocks.fetchNextCard.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);
    render(<Practice />);

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('All caught up')).toBeTruthy();
  });
});

const CHOICE = {
  correct: 'The referee made an egregious error.',
  incorrect: 'She gave an egregious speech that everyone loved.',
  mistake: '"Egregious" means shockingly bad, so it cannot praise a speech.',
};

describe('Practice: choice, easier, disputes', () => {
  it('grades a usage choice with one click and shows the correct usage', async () => {
    mocks.fetchNextCard.mockResolvedValue({ ...CARD, usageChoices: [CHOICE], reps: 0, state: 2, stability: 2 });
    mocks.submitAttempt.mockResolvedValue({
      ok: true,
      result: {
        ...RESULT,
        sentence: CHOICE.incorrect,
        rating: 1,
        verdict: { ...RESULT.verdict, corrected_sentence: CHOICE.correct, rationale: CHOICE.mistake },
      },
    });
    const user = userEvent.setup();
    render(<Practice />);

    expect(await screen.findByText('Which sentence uses "egregious" correctly?')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: CHOICE.incorrect }));

    expect(mocks.submitAttempt.mock.calls[0]![2]).toMatchObject({ type: 'choice' });
    expect(mocks.submitAttempt.mock.calls[0]![3]).toBe(CHOICE.incorrect);
    expect(await screen.findByText('Wrong')).toBeTruthy();
    expect(screen.getByText('Correct usage')).toBeTruthy();

    // A wrong pick can be disputed, in case the question itself is faulty.
    mocks.disputeAttempt.mockResolvedValue({
      ok: true,
      result: { verdict: RESULT.verdict, score: 3, rating: 3, changed: true, rescheduled: true, due: RESULT.due, scheduled_days: 3 },
    });
    await user.click(screen.getByRole('button', { name: 'Think this question is wrong?' }));
    expect(await screen.findByText('Second opinion: Right')).toBeTruthy();
    expect(screen.getByText(/this question won't be used again/)).toBeTruthy();
  });

  it('starts a new word on picking the ending that fits, and can drop to a usage choice', async () => {
    const pick = { answer: 'the crowd booed', wrong: ['everyone cheered', 'he got a prize'] as [string, string], why: 'Shockingly bad.' };
    mocks.fetchNextCard.mockResolvedValue({ ...CARD, frameChoices: [pick], usageChoices: [CHOICE] });
    const user = userEvent.setup();
    render(<Practice />);

    expect(await screen.findByText('Pick the ending that fits "egregious".')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Stuck/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'everyone cheered' }));

    expect(mocks.submitAttempt.mock.calls[0]![2]).toMatchObject({ type: 'pick', index: 0 });
    expect(mocks.submitAttempt.mock.calls[0]![3]).toBe('everyone cheered');
    expect(await screen.findByRole('button', { name: 'Next word' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /wrong\?$/ })).toBeNull();
  });

  it('drops to an easier task and reports that it did', async () => {
    mocks.fetchNextCard.mockResolvedValue({ ...CARD, state: 2, stability: 10 });
    const user = userEvent.setup();
    render(<Practice />);

    await screen.findByText('Email the league office.');
    await user.click(screen.getByRole('button', { name: 'Easier, please' }));
    await user.type(screen.getByLabelText('Fill in the blank'), 'the crowd booed{Enter}');

    expect(mocks.submitAttempt.mock.calls[0]![2]).toMatchObject({ type: 'frame' });
    expect(mocks.submitAttempt.mock.calls[0]![5]).toBe(true);
  });

  it('has no easier option on the easiest task', async () => {
    render(<Practice />);
    await screen.findByLabelText('Fill in the blank');
    expect(screen.queryByRole('button', { name: 'Easier, please' })).toBeNull();
  });

  it('shows a second opinion that changes the schedule', async () => {
    mocks.disputeAttempt.mockResolvedValue({
      ok: true,
      result: {
        verdict: { ...RESULT.verdict, rationale: 'Natural and precise.' },
        score: 4,
        rating: 4,
        changed: true,
        rescheduled: true,
        due: '2026-11-20T00:00:00.000Z',
        scheduled_days: 15,
      },
    });
    const user = userEvent.setup();
    render(<Practice />);
    await user.type(await screen.findByLabelText('Fill in the blank'), 'x{Enter}');

    await user.click(await screen.findByRole('button', { name: 'Think this grade is wrong?' }));

    expect(mocks.disputeAttempt).toHaveBeenCalledWith({}, 'a1');
    expect(await screen.findByText('Second opinion: Mastered')).toBeTruthy();
    expect(screen.getByText(/Your next review is now in 2 weeks/)).toBeTruthy();
    expect(screen.getByText('Natural and precise.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /wrong\?$/ })).toBeNull();
  });

  it('says when the second opinion agrees, and lets you retry after an error', async () => {
    mocks.disputeAttempt
      .mockResolvedValueOnce({ ok: false, message: "Couldn't get a second opinion right now. Try again." })
      .mockResolvedValueOnce({
        ok: true,
        result: { verdict: RESULT.verdict, score: 3, rating: 3, changed: false, rescheduled: false, due: null, scheduled_days: null },
      });
    const user = userEvent.setup();
    render(<Practice />);
    await user.type(await screen.findByLabelText('Fill in the blank'), 'x{Enter}');

    await user.click(await screen.findByRole('button', { name: 'Think this grade is wrong?' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /wrong\?$/ }));

    expect(await screen.findByText(/It agrees with the first grade/)).toBeTruthy();
  });
});
