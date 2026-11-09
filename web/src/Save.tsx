import { useEffect, useId, useState, type FormEvent } from 'react';
import { saveWord } from '@/lib/captures';
import { waitForMeaning, type Meaning } from '@/lib/meaning';
import { headline } from '@/lib/meaning-panel';
import { sentenceAround } from '@/lib/selection';
import { supabase } from '@/lib/supabase';
import { wordsIn, type Shared, type WordAt } from './share';

type Status =
  | { kind: 'editing'; error?: string }
  | { kind: 'saving' }
  | { kind: 'saved'; id: string; word: string; duplicate: boolean; meaning: Meaning | null | 'waiting' };

/**
 * Saving a word on a phone: shared from another app (Android), or typed or pasted in. With a
 * passage, tap the word to save and its sentence goes with it.
 */
export function Save({ shared }: { shared: Shared | null }) {
  const [word, setWord] = useState(shared?.word ?? '');
  const [passage, setPassage] = useState(shared?.text && !shared.word ? shared.text : '');
  // The tapped word's place in the passage, so the right sentence goes with it.
  const [picked, setPicked] = useState<WordAt | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'editing' });
  const wordId = useId();
  const passageId = useId();
  const tokens = wordsIn(passage);

  function pick(token: WordAt) {
    setWord(token.word);
    setPicked(token);
  }

  function sentenceFor(target: string): string | null {
    if (!passage.trim()) return null;
    if (picked && picked.word === target) return sentenceAround(passage, picked.start, picked.end);
    const at = passage.toLowerCase().indexOf(target.toLowerCase());
    return at >= 0 ? sentenceAround(passage, at, at + target.length) : passage;
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const target = word.trim();
    if (!target) return;
    setStatus({ kind: 'saving' });
    const result = await saveWord(supabase, {
      word: target,
      sentence: sentenceFor(target),
      pageTitle: shared?.pageTitle,
      sourceUrl: shared?.sourceUrl,
      source: shared ? 'android' : 'manual',
    });
    if (!result.ok) {
      setStatus({ kind: 'editing', error: result.message });
      return;
    }
    setStatus({ kind: 'saved', id: result.clientCaptureId, word: result.word, duplicate: !!result.duplicate, meaning: 'waiting' });
    const meaning = await waitForMeaning(supabase, result.clientCaptureId).catch(() => null);
    // Only if this is still the save on screen.
    setStatus((current) => (current.kind === 'saved' && current.id === result.clientCaptureId ? { ...current, meaning } : current));
  }

  function saveAnother() {
    setWord('');
    setPassage('');
    setPicked(null);
    setStatus({ kind: 'editing' });
  }

  if (status.kind === 'saved') {
    return (
      <section className="practice" aria-live="polite">
        <p className="hint">
          {headline(status.word, status.duplicate ? 'duplicate' : status.meaning && status.meaning !== 'waiting' ? status.meaning.outcome : null)}
        </p>
        <SavedMeaning word={status.word} meaning={status.meaning} />
        <button type="button" autoFocus onClick={saveAnother}>
          Save another word
        </button>
      </section>
    );
  }

  return (
    <form className="practice" onSubmit={save}>
      <h1>Save a word</h1>
      <label htmlFor={passageId}>The sentence you saw it in (optional)</label>
      <textarea
        id={passageId}
        rows={3}
        maxLength={2000}
        placeholder="Paste the sentence here"
        value={passage}
        onChange={(e) => {
          setPassage(e.target.value);
          setPicked(null);
        }}
      />
      {tokens.length > 1 && (
        <div className="word-picker">
          <p className="hint">Tap the word to save</p>
          <div className="chips">
            {tokens.map((token) => (
              <button
                key={token.start}
                type="button"
                className={`chip${picked?.start === token.start ? ' chosen' : ''}`}
                aria-pressed={picked?.start === token.start}
                onClick={() => pick(token)}
              >
                {token.word}
              </button>
            ))}
          </div>
        </div>
      )}
      <label htmlFor={wordId}>Word</label>
      <input
        id={wordId}
        autoComplete="off"
        autoCapitalize="none"
        maxLength={100}
        value={word}
        onChange={(e) => {
          setWord(e.target.value);
          setPicked(null);
        }}
      />
      {status.kind === 'editing' && status.error && <p role="alert">{status.error}</p>}
      <button type="submit" disabled={status.kind === 'saving' || !word.trim()}>
        {status.kind === 'saving' ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}

function SavedMeaning({ word, meaning }: { word: string; meaning: Meaning | null | 'waiting' }) {
  if (meaning === 'waiting') return <p className="hint">Looking up its meaning…</p>;
  if (!meaning) {
    return (
      <>
        <h1 className="word">{word}</h1>
        <p className="hint">Its meaning will be ready when you practice it.</p>
      </>
    );
  }
  return (
    <>
      <h1 className="word">
        {meaning.word} <span className="pos">{meaning.partOfSpeech}</span>
      </h1>
      <dl className="hints">
        <div>
          <dt>Meaning here</dt>
          <dd>{meaning.definition}</dd>
        </div>
        {meaning.otherMeanings.length > 0 && (
          <div>
            <dt>Other meanings</dt>
            {meaning.otherMeanings.map((other) => (
              <dd key={other.definition}>
                {other.partOfSpeech && <em>{other.partOfSpeech} </em>}
                {other.definition}
              </dd>
            ))}
          </div>
        )}
      </dl>
    </>
  );
}

/** Clears ?title=&text=&url= once read, so a reload doesn't save the shared word again. */
export function useClearShareParams() {
  useEffect(() => {
    if (location.search) history.replaceState(null, '', location.pathname);
  }, []);
}
