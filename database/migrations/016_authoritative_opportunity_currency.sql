set local role tge_owner;

create policy opportunity_currency_migration_scope on tge.opportunities
  for all
  to tge_owner
  using (true)
  with check (true);

do $migration$
begin
  if exists (
    select 1
    from tge.opportunities
    where coalesce(current_payload, legacy_payload, '{}'::jsonb) ? 'currency'
      and (
        coalesce(current_payload, legacy_payload, '{}'::jsonb)->'currency'
          is distinct from 'null'::jsonb
        and (
          jsonb_typeof(
            coalesce(current_payload, legacy_payload, '{}'::jsonb)->'currency'
          ) is distinct from 'string'
          or case
            when octet_length(
              coalesce(current_payload, legacy_payload, '{}'::jsonb)->>'currency'
            ) <> 3 then true
            else not (
              get_byte(convert_to(
                coalesce(current_payload, legacy_payload, '{}'::jsonb)->>'currency',
                'UTF8'
              ), 0) between 65 and 90
              and get_byte(convert_to(
                coalesce(current_payload, legacy_payload, '{}'::jsonb)->>'currency',
                'UTF8'
              ), 1) between 65 and 90
              and get_byte(convert_to(
                coalesce(current_payload, legacy_payload, '{}'::jsonb)->>'currency',
                'UTF8'
              ), 2) between 65 and 90
            )
          end
        )
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'Existing opportunity currency is not an exact three-letter uppercase code.';
  end if;
end
$migration$;

alter table tge.opportunities
  add column currency text;

update tge.opportunities
set currency = coalesce(current_payload, legacy_payload, '{}'::jsonb)->>'currency'
where jsonb_typeof(
  coalesce(current_payload, legacy_payload, '{}'::jsonb)->'currency'
) = 'string';

alter table tge.opportunities
  add constraint opportunities_currency_check check (
    currency is null
    or case
      when octet_length(currency) <> 3 then false
      else
        get_byte(convert_to(currency, 'UTF8'), 0) between 65 and 90
        and get_byte(convert_to(currency, 'UTF8'), 1) between 65 and 90
        and get_byte(convert_to(currency, 'UTF8'), 2) between 65 and 90
    end
  );

drop policy opportunity_currency_migration_scope on tge.opportunities;

create or replace function tge.pilot_runtime_readiness()
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
    '016'::text as schema_version,
    pg_has_role(session_user, 'tge_runtime', 'member') as runtime_role_member,
    (
      not coalesce(roles.rolsuper, true)
      and not coalesce(roles.rolbypassrls, true)
      and not coalesce(roles.rolcreatedb, true)
      and not coalesce(roles.rolcreaterole, true)
      and not coalesce(roles.rolreplication, true)
      and not exists (
        select 1
        from pg_catalog.pg_roles granted_roles
        where granted_roles.rolname not in (session_user, 'tge_runtime')
          and pg_catalog.pg_has_role(session_user, granted_roles.oid, 'member')
      )
    ) as login_nonprivileged,
    (
      to_regclass('tge.tenant_memberships') is not null
      and to_regclass('tge.import_batches') is not null
      and to_regclass('tge.import_staging_records') is not null
      and to_regclass('tge.data_deletion_evidence') is not null
      and to_regclass('tge.tenant_offboarding_requests') is not null
      and to_regclass('tge.audit_events') is not null
      and to_regclass('tge.pilot_evidence_events') is not null
    ) as required_relations_available
  from pg_catalog.pg_roles roles
  where roles.rolname = session_user
$$;

revoke all on function tge.pilot_runtime_readiness() from public;
grant execute on function tge.pilot_runtime_readiness() to tge_runtime;
