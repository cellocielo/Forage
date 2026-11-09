import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { type PushStatus, pushStatus, sendTestPush, syncPush, turnOffPush, turnOnPush } from './push';

type Note = { kind: 'error' | 'info'; text: string } | null;

/** Settings section: reminders as notifications on this phone. */
export function Notifications() {
  const [status, setStatus] = useState<PushStatus | 'loading'>('loading');
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState<Note>(null);

  useEffect(() => {
    pushStatus()
      .then((current) => {
        setStatus(current);
        if (current === 'on') syncPush(supabase).catch(() => {});
      })
      .catch(() => setStatus('unsupported'));
  }, []);

  async function run(action: () => Promise<void>) {
    setPending(true);
    setNote(null);
    try {
      await action();
    } catch {
      setNote({ kind: 'error', text: "Couldn't change notifications. Check your connection and try again." });
    }
    setPending(false);
  }

  const turnOn = () =>
    run(async () => {
      const next = await turnOnPush(supabase);
      setStatus(next);
      if (next === 'on') setNote({ kind: 'info', text: 'Notifications are on. Send a test to check they arrive.' });
    });
  const turnOff = () =>
    run(async () => {
      await turnOffPush(supabase);
      setStatus('off');
    });
  const test = () =>
    run(async () => {
      const result = await sendTestPush(supabase);
      setNote(result.ok ? { kind: 'info', text: 'Sent. It should arrive in a few seconds.' } : { kind: 'error', text: result.message });
    });

  let body;
  switch (status) {
    case 'loading':
      body = null;
      break;
    case 'needs-install':
      body = (
        <p className="hint">
          To get reminders on this iPhone, add Forage to your Home Screen first (Share → Add to Home Screen), then open it from
          there.
        </p>
      );
      break;
    case 'unsupported':
      body = <p className="hint">This browser can't show notifications.</p>;
      break;
    case 'blocked':
      body = (
        <p className="hint">
          Notifications are blocked for Forage. Turn them on in your phone's settings (Settings → Notifications → Forage), then
          come back.
        </p>
      );
      break;
    case 'off':
      body = (
        <>
          <p className="hint">Get a reminder on this device when words are ready, following the reminder settings below.</p>
          <button type="button" disabled={pending} onClick={turnOn}>
            Turn on notifications
          </button>
        </>
      );
      break;
    case 'on':
      body = (
        <>
          <p className="hint">On for this device. Reminders follow the settings below.</p>
          <div className="actions">
            <button type="button" className="secondary" disabled={pending} onClick={test}>
              Send a test
            </button>
            <button type="button" className="secondary" disabled={pending} onClick={turnOff}>
              Turn off
            </button>
          </div>
        </>
      );
      break;
  }

  return (
    <section className="notifications">
      <h2>Notifications</h2>
      {body}
      {note && (note.kind === 'error' ? <p role="alert">{note.text}</p> : <p className="hint">{note.text}</p>)}
    </section>
  );
}
