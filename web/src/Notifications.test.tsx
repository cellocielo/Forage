import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Notifications } from './Notifications';

const mocks = vi.hoisted(() => ({
  pushStatus: vi.fn(),
  turnOnPush: vi.fn(),
  turnOffPush: vi.fn(),
  sendTestPush: vi.fn(),
  syncPush: vi.fn(),
}));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));
vi.mock('./push', () => mocks);

afterEach(cleanup);

describe('Notifications', () => {
  it('turns notifications on, then sends a test', async () => {
    mocks.pushStatus.mockResolvedValue('off');
    mocks.turnOnPush.mockResolvedValue('on');
    mocks.sendTestPush.mockResolvedValue({ ok: true });
    mocks.syncPush.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Notifications />);

    await user.click(await screen.findByRole('button', { name: 'Turn on notifications' }));
    expect(await screen.findByText('Notifications are on. Send a test to check they arrive.')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Send a test' }));
    expect(await screen.findByText('Sent. It should arrive in a few seconds.')).toBeTruthy();
  });

  it('keeps the device in step with the account when already on, and can turn off', async () => {
    mocks.pushStatus.mockResolvedValue('on');
    mocks.syncPush.mockResolvedValue(undefined);
    mocks.turnOffPush.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<Notifications />);

    await user.click(await screen.findByRole('button', { name: 'Turn off' }));
    expect(mocks.syncPush).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button', { name: 'Turn on notifications' })).toBeTruthy();
  });

  it('explains how to get notifications on an iPhone in Safari', async () => {
    mocks.pushStatus.mockResolvedValue('needs-install');
    render(<Notifications />);
    expect(await screen.findByText(/add Forage to your Home Screen first/)).toBeTruthy();
  });

  it('shows the server’s message when a test fails', async () => {
    mocks.pushStatus.mockResolvedValue('on');
    mocks.syncPush.mockResolvedValue(undefined);
    mocks.sendTestPush.mockResolvedValue({ ok: false, message: 'Turn on notifications on this device first.' });
    const user = userEvent.setup();
    render(<Notifications />);

    await user.click(await screen.findByRole('button', { name: 'Send a test' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Turn on notifications on this device first.');
  });
});
