import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GradeResult, PracticeCard } from '@/lib/practice';
import { Practice } from './Practice';

const mocks = vi.hoisted(() => ({ fetchNextCard: vi.fn(), submitAttempt: vi.fn(), refreshBadge: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('@/lib/badge', () => ({ refreshBadge: mocks.refreshBadge }));
vi.mock('@/lib/practice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/practice')>()),
  fetchNextCard: mocks.fetchNextCard,
  submitAttempt: mocks.submitAttempt,
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
  hints: { partners: ['an egregious error'], example: 'The printer jam was egregious.', starter: 'The call was' },
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
  mocks.fetchNextCard.mockResolvedValue(CARD);
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

    expect(mocks.submitAttempt).toHaveBeenCalledWith({}, CARD, expect.objectContaining({ type: 'frame', index: 0 }), 'the crowd booed', 0);
    expect(await screen.findByText('Good')).toBeTruthy();
    expect(screen.getByText(RESULT.verdict.rationale)).toBeTruthy();
    expect(screen.getByText(RESULT.verdict.corrected_sentence)).toBeTruthy();
    expect(screen.getByText('Next review in 3 days.')).toBeTruthy();
    expect(mocks.refreshBadge).toHaveBeenCalled();
  });

  it('reveals hints one at a time, says which ones cap the score, and reports how many were used', async () => {
    const user = userEvent.setup();
    render(<Practice />);
    await screen.findByLabelText('Fill in the blank');

    await user.click(screen.getByRole('button', { name: 'Stuck?' }));
    expect(screen.getByText('an egregious error')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Another hint (max Good)' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Another hint (max Good)' }));
    await user.click(screen.getByRole('button', { name: 'Another hint (max Hard)' }));
    expect(screen.getByText('The call was…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /hint/i })).toBeNull();

    await user.type(screen.getByLabelText('Fill in the blank'), 'x');
    await user.click(screen.getByRole('button', { name: 'Check' }));
    expect(mocks.submitAttempt.mock.calls[0]![4]).toBe(3);
  });

  it('uses a sentence box for scenarios', async () => {
    mocks.fetchNextCard.mockResolvedValue({ ...CARD, state: 2, stability: 10 });
    render(<Practice />);

    expect(await screen.findByText('Email the league office.')).toBeTruthy();
    expect(screen.getByText('formal')).toBeTruthy();
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

  it('loads the next word after a result', async () => {
    const user = userEvent.setup();
    render(<Practice />);
    await user.type(await screen.findByLabelText('Fill in the blank'), 'x{Enter}');
    mocks.fetchNextCard.mockResolvedValue(null);

    await user.click(await screen.findByRole('button', { name: 'Next word' }));

    expect(await screen.findByText('All caught up')).toBeTruthy();
    expect(mocks.fetchNextCard).toHaveBeenCalledTimes(2);
  });

  it('says when nothing is ready, and offers a retry when loading fails', async () => {
    mocks.fetchNextCard.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(null);
    render(<Practice />);

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('All caught up')).toBeTruthy();
  });
});
