/**
 * Text shared to the installed app (Android's Share menu, via share_target in the manifest)
 * arrives as ?title=&text=&url=. Selected text usually comes as `text`, sometimes with the
 * page's link appended.
 */

export interface Shared {
  /** The shared text without links or wrapping quotes. */
  text: string;
  /** Set when the text is a single word, so it can be saved straight away. */
  word: string;
  pageTitle: string | null;
  sourceUrl: string | null;
}

const LINK = /https?:\/\/\S+/g;
const WORD = /[\p{L}\p{M}]+(?:['’-][\p{L}\p{M}]+)*/gu;

export function readShare(search: string): Shared | null {
  const params = new URLSearchParams(search);
  const raw = params.get('text') ?? '';
  const title = params.get('title')?.trim() || null;
  let url = params.get('url')?.trim() || null;
  if (!raw && !title && !url) return null;

  url ??= raw.match(LINK)?.[0] ?? null;
  const text = raw
    .replace(LINK, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^["“”'‘’\s]+|["“”'‘’\s.,;:!?]+$/g, '')
    .trim();
  const words = wordsIn(text);
  const single = words.length === 1 && words[0]!.word.length >= text.length - 1;
  return { text, word: single ? words[0]!.word : '', pageTitle: title, sourceUrl: url };
}

export interface WordAt {
  word: string;
  start: number;
  end: number;
}

/** The words in a passage, with where each one is, for tapping the one to save. */
export function wordsIn(text: string): WordAt[] {
  return [...text.matchAll(WORD)].map((m) => ({ word: m[0], start: m.index, end: m.index + m[0].length }));
}
