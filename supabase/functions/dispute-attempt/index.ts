import Anthropic from '@anthropic-ai/sdk';
import { withSupabase } from '@supabase/server';
import type { CardRow } from '../_shared/scheduling.ts';
import { DISPUTE_MODEL, GradingRefusedError, generateSecondOpinion, type PracticeSense } from '../grade-attempt/grade.ts';
import { type AttemptToDispute, type DisputeDeps, disputeAttempt, DisputeRequestSchema } from './dispute.ts';

const model = Deno.env.get('DISPUTE_MODEL') ?? DISPUTE_MODEL;

// Called from the extension popup with the signed-in user's JWT ("I disagree with this grade").
Deno.serve(
  withSupabase({ auth: 'user' }, async (req, ctx) => {
    if (req.method !== 'POST') return Response.json({ error: 'Use POST' }, { status: 405 });
    if (!Deno.env.get('ANTHROPIC_API_KEY')) {
      return Response.json({ error: 'Grading is not configured' }, { status: 500 });
    }

    const parsed = DisputeRequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: 'Invalid request' }, { status: 400 });

    const userId = ctx.userClaims!.id;
    const anthropic = new Anthropic();

    const deps: DisputeDeps = {
      async loadAttempt(attemptId) {
        // RLS: users can read only their own attempts.
        const { data, error } = await ctx.supabase
          .from('attempts')
          .select('id, card_id, task_type, prompt, answer, sentence, hints_used, rating, review, disputed_at, card_before, sense_id')
          .eq('id', attemptId)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return null;

        // The attempt is the user's, so its sense is theirs to grade against, even if a later
        // re-enrichment moved their capture to a newer sense (which RLS would then hide).
        let sense: PracticeSense | null = null;
        if (data.sense_id) {
          const { data: row, error: senseError } = await ctx.supabaseAdmin
            .from('senses')
            .select('id, part_of_speech, definition, frames, scenarios, usage_choice, lemmas ( lemma )')
            .eq('id', data.sense_id)
            .maybeSingle();
          if (senseError) throw new Error(senseError.message);
          if (row) {
            const { lemmas, ...rest } = row as unknown as Omit<PracticeSense, 'lemma'> & { lemmas: { lemma: string } };
            sense = { ...rest, lemma: lemmas.lemma };
          }
        }

        return {
          id: data.id,
          card_id: data.card_id,
          task_type: data.task_type,
          prompt: data.prompt,
          answer: data.answer,
          sentence: data.sentence,
          hints_used: data.hints_used,
          rating: data.rating,
          reviewed_at: (data.review as { review: string }).review,
          disputed_at: data.disputed_at,
          card_before: data.card_before as CardRow | null,
          sense,
        } satisfies AttemptToDispute;
      },
      async loadCardReps(cardId) {
        const { data, error } = await ctx.supabase
          .from('cards')
          .select('reps')
          .eq('id', cardId)
          .is('archived_at', null)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data?.reps ?? null;
      },
      secondOpinion: (sense, task, answer, sentence) =>
        generateSecondOpinion(anthropic, model, sense, task, answer, sentence),
      async resolve(attempt, verdict, rating, newCard, expectedReps) {
        const { data, error } = await ctx.supabaseAdmin.rpc('resolve_dispute', {
          p_user_id: userId,
          p_attempt_id: attempt.id,
          p_verdict: verdict,
          p_score: verdict.score,
          p_rating: rating,
          p_model: model,
          p_card: newCard,
          p_expected_reps: expectedReps,
        });
        if (error) throw new Error(error.message);
        return data as boolean | null;
      },
    };

    try {
      const outcome = await disputeAttempt(parsed.data, deps);
      if (!outcome.ok) return Response.json({ error: outcome.error }, { status: outcome.status });
      const { ok: _ok, ...result } = outcome;
      return Response.json(result);
    } catch (error) {
      if (error instanceof GradingRefusedError) {
        return Response.json({ error: "Couldn't get a second opinion on that sentence." }, { status: 422 });
      }
      console.error('dispute-attempt failed', error);
      return Response.json({ error: "Couldn't get a second opinion right now. Try again." }, { status: 502 });
    }
  }),
);
