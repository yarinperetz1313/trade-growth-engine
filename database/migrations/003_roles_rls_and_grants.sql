set local role tge_owner;

create or replace function tge.current_tenant_id()
returns uuid
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

create or replace function tge.current_subject_id()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.subject_id', true), '')
$$;

create or replace function tge.set_request_context(
  requested_tenant_id uuid,
  requested_subject_id text
)
returns void
language plpgsql
volatile
set search_path = pg_catalog
as $$
begin
  if requested_tenant_id is null then
    raise exception 'tenant context is required' using errcode = '22004';
  end if;

  if requested_subject_id is null or btrim(requested_subject_id) = '' then
    raise exception 'subject context is required' using errcode = '22004';
  end if;

  perform set_config('app.tenant_id', requested_tenant_id::text, true);
  perform set_config('app.subject_id', requested_subject_id, true);
end
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'tenants',
    'tenant_memberships',
    'prospects',
    'opportunities',
    'tasks',
    'activities',
    'revenue_actions',
    'import_batches',
    'import_staging_records',
    'import_id_map',
    'audit_events'
  ]
  loop
    execute format('alter table tge.%I owner to tge_owner', table_name);
    execute format('alter table tge.%I enable row level security', table_name);
    execute format('alter table tge.%I force row level security', table_name);
  end loop;
end
$$;

create policy tenant_scope on tge.tenants
  for all
  using (id = tge.current_tenant_id())
  with check (id = tge.current_tenant_id());

create policy membership_lookup on tge.tenant_memberships
  for select
  using (
    tenant_id = tge.current_tenant_id()
    or (
      tge.current_tenant_id() is null
      and subject_id = tge.current_subject_id()
    )
  );

create policy tenant_scope on tge.prospects
  for all
  using (tenant_id = tge.current_tenant_id())
  with check (tenant_id = tge.current_tenant_id());

create policy tenant_scope on tge.opportunities
  for all
  using (tenant_id = tge.current_tenant_id())
  with check (tenant_id = tge.current_tenant_id());

create policy tenant_scope on tge.tasks
  for all
  using (tenant_id = tge.current_tenant_id())
  with check (tenant_id = tge.current_tenant_id());

create policy tenant_scope on tge.activities
  for all
  using (tenant_id = tge.current_tenant_id())
  with check (tenant_id = tge.current_tenant_id());

create policy tenant_scope on tge.revenue_actions
  for all
  using (tenant_id = tge.current_tenant_id())
  with check (tenant_id = tge.current_tenant_id());

create policy tenant_scope on tge.import_batches
  for all
  using (tenant_id = tge.current_tenant_id())
  with check (tenant_id = tge.current_tenant_id());

create policy tenant_scope on tge.import_staging_records
  for all
  using (tenant_id = tge.current_tenant_id())
  with check (tenant_id = tge.current_tenant_id());

create policy tenant_scope on tge.import_id_map
  for all
  using (tenant_id = tge.current_tenant_id())
  with check (tenant_id = tge.current_tenant_id());

create policy tenant_scope on tge.audit_events
  for all
  using (tenant_id = tge.current_tenant_id())
  with check (tenant_id = tge.current_tenant_id());

revoke all on schema tge from public;
revoke all on all tables in schema tge from public;
revoke all on all sequences in schema tge from public;
revoke all on all functions in schema tge from public;

grant usage on schema tge to tge_runtime;
grant execute on function tge.current_tenant_id() to tge_runtime;
grant execute on function tge.current_subject_id() to tge_runtime;
grant execute on function tge.set_request_context(uuid, text) to tge_runtime;

grant select on tge.tenants, tge.tenant_memberships to tge_runtime;
grant select, insert, update, delete on
  tge.prospects,
  tge.opportunities,
  tge.tasks,
  tge.activities,
  tge.revenue_actions
to tge_runtime;
grant select, insert on
  tge.import_batches,
  tge.import_staging_records
to tge_runtime;
grant select, insert on
  tge.import_id_map,
  tge.audit_events
to tge_runtime;

alter default privileges for role tge_owner in schema tge
  revoke all on tables from public;
alter default privileges for role tge_owner in schema tge
  revoke all on sequences from public;
alter default privileges for role tge_owner in schema tge
  revoke all on functions from public;
