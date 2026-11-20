import Anthropic from '@anthropic-ai/sdk';
import { withSupabase } from '@supabase/server';
import {
  DEFAULT_MODEL,
  enrichCapture,
  type CaptureToEnrich,
  type EnrichDeps,
  generateMeaning,
  generatePractice,
  generateVariety,
  MAX_ATTEMPTS,
  PROMPT_VERSION,
  type SameWordCards,
  type SenseNeedingPractice,
  type SenseNeedingVariety,
} from './enrich.ts';
import { matchMeaning } from './match.ts';

const BATCH_SIZE = 10;
// Practice material for senses whose meaning was just saved (or whose earlier try failed).
const PRACTICE_BATCH_SIZE = 10;
// Older senses topped up with more practice per run, when there's room after new captures.
const VARIETY_BATCH_SIZE = 5;
const model = Deno.env.get('ENRICH_MODEL') ?? DEFAULT_MODEL;

// Called by pg_cron with a project secret key; not callable by users.
// 'secret:*' accepts any secret key, so rotating to a newly named key doesn't break it.
Deno.serve(
  withSupabase({ auth: 'secret:*' }, async (_req, ctx) => {
    // Check before claiming, so a missing key doesn't burn the captures' retry attempts.
    if (!Deno.env.get('ANTHROPIC_API_KEY')) {
      return Response.json({ error: 'ANTHROPIC_API_KEY is not set' }, { status: 500 });
    }
    const anthropic = new Anthropic();
    const db = ctx.supabaseAdmin;
    const { data, error } = await db.rpc('claim_captures_for_enrichment', { batch_size: BATCH_SIZE });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    const captures = (data ?? []) as CaptureToEnrich[];

    const deps: EnrichDeps = {
      async findCachedSense(word, hash) {
        const { data, error } = await db.rpc('find_cached_sense', {
          p_word: word,
          p_sentence_hash: hash,
          p_prompt_version: PROMPT_VERSION,
        });
        if (error) throw new Error(error.message);
        return data?.[0] ?? null;
      },
      generate: (word, sentence, context) => generateMeaning(anthropic, model, word, sentence, context),
      async saveGenerated(captureId, hash, meaning) {
        const { error } = await db.rpc('save_capture_meaning', {
          p_capture_id: captureId,
          p_sentence_hash: hash,
          p_meaning: meaning,
          p_model: model,
          p_prompt_version: PROMPT_VERSION,
        });
        if (error) throw new Error(error.message);
      },
      async linkCached(captureId, hash, cached) {
        const { error } = await db
          .from('captures')
          // place_capture marks it done, once it knows whether this is a new card.
          .update({ ...cached, sentence_hash: hash, enrichment_error: null })
          .eq('id', captureId);
        if (error) throw new Error(error.message);
      },
      async sameWordCards(captureId) {
        const { data, error } = await db.rpc('same_word_cards', { p_capture_id: captureId });
        if (error) throw new Error(error.message);
        if (!data) throw new Error('Capture has no sense to compare');
        return data as SameWordCards;
      },
      matchMeaning: (word, sentence, meaning, known) => matchMeaning(anthropic, model, word, sentence, meaning, known),
      async place(captureId, cardId) {
        const { error } = await db.rpc('place_capture', { p_capture_id: captureId, p_card_id: cardId });
        if (error) throw new Error(error.message);
      },
      async markFailed(captureId, message, giveUp) {
        await db
          .from('captures')
          .update({
            enrichment_status: 'failed',
            enrichment_error: message,
            // Exhausting attempts keeps the claim query from picking it up again.
            ...(giveUp ? { enrichment_attempts: MAX_ATTEMPTS } : {}),
          })
          .eq('id', captureId);
      },
    };

    // The same word twice in one batch (say, from an offline queue) runs in order, so the
    // second one sees the first one's card and can join it instead of making another.
    const byWord = new Map<string, CaptureToEnrich[]>();
    for (const capture of captures) {
      const key = capture.word.trim().toLowerCase();
      byWord.set(key, [...(byWord.get(key) ?? []), capture]);
    }
    const outcomes = (
      await Promise.all(
        [...byWord.values()].map(async (group) => {
          const results = [];
          for (const capture of group) results.push(await enrichCapture(capture, deps));
          return results;
        }),
      )
    ).flat();
    const counts = Object.fromEntries(
      (['cached', 'generated', 'failed'] as const).map((o) => [o, outcomes.filter((x) => x === o).length]),
    );

    // Meanings are saved and shown; now the practice material for them, which nobody waits on.
    const { data: pending, error: practiceClaimError } = await db.rpc('claim_senses_for_practice', {
      batch_size: PRACTICE_BATCH_SIZE,
    });
    if (practiceClaimError) console.warn('enrich: could not claim senses for practice', practiceClaimError.message);
    const practiceResults = await Promise.all(
      ((pending ?? []) as SenseNeedingPractice[]).map(async (sense) => {
        try {
          const practice = await generatePractice(anthropic, model, sense);
          const { error } = await db.rpc('save_sense_practice', { p_sense_id: sense.id, p_practice: practice });
          if (error) throw new Error(error.message);
          return true;
        } catch (error) {
          // Claimed with an attempt counted, so the minute job retries it a few times.
          console.warn('enrich: could not write practice', sense.id, error instanceof Error ? error.message : error);
          return false;
        }
      }),
    );
    const practiced = practiceResults.filter(Boolean).length;

    // New words come first; older senses get more practice with whatever room is left.
    const varietyRoom = Math.min(VARIETY_BATCH_SIZE, BATCH_SIZE - captures.length - practiceResults.length);
    let varied = 0;
    if (varietyRoom > 0) {
      const { data: senses, error: claimError } = await db.rpc('claim_senses_for_variety', { batch_size: varietyRoom });
      if (claimError) console.warn('enrich: could not claim senses for variety', claimError.message);
      const results = await Promise.all(
        ((senses ?? []) as SenseNeedingVariety[]).map(async (sense) => {
          try {
            const variety = await generateVariety(anthropic, model, sense);
            const { error } = await db.rpc('save_sense_variety', {
              p_sense_id: sense.id,
              p_usage_choices: variety.usage_choices,
              p_frames: variety.frames,
              p_frame_choices: variety.frame_choices,
            });
            if (error) throw new Error(error.message);
            return true;
          } catch (error) {
            // Claimed with an attempt counted, so it's retried a few times and then left alone.
            console.warn('enrich: could not add variety', sense.id, error instanceof Error ? error.message : error);
            return false;
          }
        }),
      );
      varied = results.filter(Boolean).length;
    }
    return Response.json({ claimed: outcomes.length, ...counts, practiced, varied });
  }),
);
