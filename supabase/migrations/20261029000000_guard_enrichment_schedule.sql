-- Moves the enrich-captures cron call into a function that sends nothing unless both Vault
-- secrets are present. Before, a missing project_url made net.http_post fail, and pg_cron
-- logged the failed call, secret key included, in cron.job_run_details.

create function public.request_enrichment()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  if not exists (
    select 1 from public.captures
    where enrichment_attempts < 3
      and (
        enrichment_status in ('pending', 'failed')
        or (enrichment_status = 'processing' and enrichment_claimed_at < now() - interval '5 minutes')
      )
  ) then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'enrich_secret_key';
  if v_url is null or v_key is null then
    -- Names only; never put the values in a message.
    raise warning 'request_enrichment: Vault secret project_url or enrich_secret_key is missing';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/enrich-captures',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_key),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

-- Only pg_cron (running as postgres) calls this.
revoke execute on function public.request_enrichment() from public, anon, authenticated;

-- Same job name, so this replaces the old command.
select cron.schedule('enrich-captures', '* * * * *', 'select public.request_enrichment()');

-- Clear failed runs of this job, which may hold the old key in their error messages.
delete from cron.job_run_details
where status = 'failed'
  and jobid = (select jobid from cron.job where jobname = 'enrich-captures');
