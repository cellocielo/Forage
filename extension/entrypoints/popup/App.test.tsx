import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));
vi.mock('./Practice', () => ({ Practice: () => <p>practice card</p> }));

let emitAuthChange: (session: unknown) => void;

beforeEach(() => {
  auth.getSession.mockResolvedValue({ data: { session: null } });
  auth.onAuthStateChange.mockImplementation((callback) => {
    emitAuthChange = (session) => callback('SIGNED_IN', session);
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  });
  auth.signInWithPassword.mockResolvedValue({ error: null });
  auth.signUp.mockResolvedValue({ error: null });
  auth.signOut.mockResolvedValue({ error: null });
});
afterEach(cleanup);

async function fillCredentials() {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), ' me@example.com ');
  await user.type(screen.getByLabelText('Password'), 'hunter22');
  return user;
}

describe('popup', () => {
  it('signs in with email and password', async () => {
    render(<App />);
    const user = await fillCredentials();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'me@example.com', password: 'hunter22' });
  });

  it('creates an account', async () => {
    render(<App />);
    const user = await fillCredentials();

    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(auth.signUp).toHaveBeenCalledWith({ email: 'me@example.com', password: 'hunter22' });
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('shows the auth error', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    render(<App />);
    const user = await fillCredentials();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Invalid login credentials');
  });

  it('switches to the signed-in view and signs out', async () => {
    render(<App />);
    await screen.findByLabelText('Email');

    emitAuthChange({ user: { email: 'me@example.com' } });

    expect(await screen.findByText('me@example.com')).toBeTruthy();
    expect(screen.getByText('practice card')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalled();
  });
});
