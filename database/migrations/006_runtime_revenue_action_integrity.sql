set local role tge_owner;

alter table tge.prospects no force row level security;
alter table tge.opportunities no force row level security;
alter table tge.tasks no force row level security;
alter table tge.activities no force row level security;
alter table tge.revenue_actions no force row level security;

alter table tge.prospects
  add column current_payload jsonb,
  add column live_ordinal bigint;
alter table tge.opportunities
  add column current_payload jsonb,
  add column live_ordinal bigint;
alter table tge.tasks
  add column current_payload jsonb,
  add column live_ordinal bigint;
alter table tge.activities
  add column current_payload jsonb,
  add column live_ordinal bigint;
alter table tge.revenue_actions
  add column current_payload jsonb,
  add column live_ordinal bigint;

create sequence tge.prospects_live_ordinal_seq as bigint;
create sequence tge.opportunities_live_ordinal_seq as bigint;
create sequence tge.tasks_live_ordinal_seq as bigint;
create sequence tge.activities_live_ordinal_seq as bigint;
create sequence tge.revenue_actions_live_ordinal_seq as bigint;

alter sequence tge.prospects_live_ordinal_seq
  owned by tge.prospects.live_ordinal;
alter sequence tge.opportunities_live_ordinal_seq
  owned by tge.opportunities.live_ordinal;
alter sequence tge.tasks_live_ordinal_seq
  owned by tge.tasks.live_ordinal;
alter sequence tge.activities_live_ordinal_seq
  owned by tge.activities.live_ordinal;
alter sequence tge.revenue_actions_live_ordinal_seq
  owned by tge.revenue_actions.live_ordinal;

with ordered as (
  select tenant_id, id,
    row_number() over (order by tenant_id, created_at, id) as ordinal
  from tge.prospects
)
update tge.prospects target
set current_payload = coalesce(target.legacy_payload, '{}'::jsonb),
  live_ordinal = ordered.ordinal
from ordered
where target.tenant_id = ordered.tenant_id and target.id = ordered.id;

with ordered as (
  select tenant_id, id,
    row_number() over (order by tenant_id, created_at, id) as ordinal
  from tge.opportunities
)
update tge.opportunities target
set current_payload = coalesce(target.legacy_payload, '{}'::jsonb),
  live_ordinal = ordered.ordinal
from ordered
where target.tenant_id = ordered.tenant_id and target.id = ordered.id;

with ordered as (
  select tenant_id, id,
    row_number() over (order by tenant_id, created_at, id) as ordinal
  from tge.tasks
)
update tge.tasks target
set current_payload = coalesce(target.legacy_payload, '{}'::jsonb),
  live_ordinal = ordered.ordinal
from ordered
where target.tenant_id = ordered.tenant_id and target.id = ordered.id;

with ordered as (
  select tenant_id, id,
    row_number() over (order by tenant_id, created_at, id) as ordinal
  from tge.activities
)
update tge.activities target
set current_payload = coalesce(target.legacy_payload, '{}'::jsonb),
  live_ordinal = ordered.ordinal
from ordered
where target.tenant_id = ordered.tenant_id and target.id = ordered.id;

with ordered as (
  select tenant_id, id,
    row_number() over (order by tenant_id, created_at, id) as ordinal
  from tge.revenue_actions
)
update tge.revenue_actions target
set current_payload = coalesce(target.legacy_payload, '{}'::jsonb),
  live_ordinal = ordered.ordinal
from ordered
where target.tenant_id = ordered.tenant_id and target.id = ordered.id;

