import type { SupabaseClient } from '@supabase/supabase-js';
import { parseOtherMeanings, type OtherMeaning, type OtherMeaningsColumn } from './meaning';

/**
 * The word bank (PRD D1): every saved word with its meaning and the sentences and pages it was
 * saved from. No browser APIs here, so the web app shares it.
 */

// Enough for a long reading history while keeping the popup quick to open.
const MAX_CAPTURES = 1000;
// Text fragments longer than this match unreliably, so longer sentences link by their ends.
const MAX_FRAGMENT_TEXT = 80;
const FRAGMENT_END_WORDS = 4;

export interface WordContext {
  sentence: string | null;
  /** The sentence before, when the meaning depended on it ("This approach…"). */
  previousSentence: string | null;
  pageTitle: string | null;
  sourceUrl: string | null;
  capturedAt: Date;
  /** The text as selected, to find in the sentence. */
  saved: string;
}

export interface WordEntry {
  /** The card, or the capture if it doesn't have a card yet. */
  key: string;
  word: string;
  /** Null while the meaning is still being worked out, or if it couldn't be. */
  partOfSpeech: string | null;
  definition: string | null;
  otherMeanings: OtherMeaning[];
  /** Newest first. */
  contexts: WordContext[];
}

interface WordRow {
  id: string;
  card_id: string | null;
  word: string;
  sentence: string | null;
  previous_sentence?: string | null;
  page_title: string | null;
  source_url: string | null;
  captured_at: string;
  lemmas: { lemma: string } | null;
  senses: {
    part_of_speech: string;
    definition: string;
    other_meanings: OtherMeaningsColumn;
    uses_previous_sentence?: boolean;
  } | null;
}

/** Saved words, most recently saved first, one entry per meaning (card). */
export async function fetchWords(client: SupabaseClient): Promise<WordEntry[]> {
  const { data, error } = await client
    .from('captures')
    .select(
      'id, card_id, word, sentence, previous_sentence, page_title, source_url, captured_at, lemmas ( lemma ), senses ( part_of_speech, definition, other_meanings, uses_previous_sentence )',
    )
    .order('captured_at', { ascending: false })
    .limit(MAX_CAPTURES);
  if (error) throw error;
  return groupWords((data ?? []) as unknown as WordRow[]);
}

/**
 * Deletes every save of the word (all captures on the card). The card and its practice history
 * go with its first capture.
 */
export async function removeWord(client: SupabaseClient, key: string): Promise<void> {
  const { data, error } = await client
    .from('captures')
    .delete()
    .or(`card_id.eq.${key},id.eq.${key}`)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('Nothing was removed');
}

export function groupWords(rows: WordRow[]): WordEntry[] {
  const entries = new Map<string, WordEntry>();
  for (const row of rows) {
    const key = row.card_id ?? row.id;
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, word: row.word, partOfSpeech: null, definition: null, otherMeanings: [], contexts: [] };
      entries.set(key, entry);
    }
    // Rows come newest first, so the card's first save (whose meaning the card uses) wins.
    if (row.senses) {
      entry.word = row.lemmas?.lemma ?? row.word;
      entry.partOfSpeech = row.senses.part_of_speech;
      entry.definition = row.senses.definition;
      entry.otherMeanings = parseOtherMeanings(row.senses.other_meanings);
    }
    const sentence = row.sentence?.trim() || null;
    // A repeat save of the same sentence adds nothing to show.
    if (sentence && entry.contexts.some((c) => c.sentence === sentence)) continue;
    entry.contexts.push({
      sentence,
      previousSentence: (sentence && row.senses?.uses_previous_sentence && row.previous_sentence?.trim()) || null,
      pageTitle: row.page_title,
      sourceUrl: row.source_url,
      capturedAt: new Date(row.captured_at),
      saved: row.word,
    });
  }
  return [...entries.values()];
}

/** Entries whose word, definition, sentences, or page titles contain the query. */
export function filterWords(entries: WordEntry[], query: string): WordEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter((entry) =>
    [
      entry.word,
      entry.definition,
      ...entry.contexts.flatMap((c) => [c.saved, c.sentence, c.previousSentence, c.pageTitle]),
    ].some((text) => text?.toLowerCase().includes(q)),
  );
}

/** The sentence split around the first place the saved text appears, to highlight it. */
export function splitAround(sentence: string, saved: string): [string, string, string] | null {
  const at = saved ? sentence.toLowerCase().indexOf(saved.toLowerCase()) : -1;
  if (at < 0) return null;
  return [sentence.slice(0, at), sentence.slice(at, at + saved.length), sentence.slice(at + saved.length)];
}

function encodeFragmentText(text: string): string {
  // Dashes, commas, and ampersands mean something in a text directive.
  return encodeURIComponent(text).replace(/-/g, '%2D');
}

/**
 * The page link, scrolled to and highlighting the sentence where the browser supports text
 * fragments (others just open the page). Null for anything that isn't a web page.
 */
export function sourceLink(sourceUrl: string | null, sentence: string | null): string | null {
  if (!sourceUrl) return null;
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const text = sentence?.replace(/\s+/g, ' ').trim();
  if (!text) return url.href;

  let directive: string;
  const words = text.split(' ');
  if (text.length <= MAX_FRAGMENT_TEXT || words.length <= FRAGMENT_END_WORDS * 2) {
    directive = encodeFragmentText(text);
  } else {
    const start = words.slice(0, FRAGMENT_END_WORDS).join(' ');
    const end = words.slice(-FRAGMENT_END_WORDS).join(' ');
    directive = `${encodeFragmentText(start)},${encodeFragmentText(end)}`;
  }
  // Drop any earlier text directive; keep an ordinary #anchor in front of the new one.
  const anchor = url.hash.replace(/^#/, '').split(':~:')[0];
  url.hash = '';
  return `${url.href}#${anchor}:~:text=${directive}`;
}
