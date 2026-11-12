-- A cluster's type is the most common type among its visible reports instead
-- of its first report's. 'other' never wins over a specific type; ties go to
-- the type reported most recently. With no visible reports the type is kept.
create or replace function public.refresh_cluster(p_cluster_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  with v as (
    select r.scam_type, r.point, r.created_at
    from public.visible_reports() r
    where r.cluster_id = p_cluster_id
  )
  update public.clusters c
  set report_count = s.n,
      corroboration_count = (
        select count(*)::integer from public.corroborations k
        where k.cluster_id = p_cluster_id and not public.is_limited(k.user_id)
      ),
      scam_type = coalesce(
        (
          select v.scam_type from v
          group by v.scam_type
          order by (v.scam_type = 'other'), count(*) desc, max(v.created_at) desc, v.scam_type
          limit 1
        ),
        c.scam_type
      ),
      centroid = coalesce(s.centroid, c.centroid),
      first_seen = coalesce(s.first_seen, c.first_seen),
      last_seen = coalesce(s.last_seen, c.last_seen)
  from (
    select count(*)::integer as n,
           extensions.st_centroid(extensions.st_collect(v.point::extensions.geometry))::extensions.geography as centroid,
           min(v.created_at) as first_seen,
           max(v.created_at) as last_seen
    from v
  ) s
  where c.id = p_cluster_id;
$$;

do $$
declare v_cluster uuid;
begin
  for v_cluster in select id from public.clusters loop
    perform public.refresh_cluster(v_cluster);
  end loop;
end;
$$;
