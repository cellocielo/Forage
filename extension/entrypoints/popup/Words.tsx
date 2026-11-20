import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchWords, filterWords, removeWord, sourceLink, splitAround, type WordContext, type WordEntry } from '@/lib/words';

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; entries: WordEntry[] };

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

/** Every saved word: its meaning, and the sentence and page it was saved from. */
export function Words({ onClose }: { onClose?: () => void }) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setView({ kind: 'loading' });
    try {
      setView({ kind: 'ready', entries: await fetchWords(supabase) });
    } catch {
      setView({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = useCallback(async (key: string) => {
    await removeWord(supabase, key);
    setView((v) => (v.kind === 'ready' ? { ...v, entries: v.entries.filter((e) => e.key !== key) } : v));
  }, []);

  let body;
  if (view.kind === 'loading') body = <div aria-busy="true" aria-label="Loading your words" />;
  else if (view.kind === 'error') {
    body = (
      <>
        <p role="alert">Couldn't load your words. Check your connection and try again.</p>
        <button type="button" onClick={load}>
          Try again
        </button>
      </>
    );
  } else if (view.entries.length === 0) {
    body = <p className="hint">No words yet. Select a word on any page and save it with Forage.</p>;
  } else {
    const shown = filterWords(view.entries, query);
    body = (
      <>
        <label>
          Search
          <input
            type="search"
            value={query}
            placeholder="A word, a meaning, or a page"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {shown.length === 0 ? (
          <p className="hint">No saved words match "{query.trim()}".</p>
        ) : (
          <ul className="word-list">
            {shown.map((entry) => (
              <li key={entry.key}>
                <WordItem entry={entry} onRemove={remove} />
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <section className="practice words">
      <h1>Your words</h1>
      {body}
      {onClose && (
        <button type="button" className="link" onClick={onClose}>
          Back to practice
        </button>
      )}
    </section>
  );
}

type RemoveState = 'idle' | 'confirming' | 'removing' | 'failed';

function WordItem({ entry, onRemove }: { entry: WordEntry; onRemove: (key: string) => Promise<void> }) {
  const [removal, setRemoval] = useState<RemoveState>('idle');

  async function confirmRemove() {
    setRemoval('removing');
    try {
      await onRemove(entry.key);
    } catch {
      setRemoval('failed');
    }
  }

  return (
    <details>
      <summary>
        <span className="word-name">{entry.word}</span>
        {entry.partOfSpeech && <span className="pos">{entry.partOfSpeech}</span>}
      </summary>
      <div className="word-detail">
        {entry.definition ? (
          <p className="definition">{entry.definition}</p>
        ) : (
          <p className="hint">The meaning isn't ready yet. Check back in a minute.</p>
        )}
        {entry.contexts.map((context, i) => (
          <Context key={i} context={context} first={i === 0} />
        ))}
        {entry.otherMeanings.length > 0 && (
          <dl className="hints">
            <dt>Other meanings</dt>
            {entry.otherMeanings.map((other) => (
              <dd key={other.definition}>
                {other.partOfSpeech && <em>{other.partOfSpeech}. </em>}
                {other.definition}
              </dd>
            ))}
          </dl>
        )}
        {removal === 'idle' ? (
          <button
            type="button"
            className="link remove-word"
            aria-label={`Remove ${entry.word}`}
            onClick={() => setRemoval('confirming')}>
            Remove word
          </button>
        ) : (
          <div className="remove-confirm">
            <p role={removal === 'failed' ? 'alert' : undefined}>
              {removal === 'failed'
                ? "Couldn't remove it. Check your connection and try again."
                : `Remove "${entry.word}" and its practice history? This can't be undone.`}
            </p>
            <div className="actions">
              <button type="button" className="danger" disabled={removal === 'removing'} onClick={confirmRemove}>
                {removal === 'removing' ? 'Removing…' : 'Remove'}
              </button>
              <button
                type="button"
                className="secondary"
                disabled={removal === 'removing'}
                onClick={() => setRemoval('idle')}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

function Context({ context, first }: { context: WordContext; first: boolean }) {
  const parts = context.sentence ? splitAround(context.sentence, context.saved) : null;
  const link = sourceLink(context.sourceUrl, context.sentence);
  const place = context.pageTitle || (context.sourceUrl ? hostOf(context.sourceUrl) : null);
  return (
    <figure className="sentence">
      <figcaption>{first ? 'Where you saw it' : 'Also saw it'}</figcaption>
      {context.sentence && (
        <blockquote>
          {context.previousSentence && <span className="before">{context.previousSentence} </span>}
          {parts ? (
            <>
              {parts[0]}
              <mark>{parts[1]}</mark>
              {parts[2]}
            </>
          ) : (
            context.sentence
          )}
        </blockquote>
      )}
      <p className="source">
        {place &&
          (link ? (
            <a href={link} target="_blank" rel="noreferrer">
              {place}
            </a>
          ) : (
            place
          ))}
        {place && ' · '}
        {dateFormat.format(context.capturedAt)}
      </p>
    </figure>
  );
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
