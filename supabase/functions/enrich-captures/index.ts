import Anthropic from '@anthropic-ai/sdk';
import { withSupabase } from '@supabase/server';
import {
  DEFAULT_MODEL,
  enrichCapture,
  type CaptureToEnrich,
  type EnrichDeps,
  generateEnrichment,
  MAX_ATTEMPTS,
  PROMPT_VERSION,
} from './enrich.ts';

const BATCH_SIZE = 10;
const model = Deno.env.get('ENRICH_MODEL') ?? DEFAULT_MODEL;
const anthropic = new Anthropic(); // reads the ANTHROPIC_API_KEY secret

// Called by pg_cron with the project's secret key; not callable by users.
Deno.serve(
  withSupabase({ auth: 'secret' }, async (_req, ctx) => {
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
      generate: (word, sentence) => generateEnrichment(anthropic, model, word, sentence),
      async saveGenerated(captureId, hash, enrichment) {
        const { error } = await db.rpc('save_capture_enrichment', {
          p_capture_id: captureId,
          p_sentence_hash: hash,
          p_enrichment: enrichment,
          p_model: model,
          p_prompt_version: PROMPT_VERSION,
        });
        if (error) throw new Error(error.message);
      },
      async linkCached(captureId, hash, cached) {
        const { error } = await db
          .from('captures')
          .update({ ...cached, sentence_hash: hash, enrichment_status: 'done', enrichment_error: null })
          .eq('id', captureId);
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

    const outcomes = await Promise.all(captures.map((capture) => enrichCapture(capture, deps)));
    const counts = Object.fromEntries(
      (['cached', 'generated', 'failed'] as const).map((o) => [o, outcomes.filter((x) => x === o).length]),
    );
    return Response.json({ claimed: outcomes.length, ...counts });
  }),
);