select pg_catalog.setval(
  'tge.prospects_live_ordinal_seq'::regclass,
  coalesce(max(live_ordinal), 1),
  max(live_ordinal) is not null
) from tge.prospects;
select pg_catalog.setval(
  'tge.opportunities_live_ordinal_seq'::regclass,
  coalesce(max(live_ordinal), 1),
  max(live_ordinal) is not null
) from tge.opportunities;
select pg_catalog.setval(
  'tge.tasks_live_ordinal_seq'::regclass,
  coalesce(max(live_ordinal), 1),
  max(live_ordinal) is not null
) from tge.tasks;
select pg_catalog.setval(
  'tge.activities_live_ordinal_seq'::regclass,
  coalesce(max(live_ordinal), 1),
  max(live_ordinal) is not null
) from tge.activities;
select pg_catalog.setval(
  'tge.revenue_actions_live_ordinal_seq'::regclass,
  coalesce(max(live_ordinal), 1),
  max(live_ordinal) is not null
) from tge.revenue_actions;

alter table tge.prospects
  alter column current_payload set default '{}'::jsonb,
  alter column current_payload set not null,
  alter column live_ordinal set not null,
  add constraint prospects_current_payload_object_check
    check (jsonb_typeof(current_payload) = 'object');
alter table tge.opportunities
  alter column current_payload set default '{}'::jsonb,
  alter column current_payload set not null,
  alter column live_ordinal set not null,
  add constraint opportunities_current_payload_object_check
    check (jsonb_typeof(current_payload) = 'object');
alter table tge.tasks
  alter column current_payload set default '{}'::jsonb,
  alter column current_payload set not null,
  alter column live_ordinal set not null,
  add constraint tasks_current_payload_object_check
    check (jsonb_typeof(current_payload) = 'object');
alter table tge.activities
  alter column current_payload set default '{}'::jsonb,
  alter column current_payload set not null,
  alter column live_ordinal set not null,
  add constraint activities_current_payload_object_check
    check (jsonb_typeof(current_payload) = 'object');
alter table tge.revenue_actions
  alter column current_payload set default '{}'::jsonb,
  alter column current_payload set not null,
  alter column live_ordinal set not null,
  add constraint revenue_actions_current_payload_object_check
    check (jsonb_typeof(current_payload) = 'object');

create unique index prospects_live_ordinal_uidx
  on tge.prospects(live_ordinal);
create unique index opportunities_live_ordinal_uidx
  on tge.opportunities(live_ordinal);
create unique index tasks_live_ordinal_uidx
  on tge.tasks(live_ordinal);
create unique index activities_live_ordinal_uidx
  on tge.activities(live_ordinal);
create unique index revenue_actions_live_ordinal_uidx
  on tge.revenue_actions(live_ordinal);

create function tge.assign_live_ordinal()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  new.live_ordinal := pg_catalog.nextval(
    pg_catalog.format('tge.%I_live_ordinal_seq', tg_table_name)::regclass
  );
  return new;
end;
$function$;

create function tge.guard_runtime_source_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if not (
    pg_catalog.pg_has_role(session_user, 'tge_runtime', 'member')
    and coalesce((
      select not rolsuper from pg_catalog.pg_roles
      where rolname = session_user
    ), false)
  ) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.source_ordinal is not null then
      raise exception using
        errcode = '23514',
        message = 'Runtime inserts cannot claim imported source ordering.';
    end if;
    return new;
  end if;
  if new.legacy_payload is distinct from old.legacy_payload
    or new.source_ordinal is distinct from old.source_ordinal
    or new.source_created_at is distinct from old.source_created_at
    or new.source_updated_at is distinct from old.source_updated_at
    or new.live_ordinal is distinct from old.live_ordinal then
    raise exception using
      errcode = '23514',
      message = 'Imported source evidence and live insertion order are immutable.';
  end if;
  return new;
end;
$function$;

create function tge.guard_runtime_revenue_action()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  audit_index integer;
  old_audit_length integer;
  new_audit_length integer;
