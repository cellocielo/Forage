import { describe, expect, it, vi } from 'vitest';
import { describeWhen, fetchNextPractice } from './practice';

const NOW = new Date(2026, 10, 12, 10, 0); // Nov 12, 10:00 local
const at = (hours: number) => new Date(NOW.getTime() + hours * 60 * 60 * 1000);

function clientWith(rows: Array<{ due: string; snoozed_until: string | null }> | null, error: Error | null = null) {
  const limit = vi.fn().mockResolvedValue({ data: rows, error });
  const order = vi.fn(() => ({ limit }));
  const is = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ is }));
  return { from: vi.fn(() => ({ select })), is, order };
}

describe('fetchNextPractice', () => {
  it('finds the soonest word, counting snoozes', async () => {
    const client = clientWith([
      { due: at(1).toISOString(), snoozed_until: at(30).toISOString() },
      { due: at(5).toISOString(), snoozed_until: null },
    ]);

    expect(await fetchNextPractice(client as never, NOW)).toEqual({ kind: 'due', at: at(5) });
    expect(client.is).toHaveBeenCalledWith('archived_at', null);
    expect(client.order).toHaveBeenCalledWith('due', { ascending: true });
  });

  it("is held back by today's limit when a word is already due", async () => {
    const client = clientWith([{ due: at(-2).toISOString(), snoozed_until: null }]);
    expect(await fetchNextPractice(client as never, NOW)).toEqual({ kind: 'cap' });
  });

  it('is null without any words', async () => {
    expect(await fetchNextPractice(clientWith([]) as never, NOW)).toBeNull();
  });

  it('throws when the read fails', async () => {
    await expect(fetchNextPractice(clientWith(null, new Error('offline')) as never, NOW)).rejects.toThrow('offline');
  });
});

describe('describeWhen', () => {
  it.each([
    [0.1, 'in a few minutes'],
    [0.5, 'in under an hour'],
    [1.1, 'in about an hour'],
    [3.2, 'in about 3 hours'],
    [13, 'later today'], // 23:00 the same day
    [23, 'tomorrow'], // 09:00 the next morning
    [24 * 4, 'in 4 days'],
    [24 * 21, 'in 3 weeks'],
  ])('%s hours away reads "%s"', (hours, text) => {
    expect(describeWhen(at(hours), NOW)).toBe(text);
  });
});
