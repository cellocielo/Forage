import { useCallback, useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { refreshBadge } from '@/lib/badge';
import {
  chooseTask,
  describeNextReview,
  disputeAttempt,
  easierTask,
  fetchNextCard,
  hintSteps,
  isAutoChecked,
  RATING_LABELS,
  submitAttempt,
  type DisputeResult,
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
  | { kind: 'result'; card: PracticeCard; task: Task; result: GradeResult };

/** One practice card (P1): the next ready word, a scaffolded task, hints, and the grade. */
export function Practice({ dailyCap }: { dailyCap?: number } = {}) {
  const [view, setView] = useState<View>({ kind: 'loading' });

  const loadNext = useCallback(async () => {
    setView({ kind: 'loading' });
    try {
      const card = await fetchNextCard(supabase, new Date(), dailyCap);
      setView(card ? { kind: 'task', card, task: chooseTask(card) } : { kind: 'empty' });
    } catch {
      setView({ kind: 'error', message: "Couldn't load your words. Check your connection and try again." });
    }
  }, [dailyCap]);

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
            Nothing to practice right now. Select a word on any page, then right-click → Save to Forage, or press
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
          initialTask={view.task}
          onGraded={(task, result) => {
            setView({ kind: 'result', card: view.card, task, result });
            refreshBadge(supabase);
          }}
        />
      );
    case 'result':
      return <ResultCard card={view.card} task={view.task} result={view.result} onNext={loadNext} />;
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
  initialTask,
  onGraded,
}: {
  card: PracticeCard;
  initialTask: Task;
  onGraded: (task: Task, result: GradeResult) => void;
}) {
  const [task, setTask] = useState(initialTask);
  const [easier, setEasier] = useState(false);
  const [answer, setAnswer] = useState('');
  const [hintsShown, setHintsShown] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answerId = useId();
  const steps = hintSteps(card);
  const nextHint = steps[hintsShown];
  const easierOption = easierTask(card, task);

  async function send(text: string) {
    if (!text.trim() || pending) return;
    setPending(true);
    setError(null);
    const outcome = await submitAttempt(supabase, card, task, text, hintsShown, easier);
    setPending(false);
    if (outcome.ok) onGraded(task, outcome.result);
    else setError(outcome.message);
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    send(answer);
  }

  // Enter checks a frame's one-line answer; sentences use Cmd/Ctrl+Enter so Enter can add a line.
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) submit();
  }

  function makeEasier() {
    if (!easierOption) return;
    setTask(easierOption);
    setEasier(true);
    setAnswer('');
    setHintsShown(0);
    setError(null);
  }

  const easierButton = easierOption && (
    <button type="button" className="link" disabled={pending} onClick={makeEasier}>
      Easier, please
    </button>
  );

  if (isAutoChecked(task.type)) {
    return (
      <section className="practice">
        <WordHeading card={card} />
        <p className="prompt">{task.prompt}</p>
        {task.type === 'pick' && <p className="hint">Pick the ending that fits "{card.word}".</p>}
        <div className="choices">
          {task.options!.map((option) => (
            <button key={option} type="button" className="choice" disabled={pending} onClick={() => send(option)}>
              {option}
            </button>
          ))}
        </div>
        {pending && <p className="hint">Checking…</p>}
        {error && <p role="alert">{error}</p>}
        {easierButton}
      </section>
    );
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
      {easierButton}
    </form>
  );
}

function ResultCard({
  card,
  task,
  result,
  onNext,
}: {
  card: PracticeCard;
  task: Task;
  result: GradeResult;
  onNext: () => void;
}) {
  const [dispute, setDispute] = useState<
    { kind: 'idle' } | { kind: 'pending' } | { kind: 'error'; message: string } | { kind: 'done'; result: DisputeResult }
  >({ kind: 'idle' });
  const isChoice = isAutoChecked(task.type);
  // Multiple choice is simply right or wrong; written answers get a level of mastery.
  const label = isChoice ? (result.rating >= 3 ? 'Right' : 'Wrong') : (RATING_LABELS[result.rating] ?? '');
  const corrected = result.verdict.corrected_sentence.trim();
  const changed = corrected !== '' && corrected !== result.sentence.trim();

  async function disagree() {
    setDispute({ kind: 'pending' });
    const outcome = await disputeAttempt(supabase, result.attempt_id);
    if (!outcome.ok) {
      setDispute({ kind: 'error', message: outcome.message });
      return;
    }
    setDispute({ kind: 'done', result: outcome.result });
    if (outcome.result.rescheduled) refreshBadge(supabase);
  }

  return (
    <section className="practice" aria-live="polite">
      <WordHeading card={card} />
      <p className="prompt task-recap">
        {task.register && <span className="register">{task.register}</span>}
        {task.prompt}
      </p>
      <p className={`rating rating-${result.rating}`}>
        {isChoice && <span aria-hidden="true">{result.rating >= 3 ? '✓' : '✕'}</span>}
        <span>{label}</span>
      </p>
      <p>{result.verdict.rationale}</p>
      <figure className="sentence">
        <figcaption>{isChoice ? 'You picked' : 'You wrote'}</figcaption>
        <blockquote>{result.sentence}</blockquote>
      </figure>
      {changed && (
        <figure className="sentence suggested">
          <figcaption>{isChoice ? 'Correct usage' : 'Suggested'}</figcaption>
          <blockquote>{corrected}</blockquote>
        </figure>
      )}
      <p className="hint">Next review {describeNextReview(result.scheduled_days)}.</p>

      {dispute.kind === 'done' && <SecondOpinion dispute={dispute.result} isChoice={isChoice} />}
      {dispute.kind === 'error' && <p role="alert">{dispute.message}</p>}

      <div className="actions">
        <button type="button" autoFocus onClick={onNext}>
          Next word
        </button>
        {/* A right multiple-choice answer has nothing to dispute; a wrong one may mean a faulty question. */}
        {(!isChoice || result.rating < 3) && (dispute.kind === 'idle' || dispute.kind === 'error') && (
          <button type="button" className="secondary" onClick={disagree}>
            I disagree
          </button>
        )}
        {dispute.kind === 'pending' && <span className="hint">Getting a second opinion…</span>}
      </div>
    </section>
  );
}

function SecondOpinion({ dispute, isChoice }: { dispute: DisputeResult; isChoice: boolean }) {
  let outcome: string;
  if (isChoice && !dispute.changed) outcome = 'Your pick is still wrong.';
  else if (isChoice && dispute.rescheduled && dispute.scheduled_days !== null) {
    outcome = `Your pick counts as right, and this question won't be used again. Next review ${describeNextReview(dispute.scheduled_days)}.`;
  } else if (isChoice) outcome = "Your pick counts as right, and this question won't be used again.";
  else if (!dispute.changed) outcome = 'It agrees with the first grade.';
  else if (dispute.rescheduled && dispute.scheduled_days !== null) {
    outcome = `Your next review is now ${describeNextReview(dispute.scheduled_days)}.`;
  } else outcome = "You've reviewed this word since, so its schedule stays as it is.";

  return (
    <div className="second-opinion">
      <p>
        <strong>Second opinion: {isChoice ? (dispute.rating >= 3 ? 'Right' : 'Wrong') : RATING_LABELS[dispute.rating]}</strong>.{' '}
        {outcome}
      </p>
      <p>{dispute.verdict.rationale}</p>
    </div>
  );
}
