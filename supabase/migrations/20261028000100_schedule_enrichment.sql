-- Calls the enrich-captures Edge Function every minute while captures are waiting (PRD E4).
--
-- Needs two Vault secrets, set once per project (never committed):
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<a secret key, sb_secret_...>', 'enrich_secret_key');

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'enrich-captures',
  '* * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
        || '/functions/v1/enrich-captures',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (select decrypted_secret from vault.decrypted_secrets where name = 'enrich_secret_key')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    )
    where exists (
      select 1 from public.captures
      where enrichment_attempts < 3
        and (
          enrichment_status in ('pending', 'failed')
          or (enrichment_status = 'processing' and enrichment_claimed_at < now() - interval '5 minutes')
        )
    );
  $$
);
