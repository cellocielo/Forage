export interface SelectionContext {
  word: string;
  sentence: string | null;
  /** The sentence just before, for words that lean on it ("this approach"). */
  previousSentence: string | null;
  pageTitle: string;
  sourceUrl: string;
}

const BLOCK_SELECTOR =
  'p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, dd, dt, figcaption, pre, div, article, section';

/** Returns the sentence in `text` that contains the span [start, end). */
export function sentenceAround(text: string, start: number, end: number): string {
  const { from, to } = sentenceBounds(text, start, end);
  return clean(text.slice(from, to));
}

/** The sentence ending just before `start` (where the current sentence begins), if any. */
export function sentenceBefore(text: string, start: number): string | null {
  const { from } = sentenceBounds(text, start, start);
  return lastSentence(text.slice(0, from));
}

/** The last sentence of `text`, if any. */
export function lastSentence(text: string): string | null {
  const trimmed = text.trimEnd();
  if (!trimmed) return null;
  const { from } = sentenceBounds(trimmed, trimmed.length - 1, trimmed.length - 1);
  return clean(trimmed.slice(from)) || null;
}

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function sentenceBounds(text: string, start: number, end: number): { from: number; to: number } {
  let from = 0;
  for (let i = start - 1; i > 0; i--) {
    if (/\s/.test(text.charAt(i)) && /[.!?]["'”’)\]]*$/.test(text.slice(Math.max(0, i - 4), i))) {
      from = i + 1;
      break;
    }
  }

  let to = text.length;
  const after = /[.!?]+["'”’)\]]*(?=\s|$)/g;
  after.lastIndex = end;
  const match = after.exec(text);
  if (match) to = match.index + match[0].length;

  return { from, to };
}

export function getSelectionContext(win: Window = window): SelectionContext | null {
  const selection = win.getSelection();
  const word = selection?.toString().trim();
  if (!selection || selection.rangeCount === 0 || !word) return null;

  const range = selection.getRangeAt(0);
  const anchor = range.commonAncestorContainer;
  const element = anchor.nodeType === Node.ELEMENT_NODE ? (anchor as Element) : anchor.parentElement;
  const block = element?.closest(BLOCK_SELECTOR) ?? win.document.body;

  let sentence: string | null = null;
  let previousSentence: string | null = null;
  if (block.contains(range.startContainer)) {
    const before = win.document.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const text = block.textContent ?? '';
    sentence = sentenceAround(text, start, start + range.toString().length) || null;
    previousSentence = sentenceBefore(text, start) ?? previousParagraphEnd(block);
  }

  return {
    word,
    sentence,
    previousSentence,
    pageTitle: win.document.title,
    sourceUrl: win.location.href,
  };
}

// A paragraph that opens with "This approach…" usually points back to the paragraph before.
function previousParagraphEnd(block: Element): string | null {
  const previous = block.previousElementSibling;
  if (block.tagName !== 'P' || previous?.tagName !== 'P') return null;
  return lastSentence(previous.textContent ?? '');
}
