import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { countReadyWords, DAILY_CAP, startOfLocalDay } from './ready';
import { parseOtherMeanings, type OtherMeaning, type OtherMeaningsColumn } from './meaning';

/**
 * Easiest first: pick the right usage, pick the ending for a frame, type the ending, write for
 * a scenario, write freely.
 */
export const TASK_LEVELS = ['choice', 'pick', 'frame', 'scenario', 'open'] as const;
export type TaskType = (typeof TASK_LEVELS)[number];

export interface Scenario {
  register: string;
  situation: string;
}

export interface UsageChoice {
  correct: string;
  incorrect: string;
  mistake: string;
}

/** A frame's multiple-choice version: the right ending and two wrong ones. */
export interface FrameChoice {
  answer: string;
  wrong: [string, string];
  why: string;
}

export interface RecentAttempt {
  type: TaskType;
  prompt: string;
  /** For a choice task, the sentence picked, which says which pair was shown. */
  answer: string;
  rating: number;
}

export interface PracticeCard {
  id: string;
  state: number;
  stability: number;
  reps: number;
  word: string;
  partOfSpeech: string;
  frames: string[];
  scenarios: Scenario[];
  /** "Which is correct?" pairs, by index; null where a pair was retired. */
  usageChoices: Array<UsageChoice | null>;
  /** One per frame, in the same order; null where a frame has no choice. */
  frameChoices: Array<FrameChoice | null>;
  /** This word's latest attempts, newest first, so questions it just saw aren't repeated. */
  recent: RecentAttempt[];
  hints: { partners: string[]; example: string | null; starter: string | null };
  /** Shown after answering: this meaning, its other meanings, and example sentences. */
  definition: string;
  otherMeanings: OtherMeaning[];
  examples: string[];
}

export interface Task {
  type: TaskType;
  index: number;
  prompt: string;
  register?: string;
  /** Choice tasks: the two sentences; pick tasks: the three endings. In the order shown. */
  options?: string[];
}

// Mirrors scaffoldLevel in supabase/functions/_shared/scheduling.ts; keep the thresholds in step.
const FRAME_BELOW_DAYS = 7;
const SCENARIO_BELOW_DAYS = 21;
const STATE_NEW = 0;

// Correct multiple-choice answers in a row (since the last missed typed answer) after which a
// weak word moves on to typing: recognizing it again teaches little once it's easy.
const CHOICE_STREAK_TO_MOVE_ON = 2;
const RATING_GOOD = 3;

function hasLevel(card: PracticeCard, type: TaskType): boolean {
  switch (type) {
    case 'choice':
      return choiceIndexes(card).length > 0;
    case 'pick':
      return pickIndexes(card).length > 0;
    case 'frame':
      return card.frames.length > 0;
    case 'scenario':
      return card.scenarios.length > 0;
    case 'open':
      return true;
  }
}

function choiceIndexes(card: PracticeCard): number[] {
  return card.usageChoices.flatMap((choice, i) => (choice ? [i] : []));
}

/** Frames that have a multiple-choice version. */
function pickIndexes(card: PracticeCard): number[] {
  return card.frames.flatMap((_, i) => (card.frameChoices[i] ? [i] : []));
}

