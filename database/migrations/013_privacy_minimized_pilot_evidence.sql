set local role tge_owner;

create function tge.pilot_evidence_exact_keys(value jsonb, expected text[])
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select jsonb_typeof(value) = 'object'
    and coalesce(
      (select array_agg(key order by key) from jsonb_object_keys(value) key),
      array[]::text[]
    ) = (select array_agg(key order by key) from unnest(expected) key)
$function$;

create function tge.pilot_evidence_count(value jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select jsonb_typeof(value) = 'number'
    and value::text ~ '^(0|[1-9][0-9]{0,6})$'
    and (value::text)::numeric <= 1000000
$function$;

create function tge.pilot_evidence_bounded_id(value jsonb, maximum integer)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select jsonb_typeof(value) = 'string'
    and btrim(value#>>'{}') <> ''
    and octet_length(value#>>'{}') <= maximum
    and value#>>'{}' !~ '[[:cntrl:]]'
$function$;

create function tge.pilot_evidence_facts_valid(kind text, value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, tge
as $function$
declare
  total_count integer;
  covered integer;
begin
  if kind = 'IMPORT_COMMITTED' then
    if not tge.pilot_evidence_exact_keys(value, array[
      'import_batch_id', 'source_collection', 'total_count', 'committed_count',
      'skipped_count', 'quality_blocked_count', 'quality_conflict_count',
      'source_identity_covered_count', 'commercial_value_covered_count',
      'stage_covered_count', 'created_at_covered_count',
      'created_at_invalid_count', 'updated_at_covered_count',
      'updated_at_invalid_count', 'contactable_count'
    ])
      or not tge.pilot_evidence_bounded_id(value->'import_batch_id', 200)
      or (value->>'source_collection') not in (
        'prospects', 'opportunities', 'tasks', 'activities'
      ) then return false;
    end if;
    if not (
      tge.pilot_evidence_count(value->'total_count')
      and tge.pilot_evidence_count(value->'committed_count')
      and tge.pilot_evidence_count(value->'skipped_count')
      and tge.pilot_evidence_count(value->'quality_blocked_count')
      and tge.pilot_evidence_count(value->'quality_conflict_count')
      and tge.pilot_evidence_count(value->'source_identity_covered_count')
    ) then return false;
    end if;
    total_count := (value->>'total_count')::integer;
    if (value->>'committed_count')::integer
        + (value->>'skipped_count')::integer <> total_count
      or (value->>'quality_blocked_count')::integer > total_count
      or (value->>'quality_conflict_count')::integer > total_count
      or (value->>'source_identity_covered_count')::integer > total_count then
      return false;
    end if;
    foreach covered in array array[
      case when value->'commercial_value_covered_count' = 'null'::jsonb then -1
        when tge.pilot_evidence_count(value->'commercial_value_covered_count')
          then (value->>'commercial_value_covered_count')::integer else -2 end,
      case when value->'stage_covered_count' = 'null'::jsonb then -1
        when tge.pilot_evidence_count(value->'stage_covered_count')
          then (value->>'stage_covered_count')::integer else -2 end,
      case when value->'created_at_covered_count' = 'null'::jsonb then -1
        when tge.pilot_evidence_count(value->'created_at_covered_count')
          then (value->>'created_at_covered_count')::integer else -2 end,
      case when value->'created_at_invalid_count' = 'null'::jsonb then -1
        when tge.pilot_evidence_count(value->'created_at_invalid_count')
          then (value->>'created_at_invalid_count')::integer else -2 end,
      case when value->'updated_at_covered_count' = 'null'::jsonb then -1
        when tge.pilot_evidence_count(value->'updated_at_covered_count')
          then (value->>'updated_at_covered_count')::integer else -2 end,
      case when value->'updated_at_invalid_count' = 'null'::jsonb then -1
        when tge.pilot_evidence_count(value->'updated_at_invalid_count')
          then (value->>'updated_at_invalid_count')::integer else -2 end,
      case when value->'contactable_count' = 'null'::jsonb then -1
        when tge.pilot_evidence_count(value->'contactable_count')
          then (value->>'contactable_count')::integer else -2 end
    ] loop
      if covered < -1 or covered > total_count then return false; end if;
    end loop;
    return true;
  end if;

  if kind = 'PORTFOLIO_SCAN_COMPLETED' then
    if not tge.pilot_evidence_exact_keys(value, array[
      'evaluated_count', 'eligible_leak_count', 'eligible_no_leak_count',
      'insufficient_evidence_count', 'stale_source_count',
      'data_health_suppressed_count', 'excluded_count'
    ])
      or not tge.pilot_evidence_count(value->'evaluated_count')
      or not tge.pilot_evidence_count(value->'eligible_leak_count')
      or not tge.pilot_evidence_count(value->'eligible_no_leak_count')
      or not tge.pilot_evidence_count(value->'insufficient_evidence_count')
      or not tge.pilot_evidence_count(value->'stale_source_count')
      or not tge.pilot_evidence_count(value->'data_health_suppressed_count')
      or not tge.pilot_evidence_count(value->'excluded_count') then
      return false;
    end if;
    return (value->>'eligible_leak_count')::integer
      + (value->>'eligible_no_leak_count')::integer
      + (value->>'insufficient_evidence_count')::integer
      + (value->>'stale_source_count')::integer
      + (value->>'data_health_suppressed_count')::integer
      = (value->>'evaluated_count')::integer;
  end if;

  if kind = 'FIRST_CREDIBLE_CASE_SURFACED' then
    if not tge.pilot_evidence_exact_keys(value, array[
      'case_id', 'import_batch_id', 'value_kind', 'currency'
    ])
      or not tge.pilot_evidence_bounded_id(value->'case_id', 255)
      or not tge.pilot_evidence_bounded_id(value->'import_batch_id', 200)
      or (value->>'value_kind') not in (
        'KNOWN_POSITIVE', 'KNOWN_ZERO', 'UNKNOWN', 'NOT_APPLICABLE'
      ) then return false;
    end if;
    return (
      (value->>'value_kind') in ('KNOWN_POSITIVE', 'KNOWN_ZERO')
      and jsonb_typeof(value->'currency') = 'string'
      and value->>'currency' ~ '^[A-Z]{3}$'
    ) or (
      (value->>'value_kind') in ('UNKNOWN', 'NOT_APPLICABLE')
      and value->'currency' = 'null'::jsonb
    );
  end if;

  if kind = 'CASE_INSPECTED' then
    return tge.pilot_evidence_exact_keys(value, array[
      'case_id', 'import_batch_id'
    ])
      and tge.pilot_evidence_bounded_id(value->'case_id', 255)
      and tge.pilot_evidence_bounded_id(value->'import_batch_id', 200);
  end if;

  if kind = 'OPERATOR_FEEDBACK' then
    return tge.pilot_evidence_exact_keys(value, array[
      'case_id', 'import_batch_id', 'feedback_code'
    ])
      and tge.pilot_evidence_bounded_id(value->'case_id', 255)
      and tge.pilot_evidence_bounded_id(value->'import_batch_id', 200)
      and (value->>'feedback_code') in (
        'USEFUL', 'WRONG', 'ALREADY_HANDLED', 'MISSING_CONTEXT',
        'NOT_WORTH_PURSUING'
      );
  end if;

  if kind in (
    'REVENUE_ACTION_MATERIALIZED_LINKED', 'ACTION_APPROVED', 'ACTION_EXECUTED'
  ) then
    if not tge.pilot_evidence_exact_keys(value,
      case when kind = 'ACTION_EXECUTED' then array[
        'case_id', 'import_batch_id', 'revenue_action_id', 'action_status',
        'execution_effect_type'
      ] else array[
        'case_id', 'import_batch_id', 'revenue_action_id', 'action_status'
      ] end
    )
      or not tge.pilot_evidence_bounded_id(value->'case_id', 255)
      or not tge.pilot_evidence_bounded_id(value->'import_batch_id', 200)
      or not tge.pilot_evidence_bounded_id(value->'revenue_action_id', 255)
      or (value->>'action_status') <> (case kind
        when 'REVENUE_ACTION_MATERIALIZED_LINKED' then 'RECOMMENDED'
        when 'ACTION_APPROVED' then 'APPROVED'
        else 'EXECUTED' end) then return false;
    end if;
    return kind <> 'ACTION_EXECUTED'
      or (value->>'execution_effect_type') in (
        'INTERNAL_TASK', 'COMMUNICATION_MANUAL_CONFIRMATION'
      );
  end if;
  return false;
end;
$function$;

create table tge.pilot_evidence_events (
  tenant_id uuid not null,
  id text not null check (btrim(id) <> '' and octet_length(id) <= 255),
  event_type text not null check (event_type in (
    'IMPORT_COMMITTED',
    'PORTFOLIO_SCAN_COMPLETED',
    'FIRST_CREDIBLE_CASE_SURFACED',
    'CASE_INSPECTED',
    'REVENUE_ACTION_MATERIALIZED_LINKED',
    'ACTION_APPROVED',
    'ACTION_EXECUTED',
    'OPERATOR_FEEDBACK'
  )),
  actor_subject_id text not null check (
    btrim(actor_subject_id) <> '' and octet_length(actor_subject_id) <= 512
  ),
  occurred_at timestamptz not null,
  semantic_key text not null check (semantic_key ~ '^[0-9a-f]{64}$'),
  facts jsonb not null check (tge.pilot_evidence_facts_valid(event_type, facts)),
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  unique (tenant_id, semantic_key),
  foreign key (tenant_id) references tge.tenants(id)
    on update restrict on delete restrict
);

create index pilot_evidence_events_tenant_time_idx
  on tge.pilot_evidence_events(tenant_id, occurred_at, id);

alter table tge.pilot_evidence_events owner to tge_owner;
alter table tge.pilot_evidence_events enable row level security;
alter table tge.pilot_evidence_events force row level security;

create policy tenant_scope on tge.pilot_evidence_events
  for all
  using (tenant_id = tge.current_tenant_id())
  with check (tenant_id = tge.current_tenant_id());

create function tge.guard_runtime_pilot_evidence_events()
returns trigger
language plpgsql
set search_path = pg_catalog, tge
as $function$
declare
  runtime_session boolean;
begin
  runtime_session := (
    pg_catalog.pg_has_role(session_user, 'tge_runtime', 'member')
    and coalesce((
      select not rolsuper from pg_catalog.pg_roles where rolname = session_user
    ), false)
  );
  if not runtime_session then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'INSERT' then
    raise exception using
      errcode = '23514',
      message = 'Pilot evidence is append-only.';
  end if;
  if new.tenant_id is distinct from tge.current_tenant_id()
    or new.actor_subject_id is distinct from tge.current_subject_id()
    or new.created_at is distinct from new.occurred_at then
    raise exception using
      errcode = '23514',
      message = 'Pilot evidence authority is incoherent.';
  end if;
  return new;
end;
$function$;

revoke all on function tge.guard_runtime_pilot_evidence_events()
  from public, tge_runtime;
revoke all on function tge.pilot_evidence_exact_keys(jsonb, text[])
  from public, tge_runtime;
revoke all on function tge.pilot_evidence_count(jsonb)
  from public, tge_runtime;
revoke all on function tge.pilot_evidence_bounded_id(jsonb, integer)
  from public, tge_runtime;
revoke all on function tge.pilot_evidence_facts_valid(text, jsonb)
  from public, tge_runtime;

grant execute on function tge.pilot_evidence_exact_keys(jsonb, text[])
  to tge_runtime;
grant execute on function tge.pilot_evidence_count(jsonb)
  to tge_runtime;
grant execute on function tge.pilot_evidence_bounded_id(jsonb, integer)
  to tge_runtime;
grant execute on function tge.pilot_evidence_facts_valid(text, jsonb)
  to tge_runtime;

create trigger pilot_evidence_events_runtime_guard
before insert or update or delete on tge.pilot_evidence_events
for each row execute function tge.guard_runtime_pilot_evidence_events();

revoke all on tge.pilot_evidence_events from public;
grant select, insert on tge.pilot_evidence_events to tge_runtime;

revoke execute on all functions in schema tge from public;
