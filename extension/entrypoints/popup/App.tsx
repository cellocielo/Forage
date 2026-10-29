import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

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

function SignedIn({ email }: { email?: string }) {
  return (
    <>
      <p>
        Signed in as <strong>{email}</strong>
      </p>
      <p className="hint">
        Select a word on any page, then right-click → Save to Forage, or press Alt+Shift+S.
      </p>
      <button type="button" onClick={() => supabase.auth.signOut()}>
        Sign out
      </button>
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
      <h1>Forage</h1>
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