begin
  if not (
    pg_catalog.pg_has_role(session_user, 'tge_runtime', 'member')
    and coalesce((
      select not rolsuper from pg_catalog.pg_roles
      where rolname = session_user
    ), false)
  ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception using
      errcode = '23514',
      message = 'RevenueAction rows cannot be deleted by runtime.';
  end if;

  if tg_op = 'INSERT' then
    if new.source_ordinal is not null then
      raise exception using
        errcode = '23514',
        message = 'Runtime inserts cannot claim imported source ordering.';
    end if;
    if new.status <> 'RECOMMENDED'
      or new.approval_requirement <> 'HUMAN'
      or new.source <> 'DEAL_INTELLIGENCE'
      or not (
        (new.action_type = 'FOLLOW_UP'
          and new.execution_type = 'COMMUNICATION_DRAFT'
          and new.risk_class = 'EXTERNAL_CONSEQUENTIAL')
        or (new.action_type in ('CREATE_TASK', 'RESEARCH', 'QUALIFY', 'ADVANCE')
          and new.execution_type = 'INTERNAL_TASK'
          and new.risk_class = 'INTERNAL')
      )
      or new.proposed_execution is not null
      or new.execution_request is not null
      or new.execution_result is not null
      or new.execution_attempts <> 0
      or new.prepared_at is not null
      or new.approved_at is not null
      or new.executed_at is not null
      or new.rejected_at is not null
      or new.cancelled_at is not null
      or new.failed_at is not null
      or new.rejection_reason is not null
      or new.resulting_task_id is not null
      or new.resulting_activity_id is not null
      or jsonb_typeof(new.evidence->'factual') <> 'object'
      or jsonb_typeof(new.evidence->'derived') <> 'object'
      or new.recommendation_snapshot->>'action_type' is distinct from new.action_type
      or new.recommendation_snapshot->>'priority' is distinct from new.priority
      or new.recommendation_snapshot->>'title' is distinct from new.title
      or new.recommendation_snapshot->>'reason' is distinct from new.reason
      or new.recommendation_snapshot->'evidence' is distinct from new.evidence
      or jsonb_array_length(new.audit) <> 1
      or new.audit->0->>'transition' <> 'CREATED_AS_RECOMMENDED'
      or jsonb_typeof(new.audit->0) <> 'object'
      or coalesce(btrim(new.audit->0->>'at'), '') = '' then
      raise exception using
        errcode = '23514',
        message = 'Runtime RevenueAction inserts must be deterministic RECOMMENDED records.';
    end if;
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id
    or new.id is distinct from old.id
    or new.opportunity_id is distinct from old.opportunity_id
    or new.action_type is distinct from old.action_type
    or new.execution_type is distinct from old.execution_type
    or new.approval_requirement is distinct from old.approval_requirement
    or new.risk_class is distinct from old.risk_class
    or new.priority is distinct from old.priority
    or new.title is distinct from old.title
    or new.reason is distinct from old.reason
    or new.evidence is distinct from old.evidence
    or new.recommendation_snapshot is distinct from old.recommendation_snapshot
    or new.basis_fingerprint is distinct from old.basis_fingerprint
    or new.source is distinct from old.source
    or new.legacy_payload is distinct from old.legacy_payload
    or new.current_payload is distinct from old.current_payload
    or new.source_ordinal is distinct from old.source_ordinal
    or new.source_created_at is distinct from old.source_created_at
    or new.source_updated_at is distinct from old.source_updated_at
    or new.created_at is distinct from old.created_at
    or new.live_ordinal is distinct from old.live_ordinal then
    raise exception using
      errcode = '23514',
      message = 'RevenueAction identity, snapshot, evidence, fingerprint, source, and history are immutable.';
  end if;

  if old.status in ('EXECUTED', 'REJECTED', 'CANCELLED')
    and new is distinct from old then
    raise exception using
      errcode = '23514',
      message = 'Terminal RevenueAction history is immutable.';
  end if;
  if old.resulting_task_id is not null
    and new.resulting_task_id is distinct from old.resulting_task_id then
    raise exception using
      errcode = '23514',
      message = 'RevenueAction task effect identity is immutable.';
  end if;
  if old.resulting_activity_id is not null
    and new.resulting_activity_id is distinct from old.resulting_activity_id then
    raise exception using
      errcode = '23514',
      message = 'RevenueAction activity effect identity is immutable.';
  end if;
  if old.proposed_execution is not null
    and new.proposed_execution is distinct from old.proposed_execution then
    raise exception using
      errcode = '23514',
      message = 'Prepared RevenueAction execution evidence is immutable.';
  end if;
  if old.prepared_at is not null and new.prepared_at is distinct from old.prepared_at then
    raise exception using errcode = '23514', message = 'RevenueAction prepared time is immutable.';
  end if;
  if old.approved_at is not null and new.approved_at is distinct from old.approved_at then
    raise exception using errcode = '23514', message = 'RevenueAction approval time is immutable.';
  end if;
  if new.execution_attempts < old.execution_attempts then
    raise exception using errcode = '23514', message = 'RevenueAction execution attempts cannot decrease.';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'RECOMMENDED' and new.status in ('PREPARED', 'CANCELLED'))
    or (old.status = 'PREPARED' and new.status in ('APPROVED', 'REJECTED', 'CANCELLED'))
    or (old.status = 'APPROVED' and new.status in ('EXECUTING', 'FAILED', 'CANCELLED'))
    or (old.status = 'EXECUTING' and new.status in ('EXECUTED', 'FAILED', 'CANCELLED'))
    or (old.status = 'FAILED' and new.status in ('EXECUTING', 'EXECUTED', 'CANCELLED'))
  ) then
    raise exception using errcode = '23514', message = 'RevenueAction lifecycle transition is invalid.';
  end if;

  old_audit_length := jsonb_array_length(old.audit);
  new_audit_length := jsonb_array_length(new.audit);
  if new_audit_length < old_audit_length then
    raise exception using errcode = '23514', message = 'RevenueAction audit history is append-only.';
  end if;
  if old_audit_length > 0 then
    for audit_index in 0..(old_audit_length - 1) loop
      if new.audit->audit_index is distinct from old.audit->audit_index then
        raise exception using errcode = '23514', message = 'RevenueAction audit history is append-only.';
      end if;
    end loop;
  end if;
  if new is distinct from old and new_audit_length = old_audit_length then
    raise exception using errcode = '23514', message = 'RevenueAction lifecycle changes require appended audit evidence.';
  end if;
  if new_audit_length > old_audit_length then
    for audit_index in old_audit_length..(new_audit_length - 1) loop
      if jsonb_typeof(new.audit->audit_index) <> 'object'
        or coalesce(btrim(new.audit->audit_index->>'transition'), '') = ''
        or coalesce(btrim(new.audit->audit_index->>'at'), '') = '' then
        raise exception using errcode = '23514', message = 'RevenueAction audit entries require a transition and server timestamp.';
      end if;
    end loop;
  end if;
  if new.status in ('PREPARED', 'APPROVED', 'EXECUTING', 'EXECUTED', 'FAILED')
    and new.proposed_execution is null then
    raise exception using errcode = '23514', message = 'Prepared RevenueActions require immutable proposed execution evidence.';
  end if;
  return new;
