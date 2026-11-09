import { assertEquals } from '@std/assert';
import {
  INITIAL_STATE,
  localClock,
  readyCount,
  reminderMessage,
  type ReminderSettings,
  skipReason,
  startOfLocalDay,
  stateAfterSending,
} from './remind.ts';
import { sendDueReminders, type SendDeps, sendTest, type Subscription } from './send.ts';

const SETTINGS: ReminderSettings = {
  reminder_every_hours: 5,
  daily_cap: 5,
  weekends: false,
  quiet_start: '21:00:00',
  quiet_end: '08:00:00',
  time_zone: 'America/Los_Angeles',
  paused_until: null,
  spare_minute: null,
  corner_reminder_enabled: true,
};

// Tuesday 2026-11-10, 10:00 in Los Angeles (18:00 UTC).
const TUESDAY_10AM = new Date('2026-11-10T18:00:00Z');
const at = (base: Date, hours: number) => new Date(base.getTime() + hours * 3600_000);

Deno.test('localClock reads the day and time in the user’s time zone', () => {
  assertEquals(localClock(TUESDAY_10AM, 'America/Los_Angeles'), { day: 2, minutes: 600 });
  assertEquals(localClock(TUESDAY_10AM, 'Asia/Seoul'), { day: 3, minutes: 180 });
  // An unknown zone falls back to UTC rather than failing.
  assertEquals(localClock(TUESDAY_10AM, 'Not/AZone'), { day: 2, minutes: 1080 });
});

Deno.test('startOfLocalDay is local midnight', () => {
  assertEquals(startOfLocalDay(new Date('2026-11-10T18:00:42.5Z'), 'America/Los_Angeles').toISOString(), '2026-11-10T08:00:00.000Z');
});

Deno.test('skipReason allows a reminder in working hours on a weekday', () => {
  assertEquals(skipReason(SETTINGS, INITIAL_STATE, TUESDAY_10AM), null);
});

Deno.test('skipReason respects the switch, pause, weekends and quiet hours, in local time', () => {
  assertEquals(skipReason({ ...SETTINGS, corner_reminder_enabled: false }, INITIAL_STATE, TUESDAY_10AM), 'turned-off');
  assertEquals(
    skipReason({ ...SETTINGS, paused_until: at(TUESDAY_10AM, 1).toISOString() }, INITIAL_STATE, TUESDAY_10AM),
    'paused',
  );
  const saturday = at(TUESDAY_10AM, 24 * 4);
  assertEquals(skipReason(SETTINGS, INITIAL_STATE, saturday), 'weekend');
  assertEquals(skipReason({ ...SETTINGS, weekends: true }, INITIAL_STATE, saturday), null);
  // 22:00 and 07:00 local fall in the 21:00 to 08:00 window, which wraps past midnight.
  assertEquals(skipReason(SETTINGS, INITIAL_STATE, at(TUESDAY_10AM, 12)), 'quiet-hours');
  assertEquals(skipReason(SETTINGS, INITIAL_STATE, at(TUESDAY_10AM, -3)), 'quiet-hours');
});

Deno.test('skipReason waits the gap, longer after ignored reminders', () => {
  const sent = { last_sent_at: TUESDAY_10AM.toISOString(), awaiting_response: false, ignored_streak: 0 };
  assertEquals(skipReason(SETTINGS, sent, at(TUESDAY_10AM, 4)), 'too-soon');
  assertEquals(skipReason(SETTINGS, sent, at(TUESDAY_10AM, 5)), null);
  // Two ignored plus one unanswered: the gap doubles to 10 hours.
  const ignored = { ...sent, awaiting_response: true, ignored_streak: 2 };
  assertEquals(skipReason({ ...SETTINGS, quiet_start: '23:00', quiet_end: '00:00' }, ignored, at(TUESDAY_10AM, 9)), 'too-soon');
});

