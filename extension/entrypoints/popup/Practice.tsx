import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { refreshBadge } from '@/lib/badge';
import {
  chooseTask,
  describeNextReview,
  describeWhen,
  disputeAttempt,
  easierTask,
  fetchExtraCard,
  fetchNextCard,
  fetchNextPractice,
  hintSteps,
  isAutoChecked,
  RATING_LABELS,
  submitAttempt,
  type DisputeResult,
  type GradeResult,
  type NextPractice,
  type PracticeCard,
  type Task,
} from '@/lib/practice';
import { supabase } from '@/lib/supabase';

type View =
  | { kind: 'loading' }
  // canKeepGoing: there are words that aren't due yet, for "Keep practicing".
  // next: when practice opens up again, if that's known.
  | { kind: 'empty'; canKeepGoing: boolean; next: NextPractice | null }
  | { kind: 'error'; message: string }
  | { kind: 'task'; card: PracticeCard; task: Task }
  | { kind: 'result'; card: PracticeCard; task: Task; result: GradeResult };

interface PracticeProps {
  dailyCap?: number;
  /** A reminder will say when words are ready, so the caught-up screen can say so. */
  remindsWhenReady?: boolean;
}

/** One practice card (P1): the next ready word, a scaffolded task, hints, and the grade. */
export function Practice({ dailyCap, remindsWhenReady = false }: PracticeProps = {}) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  // "Keep practicing" mode: words that aren't due yet, each once per session.
  const [extra, setExtra] = useState(false);
  const seen = useRef<string[]>([]);

  const load = useCallback(
    async (keepGoing: boolean) => {
      setView({ kind: 'loading' });
      try {
        const now = new Date();
        let card = await fetchNextCard(supabase, now, dailyCap);
        // Words that aren't due yet get typing tasks, not multiple choice.
        let early = false;
        if (!card && keepGoing) {
          card = await fetchExtraCard(supabase, now, seen.current);
          early = card !== null;
        }
        if (card) {
          seen.current = [...seen.current, card.id];
          setView({ kind: 'task', card, task: chooseTask(card, { extra: early }) });
          return;
        }
        const [canKeepGoing, next] = await Promise.all([
          keepGoing ? false : fetchExtraCard(supabase, now, seen.current).then((c) => c !== null),
          // Nice to know, so the caught-up screen still shows without it.
          fetchNextPractice(supabase, now).catch(() => null),
        ]);
        setView({ kind: 'empty', canKeepGoing, next });
      } catch {
        setView({ kind: 'error', message: "Couldn't load your words. Check your connection and try again." });
      }
    },
    [dailyCap],
  );
  const loadNext = useCallback(() => load(extra), [load, extra]);

  useEffect(() => {
    load(false);
  }, [load]);

  function keepPracticing() {
    setExtra(true);
    load(true);
  }

  switch (view.kind) {
    case 'loading':
      return <section className="practice" aria-busy="true" aria-label="Loading your next word" />;
    case 'empty':
      if (extra) {
        return (
          <section className="practice">
            <h1>That's every word</h1>
            <p className="hint">You've practiced all your words this session. Come back later, or save some new ones.</p>
          </section>
        );
      }
      return (
        <section className="practice">
          <h1>All caught up</h1>
          <NextUp next={view.next} dailyCap={dailyCap} remindsWhenReady={remindsWhenReady} />
          {view.canKeepGoing ? (
            <>
              <p className="hint">
                {view.next ? '' : 'Nothing is due right now. '}You can keep practicing words that are coming up soon,
                starting with the ones due first.
              </p>
              <button type="button" onClick={keepPracticing}>
                Keep practicing
              </button>
            </>
          ) : (
            <p className="hint">
              Nothing to practice right now. Select a word on any page, then right-click → Save to Forage, or press
              Alt+Shift+S.
            </p>
          )}
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
          extra={extra}
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
  extra,
  onGraded,
}: {
  card: PracticeCard;
  initialTask: Task;
  extra: boolean;
  onGraded: (task: Task, result: GradeResult) => void;
}) {
  const [task, setTask] = useState(initialTask);
  const [easier, setEasier] = useState(false);
  const [answer, setAnswer] = useState('');
  const [hintsShown, setHintsShown] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answerId = useId();
  const steps = hintSteps(card, task);
  const nextHint = steps[hintsShown];
  const easierOption = easierTask(card, task);

  async function send(text: string) {
    if (!text.trim() || pending) return;
    setPending(true);
    setError(null);
    const outcome = await submitAttempt(supabase, card, task, text, hintsShown, easier, extra);
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
            {task.register && <span className="register">{task.register} tone</span>}
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
        {task.register && <span className="register">{task.register} tone</span>}
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

      <LearnMore card={card} />

      {dispute.kind === 'done' && <SecondOpinion dispute={dispute.result} isChoice={isChoice} />}
      {dispute.kind === 'error' && <p role="alert">{dispute.message}</p>}

      <div className="actions">
        <button type="button" autoFocus onClick={onNext}>
          Next word
        </button>
      </div>
      {/* A quiet way out, not a step: low and unsure grades are already checked by a stronger
          model. A right multiple-choice answer has nothing to dispute; a wrong one may mean a
          faulty question. */}
      {(!isChoice || result.rating < 3) && (dispute.kind === 'idle' || dispute.kind === 'error') && (
        <button type="button" className="link dispute-link" onClick={disagree}>
          {isChoice ? 'Think this question is wrong?' : 'Think this grade is wrong?'}
        </button>
      )}
      {dispute.kind === 'pending' && <p className="hint dispute-link">Taking another look…</p>}
    </section>
  );
}

