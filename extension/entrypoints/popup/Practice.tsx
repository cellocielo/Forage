import { useCallback, useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { refreshBadge } from '@/lib/badge';
import {
  chooseTask,
  describeNextReview,
  fetchNextCard,
  hintSteps,
  RATING_LABELS,
  submitAttempt,
  type GradeResult,
  type PracticeCard,
  type Task,
} from '@/lib/practice';
import { supabase } from '@/lib/supabase';

type View =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'error'; message: string }
  | { kind: 'task'; card: PracticeCard; task: Task }
  | { kind: 'result'; card: PracticeCard; result: GradeResult };

/** One practice card (P1): the next ready word, a scaffolded task, hints, and the grade. */
export function Practice() {
  const [view, setView] = useState<View>({ kind: 'loading' });

  const loadNext = useCallback(async () => {
    setView({ kind: 'loading' });
    try {
      const card = await fetchNextCard(supabase);
      setView(card ? { kind: 'task', card, task: chooseTask(card) } : { kind: 'empty' });
    } catch {
      setView({ kind: 'error', message: "Couldn't load your words. Check your connection and try again." });
    }
  }, []);

  useEffect(() => {
    loadNext();
  }, [loadNext]);

  switch (view.kind) {
    case 'loading':
      return <section className="practice" aria-busy="true" aria-label="Loading your next word" />;
    case 'empty':
      return (
        <section className="practice">
          <h1>All caught up</h1>
          <p className="hint">
            Nothing to practise right now. Select a word on any page, then right-click → Save to Forage, or press
            Alt+Shift+S.
          </p>
        </section>
      );
    case 'error':
      return (
        <section className="practice">
          <p role="alert">{view.message}</p>
          <button type="button" onClick={loadNext}>
            Try again
          </button>
        </section>
      );
    case 'task':
      return (
        <TaskCard
          key={view.card.id}
          card={view.card}
          task={view.task}
          onGraded={(result) => {
            setView({ kind: 'result', card: view.card, result });
            refreshBadge(supabase);
          }}
        />
      );
    case 'result':
      return <ResultCard card={view.card} result={view.result} onNext={loadNext} />;
  }
}

function WordHeading({ card }: { card: PracticeCard }) {
  return (
    <h1 className="word">
      {card.word} <span className="pos">{card.partOfSpeech}</span>
    </h1>
  );
}

function TaskCard({
  card,
  task,
  onGraded,
}: {
  card: PracticeCard;
  task: Task;
  onGraded: (result: GradeResult) => void;
}) {
  const [answer, setAnswer] = useState('');
  const [hintsShown, setHintsShown] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answerId = useId();
  const steps = hintSteps(card);
  const nextHint = steps[hintsShown];

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!answer.trim() || pending) return;
    setPending(true);
    setError(null);
    const outcome = await submitAttempt(supabase, card, task, answer, hintsShown);
    setPending(false);
    if (outcome.ok) onGraded(outcome.result);
    else setError(outcome.message);
  }

  // Enter checks a frame's one-line answer; sentences use Cmd/Ctrl+Enter so Enter can add a line.
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
  }

  return (
    <form className="practice" onSubmit={submit}>
      <WordHeading card={card} />

      {task.type === 'frame' && (
        <>
          <p className="prompt">{task.prompt}</p>
          <label htmlFor={answerId}>Fill in the blank</label>
          <input
            id={answerId}
            autoFocus
            autoComplete="off"
            maxLength={500}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
        </>
      )}
      {task.type !== 'frame' && (
        <>
          <p className="prompt">
            {task.register && <span className="register">{task.register}</span>}
            {task.prompt}
          </p>
          <label htmlFor={answerId}>{task.type === 'scenario' ? `Your sentence, using "${card.word}"` : 'Your sentence'}</label>
          <textarea
            id={answerId}
            autoFocus
            rows={3}
            maxLength={500}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </>
      )}

      {hintsShown > 0 && (
        <dl className="hints">
          {steps.slice(0, hintsShown).map((step) => (
            <div key={step.label}>
              <dt>{step.label}</dt>
              <dd>{step.text}</dd>
            </div>
          ))}
        </dl>
      )}

      {error && <p role="alert">{error}</p>}

      <div className="actions">
        <button type="submit" disabled={pending || !answer.trim()}>
          {pending ? 'Checking…' : 'Check'}
        </button>
        {nextHint && (
          <button type="button" className="secondary" disabled={pending} onClick={() => setHintsShown((n) => n + 1)}>
            {hintsShown === 0 ? 'Stuck?' : 'Another hint'}
            {nextHint.cap && <span className="cap"> (max {nextHint.cap})</span>}
          </button>
        )}
      </div>
    </form>
  );
}

function ResultCard({ card, result, onNext }: { card: PracticeCard; result: GradeResult; onNext: () => void }) {
  const label = RATING_LABELS[result.rating] ?? '';
  const corrected = result.verdict.corrected_sentence.trim();
  const changed = corrected !== '' && corrected !== result.sentence.trim();

  return (
    <section className="practice" aria-live="polite">
      <WordHeading card={card} />
      <p className={`rating rating-${result.rating}`}>{label}</p>
      <p>{result.verdict.rationale}</p>
      <figure className="sentence">
        <figcaption>You wrote</figcaption>
        <blockquote>{result.sentence}</blockquote>
      </figure>
      {changed && (
        <figure className="sentence">
          <figcaption>Suggested</figcaption>
          <blockquote>{corrected}</blockquote>
        </figure>
      )}
      <p className="hint">Next review {describeNextReview(result.scheduled_days)}.</p>
      <button type="button" autoFocus onClick={onNext}>
        Next word
      </button>
    </section>
  );
}
