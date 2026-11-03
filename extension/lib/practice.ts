import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';
import { countReadyWords } from './badge';

export type TaskType = 'frame' | 'scenario' | 'open';

export interface Scenario {
  register: string;
  situation: string;
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
  hints: { partners: string[]; example: string | null; starter: string | null };
}

export interface Task {
  type: TaskType;
  index: number;
  prompt: string;
  register?: string;
}

// Mirrors scaffoldLevel in supabase/functions/_shared/scheduling.ts; keep the thresholds in step.
const FRAME_BELOW_DAYS = 7;
const SCENARIO_BELOW_DAYS = 21;
const STATE_NEW = 0;

/**
 * The task for this review (P8, P12): frames for new and weak words, scenarios in the middle,
 * an open prompt for strong ones. Falls back a level when a sense lacks that scaffold, and
 * rotates through the frames or scenarios as the card is reviewed.
 */
export function chooseTask(card: PracticeCard): Task {
  const level =
    card.state === STATE_NEW || card.stability < FRAME_BELOW_DAYS
      ? 'frame'
      : card.stability < SCENARIO_BELOW_DAYS
        ? 'scenario'
        : 'open';

  if (level === 'frame' && card.frames.length > 0) {
    const index = card.reps % card.frames.length;
    return { type: 'frame', index, prompt: card.frames[index]! };
  }
  if (level !== 'open' && card.scenarios.length > 0) {
    const index = card.reps % card.scenarios.length;
    const scenario = card.scenarios[index]!;
    return { type: 'scenario', index, prompt: scenario.situation, register: scenario.register };
  }
  return { type: 'open', index: 0, prompt: `Write a sentence using "${card.word}".` };
}

const CARD_SELECT = `
  id, state, stability, reps,
  captures!inner (
    word,
    lemmas ( lemma ),
    senses!inner ( part_of_speech, frames, scenarios, hint_partners, hint_example, hint_starter )
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

export type SubmitResult = { ok: true; result: GradeResult } | { ok: false; message: string };

export async function submitAttempt(
  client: SupabaseClient,
  card: PracticeCard,
  task: Task,
  answer: string,
  hintsUsed: number,
): Promise<SubmitResult> {
  const { data, error } = await client.functions.invoke<GradeResult>('grade-attempt', {
    body: {
      card_id: card.id,
      task_type: task.type,
      prompt_index: task.index,
      answer: answer.trim(),
      hints_used: hintsUsed,
    },
  });
  if (!error && data) return { ok: true, result: data };

  if (error instanceof FunctionsHttpError) {
    const body = await (error.context as Response).json().catch(() => null);
    if (body && typeof body.error === 'string') return { ok: false, message: body.error };
  }
  return { ok: false, message: "Couldn't grade right now. Check your connection and try again." };
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