/** On the caught-up screen: roughly when the next word is ready. */
function NextUp({
  next,
  dailyCap,
  remindsWhenReady,
}: {
  next: NextPractice | null;
  dailyCap?: number;
  remindsWhenReady: boolean;
}) {
  if (!next) return null;
  const remind = remindsWhenReady ? " We'll remind you when it's ready." : '';
  if (next.kind === 'cap') {
    const done = dailyCap ? `today's ${dailyCap} ${dailyCap === 1 ? 'word' : 'words'}` : "today's words";
    return (
      <p className="next-up">
        You've done {done}. More tomorrow.{remindsWhenReady && " We'll remind you."}
      </p>
    );
  }
  return (
    <p className="next-up">
      Next word due {describeWhen(next.at)}.{remind}
    </p>
  );
}

/** After answering: on request, the word's other meanings and example sentences. */
function LearnMore({ card }: { card: PracticeCard }) {
  const [meaningsOpen, setMeaningsOpen] = useState(false);
  // Index of the example shown, or null before asking for one.
  const [exampleIndex, setExampleIndex] = useState<number | null>(null);
  // With one example, the button goes once it's shown.
  const canShowExample = card.examples.length > 1 || (card.examples.length === 1 && exampleIndex === null);

  function nextExample() {
    setExampleIndex((i) => (i === null ? 0 : (i + 1) % card.examples.length));
  }

  return (
    <div className="learn-more">
      <div className="actions">
        <button
          type="button"
          className="secondary"
          aria-expanded={meaningsOpen}
          onClick={() => setMeaningsOpen((open) => !open)}
        >
          {meaningsOpen ? 'Hide meanings' : 'Other meanings'}
        </button>
        {canShowExample && (
          <button type="button" className="secondary" onClick={nextExample}>
            {exampleIndex === null ? 'Use it in a sentence' : 'Another example'}
          </button>
        )}
      </div>

      {meaningsOpen && (
        <dl className="hints">
          <div>
            <dt>Meaning here</dt>
            <dd>{card.definition}</dd>
          </div>
          <div>
            <dt>Other meanings</dt>
            {card.otherMeanings.length > 0 ? (
              card.otherMeanings.map((other) => (
                <dd key={other.definition}>
                  {other.partOfSpeech && <em>{other.partOfSpeech} </em>}
                  {other.definition}
                </dd>
              ))
            ) : (
              <dd>This is its only common meaning.</dd>
            )}
          </div>
        </dl>
      )}

      {exampleIndex !== null && (
        <figure className="sentence">
          <figcaption>
            Example{card.examples.length > 1 ? ` ${exampleIndex + 1} of ${card.examples.length}` : ''}
          </figcaption>
          <blockquote>{card.examples[exampleIndex]}</blockquote>
        </figure>
      )}
    </div>
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
