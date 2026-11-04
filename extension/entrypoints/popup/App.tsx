import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Acorn } from '@/components/Acorn';
import { loadSettings, type Settings as SettingsValue } from '@/lib/settings';
import { supabase } from '@/lib/supabase';
import { Practice } from './Practice';
import { Onboarding, Settings } from './Settings';

function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <main aria-busy="true" />;
  return <main>{session ? <SignedIn email={session.user.email} /> : <SignInForm />}</main>;
}

type SignedInView =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'onboarding' }
  | { kind: 'practice' | 'settings'; settings: SettingsValue };

function SignedIn({ email }: { email?: string }) {
  const [view, setView] = useState<SignedInView>({ kind: 'loading' });

  const load = useCallback(async () => {
    setView({ kind: 'loading' });
    try {
      const settings = await loadSettings(supabase);
      setView(settings ? { kind: 'practice', settings } : { kind: 'onboarding' });
    } catch {
      setView({ kind: 'error' });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  let body;
  switch (view.kind) {
    case 'loading':
      body = <section className="practice" aria-busy="true" aria-label="Loading" />;
      break;
    case 'error':
      body = (
        <section className="practice">
          <p role="alert">Couldn't load your settings. Check your connection and try again.</p>
          <button type="button" onClick={load}>
            Try again
          </button>
        </section>
      );
      break;
    case 'onboarding':
      body = <Onboarding onDone={(settings) => setView({ kind: 'practice', settings })} />;
      break;
    case 'practice':
      body = <Practice dailyCap={view.settings.dailyCap} />;
      break;
    case 'settings':
      body = (
        <Settings
          initial={view.settings}
          onSaved={(settings) => setView({ kind: 'settings', settings })}
          onClose={() => setView({ kind: 'practice', settings: view.settings })}
        />
      );
      break;
  }

  return (
    <>
      <div className="brand">
        <Acorn size={18} />
        Forage
      </div>
      {body}
      <footer className="account">
        <span>
          Signed in as <strong>{email}</strong>
        </span>
        {view.kind === 'practice' && (
          <button type="button" className="link" onClick={() => setView({ kind: 'settings', settings: view.settings })}>
            Settings
          </button>
        )}
        <button type="button" className="link" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </footer>
    </>
  );
}

function SignInForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function authenticate(mode: 'sign-in' | 'sign-up') {
    setPending(true);
    setError(null);
    const credentials = { email: email.trim(), password };
    const { error } =
      mode === 'sign-up'
        ? await supabase.auth.signUp(credentials)
        : await supabase.auth.signInWithPassword(credentials);
    setPending(false);
    if (error) setError(error.message);
  }

  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        authenticate('sign-in');
      }}
    >
      <div className="brand brand-large">
        <Acorn size={44} />
        <h1>Forage</h1>
      </div>
      <label>
        Email
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Password
        <input
          type="password"
          autoComplete="current-password"
          required
          minLength={6}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        <button type="submit" disabled={pending}>
          Sign in
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={(event) => {
            if (event.currentTarget.form?.reportValidity()) authenticate('sign-up');
          }}
        >
          Create account
        </button>
      </div>
    </form>
  );
}

export default App;
