import { z } from 'zod';
import { type CardRow, type HintsUsed, reviewCard, type Score, scoreToRating } from '../_shared/scheduling.ts';
import type { PracticeSense, Task, TaskType, Verdict } from '../grade-attempt/grade.ts';

export const DisputeRequestSchema = z.object({ attempt_id: z.string().uuid() });
export type DisputeRequest = z.infer<typeof DisputeRequestSchema>;

/** A graded attempt as read by its owner, with the sense it was graded against. */
export interface AttemptToDispute {
  id: string;
  card_id: string;
  task_type: TaskType;
  prompt: string;
  answer: string;
  sentence: string;
  hints_used: number;
  rating: number;
  /** When the original review was applied (the ts-fsrs review log's timestamp). */
  reviewed_at: string;
  disputed_at: string | null;
  card_before: CardRow | null;
  sense: PracticeSense | null;
}

export interface DisputeDeps {
  loadAttempt(attemptId: string): Promise<AttemptToDispute | null>;
  /** The card's current review count, or null if it is gone or archived. */
  loadCardReps(cardId: string): Promise<number | null>;
  secondOpinion(sense: PracticeSense, task: Task, answer: string, sentence: string): Promise<Verdict>;
  /** Logs the dispute and applies `newCard` if given; null if already disputed. */
  resolve(
    attempt: AttemptToDispute,
    verdict: Verdict,
    rating: number,
    newCard: CardRow | null,
    expectedReps: number | null,
  ): Promise<boolean | null>;
}

export type DisputeOutcome =
  | {
    ok: true;
    verdict: Verdict;
    score: Score;
    rating: number;
    /** The second opinion's rating differs from the original. */
    changed: boolean;
    /** The card's schedule was redone with the new rating. */
    rescheduled: boolean;
    due: string | null;
    scheduled_days: number | null;
  }
  | { ok: false; status: 400 | 404 | 409; error: string };

/** The task as the learner saw it; scenarios get their register back from the sense. */
export function taskForAttempt(attempt: AttemptToDispute, sense: PracticeSense): Task {
  const register = attempt.task_type === 'scenario'
    ? sense.scenarios?.find((s) => s.situation === attempt.prompt)?.register
    : undefined;
  return { type: attempt.task_type, prompt: attempt.prompt, ...(register ? { register } : {}) };
}

/**
 * G3: regrades a disputed attempt on a stronger model. The second opinion is final. If its
 * rating differs and the card hasn't been reviewed since, the review is redone from the
 * card's state before it, at the original review time, so the schedule is as if the second
 * opinion had been the grade.
 */
export async function disputeAttempt(request: DisputeRequest, deps: DisputeDeps): Promise<DisputeOutcome> {
  const attempt = await deps.loadAttempt(request.attempt_id);
  if (!attempt || !attempt.sense) return { ok: false, status: 404, error: 'Attempt not found' };
  if (attempt.disputed_at) return { ok: false, status: 409, error: 'You already disputed this grade' };
  if (attempt.task_type === 'choice') {
    return { ok: false, status: 400, error: 'Choice answers are checked automatically' };
  }

  const task = taskForAttempt(attempt, attempt.sense);
  const verdict = await deps.secondOpinion(attempt.sense, task, attempt.answer, attempt.sentence);
  const score = verdict.score as Score;
  const rating = scoreToRating(score, attempt.hints_used as HintsUsed);
  const changed = rating !== attempt.rating;

  let newCard: CardRow | null = null;
  let expectedReps: number | null = null;
  if (changed && attempt.card_before) {
    const reps = await deps.loadCardReps(attempt.card_id);
    if (reps === attempt.card_before.reps + 1) {
      newCard = reviewCard(attempt.card_before, rating, new Date(attempt.reviewed_at)).card;
      expectedReps = reps;
    }
  }

  const rescheduled = await deps.resolve(attempt, verdict, rating, newCard, expectedReps);
  if (rescheduled === null) return { ok: false, status: 409, error: 'You already disputed this grade' };

  return {
    ok: true,
    verdict,
    score,
    rating,
    changed,
    rescheduled,
    due: rescheduled && newCard ? newCard.due : null,
    scheduled_days: rescheduled && newCard ? newCard.scheduled_days : null,
  };
}
