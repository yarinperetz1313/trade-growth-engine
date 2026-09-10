set local role tge_owner;

create function tge.pilot_runtime_readiness()
returns table (
  schema_version text,
  runtime_role_member boolean,
  login_nonprivileged boolean,
  required_relations_available boolean
)
language sql
stable
set search_path = pg_catalog
as $$
  select
    '014'::text as schema_version,
    pg_has_role(session_user, 'tge_runtime', 'member') as runtime_role_member,
    (
      not coalesce(roles.rolsuper, true)
      and not coalesce(roles.rolbypassrls, true)
      and not coalesce(roles.rolcreatedb, true)
      and not coalesce(roles.rolcreaterole, true)
      and not coalesce(roles.rolreplication, true)
    ) as login_nonprivileged,
    (
      to_regclass('tge.tenant_memberships') is not null
      and to_regclass('tge.prospects') is not null
      and to_regclass('tge.opportunities') is not null
      and to_regclass('tge.tasks') is not null
      and to_regclass('tge.activities') is not null
      and to_regclass('tge.revenue_actions') is not null
      and to_regclass('tge.import_batches') is not null
      and to_regclass('tge.import_staging_records') is not null
      and to_regclass('tge.import_id_map') is not null
      and to_regclass('tge.revenue_leak_cases') is not null
      and to_regclass('tge.pilot_evidence_events') is not null
      and to_regclass('tge.audit_events') is not null
    ) as required_relations_available
  from pg_roles as roles
  where roles.rolname = session_user
$$;

revoke all on function tge.pilot_runtime_readiness() from public;
grant execute on function tge.pilot_runtime_readiness() to tge_runtime;
