begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(14);

select is(
  (select schedule from cron.job where jobname = 'ingest-ftc'),
  '*/15 17-22 * * 1-5',
  'ingest job runs every 15 minutes, 17:00–22:45 UTC, weekdays'
);

select ok(
  not has_function_privilege('anon', 'public.trigger_ingest()', 'execute')
    and not has_function_privilege('authenticated', 'public.trigger_ingest()', 'execute'),
  'only the database itself can trigger ingest'
);

-- Without Vault secrets (dev, local), nothing is called.
select is(public.trigger_ingest(), null, 'does nothing without Vault secrets');

select vault.create_secret('https://example.test/api/cron/ingest', 'ingest_url');
select vault.create_secret('test-secret', 'ingest_cron_secret');

create temporary table req as select public.trigger_ingest() as id;
select isnt((select id from req), null, 'queues a request when the secrets are set');
select is(
  (select q.url from net.http_request_queue q where q.id = (select id from req)),
  'https://example.test/api/cron/ingest?background=1',
  'calls the endpoint in background mode'
);
select is(
  (select q.headers ->> 'Authorization' from net.http_request_queue q where q.id = (select id from req)),
  'Bearer test-secret',
  'sends the cron secret'
);

-- One run at a time, and a cooldown after a 429.
select is(public.dnc_claim_run(300), 'claimed', 'first run claims the lease');
select is(public.dnc_claim_run(300), 'running', 'a second run is turned away while one is running');
select public.dnc_finish_run(0);
select is(public.dnc_claim_run(300), 'claimed', 'the next run claims it after a clean finish');
select public.dnc_finish_run(20);
select is(public.dnc_claim_run(300), 'cooldown', 'no run starts during the cooldown after a 429');
update public.dnc_ingest_control set cooldown_until = now() - interval '1 second';
select is(public.dnc_claim_run(300), 'claimed', 'runs resume once the cooldown ends');

-- A run that crashes never calls dnc_finish_run; its lease must lapse on its own.
select is(
  (select running_until from public.dnc_ingest_control),
  now() + interval '300 seconds',
  'the lease lasts only as long as the function limit'
);
update public.dnc_ingest_control set running_until = now() - interval '1 second';
select is(public.dnc_claim_run(300), 'claimed', 'an expired lease from a crashed run does not block the next run');

select ok(
  not has_function_privilege('anon', 'public.dnc_claim_run(integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.dnc_finish_run(integer)', 'execute')
    and not has_table_privilege('anon', 'public.dnc_ingest_control', 'select'),
  'only the server can use the run lease'
);

select * from finish();
rollback;
