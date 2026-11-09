import type { Meaning, SaveOutcome } from './meaning';

export const PANEL_HOST_ID = 'forage-meaning-host';
// Once the meaning shows, the panel stays long enough to read, and longer while hovered.
const READ_MS = 20_000;
const UNAVAILABLE_MS = 4000;

export interface MeaningPanel {
  host: HTMLElement;
  showMeaning(meaning: Meaning): void;
  showUnavailable(): void;
  close(): void;
}

const STYLE = `
  :host { all: initial; }
  .panel {
    --bg: #ffffff; --text: #1f251e; --muted: #6c6f66; --line: #e4dfd3;
    --accent: #3f6b47; --accent-soft: #e7efe4;
    position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
    width: 320px; max-width: calc(100vw - 32px); box-sizing: border-box;
    padding: 12px 14px 14px; border: 1px solid var(--line); border-radius: 12px;
    background: var(--bg); color: var(--text);
    font: 14px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    box-shadow: 0 8px 28px rgb(0 0 0 / 0.16);
    opacity: 0; transform: translateY(8px); transition: opacity 150ms, transform 150ms;
  }
  @media (prefers-color-scheme: dark) {
    .panel { --bg: #23261f; --text: #ecebe3; --muted: #a2a497; --line: #363a31; --accent: #8fbf92; --accent-soft: #2a3a2b; }
  }
  .panel.visible { opacity: 1; transform: none; }
  .top { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); }
  .top .saved { flex: 1; }
  .close {
    all: unset; cursor: pointer; width: 22px; height: 22px; border-radius: 6px;
    text-align: center; line-height: 22px; font-size: 16px; color: var(--muted);
  }
  .close:hover, .close:focus-visible { background: var(--accent-soft); color: var(--text); }
  .word { margin-top: 6px; display: flex; align-items: center; gap: 8px;
    font: 600 20px/1.25 'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif; }
  .pos { padding: 1px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent);
    font: 500 11px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
  .label { margin-top: 10px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em;
    text-transform: uppercase; color: var(--muted); }
  .definition { margin: 2px 0 0; }
  .loading { margin-top: 6px; color: var(--muted); }
  ul { margin: 2px 0 0; padding-left: 18px; font-size: 13px; }
  li + li { margin-top: 2px; }
  li .other-pos { color: var(--muted); font-style: italic; }
  @media (prefers-reduced-motion: reduce) { .panel { transition: none; } }
`;

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The panel's top line: what saving did. */
export function headline(word: string, outcome: SaveOutcome | null): string {
  switch (outcome) {
    case 'duplicate':
      return 'Already saved.';
    case 'same_meaning':
      return `Already learning "${word}". Added this example.`;
    case 'new_meaning':
      return `New meaning of "${word}" saved.`;
    case 'returned':
      return `"${word}" is back in your practice.`;
    default:
      return `Saved "${word}" to Forage`;
  }
}

/**
 * Shown after saving a word: "Saved", then what the word means here and its other meanings.
 * It never takes focus or blocks the page, and closes itself after a while.
 */
export function showMeaningPanel(
  word: string,
  doc: Document = document,
  { duplicate = false }: { duplicate?: boolean } = {},
): MeaningPanel {
  doc.getElementById(PANEL_HOST_ID)?.remove();

  const host = doc.createElement('div');
  host.id = PANEL_HOST_ID;
  // Shadow root keeps page styles out of the panel and ours out of the page.
  const shadow = host.attachShadow({ mode: 'open' });
  const style = el(doc, 'style', undefined, STYLE);
  const panel = el(doc, 'section', 'panel');
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  panel.setAttribute('aria-label', 'Forage');

  const top = el(doc, 'div', 'top');
  const saved = el(doc, 'span', 'saved', headline(word, duplicate ? 'duplicate' : null));
  top.append(saved);
  const closeButton = el(doc, 'button', 'close', '×');
  closeButton.setAttribute('aria-label', 'Close');
  top.append(closeButton);

  const body = el(doc, 'div', 'body');
  body.append(el(doc, 'p', 'loading', 'Looking up its meaning…'));
  panel.append(top, body);
  shadow.append(style, panel);
  doc.documentElement.append(host);
  requestAnimationFrame(() => panel.classList.add('visible'));

  let timer: ReturnType<typeof setTimeout> | undefined;
  let remainingMs: number | null = null;
  const close = () => {
    clearTimeout(timer);
    host.remove();
  };
  const closeAfter = (ms: number) => {
    remainingMs = ms;
    clearTimeout(timer);
    timer = setTimeout(close, ms);
  };
  // Hovering keeps it open; leaving restarts the countdown.
  panel.addEventListener('mouseenter', () => clearTimeout(timer));
  panel.addEventListener('mouseleave', () => {
    if (remainingMs !== null) closeAfter(remainingMs);
  });
  closeButton.addEventListener('click', close);

  return {
    host,
    close,
    showMeaning(meaning) {
      if (!duplicate) saved.textContent = headline(meaning.word, meaning.outcome);
      const heading = el(doc, 'div', 'word', meaning.word);
      heading.append(el(doc, 'span', 'pos', meaning.partOfSpeech));
      const parts: Node[] = [
        heading,
        el(doc, 'div', 'label', 'Meaning here'),
        el(doc, 'p', 'definition', meaning.definition),
      ];
      if (meaning.otherMeanings.length > 0) {
        const list = el(doc, 'ul');
        for (const other of meaning.otherMeanings) {
          const item = el(doc, 'li');
          if (other.partOfSpeech) item.append(el(doc, 'span', 'other-pos', `${other.partOfSpeech} `));
          item.append(doc.createTextNode(other.definition));
          list.append(item);
        }
        parts.push(el(doc, 'div', 'label', 'Other meanings'), list);
      }
      body.replaceChildren(...parts);
      closeAfter(READ_MS);
    },
    showUnavailable() {
      body.replaceChildren(el(doc, 'p', 'loading', 'Its meaning will be ready in Forage soon.'));
      closeAfter(UNAVAILABLE_MS);
    },
  };
}
