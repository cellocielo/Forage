-- Reminders as push notifications on phones (the installed web app), following the same
-- settings as the extension's reminders: how often, quiet hours, pause, weekends, the
-- spare-minute window, and backing off when ignored (T5 to T9).
--
-- The send-reminders Edge Function needs these Edge Function secrets (never committed):
--   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (an https: or mailto: contact URL).
-- The cron call reuses the project_url and enrich_secret_key Vault secrets.

-- One row per device that turned notifications on.
create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- Only real push services, so the server never posts to an address a user made up.
  endpoint     text not null unique check (
    char_length(endpoint) <= 1000
    and endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/'
  ),
  p256dh       text not null check (char_length(p256dh) between 1 and 200),
  auth         text not null check (char_length(auth) between 1 and 100),
  created_at   timestamptz not null default now()
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

create policy "Users see their own devices"
  on public.push_subscriptions for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "Users remove their own devices"
  on public.push_subscriptions for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- Saving goes through this function: a device's endpoint is unique, and when someone else
-- signs in on the same phone the device moves to their account (RLS would hide the old row).
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'save_push_subscription: not signed in';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

revoke execute on function public.save_push_subscription(text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;

-- When the last push reminder went out and whether it was answered, for the gap and back-off.
-- Written only by the server; users answer through respond_to_push_reminder.
create table public.push_reminder_state (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  last_sent_at       timestamptz,
  awaiting_response  boolean not null default false,
  ignored_streak     integer not null default 0 check (ignored_streak >= 0)
);

alter table public.push_reminder_state enable row level security;

-- Opening the app from a reminder: it was answered, so the back-off resets.
create function public.respond_to_push_reminder()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.push_reminder_state
  set awaiting_response = false, ignored_streak = 0
  where user_id = (select auth.uid());
$$;

revoke execute on function public.respond_to_push_reminder() from public, anon;
grant execute on function public.respond_to_push_reminder() to authenticated;

-- Like request_enrichment: only calls the function when someone has a device to notify, and
-- never puts the secrets in an error.
create function public.request_push_reminders()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  if not exists (select 1 from public.push_subscriptions) then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'enrich_secret_key';
  if v_url is null or v_key is null then
    raise warning 'request_push_reminders: Vault secret project_url or enrich_secret_key is missing';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke execute on function public.request_push_reminders() from public, anon, authenticated;

select cron.schedule('send-reminders', '*/10 * * * *', 'select public.request_push_reminders()');
