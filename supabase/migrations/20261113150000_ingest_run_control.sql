-- pg_cron, GitHub Actions, and Vercel Cron all trigger ingest, sometimes at the
-- same minute. The FTC burst throttle needs ~10 minutes of silence to recover,
-- and each extra request during that time keeps it locked. So only one run
-- fetches at a time, and after a 429 no run calls the FTC until the cooldown ends.
create table public.dnc_ingest_control (
  id boolean primary key default true check (id),
  running_until timestamptz,
  cooldown_until timestamptz
);
alter table public.dnc_ingest_control enable row level security;
revoke all on public.dnc_ingest_control from anon, authenticated;
insert into public.dnc_ingest_control default values;

-- 'claimed', or why not: 'cooldown' or 'running'. The lease expires on its own,
-- so a run that dies without finishing can't block later runs.
create function public.dnc_claim_run(p_seconds integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cooldown_until timestamptz;
begin
  update public.dnc_ingest_control c
  set running_until = now() + make_interval(secs => p_seconds)
  where c.id
    and (c.running_until is null or c.running_until <= now())
    and (c.cooldown_until is null or c.cooldown_until <= now());
  if found then
    return 'claimed';
  end if;
  select c.cooldown_until into v_cooldown_until from public.dnc_ingest_control c where c.id;
  return case when v_cooldown_until > now() then 'cooldown' else 'running' end;
end;
$$;

create function public.dnc_finish_run(p_cooldown_minutes integer)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.dnc_ingest_control c
  set running_until = null,
      cooldown_until = case
        when p_cooldown_minutes > 0 then now() + make_interval(mins => p_cooldown_minutes)
        else c.cooldown_until
      end
  where c.id;
$$;

revoke execute on function public.dnc_claim_run(integer) from public, anon, authenticated;
revoke execute on function public.dnc_finish_run(integer) from public, anon, authenticated;
grant execute on function public.dnc_claim_run(integer) to service_role;
grant execute on function public.dnc_finish_run(integer) to service_role;

-- Two more hours of runs, so a cooldown or a slow day still leaves time for every state.
select cron.schedule('ingest-ftc', '*/15 17-22 * * 1-5', 'select public.trigger_ingest()');
