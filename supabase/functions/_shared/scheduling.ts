import { type CardInput, fsrs, type Grade, Rating, State } from 'ts-fsrs';

// Practice happens at most a few times a day from a new tab, so minute-long learning
// steps don't apply: every review schedules in whole days. No fuzz keeps it predictable
// while the daily cap (S3) already limits how many cards come due at once.
const scheduler = fsrs({ enable_short_term: false, enable_fuzz: false });

/** A card's FSRS state as stored in public.cards. */
export interface CardRow {
  due: string;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: State;
  last_review: string | null;
}

export type Score = 1 | 2 | 3 | 4;

/** Hint steps revealed before answering (P9): partners, then an example, then a starter. */
export type HintsUsed = 0 | 1 | 2 | 3;

/**
 * Maps the grader's 1-4 score to an FSRS rating (S2). The first hint is free; the second
 * caps the rating at Good and the third at Hard, since the learner produced less on their own.
 */
export function scoreToRating(score: Score, hintsUsed: HintsUsed): Grade {
  const cap = hintsUsed >= 3 ? Rating.Hard : hintsUsed === 2 ? Rating.Good : Rating.Easy;
  return Math.min(score, cap) as Grade;
}

export interface ReviewLogRow {
  rating: Grade;
  state: State;
  due: string;
  stability: number;
  difficulty: number;
  scheduled_days: number;
  review: string;
}

/** Schedules the card's next review. Returns the new card state and a log of this review. */
export function reviewCard(row: CardRow, rating: Grade, now: Date): { card: CardRow; log: ReviewLogRow } {
  const input: CardInput = {
    ...row,
    // Deprecated in ts-fsrs 5; the scheduler derives elapsed time from last_review.
    elapsed_days: 0,
    last_review: row.last_review,
  };
  const { card, log } = scheduler.next(input, now, rating);
  return {
    card: {
      due: card.due.toISOString(),
      stability: card.stability,
      difficulty: card.difficulty,
      scheduled_days: card.scheduled_days,
      learning_steps: card.learning_steps,
      reps: card.reps,
      lapses: card.lapses,
      state: card.state,
      last_review: card.last_review?.toISOString() ?? null,
    },
    log: {
      rating,
      state: log.state,
      due: log.due.toISOString(),
      stability: log.stability,
      difficulty: log.difficulty,
      scheduled_days: log.scheduled_days,
      review: log.review.toISOString(),
    },
  };
}

export type ScaffoldLevel = 'frame' | 'scenario' | 'open';

// Stability is roughly how many days the word stays recallable. Thresholds are starting
// guesses to tune with real data.
const FRAME_BELOW_DAYS = 7;
const SCENARIO_BELOW_DAYS = 21;
const LEVELS: ScaffoldLevel[] = ['frame', 'scenario', 'open'];

/**
 * How much structure the next prompt gets (P10): new words get frames, mid-stability words
 * get scenarios, strong words get open prompts. "Easier, please" drops one level.
 */
export function scaffoldLevel(card: Pick<CardRow, 'state' | 'stability'>, easier = false): ScaffoldLevel {
  const level = card.state === State.New || card.stability < FRAME_BELOW_DAYS
    ? 0
    : card.stability < SCENARIO_BELOW_DAYS
    ? 1
    : 2;
  return LEVELS[Math.max(0, level - (easier ? 1 : 0))]!;
}
