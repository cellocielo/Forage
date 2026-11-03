import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { countReadyWords } from './badge';

/** Easiest first: pick the right usage, fill a frame, write for a scenario, write freely. */
export const TASK_LEVELS = ['choice', 'frame', 'scenario', 'open'] as const;
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
  hints: { partners: string[]; example: string | null; starter: string | null };
}

export interface Task {
  type: TaskType;
  index: number;
  prompt: string;
  register?: string;
  /** Choice tasks: the two sentences, in the order shown. */
  options?: [string, string];
}

// Mirrors scaffoldLevel in supabase/functions/_shared/scheduling.ts; keep the thresholds in step.
const FRAME_BELOW_DAYS = 7;
const SCENARIO_BELOW_DAYS = 21;
const STATE_NEW = 0;

function hasLevel(card: PracticeCard, type: TaskType): boolean {
  switch (type) {
    case 'choice':
      return card.usageChoice !== null;
    case 'frame':
      return card.frames.length > 0;
    case 'scenario':
      return card.scenarios.length > 0;
    case 'open':
      return true;
  }
}

/** Stable per card and review, so the correct sentence isn't always first. */
function choiceFlipped(card: PracticeCard): boolean {
  let hash = card.reps;
  for (const ch of card.id) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return (hash & 1) === 1;
}

function buildTask(card: PracticeCard, type: TaskType): Task {
  // New and weak words alternate between a frame and a usage choice (P8), so frames
  // advance every other review when both exist.
  const frameTurn = card.usageChoice ? Math.floor(card.reps / 2) : card.reps;
  switch (type) {
    case 'choice': {
      const { correct, incorrect } = card.usageChoice!;
      const options: [string, string] = choiceFlipped(card) ? [incorrect, correct] : [correct, incorrect];
      return { type, index: 0, prompt: `Which sentence uses "${card.word}" correctly?`, options };
    }
    case 'frame': {
      const index = frameTurn % card.frames.length;
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

function baseLevel(card: PracticeCard): number {
  if (card.state === STATE_NEW || card.stability < FRAME_BELOW_DAYS) {
    return card.usageChoice && card.reps % 2 === 1 ? 0 : 1;
  }
  return card.stability < SCENARIO_BELOW_DAYS ? 2 : 3;
}

/**
 * The task for this review (P8, P12): frames (alternating with a usage choice) for new and
 * weak words, scenarios in the middle, an open prompt for strong ones. Moves up a level when
 * a sense lacks that scaffold, and rotates through frames and scenarios as the card is reviewed.
 */
export function chooseTask(card: PracticeCard): Task {
  let level = baseLevel(card);
  while (!hasLevel(card, TASK_LEVELS[level]!)) level++;
  return buildTask(card, TASK_LEVELS[level]!);
}

/** "Easier, please" (P12): the next easier task this word has, or null if this is the easiest. */
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
    senses!inner ( part_of_speech, frames, scenarios, usage_choice, hint_partners, hint_example, hint_starter )
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
      frames: string[] | null;
      scenarios: Scenario[] | null;
      usage_choice: UsageChoice | null;
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
    hints: {
      partners: sense.hint_partners ?? [],
      example: sense.hint_example,
      starter: sense.hint_starter,
    },
  };
}

/**
 * The most overdue ready card, or null when nothing is due or today's cap is used up.
 * Uses the same rules as the toolbar badge, so the two always agree.
 */
export async function fetchNextCard(client: SupabaseClient, now: Date = new Date()): Promise<PracticeCard | null> {
  if ((await countReadyWords(client, now)) === 0) return null;

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
): Promise<SubmitResult> {
  return callFunction<GradeResult>(
    client,
    'grade-attempt',
    {
      card_id: card.id,
      task_type: task.type,
      prompt_index: task.index,
      answer: answer.trim(),
      hints_used: task.type === 'choice' ? 0 : hintsUsed,
      easier,
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

export const RATING_LABELS: Record<number, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

/** "tomorrow", "in 3 days", "in 2 weeks" for the next review. */
export function describeNextReview(scheduledDays: number): string {
  if (scheduledDays <= 1) return 'tomorrow';
  if (scheduledDays < 14) return `in ${scheduledDays} days`;
  if (scheduledDays < 60) return `in ${Math.round(scheduledDays / 7)} weeks`;
  return `in ${Math.round(scheduledDays / 30)} months`;
}

// The grader caps by how many hints were opened (scoreToRating): the 2nd caps at Good, the 3rd at Hard.
const CAP_AFTER_STEP = [null, 'Good', 'Hard'] as const;

/** The hint ladder (P11): partners, then an example, then a starter. Missing steps are skipped. */
export function hintSteps(card: PracticeCard): Array<{ label: string; text: string; cap: string | null }> {
  const steps: Array<{ label: string; text: string }> = [];
  if (card.hints.partners.length > 0) steps.push({ label: 'Goes with', text: card.hints.partners.join(' · ') });
  if (card.hints.example) steps.push({ label: 'Example', text: card.hints.example });
  if (card.hints.starter) steps.push({ label: 'Start with', text: `${card.hints.starter}…` });
  return steps.map((step, i) => ({ ...step, cap: CAP_AFTER_STEP[i] ?? null }));
}