end;
$function$;

create function tge.guard_runtime_revenue_action_effect()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if not (
    pg_catalog.pg_has_role(session_user, 'tge_runtime', 'member')
    and coalesce((
      select not rolsuper from pg_catalog.pg_roles
      where rolname = session_user
    ), false)
  ) then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.revenue_action_id is not null then
      if tg_table_name = 'tasks' then
        raise exception using errcode = '23514', message = 'Linked RevenueAction task effects are immutable.';
      end if;
      raise exception using errcode = '23514', message = 'Linked RevenueAction activity effects are immutable.';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' and new.source_ordinal is not null then
    raise exception using
      errcode = '23514',
      message = 'Runtime inserts cannot claim imported source ordering.';
  end if;

  if tg_op = 'UPDATE' and (
    new.legacy_payload is distinct from old.legacy_payload
    or new.source_ordinal is distinct from old.source_ordinal
    or new.source_created_at is distinct from old.source_created_at
    or new.source_updated_at is distinct from old.source_updated_at
    or new.live_ordinal is distinct from old.live_ordinal
  ) then
    raise exception using errcode = '23514', message = 'Imported source evidence and live insertion order are immutable.';
  end if;

  if new.revenue_action_id is null and (
    new.metadata->>'source' = 'revenue_action'
    or new.metadata ? 'revenue_action_id'
    or new.metadata ? 'execution_effect_type'
    or new.metadata ? 'execution_mode'
    or new.metadata ? 'revenue_action_linked_at'
  ) then
    raise exception using errcode = '23514', message = 'RevenueAction effect evidence requires an authoritative linked action.';
  end if;

  if tg_table_name = 'tasks' then
    if new.revenue_action_id is not null and (
      new.metadata->>'revenue_action_id' is distinct from new.revenue_action_id
      or coalesce(new.metadata->>'source', '') not in ('revenue_action', 'deal_intelligence')
      or coalesce(btrim(new.metadata->>'action_type'), '') = ''
      or new.metadata->>'execution_effect_type' <> 'INTERNAL_TASK'
      or coalesce(btrim(new.metadata->>'normalized_title'), '') = ''
      or coalesce(btrim(new.metadata->>'semantic_task_key'), '') = ''
    ) then
      raise exception using errcode = '23514', message = 'Linked RevenueAction task provenance is invalid.';
    end if;
    if tg_op = 'UPDATE' and old.revenue_action_id is not null and (
      new.tenant_id is distinct from old.tenant_id
      or new.id is distinct from old.id
      or new.opportunity_id is distinct from old.opportunity_id
      or new.revenue_action_id is distinct from old.revenue_action_id
      or new.title is distinct from old.title
      or new.description is distinct from old.description
      or new.due_at is distinct from old.due_at
      or new.priority is distinct from old.priority
      or new.metadata is distinct from old.metadata
      or new.created_at is distinct from old.created_at
      or (new.current_payload - 'status' - 'completed_at' - 'updated_at')
        is distinct from
        (old.current_payload - 'status' - 'completed_at' - 'updated_at')
    ) then
      raise exception using errcode = '23514', message = 'Linked RevenueAction task effects are immutable.';
    end if;
    if tg_op = 'UPDATE' and old.revenue_action_id is null
      and new.revenue_action_id is not null and (
        new.tenant_id is distinct from old.tenant_id
        or new.id is distinct from old.id
        or new.opportunity_id is distinct from old.opportunity_id
        or new.title is distinct from old.title
        or new.description is distinct from old.description
        or new.due_at is distinct from old.due_at
        or new.priority is distinct from old.priority
        or new.status is distinct from old.status
        or new.completed_at is distinct from old.completed_at
        or new.created_at is distinct from old.created_at
        or (
          new.metadata
            - 'revenue_action_id'
            - 'action_type'
            - 'execution_effect_type'
            - 'normalized_title'
            - 'semantic_task_key'
            - 'revenue_action_linked_at'
        ) is distinct from (
          old.metadata
            - 'revenue_action_id'
            - 'action_type'
            - 'execution_effect_type'
            - 'normalized_title'
            - 'semantic_task_key'
            - 'revenue_action_linked_at'
        )
        or new.current_payload is distinct from
          jsonb_set(old.current_payload, '{metadata}', new.metadata, true)
      ) then
      raise exception using errcode = '23514', message = 'Only derived RevenueAction task provenance may change when linking an existing task.';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and tg_table_name = 'activities'
    and old.revenue_action_id is null
    and new.revenue_action_id is not null then
    raise exception using
      errcode = '23514',
      message = 'Existing activities cannot be linked to RevenueActions.';
  end if;

  if new.revenue_action_id is not null and (
    new.metadata->>'revenue_action_id' is distinct from new.revenue_action_id
    or new.metadata->>'source' <> 'revenue_action'
    or coalesce(btrim(new.metadata->>'action_type'), '') = ''
    or coalesce(new.metadata->>'execution_mode', '') not in ('SYSTEM_INTERNAL', 'MANUAL_CONFIRMED')
    or coalesce(new.metadata->>'execution_effect_type', '') not in (
      'INTERNAL_TASK', 'COMMUNICATION_MANUAL_CONFIRMATION'
    )
    or coalesce(btrim(new.metadata->>'action_key'), '') = ''
    or (new.metadata->>'execution_effect_type' = 'INTERNAL_TASK' and (
      new.type <> 'REVENUE_ACTION_TASK_EXECUTED'
      or coalesce(btrim(new.metadata->>'task_id'), '') = ''
      or new.metadata->>'execution_mode' <> 'SYSTEM_INTERNAL'
    ))
    or (new.metadata->>'execution_effect_type' = 'COMMUNICATION_MANUAL_CONFIRMATION' and (
      new.type <> 'REVENUE_ACTION_MANUALLY_CONFIRMED'
      or coalesce(btrim(new.metadata->>'channel'), '') = ''
      or new.metadata->>'execution_mode' <> 'MANUAL_CONFIRMED'
    ))
  ) then
    raise exception using errcode = '23514', message = 'Linked RevenueAction activity provenance is invalid.';
  end if;
  if tg_op = 'UPDATE' and old.revenue_action_id is not null
    and new is distinct from old then
    raise exception using errcode = '23514', message = 'Linked RevenueAction activity effects are immutable.';
  end if;
  return new;
