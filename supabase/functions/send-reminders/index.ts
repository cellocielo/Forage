import { withSupabase } from '@supabase/server';
import webpush from 'web-push';
import { type PushMessage, type ReminderSettings, type ReminderState, startOfLocalDay, TEST_MESSAGE } from './remind.ts';
import { type PushOutcome, type SendDeps, sendDueReminders, sendTest, type Subscription } from './send.ts';

// Reminders as push notifications to phones (the installed web app).
//   - pg_cron calls it every 10 minutes with a project secret key: remind whoever is due.
//   - A signed-in user calls it from Settings with { test: true }: one test to their devices.
Deno.serve(
  withSupabase({ auth: ['secret:*', 'user'] }, async (req, ctx) => {
    if (req.method !== 'POST') return Response.json({ error: 'Use POST' }, { status: 405 });
    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY');
    const privateKey = Deno.env.get('VAPID_PRIVATE_KEY');
    const subject = Deno.env.get('VAPID_SUBJECT');
    if (!publicKey || !privateKey || !subject) {
      return Response.json({ error: 'Notifications are not configured' }, { status: 500 });
    }
    webpush.setVapidDetails(subject, publicKey, privateKey);
    const db = ctx.supabaseAdmin;

    async function push(sub: Subscription, message: PushMessage): Promise<PushOutcome> {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(message),
          // A reminder an hour late is no use; a newer one replaces one still waiting.
          { TTL: 60 * 60, urgency: 'normal', topic: 'forage-reminder' },
        );
        return 'sent';
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) return 'gone';
        console.warn(`push failed (${status ?? 'no status'}) to ${new URL(sub.endpoint).host}`);
        return 'failed';
      }
    }

    async function removeSubscriptions(ids: string[]) {
      if (ids.length === 0) return;
      const { error } = await db.from('push_subscriptions').delete().in('id', ids);
      if (error) console.warn(`removing gone devices failed: ${error.message}`);
    }

    if (ctx.authMode === 'user') {
      const body = await req.json().catch(() => null);
      if (body?.test !== true) return Response.json({ error: 'Invalid request' }, { status: 400 });
      const { data, error } = await db
        .from('push_subscriptions')
        .select('id, user_id, endpoint, p256dh, auth')
        .eq('user_id', ctx.userClaims!.id);
      if (error) return Response.json({ error: error.message }, { status: 500 });
      if (!data?.length) {
        return Response.json({ error: 'Turn on notifications on this device first.' }, { status: 404 });
      }
      const result = await sendTest(data as Subscription[], TEST_MESSAGE, push);
      await removeSubscriptions(result.gone);
      if (result.sent === 0) {
        return Response.json({ error: "Couldn't reach your device. Turn notifications off and on again." }, { status: 502 });
      }
      return Response.json({ sent: result.sent, failed: result.failed });
    }

    const now = new Date();
    const deps: SendDeps = {
      now,
      async subscriptions() {
        const { data, error } = await db.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth');
        if (error) throw new Error(error.message);
        return (data ?? []) as Subscription[];
      },
      async settings(userIds) {
        const { data, error } = await db
          .from('user_settings')
          .select(
            'user_id, reminder_every_hours, daily_cap, weekends, quiet_start, quiet_end, time_zone, paused_until, spare_minute, corner_reminder_enabled',
          )
          .in('user_id', userIds);
        if (error) throw new Error(error.message);
        return new Map((data ?? []).map((row) => [row.user_id as string, row as unknown as ReminderSettings]));
      },
      async states(userIds) {
        const { data, error } = await db
          .from('push_reminder_state')
          .select('user_id, last_sent_at, awaiting_response, ignored_streak')
          .in('user_id', userIds);
        if (error) throw new Error(error.message);
        return new Map((data ?? []).map((row) => [row.user_id as string, row as unknown as ReminderState]));
      },
      async readiness(userId, settings) {
        const nowIso = now.toISOString();
        // Same rules as the extension's countReadyWords and fetchNextCard.
        const ready = () =>
          db
            .from('cards')
            .select('id, captures!inner ( word, lemmas ( lemma ) )', { count: 'exact' })
            .eq('user_id', userId)
            .is('archived_at', null)
            .lte('due', nowIso)
            .or(`snoozed_until.is.null,snoozed_until.lte."${nowIso}"`)
            .order('due', { ascending: true })
            .limit(1);
        const [due, reviewed] = await Promise.all([
          ready(),
          db
            .from('cards')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .gte('last_review', startOfLocalDay(now, settings.time_zone).toISOString()),
        ]);
        if (due.error) throw new Error(due.error.message);
        if (reviewed.error) throw new Error(reviewed.error.message);
        const first = due.data?.[0] as unknown as { captures: { word: string; lemmas: { lemma: string } | null } } | undefined;
        return {
          due: due.count ?? 0,
          reviewedToday: reviewed.count ?? 0,
          word: first ? (first.captures.lemmas?.lemma ?? first.captures.word) : null,
        };
      },
      push,
      async saveState(userId, state) {
        const { error } = await db.from('push_reminder_state').upsert({ user_id: userId, ...state });
        if (error) throw new Error(error.message);
      },
      removeSubscriptions,
    };

    try {
      return Response.json(await sendDueReminders(deps));
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 500 });
    }
  }),
);
