export interface SelectionContext {
  word: string;
  sentence: string | null;
  pageTitle: string;
  sourceUrl: string;
}

const BLOCK_SELECTOR =
  'p, li, blockquote, h1, h2, h3, h4, h5, h6, td, th, dd, dt, figcaption, pre, div, article, section';

/** Returns the sentence in `text` that contains the span [start, end). */
export function sentenceAround(text: string, start: number, end: number): string {
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

  return text.slice(from, to).replace(/\s+/g, ' ').trim();
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
  if (block.contains(range.startContainer)) {
    const before = win.document.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const text = block.textContent ?? '';
    sentence = sentenceAround(text, start, start + range.toString().length) || null;
  }

  return {
    word,
    sentence,
    pageTitle: win.document.title,
    sourceUrl: win.location.href,
  };
}
