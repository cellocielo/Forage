import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { countReadyWords, DAILY_CAP } from './ready';
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

export interface PracticeCard {
  id: string;
  state: number;
  stability: number;
  reps: number;
  word: string;
  partOfSpeech: string;
  frames: string[];
  scenarios: Scenario[];
  usageChoice: UsageChoice | null;
  /** One per frame, in the same order; null where a frame has no choice. */
  frameChoices: Array<FrameChoice | null>;
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

function hasLevel(card: PracticeCard, type: TaskType): boolean {
  switch (type) {
    case 'choice':
      return card.usageChoice !== null;
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

function buildTask(card: PracticeCard, type: TaskType): Task {
  switch (type) {
    case 'choice': {
      const { correct, incorrect } = card.usageChoice!;
      const options = rotate([correct, incorrect], cardHash(card));
      return { type, index: 0, prompt: `Which sentence uses "${card.word}" correctly?`, options };
    }
    case 'pick': {
      const indexes = pickIndexes(card);
      const index = indexes[card.reps % indexes.length]!;
      const { answer, wrong } = card.frameChoices[index]!;
      return { type, index, prompt: card.frames[index]!, options: rotate([answer, ...wrong], cardHash(card)) };
    }
    case 'frame': {
      const index = card.reps % card.frames.length;
      return { type, index, prompt: card.frames[index]! };
    }
    case 'scenario': {
      const index = card.reps % card.scenarios.length;
      const scenario = card.scenarios[index]!;
      return { type, index, prompt: scenario.situation, register: scenario.register };
    }
    case 'open':
      return { type, index: 0, prompt: `Write a sentence using "${card.word}".` };
  }
}

// New and weak words rotate through these, starting with picking a frame's ending (P8).
const WEAK_ROTATION: TaskType[] = ['pick', 'choice', 'frame'];

/**
 * The task for this review (P8, P12): new and weak words rotate through picking a frame's
 * ending, choosing the right usage, and typing a frame's ending; mid-stability words get
 * scenarios, strong ones an open prompt. Moves up a level when a sense lacks that scaffold,
 * and rotates through frames and scenarios as the card is reviewed.
 */
export function chooseTask(card: PracticeCard): Task {
  const weak = card.state === STATE_NEW || card.stability < FRAME_BELOW_DAYS;
  if (weak) {
    const rotation = WEAK_ROTATION.filter((type) => hasLevel(card, type));
    if (rotation.length > 0) return buildTask(card, rotation[card.reps % rotation.length]!);
  }
  let level = TASK_LEVELS.indexOf(weak || card.stability < SCENARIO_BELOW_DAYS ? 'scenario' : 'open');
  while (!hasLevel(card, TASK_LEVELS[level]!)) level++;
  return buildTask(card, TASK_LEVELS[level]!);
}

/** "Easier, please" (P12): the next easier task this word has, or null if this is the easiest. */
/** Multiple-choice tasks: checked against stored answers, with no hints and no disputes. */
export function isAutoChecked(type: TaskType): boolean {
  return type === 'choice' || type === 'pick';
}

export function easierTask(card: PracticeCard, task: Task): Task | null {
  for (let level = TASK_LEVELS.indexOf(task.type) - 1; level >= 0; level--) {
    const type = TASK_LEVELS[level]!;
    if (hasLevel(card, type)) return buildTask(card, type);
  }
  return null;
}

const CARD_SELECT = `
  id, state, stability, reps,
  captures!inner (
    word,
    lemmas ( lemma ),
    senses!inner ( part_of_speech, definition, examples, other_meanings, frames, frame_choices, scenarios, usage_choice, hint_partners, hint_example, hint_starter )
  )
`;

interface CardQueryRow {
  id: string;
  state: number;
  stability: number;
  reps: number;
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
      usage_choice: UsageChoice | null;
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
    word: captures.lemmas?.lemma ?? captures.word,
    partOfSpeech: sense.part_of_speech,
    frames: sense.frames ?? [],
    scenarios: sense.scenarios ?? [],
    usageChoice: sense.usage_choice ?? null,
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
    .is('archived_at', null)
    .lte('due', nowIso)
    .or(`snoozed_until.is.null,snoozed_until.lte."${nowIso}"`)
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
    .is('archived_at', null)
    .or(`snoozed_until.is.null,snoozed_until.lte."${nowIso}"`);
  if (seenIds.length > 0) query = query.not('id', 'in', `(${seenIds.join(',')})`);
  const { data, error } = await query.order('due', { ascending: true }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toPracticeCard(data as unknown as CardQueryRow) : null;
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

// The grader caps by how many hints were opened (scoreToRating): the 2nd caps at Good, the 3rd at Hard.
const CAP_AFTER_STEP = [null, RATING_LABELS[3]!, RATING_LABELS[2]!] as const;

/** The hint ladder (P11): partners, then an example, then a starter. Missing steps are skipped. */
export function hintSteps(card: PracticeCard): Array<{ label: string; text: string; cap: string | null }> {
  const steps: Array<{ label: string; text: string }> = [];
  if (card.hints.partners.length > 0) steps.push({ label: 'Goes with', text: card.hints.partners.join(' · ') });
  if (card.hints.example) steps.push({ label: 'Example', text: card.hints.example });
  if (card.hints.starter) steps.push({ label: 'Start with', text: `${card.hints.starter}…` });
  return steps.map((step, i) => ({ ...step, cap: CAP_AFTER_STEP[i] ?? null }));
}
