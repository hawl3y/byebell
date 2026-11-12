begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

select is(
  (select schedule from cron.job where jobname = 'ingest-ftc'),
  '*/15 17-20 * * 1-5',
  'ingest job runs every 15 minutes, 17:00–20:45 UTC, weekdays'
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

select * from finish();
rollback;