end;
$function$;

create trigger prospects_assign_live_ordinal
before insert on tge.prospects
for each row execute function tge.assign_live_ordinal();
create trigger opportunities_assign_live_ordinal
before insert on tge.opportunities
for each row execute function tge.assign_live_ordinal();
create trigger tasks_assign_live_ordinal
before insert on tge.tasks
for each row execute function tge.assign_live_ordinal();
create trigger activities_assign_live_ordinal
before insert on tge.activities
for each row execute function tge.assign_live_ordinal();
create trigger revenue_actions_assign_live_ordinal
before insert on tge.revenue_actions
for each row execute function tge.assign_live_ordinal();

create trigger prospects_runtime_source_integrity
before insert or update on tge.prospects
for each row execute function tge.guard_runtime_source_evidence();
create trigger opportunities_runtime_source_integrity
before insert or update on tge.opportunities
for each row execute function tge.guard_runtime_source_evidence();
create trigger tasks_runtime_effect_integrity
before insert or update or delete on tge.tasks
for each row execute function tge.guard_runtime_revenue_action_effect();
create trigger activities_runtime_effect_integrity
before insert or update or delete on tge.activities
for each row execute function tge.guard_runtime_revenue_action_effect();
create trigger revenue_actions_runtime_integrity
before insert or update or delete on tge.revenue_actions
for each row execute function tge.guard_runtime_revenue_action();

revoke update, delete on tge.revenue_actions from tge_runtime;
grant update (
  status,
  proposed_execution,
  execution_request,
  execution_result,
  audit,
  execution_attempts,
  prepared_at,
  approved_at,
  executed_at,
  rejected_at,
  cancelled_at,
  failed_at,
  rejection_reason,
  resulting_task_id,
  resulting_activity_id,
  updated_at
) on tge.revenue_actions to tge_runtime;

grant usage on sequence
  tge.prospects_live_ordinal_seq,
  tge.opportunities_live_ordinal_seq,
  tge.tasks_live_ordinal_seq,
  tge.activities_live_ordinal_seq,
  tge.revenue_actions_live_ordinal_seq
to tge_runtime;

revoke all on function tge.assign_live_ordinal() from public, tge_runtime;
revoke all on function tge.guard_runtime_source_evidence() from public, tge_runtime;
revoke all on function tge.guard_runtime_revenue_action() from public, tge_runtime;
revoke all on function tge.guard_runtime_revenue_action_effect() from public, tge_runtime;

alter table tge.prospects force row level security;
alter table tge.opportunities force row level security;
alter table tge.tasks force row level security;
alter table tge.activities force row level security;
alter table tge.revenue_actions force row level security;
