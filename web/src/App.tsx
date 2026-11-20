import { useCallback, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Acorn } from '@/components/Acorn';
import { SignInForm } from '@/entrypoints/popup/App';
import { Practice } from '@/entrypoints/popup/Practice';
import { Onboarding, Settings } from '@/entrypoints/popup/Settings';
import { Words } from '@/entrypoints/popup/Words';
import { loadSettings, type Settings as SettingsValue } from '@/lib/settings';
import { supabase } from '@/lib/supabase';
import { refreshBadge } from './badge';
import { Notifications } from './Notifications';
import { respondToReminder, turnOffPush } from './push';
import { Save, useClearShareParams } from './Save';
import { readShare, type Shared } from './share';

type Tab = 'practice' | 'words' | 'save' | 'settings';

/** Forage on a phone or in any browser: practice, saved words, save words, settings. */
export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  // Read once: text shared to the app opens the Save tab with it.
  const [shared] = useState<Shared | null>(() => readShare(location.search));
  // Opened by tapping a reminder notification.
  const [fromReminder] = useState(() => new URLSearchParams(location.search).get('from') === 'reminder');
  useClearShareParams();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <main aria-busy="true" />;
  return (
    <main>
      {session ? (
        <SignedIn email={session.user.email} shared={shared} fromReminder={fromReminder} />
      ) : (
        <>
          {shared && <p className="hint signed-out-share">Sign in, then share the word again to save it.</p>}
          <SignInForm />
        </>
      )}
    </main>
  );
}

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'onboarding' } | { kind: 'ready'; settings: SettingsValue };

function SignedIn({ email, shared, fromReminder }: { email?: string; shared: Shared | null; fromReminder: boolean }) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [tab, setTab] = useState<Tab>(shared ? 'save' : 'practice');

  const load = useCallback(async () => {
    setView({ kind: 'loading' });
    try {
      const settings = await loadSettings(supabase);
      setView(settings ? { kind: 'ready', settings } : { kind: 'onboarding' });
    } catch {
      setView({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    load();
    refreshBadge(supabase);
  }, [load]);

  useEffect(() => {
    if (fromReminder) respondToReminder(supabase).catch(() => {});
  }, [fromReminder]);

  async function signOut() {
    // This device stops getting the account's reminders.
    await turnOffPush(supabase).catch(() => {});
    await supabase.auth.signOut();
  }

  let body;
  if (view.kind === 'loading') body = <section className="practice" aria-busy="true" aria-label="Loading" />;
  else if (view.kind === 'error') {
    body = (
      <section className="practice">
        <p role="alert">Couldn't load your settings. Check your connection and try again.</p>
        <button type="button" onClick={load}>
          Try again
        </button>
      </section>
    );
  } else if (view.kind === 'onboarding') {
    body = <Onboarding onDone={(settings) => setView({ kind: 'ready', settings })} />;
  } else if (tab === 'practice') body = <Practice dailyCap={view.settings.dailyCap} />;
  else if (tab === 'words') body = <Words />;
  else if (tab === 'save') body = <Save shared={shared} />;
  else {
    body = (
      <>
        <Notifications />
        <Settings
          initial={view.settings}
          onSaved={(settings) => setView({ kind: 'ready', settings })}
          onClose={() => setTab('practice')}
        />
        <footer className="account">
          <span>
            Signed in as <strong>{email}</strong>
          </span>
          <button type="button" className="link" onClick={signOut}>
            Sign out
          </button>
        </footer>
      </>
    );
  }

  return (
    <>
      <div className="brand">
        <Acorn size={18} />
        Forage
      </div>
      {body}
      {view.kind === 'ready' && (
        <nav className="tabs" aria-label="Forage">
          {(
            [
              ['practice', 'Practice'],
              ['words', 'Words'],
              ['save', 'Save a word'],
              ['settings', 'Settings'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-current={tab === key ? 'page' : undefined}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      )}
    </>
  );
}