Deno.test('skipReason keeps once-a-day reminders to the spare-minute window', () => {
  const daily = { ...SETTINGS, reminder_every_hours: 24, spare_minute: 'lunch' as const };
  assertEquals(skipReason(daily, INITIAL_STATE, TUESDAY_10AM), 'outside-window');
  assertEquals(skipReason(daily, INITIAL_STATE, at(TUESDAY_10AM, 2.5)), null);
});

Deno.test('stateAfterSending counts an unanswered reminder as ignored', () => {
  assertEquals(stateAfterSending(INITIAL_STATE, TUESDAY_10AM), {
    last_sent_at: TUESDAY_10AM.toISOString(),
    awaiting_response: true,
    ignored_streak: 0,
  });
  assertEquals(stateAfterSending({ last_sent_at: null, awaiting_response: true, ignored_streak: 1 }, TUESDAY_10AM).ignored_streak, 2);
});

Deno.test('readyCount and the message follow the daily cap', () => {
  assertEquals(readyCount(8, 3, 5), 2);
  assertEquals(readyCount(8, 7, 5), 0);
  assertEquals(reminderMessage('egregious', 1).body, 'Tap to start.');
  assertEquals(reminderMessage('egregious', 3), {
    title: 'Time to practice "egregious"',
    body: '2 more words ready after it. Tap to start.',
    url: './?from=reminder',
  });
});

const PHONE: Subscription = { id: 's1', user_id: 'u1', endpoint: 'https://web.push.apple.com/x', p256dh: 'k', auth: 'a' };
const OLD_PHONE: Subscription = { ...PHONE, id: 's2', endpoint: 'https://web.push.apple.com/y' };

function fakeDeps(overrides: Partial<SendDeps> = {}) {
  const pushed: string[] = [];
  const saved: unknown[] = [];
  const removed: string[][] = [];
  const deps: SendDeps = {
    now: TUESDAY_10AM,
    subscriptions: async () => [PHONE, OLD_PHONE],
    settings: async () => new Map([['u1', SETTINGS]]),
    states: async () => new Map(),
    readiness: async () => ({ due: 3, reviewedToday: 0, word: 'egregious' }),
    push: async (sub) => {
      pushed.push(sub.id);
      return sub.id === 's2' ? 'gone' : 'sent';
    },
    saveState: async (userId, state) => {
      saved.push([userId, state]);
    },
    removeSubscriptions: async (ids) => {
      removed.push(ids);
    },
    ...overrides,
  };
  return { deps, pushed, saved, removed };
}

Deno.test('sendDueReminders pushes every device, saves the state, and drops unsubscribed devices', async () => {
  const { deps, pushed, saved, removed } = fakeDeps();
  assertEquals(await sendDueReminders(deps), { sent: 1 });
  assertEquals(pushed, ['s1', 's2']);
  assertEquals(saved, [['u1', stateAfterSending(INITIAL_STATE, TUESDAY_10AM)]]);
  assertEquals(removed, [['s2']]);
});

Deno.test('sendDueReminders skips users without settings, outside their hours, or with nothing ready', async () => {
  assertEquals(await sendDueReminders(fakeDeps({ settings: async () => new Map() }).deps), { 'not-set-up': 1 });
  assertEquals(await sendDueReminders(fakeDeps({ now: at(TUESDAY_10AM, 12) }).deps), { 'quiet-hours': 1 });
  const { deps, pushed, saved } = fakeDeps({ readiness: async () => ({ due: 4, reviewedToday: 5, word: 'x' }) });
  assertEquals(await sendDueReminders(deps), { 'nothing-due': 1 });
  assertEquals(pushed, []);
  assertEquals(saved, []);
});

Deno.test('sendDueReminders keeps the state when no device got it', async () => {
  const { deps, saved } = fakeDeps({ push: async () => 'failed' });
  assertEquals(await sendDueReminders(deps), { failed: 1 });
  assertEquals(saved, []);
});

Deno.test('sendTest reports what reached the devices', async () => {
  const result = await sendTest([PHONE, OLD_PHONE], reminderMessage('x', 1), async (sub) => (sub.id === 's2' ? 'gone' : 'sent'));
  assertEquals(result, { sent: 1, failed: 1, gone: ['s2'] });
});
