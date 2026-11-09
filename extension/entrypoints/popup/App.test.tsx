import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_SETTINGS } from '@/lib/settings';
import App from './App';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: { auth } }));
vi.mock('./Practice', () => ({ Practice: ({ dailyCap }: { dailyCap: number }) => <p>practice card, cap {dailyCap}</p> }));
const settings = vi.hoisted(() => ({ loadSettings: vi.fn(), saveSettings: vi.fn() }));
vi.mock('@/lib/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/settings')>()),
  ...settings,
}));
vi.mock('@/lib/badge', () => ({ refreshBadge: vi.fn() }));

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
  settings.loadSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, dailyCap: 7 });
  settings.saveSettings.mockResolvedValue(undefined);
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
    expect(await screen.findByText('practice card, cap 7')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(auth.signOut).toHaveBeenCalled();
  });

  it('asks the spare-minute question once, before practice', async () => {
    settings.loadSettings.mockResolvedValue(null);
    auth.getSession.mockResolvedValue({ data: { session: { user: { email: 'me@example.com' } } } });
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'Lunch' }));

    expect(settings.saveSettings).toHaveBeenCalledWith(expect.anything(), { ...DEFAULT_SETTINGS, spareMinute: 'lunch' });
    expect(await screen.findByText('practice card, cap 5')).toBeTruthy();
  });

  it('opens settings from the footer and returns to practice', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { email: 'me@example.com' } } } });
    render(<App />);

    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(await screen.findByText('practice card, cap 7')).toBeTruthy();
  });
});
