-- Timing controls and preferences (T4 to T8, D6). One row per user, created when they
-- finish or skip onboarding; a missing row means they haven't been asked yet.
create table public.user_settings (
  user_id                  uuid primary key default auth.uid() references auth.users (id) on delete cascade,

  -- T4: "When do you usually have a spare minute?" Sets the preferred reminder window.
  spare_minute             text check (spare_minute in ('morning', 'commute', 'lunch', 'evening')),
  -- T5: hours between reminders (24 = once a day) and words per day.
  reminder_every_hours     smallint not null default 5 check (reminder_every_hours in (3, 5, 8, 24)),
  daily_cap                smallint not null default 5 check (daily_cap between 1 and 20),
  -- T6, T7: quiet hours are local times in time_zone; the window may wrap past midnight.
  weekends                 boolean not null default false,
  quiet_start              time not null default '21:00',
  quiet_end                time not null default '08:00',
  time_zone                text not null default 'UTC' check (length(time_zone) between 1 and 64),
  -- T8: "Pause for a week".
  paused_until             timestamptz,
  -- D6: surfaces on or off.
  badge_enabled            boolean not null default true,
  end_of_reading_enabled   boolean not null default true,
  corner_reminder_enabled  boolean not null default true,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint quiet_hours_not_empty check (quiet_start <> quiet_end)
);

create function public.touch_user_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger user_settings_touch
  before update on public.user_settings
  for each row
  execute function public.touch_user_settings();

alter table public.user_settings enable row level security;

create policy "Users can read their own settings"
  on public.user_settings for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own settings"
  on public.user_settings for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can change their own settings"
  on public.user_settings for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.user_settings from anon, authenticated;
grant select, insert, update on public.user_settings to authenticated;
