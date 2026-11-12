begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(7);

-- Each scenario uses its own accounts: removed reports lower the author's
-- reputation and can hide their other reports.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'b@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'c@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'd@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'e@example.test'),
  ('00000000-0000-0000-0000-0000000000b3', 'f@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'g@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'h@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'i@example.test');

create temporary table t (label text primary key, id uuid) on commit drop;

create function pg_temp.report(p_label text, p_user text, p_type public.scam_type, p_minutes_ago integer, p_cluster uuid)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.reports (user_id, scam_type, channel, description_redacted, zip, created_at)
  values (('00000000-0000-0000-0000-0000000000' || p_user)::uuid, p_type, 'email', 'test report',
          (select z.zip from public.zip_centroids z order by z.zip limit 1),
          now() - make_interval(mins => p_minutes_ago))
  returning id into v_id;
  insert into t values (p_label, v_id);
  return public.attach_report_to_cluster(v_id, p_cluster);
end;
$$;

create function pg_temp.cluster_type(p_cluster uuid) returns public.scam_type language sql as $$
  select c.scam_type from public.clusters c where c.id = p_cluster;
$$;

-- "Something else" first, then Impersonation joins.
create temporary table c1 as select pg_temp.report('r1', 'a1', 'other', 10, null) as id;
select pg_temp.report('r2', 'a2', 'impersonation', 5, (select id from c1));
select is(pg_temp.cluster_type((select id from c1)), 'impersonation',
  'one Something else + one Impersonation shows as Impersonation');

-- Hiding the Impersonation report recalculates.
update public.reports set status = 'removed' where id = (select id from t where label = 'r2');
select public.refresh_cluster((select id from c1));
select is(pg_temp.cluster_type((select id from c1)), 'other', 'hiding the only specific report falls back to Something else');

-- No visible reports: the type is kept.
update public.reports set status = 'removed' where id = (select id from t where label = 'r1');
select public.refresh_cluster((select id from c1));
select is(pg_temp.cluster_type((select id from c1)), 'other', 'a cluster with no visible reports keeps its type');

-- Majority wins, even over a more recent type.
create temporary table c2 as select pg_temp.report('m1', 'b1', 'fake_fee', 30, null) as id;
select pg_temp.report('m2', 'b2', 'fake_fee', 20, (select id from c2));
select pg_temp.report('m3', 'b3', 'tech_support', 1, (select id from c2));
select is(pg_temp.cluster_type((select id from c2)), 'fake_fee', 'the most common type wins');

-- Ties go to the most recent specific type.
update public.reports set status = 'removed' where id = (select id from t where label = 'm1');
select public.refresh_cluster((select id from c2));
select is(pg_temp.cluster_type((select id from c2)), 'tech_support', 'ties go to the most recent specific type');

-- "Something else" never wins over a specific type, even outnumbering it.
create temporary table c3 as select pg_temp.report('o1', 'c1', 'too_good', 40, null) as id;
select pg_temp.report('o2', 'c2', 'other', 30, (select id from c3));
select pg_temp.report('o3', 'c3', 'other', 20, (select id from c3));
select is(pg_temp.cluster_type((select id from c3)), 'too_good', 'Something else never wins over a specific type');

-- Reports are counted once (the shared CTE didn't break the counts).
select is((select report_count from public.clusters where id = (select id from c3)), 3, 'report_count still counts visible reports');

select * from finish();
rollback;
