import Anthropic from '@anthropic-ai/sdk';
import { withSupabase } from '@supabase/server';
import type { CardRow } from '../_shared/scheduling.ts';
import {
  type CardToGrade,
  DEFAULT_MODEL,
  DISPUTE_MODEL,
  type GradeDeps,
  gradeAttempt,
  GradeRequestSchema,
  GradingRefusedError,
  generateSecondOpinion,
  generateVerdict,
  type PracticeSense,
  PROMPT_VERSION,
} from './grade.ts';

const model = Deno.env.get('GRADE_MODEL') ?? DEFAULT_MODEL;
// The stronger model that checks low or unsure grades before they're shown (G6).
const checkModel = Deno.env.get('DISPUTE_MODEL') ?? DISPUTE_MODEL;

// RLS on cards, captures and senses limits this to the caller's own words.
const CARD_SELECT = `
  id, due, stability, difficulty, scheduled_days, learning_steps, reps, lapses, state, last_review, archived_at,
  captures!inner (
    lemmas ( lemma ),
    senses ( id, part_of_speech, definition, frames, scenarios, usage_choices, frame_choices )
  )
`;

// Called from the extension popup with the signed-in user's JWT.
Deno.serve(
  withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return Response.json({ error: 'Use POST' }, { status: 405 });
    if (!Deno.env.get('ANTHROPIC_API_KEY')) {
      return Response.json({ error: 'Grading is not configured' }, { status: 500 });
    }

    const parsed = GradeRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 });

    const userId = ctx.userClaims!.id;
    const anthropic = new Anthropic();

    const deps: GradeDeps = {
      async loadCard(cardId) {
        const { data, error } = await ctx.supabase.from('cards').select(CARD_SELECT).eq('id', cardId).maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return null;
        const { captures, ...card } = data as unknown as CardRow & {
          id: string;
          archived_at: string | null;
          captures: {
            lemmas: { lemma: string } | null;
            senses: Omit<PracticeSense, 'lemma'> | null;
          };
        };
        const sense = captures.senses && captures.lemmas ? { ...captures.senses, lemma: captures.lemmas.lemma } : null;
        return { ...card, sense } satisfies CardToGrade;
      },
      verdict: (sense, task, answer, sentence) => generateVerdict(anthropic, model, sense, task, answer, sentence),
      secondLook: (sense, task, answer, sentence) =>
        generateSecondOpinion(anthropic, checkModel, sense, task, answer, sentence, 'check'),
      async record(card, newCard, attempt) {
        const { data, error } = await ctx.supabaseAdmin.rpc('record_attempt', {
          p_user_id: userId,
          p_card_id: card.id,
          p_expected_reps: card.reps,
          p_card: newCard,
          p_attempt: {
            ...attempt,
            surface: 'badge',
            model: attempt.second_look ? checkModel : model,
            prompt_version: PROMPT_VERSION,
          },
        });
        if (error) throw new Error(error.message);
        return (data as string | null) ?? null;
      },
      now: () => new Date(),
    };

    try {
      const outcome = await gradeAttempt(parsed.data, deps);
      if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
      const { ok: _ok, ...result } = outcome;
      return Response.json(result);
    } catch (error) {
      if (error instanceof GradingRefusedError) {
        return Response.json({ error: "Couldn't grade that sentence. Try writing a different one." }, { status: 422 });
      }
      console.error('grade-attempt failed', error);
      return Response.json({ error: "Couldn't grade right now. Try again." }, { status: 502 });
    }
  }),
);
