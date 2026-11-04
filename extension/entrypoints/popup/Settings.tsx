import { useId, useState, type FormEvent } from 'react';
import { refreshBadge } from '@/lib/badge';
import {
  DEFAULT_SETTINGS,
  MAX_DAILY_CAP,
  pauseForAWeek,
  REMINDER_INTERVALS,
  saveSettings,
  SPARE_MINUTES,
  type Settings as SettingsValue,
  type SpareMinute,
} from '@/lib/settings';
import { supabase } from '@/lib/supabase';

const SPARE_MINUTE_KEYS = Object.keys(SPARE_MINUTES) as SpareMinute[];

async function persist(settings: SettingsValue): Promise<string | null> {
  try {
    await saveSettings(supabase, settings);
    refreshBadge(supabase);
    return null;
  } catch {
    return "Couldn't save your settings. Check your connection and try again.";
  }
}

/** T4: one question after sign-in. Skipping keeps the defaults (no required setup). */
export function Onboarding({ onDone }: { onDone: (settings: SettingsValue) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(spareMinute: SpareMinute | null) {
    setPending(true);
    setError(null);
    const settings = { ...DEFAULT_SETTINGS, spareMinute };
    const failure = await persist(settings);
    setPending(false);
    if (failure) setError(failure);
    else onDone(settings);
  }

  return (
    <section className="practice">
      <h1>When do you usually have a spare minute?</h1>
      <p className="hint">Forage will aim its reminders at that time. You can change this later.</p>
      <div className="choices">
        {SPARE_MINUTE_KEYS.map((key) => (
          <button key={key} type="button" className="choice" disabled={pending} onClick={() => choose(key)}>
            {SPARE_MINUTES[key].label}
          </button>
        ))}
      </div>
      {error && <p role="alert">{error}</p>}
      <button type="button" className="link" disabled={pending} onClick={() => choose(null)}>
        Skip for now
      </button>
    </section>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

/** D6: every timing control from section 7.5 of the PRD, plus surfaces on or off. */
export function Settings({
  initial,
  onSaved,
  onClose,
}: {
  initial: SettingsValue;
  onSaved: (settings: SettingsValue) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{ kind: 'saved' } | { kind: 'error'; message: string } | null>(null);
  const id = useId();
  const paused = saved.pausedUntil !== null && new Date(saved.pausedUntil) > new Date();
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  function set<K extends keyof SettingsValue>(key: K, value: SettingsValue[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setStatus(null);
  }

  async function save(next: SettingsValue): Promise<boolean> {
    setPending(true);
    setStatus(null);
    const failure = await persist(next);
    setPending(false);
    if (failure) {
      setStatus({ kind: 'error', message: failure });
      return false;
    }
    setSaved(next);
    setDraft(next);
    setStatus({ kind: 'saved' });
    onSaved(next);
    return true;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.quietStart === draft.quietEnd) {
      setStatus({ kind: 'error', message: 'Quiet hours need different start and end times.' });
      return;
    }
    save(draft);
  }

  // Pausing saves right away, keeping any other unsaved edits in the form.
  function togglePause() {
    const pausedUntil = paused ? null : pauseForAWeek();
    const edits = draft;
    save({ ...saved, pausedUntil }).then((ok) => {
      if (ok) setDraft({ ...edits, pausedUntil });
    });
  }

  return (
    <form className="practice settings" onSubmit={submit}>
      <h1>Settings</h1>

      <fieldset>
        <legend>Reminders</legend>
        <label htmlFor={`${id}-spare`}>Spare minute</label>
        <select
          id={`${id}-spare`}
          value={draft.spareMinute ?? ''}
          onChange={(e) => set('spareMinute', (e.target.value || null) as SpareMinute | null)}
        >
          <option value="">No preference</option>
          {SPARE_MINUTE_KEYS.map((key) => (
            <option key={key} value={key}>
              {SPARE_MINUTES[key].label}
            </option>
          ))}
        </select>

        <label htmlFor={`${id}-every`}>How often</label>
        <select
          id={`${id}-every`}
          value={draft.reminderEveryHours}
          onChange={(e) => set('reminderEveryHours', Number(e.target.value) as SettingsValue['reminderEveryHours'])}
        >
          {REMINDER_INTERVALS.map((hours) => (
            <option key={hours} value={hours}>
              {hours === 24 ? 'Once a day' : `At most every ${hours} hours`}
            </option>
          ))}
        </select>

        <label htmlFor={`${id}-cap`}>Words per day</label>
        <input
          id={`${id}-cap`}
          type="number"
          min={1}
          max={MAX_DAILY_CAP}
          required
          value={draft.dailyCap}
          onChange={(e) => set('dailyCap', Number(e.target.value))}
        />

        <label className="check">
          <input type="checkbox" checked={draft.weekends} onChange={(e) => set('weekends', e.target.checked)} />
          Practice on weekends
        </label>
      </fieldset>

      <fieldset>
        <legend>Quiet hours</legend>
        <div className="row">
          <label>
            From
            <input type="time" required value={draft.quietStart} onChange={(e) => set('quietStart', e.target.value)} />
          </label>
          <label>
            To
            <input type="time" required value={draft.quietEnd} onChange={(e) => set('quietEnd', e.target.value)} />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>Where to practice</legend>
        <label className="check">
          <input type="checkbox" checked={draft.badgeEnabled} onChange={(e) => set('badgeEnabled', e.target.checked)} />
          Toolbar badge count
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.endOfReadingEnabled}
            onChange={(e) => set('endOfReadingEnabled', e.target.checked)}
          />
          Card when I close a page I saved a word from
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={draft.cornerReminderEnabled}
            onChange={(e) => set('cornerReminderEnabled', e.target.checked)}
          />
          Corner reminders
        </label>
      </fieldset>

      <fieldset>
        <legend>Pause</legend>
        {paused && <p className="hint">Paused until {formatDay(saved.pausedUntil!)}.</p>}
        <button type="button" className="secondary" disabled={pending} onClick={togglePause}>
          {paused ? 'Resume now' : 'Pause for a week'}
        </button>
      </fieldset>

      {status?.kind === 'error' && <p role="alert">{status.message}</p>}
      {status?.kind === 'saved' && !dirty && (
        <p className="hint" role="status">
          Saved.
        </p>
      )}

      <div className="actions">
        <button type="submit" disabled={pending || !dirty}>
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          Done
        </button>
      </div>
    </form>
  );
}
