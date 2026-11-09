import {
  INITIAL_STATE,
  type PushMessage,
  readyCount,
  reminderMessage,
  type ReminderSettings,
  type ReminderState,
  skipReason,
  stateAfterSending,
} from './remind.ts';

export interface Subscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** gone: the push service says the device unsubscribed, so its row should go. */
export type PushOutcome = 'sent' | 'gone' | 'failed';

export interface SendDeps {
  now: Date;
  subscriptions(): Promise<Subscription[]>;
  settings(userIds: string[]): Promise<Map<string, ReminderSettings>>;
  states(userIds: string[]): Promise<Map<string, ReminderState>>;
  /** Due words and today's reviews for one user, and the word that comes up first. */
  readiness(userId: string, settings: ReminderSettings): Promise<{ due: number; reviewedToday: number; word: string | null }>;
  push(subscription: Subscription, message: PushMessage): Promise<PushOutcome>;
  saveState(userId: string, state: ReminderState): Promise<void>;
  removeSubscriptions(ids: string[]): Promise<void>;
}

export type UserOutcome = 'not-set-up' | 'nothing-due' | 'sent' | 'failed' | ReturnType<typeof skipReason> & string;

/** Pushes the users that should get a reminder now, on all their devices. Returns counts per outcome. */
export async function sendDueReminders(deps: SendDeps): Promise<Record<string, number>> {
  const subscriptions = await deps.subscriptions();
  const byUser = new Map<string, Subscription[]>();
  for (const sub of subscriptions) byUser.set(sub.user_id, [...(byUser.get(sub.user_id) ?? []), sub]);
  const userIds = [...byUser.keys()];
  if (userIds.length === 0) return {};

  const [settingsByUser, statesByUser] = await Promise.all([deps.settings(userIds), deps.states(userIds)]);
  const counts: Record<string, number> = {};
  const gone: string[] = [];

  for (const [userId, devices] of byUser) {
    const outcome = await remindUser(deps, userId, devices, settingsByUser.get(userId), statesByUser.get(userId), gone);
    counts[outcome] = (counts[outcome] ?? 0) + 1;
  }
  if (gone.length > 0) await deps.removeSubscriptions(gone);
  return counts;
}

async function remindUser(
  deps: SendDeps,
  userId: string,
  devices: Subscription[],
  settings: ReminderSettings | undefined,
  state: ReminderState = INITIAL_STATE,
  gone: string[],
): Promise<UserOutcome> {
  if (!settings) return 'not-set-up';
  const reason = skipReason(settings, state, deps.now);
  if (reason) return reason;

  const { due, reviewedToday, word } = await deps.readiness(userId, settings);
  const ready = readyCount(due, reviewedToday, settings.daily_cap);
  if (ready === 0 || !word) return 'nothing-due';

  const message = reminderMessage(word, ready);
  const outcomes = await Promise.all(devices.map((device) => deps.push(device, message)));
  devices.forEach((device, i) => {
    if (outcomes[i] === 'gone') gone.push(device.id);
  });
  if (!outcomes.includes('sent')) return 'failed';

  await deps.saveState(userId, stateAfterSending(state, deps.now));
  return 'sent';
}

/** "Send a test": one notification to each of the user's devices, ignoring timing. */
export async function sendTest(
  devices: Subscription[],
  message: PushMessage,
  push: SendDeps['push'],
): Promise<{ sent: number; failed: number; gone: string[] }> {
  const outcomes = await Promise.all(devices.map((device) => push(device, message)));
  return {
    sent: outcomes.filter((o) => o === 'sent').length,
    failed: outcomes.filter((o) => o !== 'sent').length,
    gone: devices.filter((_, i) => outcomes[i] === 'gone').map((d) => d.id),
  };
}