/** Stable per card and review, so the right answer isn't always in the same place. */
function cardHash(card: PracticeCard): number {
  let hash = card.reps;
  for (const ch of card.id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

function rotate<T>(items: T[], by: number): T[] {
  const n = by % items.length;
  return [...items.slice(n), ...items.slice(0, n)];
}

/**
 * How many attempts ago (0 is the latest) the learner last saw a question, or Infinity if not
 * in recent history. A frame counts as seen whether it was picked or typed, so the sentence
 * just answered by picking doesn't come straight back to type.
 */
function lastSeen(card: PracticeCard, matches: (attempt: RecentAttempt) => boolean): number {
  const at = card.recent.findIndex(matches);
  return at < 0 ? Infinity : at;
}

function seenQuestion(card: PracticeCard, type: TaskType, index: number): number {
  switch (type) {
    case 'choice': {
      const pair = card.usageChoices[index];
      return pair ? lastSeen(card, (a) => a.type === 'choice' && (a.answer === pair.correct || a.answer === pair.incorrect)) : Infinity;
    }
    case 'pick':
    case 'frame': {
      const frame = card.frames[index];
      return lastSeen(card, (a) => (a.type === 'pick' || a.type === 'frame') && a.prompt === frame);
    }
    case 'scenario': {
      const situation = card.scenarios[index]?.situation;
      return lastSeen(card, (a) => a.type === 'scenario' && a.prompt === situation);
    }
    case 'open':
      return Infinity;
  }
}

/** The question seen longest ago (or never), starting from a per-review spot to break ties. */
function freshest(card: PracticeCard, type: TaskType, indexes: number[]): number {
  let best = indexes[0]!;
  let bestSeen = -1;
  for (const index of rotate(indexes, cardHash(card))) {
    const seen = seenQuestion(card, type, index);
    if (seen > bestSeen) [best, bestSeen] = [index, seen];
  }
  return best;
}

function indexesFor(card: PracticeCard, type: TaskType): number[] {
  switch (type) {
    case 'choice':
      return choiceIndexes(card);
    case 'pick':
      return pickIndexes(card);
    case 'frame':
      return card.frames.map((_, i) => i);
    case 'scenario':
      return card.scenarios.map((_, i) => i);
    case 'open':
      return [0];
  }
}

function buildTask(card: PracticeCard, type: TaskType): Task {
  const index = freshest(card, type, indexesFor(card, type));
  switch (type) {
    case 'choice': {
      const { correct, incorrect } = card.usageChoices[index]!;
      const options = rotate([correct, incorrect], cardHash(card));
      return { type, index, prompt: `Which sentence uses "${card.word}" correctly?`, options };
    }
    case 'pick': {
      const { answer, wrong } = card.frameChoices[index]!;
      return { type, index, prompt: card.frames[index]!, options: rotate([answer, ...wrong], cardHash(card)) };
    }
    case 'frame':
      return { type, index, prompt: card.frames[index]! };
    case 'scenario': {
      const scenario = card.scenarios[index]!;
      return { type, index, prompt: scenario.situation, register: scenario.register };
    }
    case 'open':
      return { type, index: 0, prompt: `Write a sentence using "${card.word}".` };
  }
}

/**
 * Correct multiple-choice answers in a row, newest first. Correct typed answers don't break the
 * run, but a missed one does, so a word that slips goes back to multiple choice.
 */
export function choiceStreak(recent: RecentAttempt[]): number {
  let streak = 0;
  for (const attempt of recent) {
    if (isAutoChecked(attempt.type)) {
      if (attempt.rating < RATING_GOOD) break;
      streak++;
    } else if (attempt.rating <= 1) {
      break;
    }
  }
  return streak;
}

// New and weak words rotate through these, starting with picking a frame's ending (P8).
const WEAK_ROTATION: TaskType[] = ['pick', 'choice', 'frame'];

export interface ChooseOptions {
  /** "Keep practicing": extra reviews of words that aren't due, which should make you write. */
  extra?: boolean;
}

/**
 * The task for this review (P8, P12): new and weak words rotate through picking a frame's
 * ending, choosing the right usage, and typing a frame's ending, taking whichever type was
 * done longest ago; mid-stability words get scenarios, strong ones an open prompt. Within a
 * type, the question seen longest ago comes up. A weak word skips multiple choice after a run
 * of right answers, and in "Keep practicing". Moves up a level when a sense lacks a scaffold.
 */
export function chooseTask(card: PracticeCard, { extra = false }: ChooseOptions = {}): Task {
  const weak = card.state === STATE_NEW || card.stability < FRAME_BELOW_DAYS;
  if (weak) {
    const skipChoices = extra || choiceStreak(card.recent) >= CHOICE_STREAK_TO_MOVE_ON;
    const rotation = WEAK_ROTATION.filter((type) => hasLevel(card, type) && !(skipChoices && isAutoChecked(type)));
    if (rotation.length > 0) {
      let type = rotation[0]!;
      let typeSeen = -1;
      for (const candidate of rotation) {
        const seen = lastSeen(card, (a) => a.type === candidate);
        if (seen > typeSeen) [type, typeSeen] = [candidate, seen];
      }
      return buildTask(card, type);
    }
  }
  let level = TASK_LEVELS.indexOf(weak || card.stability < SCENARIO_BELOW_DAYS ? 'scenario' : 'open');
  while (!hasLevel(card, TASK_LEVELS[level]!)) level++;
  return buildTask(card, TASK_LEVELS[level]!);
}

/** Multiple-choice tasks: checked against stored answers, with no hints and no disputes. */
export function isAutoChecked(type: TaskType): boolean {
  return type === 'choice' || type === 'pick';
}

/** "Easier, please" (P12): the next easier task this word has, or null if this is the easiest. */
export function easierTask(card: PracticeCard, task: Task): Task | null {
  for (let level = TASK_LEVELS.indexOf(task.type) - 1; level >= 0; level--) {
    const type = TASK_LEVELS[level]!;
    if (hasLevel(card, type)) return buildTask(card, type);
  }
  return null;
}

// Enough history to cover every question a word has, so none repeats before the others.
const RECENT_ATTEMPTS = 12;

const PRACTICE_READY = 'captures.senses.practice_ready';

const CARD_SELECT = `
  id, state, stability, reps,
  attempts ( task_type, prompt, answer, rating, created_at ),
  captures!inner (
    word,
    lemmas ( lemma ),
    senses!inner ( practice_ready, part_of_speech, definition, examples, other_meanings, frames, frame_choices, scenarios, usage_choices, hint_partners, hint_example, hint_starter )
  )
`;

interface CardQueryRow {
  id: string;
  state: number;
  stability: number;
  reps: number;
  attempts: Array<{ task_type: TaskType; prompt: string; answer: string; rating: number; created_at: string }> | null;
  captures: {
    word: string;
    lemmas: { lemma: string } | null;
    senses: {
      part_of_speech: string;
      definition: string;
      examples: string[] | null;
      other_meanings: OtherMeaningsColumn;
      frames: string[] | null;
      scenarios: Scenario[] | null;
      usage_choices: Array<UsageChoice | null> | null;
      frame_choices: Array<FrameChoice | null> | null;
      hint_partners: string[] | null;
      hint_example: string | null;
      hint_starter: string | null;
    };
  };
}

function toPracticeCard(row: CardQueryRow): PracticeCard {
  const { captures } = row;
  const sense = captures.senses;
  return {
    id: row.id,
    state: row.state,
    stability: row.stability,
    reps: row.reps,
    // Ordered by the query, but sorted again so a missing order can't scramble "recent".
    recent: [...(row.attempts ?? [])]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, RECENT_ATTEMPTS)
      .map((a) => ({ type: a.task_type, prompt: a.prompt, answer: a.answer, rating: a.rating })),
    word: captures.lemmas?.lemma ?? captures.word,
    partOfSpeech: sense.part_of_speech,
    frames: sense.frames ?? [],
    scenarios: sense.scenarios ?? [],
    usageChoices: sense.usage_choices ?? [],
    frameChoices: sense.frame_choices ?? [],
    hints: {
      partners: sense.hint_partners ?? [],
      example: sense.hint_example,
      starter: sense.hint_starter,
    },
    definition: sense.definition,
    otherMeanings: parseOtherMeanings(sense.other_meanings),
    // The hint example is used up by then, so it's one more to show.
    examples: [...new Set([...(sense.examples ?? []), ...(sense.hint_example ? [sense.hint_example] : [])])],
  };
}

/**
 * The most overdue ready card, or null when nothing is due or today's cap is used up.
 * Uses the same rules as the toolbar badge, so the two always agree.
 */
export async function fetchNextCard(
  client: SupabaseClient,
  now: Date = new Date(),
  dailyCap: number = DAILY_CAP,
): Promise<PracticeCard | null> {
  if ((await countReadyWords(client, now, dailyCap)) === 0) return null;

  const nowIso = now.toISOString();
  const { data, error } = await client
    .from('cards')
    .select(CARD_SELECT)
    // A word saved seconds ago has its meaning but not yet its practice material.
    .eq(PRACTICE_READY, true)
    .is('archived_at', null)
    .lte('due', nowIso)
    .or(`snoozed_until.is.null,snoozed_until.lte."${nowIso}"`)
    .order('created_at', { referencedTable: 'attempts', ascending: false })
    .limit(RECENT_ATTEMPTS, { referencedTable: 'attempts' })
    .order('due', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toPracticeCard(data as unknown as CardQueryRow) : null;
}

/**
 * "Keep practicing": once nothing is ready, the word due soonest that hasn't come up in this
 * session, or null if every word has. Snoozed and archived words stay out.
 */
export async function fetchExtraCard(
  client: SupabaseClient,
  now: Date = new Date(),
  seenIds: string[] = [],
): Promise<PracticeCard | null> {
  const nowIso = now.toISOString();
  let query = client
    .from('cards')
    .select(CARD_SELECT)
    // A word saved seconds ago has its meaning but not yet its practice material.
    .eq(PRACTICE_READY, true)
    .is('archived_at', null)
    .or(`snoozed_until.is.null,snoozed_until.lte."${nowIso}"`);
  if (seenIds.length > 0) query = query.not('id', 'in', `(${seenIds.join(',')})`);
  const { data, error } = await query
    .order('created_at', { referencedTable: 'attempts', ascending: false })
    .limit(RECENT_ATTEMPTS, { referencedTable: 'attempts' })
    .order('due', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toPracticeCard(data as unknown as CardQueryRow) : null;
}

// Snoozes push a word past its due date, so check this many of the soonest for the true next one.
const NEXT_DUE_LOOKAHEAD = 50;

/**
 * When practice next opens up, for the caught-up screen: the soonest word due (after any
 * snooze), or "cap" when words are due but today's limit is used up. Null when there are no
 * words to practice.
 */
export type NextPractice = { kind: 'cap' } | { kind: 'due'; at: Date };

export async function fetchNextPractice(client: SupabaseClient, now: Date = new Date()): Promise<NextPractice | null> {
  const { data, error } = await client
    .from('cards')
    .select('due, snoozed_until')
    .is('archived_at', null)
    .order('due', { ascending: true })
    .limit(NEXT_DUE_LOOKAHEAD);
  if (error) throw new Error(error.message);

  let soonest: number | null = null;
  for (const row of (data ?? []) as Array<{ due: string; snoozed_until: string | null }>) {
    const at = Math.max(Date.parse(row.due), row.snoozed_until ? Date.parse(row.snoozed_until) : 0);
    if (!Number.isNaN(at) && (soonest === null || at < soonest)) soonest = at;
  }
  if (soonest === null) return null;
  // Called once nothing is ready, so a word that's already due is held back by the daily limit.
  if (soonest <= now.getTime()) return { kind: 'cap' };
  return { kind: 'due', at: new Date(soonest) };
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Roughly when, on purpose: "in a few minutes", "in about 3 hours", "tomorrow", "in 4 days".
 * Exact times invite checking back; reminders handle the rest.
 */
export function describeWhen(at: Date, now: Date = new Date()): string {
  const ms = at.getTime() - now.getTime();
  if (ms < 15 * 60 * 1000) return 'in a few minutes';
  if (ms < 50 * 60 * 1000) return 'in under an hour';
  if (ms < 12 * HOUR_MS) {
    const hours = Math.max(1, Math.round(ms / HOUR_MS));
    return hours === 1 ? 'in about an hour' : `in about ${hours} hours`;
  }
  // Calendar days, so 10pm to 9am the next morning reads as tomorrow.
  const days = Math.round((startOfLocalDay(at).getTime() - startOfLocalDay(now).getTime()) / (24 * HOUR_MS));
  if (days <= 0) return 'later today';
  return describeNextReview(days);
}

export interface Verdict {
  sense: 'correct' | 'different_sense' | 'wrong';
  grammar: 'correct' | 'minor_errors' | 'major_errors';
  collocation: 'natural' | 'slightly_unnatural' | 'unnatural';
  tone: 'fits' | 'slightly_off' | 'mismatch' | 'not_applicable';
  corrected_sentence: string;
  rationale: string;
  score: number;
}

export interface GradeResult {
  attempt_id: string;
  sentence: string;
  verdict: Verdict;
  score: number;
  rating: number;
  due: string;
  scheduled_days: number;
}

export type CallResult<T> = { ok: true; result: T } | { ok: false; message: string };
export type SubmitResult = CallResult<GradeResult>;

/** Calls an Edge Function, turning its { error } body or a network failure into a message. */
async function callFunction<T>(client: SupabaseClient, name: string, body: object, fallback: string): Promise<CallResult<T>> {
  const { data, error } = await client.functions.invoke<T>(name, { body });
  if (!error && data) return { ok: true, result: data };

  if (error instanceof FunctionsHttpError) {
    const payload = await (error.context as Response).json().catch(() => null);
    if (payload && typeof payload.error === 'string') return { ok: false, message: payload.error };
  }
  return { ok: false, message: fallback };
}

export function submitAttempt(
  client: SupabaseClient,
  card: PracticeCard,
  task: Task,
  answer: string,
  hintsUsed: number,
  easier = false,
  extra = false,
): Promise<SubmitResult> {
  return callFunction<GradeResult>(
    client,
    'grade-attempt',
    {
      card_id: card.id,
      task_type: task.type,
      prompt_index: task.index,
      answer: answer.trim(),
      hints_used: isAutoChecked(task.type) ? 0 : hintsUsed,
      easier,
      extra,
    },
    "Couldn't grade right now. Check your connection and try again.",
  );
}

export interface DisputeResult {
  verdict: Verdict;
  score: number;
  rating: number;
  changed: boolean;
  rescheduled: boolean;
  due: string | null;
  scheduled_days: number | null;
}

/** "I disagree with this grade" (G3): a second opinion from a stronger model, which is final. */
export function disputeAttempt(client: SupabaseClient, attemptId: string): Promise<CallResult<DisputeResult>> {
  return callFunction<DisputeResult>(
    client,
    'dispute-attempt',
    { attempt_id: attemptId },
    "Couldn't get a second opinion right now. Check your connection and try again.",
  );
}

// Shown to the learner as how well they know the word. The FSRS ratings behind them are
// Again, Hard, Good and Easy (1 to 4).
export const RATING_LABELS: Record<number, string> = { 1: 'Not yet', 2: 'Shaky', 3: 'Solid', 4: 'Mastered' };

/** "tomorrow", "in 3 days", "in 2 weeks" for the next review. */
export function describeNextReview(scheduledDays: number): string {
  if (scheduledDays <= 1) return 'tomorrow';
  if (scheduledDays < 14) return `in ${scheduledDays} days`;
  if (scheduledDays < 60) return `in ${Math.round(scheduledDays / 7)} weeks`;
  return `in ${Math.round(scheduledDays / 30)} months`;
}

function starterIsGiven(starter: string, task?: Pick<Task, 'type' | 'prompt'>): boolean {
  if (!task) return false;
  if (task.type === 'frame') return true;
  const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return squash(task.prompt).includes(squash(starter));
}

// The grader caps by how many hints were opened (scoreToRating): the 2nd caps at Good, the 3rd at Hard.
const CAP_AFTER_STEP = [null, RATING_LABELS[3]!, RATING_LABELS[2]!] as const;

/**
 * The hint ladder (P11): partners, then an example, then a starter. Missing steps are skipped,
 * and so is the starter on a fill-in-the-blank task, which already gives the start of the
 * sentence (sometimes the very same words, when the starter became the frame).
 */
export function hintSteps(
  card: PracticeCard,
  task?: Pick<Task, 'type' | 'prompt'>,
): Array<{ label: string; text: string; cap: string | null }> {
  const steps: Array<{ label: string; text: string }> = [];
  if (card.hints.partners.length > 0) steps.push({ label: 'Goes with', text: card.hints.partners.join(' · ') });
  if (card.hints.example) steps.push({ label: 'Example', text: card.hints.example });
  if (card.hints.starter && !starterIsGiven(card.hints.starter, task)) {
    steps.push({ label: 'Start with', text: `${card.hints.starter}…` });
  }
  return steps.map((step, i) => ({ ...step, cap: CAP_AFTER_STEP[i] ?? null }));
}
