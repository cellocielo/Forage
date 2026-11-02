import { assert, assertEquals, assertNotEquals } from '@std/assert';
import { createEmptyCard, Rating, State } from 'ts-fsrs';
import { type CardRow, reviewCard, scaffoldLevel, scoreToRating } from './scheduling.ts';

const NOW = new Date('2026-11-02T09:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

// Mirrors the column defaults of public.cards.
const NEW_CARD: CardRow = {
  due: NOW.toISOString(),
  stability: 0,
  difficulty: 0,
  scheduled_days: 0,
  learning_steps: 0,
  reps: 0,
  lapses: 0,
  state: State.New,
  last_review: null,
};

const daysUntil = (iso: string, from: Date) => (new Date(iso).getTime() - from.getTime()) / DAY;

Deno.test('the database defaults for a new card match an empty FSRS card', () => {
  const empty = createEmptyCard(NOW);
  const { elapsed_days: _deprecated, last_review: _none, ...fields } = empty;
  assertEquals({ ...fields, due: empty.due.toISOString(), last_review: null }, NEW_CARD);
});

Deno.test('scoreToRating maps scores straight through when at most one hint was used', () => {
  for (const hints of [0, 1] as const) {
    assertEquals([1, 2, 3, 4].map((s) => scoreToRating(s as 1 | 2 | 3 | 4, hints)), [
      Rating.Again,
      Rating.Hard,
      Rating.Good,
      Rating.Easy,
    ]);
  }
});

Deno.test('scoreToRating caps at Good after two hints and at Hard after three', () => {
  assertEquals(scoreToRating(4, 2), Rating.Good);
  assertEquals(scoreToRating(3, 2), Rating.Good);
  assertEquals(scoreToRating(4, 3), Rating.Hard);
  assertEquals(scoreToRating(1, 3), Rating.Again);
});

Deno.test('a first Good review schedules the word days ahead, never minutes', () => {
  const { card, log } = reviewCard(NEW_CARD, Rating.Good, NOW);

  assertEquals(card.state, State.Review);
  assertEquals(card.reps, 1);
  assertEquals(card.last_review, NOW.toISOString());
  assert(daysUntil(card.due, NOW) >= 1, `due in ${daysUntil(card.due, NOW)} days`);
  assertEquals(log.rating, Rating.Good);
  assertEquals(log.state, State.New);
  assertEquals(log.review, NOW.toISOString());
});

Deno.test('Easy schedules further out than Hard, and Again counts a lapse once learned', () => {
  const easy = reviewCard(NEW_CARD, Rating.Easy, NOW).card;
  const hard = reviewCard(NEW_CARD, Rating.Hard, NOW).card;
  assert(easy.due > hard.due);

  const learned = reviewCard(NEW_CARD, Rating.Good, NOW).card;
  const forgot = reviewCard(learned, Rating.Again, new Date(learned.due)).card;
  assertEquals(forgot.lapses, 1);
  assert(forgot.stability < learned.stability);
});

Deno.test('a review uses the time since the last one, read from last_review', () => {
  const learned = reviewCard(NEW_CARD, Rating.Good, NOW).card;
  const onTime = reviewCard(learned, Rating.Good, new Date(learned.due)).card;
  const late = reviewCard(learned, Rating.Good, new Date(new Date(learned.due).getTime() + 30 * DAY)).card;

  // Remembering after a longer gap is stronger evidence, so stability grows more.
  assertNotEquals(onTime.stability, late.stability);
  assert(late.stability > onTime.stability);
});

Deno.test('scaffoldLevel fades from frames to scenarios to open prompts as stability grows', () => {
  assertEquals(scaffoldLevel({ state: State.New, stability: 0 }), 'frame');
  assertEquals(scaffoldLevel({ state: State.Review, stability: 3 }), 'frame');
  assertEquals(scaffoldLevel({ state: State.Review, stability: 10 }), 'scenario');
  assertEquals(scaffoldLevel({ state: State.Review, stability: 40 }), 'open');
});

Deno.test('scaffoldLevel drops one level when the learner asks for easier, but not below frames', () => {
  assertEquals(scaffoldLevel({ state: State.Review, stability: 40 }, true), 'scenario');
  assertEquals(scaffoldLevel({ state: State.Review, stability: 10 }, true), 'frame');
  assertEquals(scaffoldLevel({ state: State.New, stability: 0 }, true), 'frame');
});
