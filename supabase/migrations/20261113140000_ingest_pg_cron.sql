-- GitHub drops most scheduled Actions runs, so the database schedules ingest
-- itself. The URL and secret come from Vault (set by hand per project); without
-- them the job does nothing, so dev and local databases never call prod.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create or replace function public.trigger_ingest()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'ingest_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'ingest_cron_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  -- background=1: the endpoint replies at once and finishes the run on its own,
  -- so pg_net's short timeout doesn't matter.
  return net.http_get(
    url := v_url,
    params := jsonb_build_object('background', '1'),
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 10000
  );
end;
$$;

revoke execute on function public.trigger_ingest() from public, anon, authenticated;

-- Every 15 minutes, 17:00–20:45 UTC, Monday–Friday (after the FTC's weekday update).
select cron.schedule('ingest-ftc', '*/15 17-20 * * 1-5', 'select public.trigger_ingest()');
