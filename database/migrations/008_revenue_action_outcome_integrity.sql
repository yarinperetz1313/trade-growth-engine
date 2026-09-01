set local role tge_owner;

create or replace function tge.guard_runtime_revenue_action_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  old_audit_length integer;
  new_audit_length integer;
  suffix_first jsonb;
  suffix_last jsonb;
  expected_mode text;
  linked_task_source text;
  suffix_at timestamptz;
  coherent boolean := true;
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

  old_audit_length := jsonb_array_length(old.audit);
  new_audit_length := jsonb_array_length(new.audit);
  suffix_first := new.audit->old_audit_length;
  suffix_last := new.audit->(new_audit_length - 1);
  expected_mode := case
    when new.execution_type = 'COMMUNICATION_DRAFT' then 'MANUAL_CONFIRMED'
    else 'SYSTEM_INTERNAL'
  end;

  begin
    suffix_at := (suffix_last->>'at')::timestamptz;
  exception when others then
    coherent := false;
  end;
  if suffix_at is distinct from new.updated_at then
    coherent := false;
  end if;

  if new.resulting_task_id is not null then
    select task.metadata->>'source'
      into linked_task_source
      from tge.tasks as task
      where task.tenant_id = new.tenant_id
        and task.id = new.resulting_task_id
        and task.revenue_action_id = new.id;
  end if;

  if old.status = 'RECOMMENDED' and new.status = 'PREPARED' then
    if new_audit_length <> old_audit_length + 1
      or suffix_last->>'transition' <> 'PREPARED'
      or new.prepared_at is distinct from suffix_at
      or new.proposed_execution is null
      or new.execution_attempts <> 0
      or new.execution_request is not null
      or new.execution_result is not null then
      coherent := false;
    end if;

  elsif old.status = 'PREPARED' and new.status = 'APPROVED' then
    if new_audit_length <> old_audit_length + 1
      or suffix_last->>'transition' <> 'APPROVED'
      or suffix_last->>'approval' <> 'HUMAN'
      or new.approved_at is distinct from suffix_at
      or new.prepared_at is distinct from old.prepared_at
      or new.proposed_execution is distinct from old.proposed_execution
      or new.execution_attempts <> 0
      or new.execution_request is not null
      or new.execution_result is not null then
      coherent := false;
    end if;

  elsif old.status = 'PREPARED' and new.status = 'REJECTED' then
    if new_audit_length <> old_audit_length + 1
      or suffix_last->>'transition' <> 'REJECTED'
      or new.rejected_at is distinct from suffix_at
      or suffix_last->>'reason' is distinct from new.rejection_reason
      or new.execution_attempts <> 0
      or new.execution_request is not null
      or new.execution_result is not null then
      coherent := false;
    end if;

  elsif new.status = 'CANCELLED'
    and old.status in ('RECOMMENDED', 'PREPARED', 'APPROVED', 'EXECUTING', 'FAILED') then
    if new_audit_length <> old_audit_length + 1
      or suffix_last->>'transition' not in (
        'CANCELLED',
        'SUPERSEDED_BY_CURRENT_RECOMMENDATION',
        'SUPERSEDED_AS_STALE',
        'SUPERSEDED_OPPORTUNITY_CLOSED',
        'QUARANTINED_INVALID_EVIDENCE'
      )
      or new.cancelled_at is distinct from suffix_at then
      coherent := false;
    end if;

  elsif old.status in ('APPROVED', 'FAILED') and new.status = 'EXECUTING' then
    if new_audit_length <> old_audit_length + 1
      or suffix_last->>'transition' <> 'EXECUTION_STARTED'
      or suffix_last->>'attempt' is distinct from new.execution_attempts::text
      or new.execution_attempts <> old.execution_attempts + 1
      or new.execution_request->>'mode' is distinct from expected_mode
      or new.execution_request->>'requested_at' is distinct from suffix_last->>'at'
      or new.execution_result is not null
      or new.failed_at is not null then
      coherent := false;
    end if;

  elsif old.status = 'EXECUTING' and new.status = 'FAILED' then
    if new_audit_length <> old_audit_length + 1
      or suffix_last->>'transition' <> 'FAILED'
      or new.execution_attempts <> old.execution_attempts
      or new.execution_request is distinct from old.execution_request
      or new.execution_result->>'mode' is distinct from expected_mode
      or new.execution_result->>'outcome' is distinct from 'FAILED'
      or new.execution_result->>'external_send_performed' is distinct from 'false'
      or coalesce(btrim(new.execution_result->>'error'), '') = ''
      or suffix_last->>'error' is distinct from new.execution_result->>'error'
      or new.failed_at is distinct from suffix_at then
      coherent := false;
    end if;

  elsif old.status in ('APPROVED', 'FAILED') and new.status = 'FAILED' then
    if new_audit_length <> old_audit_length + 2
      or suffix_first->>'transition' <> 'EXECUTION_STARTED'
      or suffix_last->>'transition' <> 'FAILED'
      or suffix_first->>'attempt' is distinct from new.execution_attempts::text
      or new.execution_attempts <> old.execution_attempts + 1
      or new.execution_request->>'mode' is distinct from expected_mode
      or new.execution_request->>'requested_at' is distinct from suffix_first->>'at'
      or new.execution_result->>'mode' is distinct from expected_mode
      or new.execution_result->>'outcome' is distinct from 'FAILED'
      or new.execution_result->>'external_send_performed' is distinct from 'false'
      or coalesce(btrim(new.execution_result->>'error'), '') = ''
      or suffix_last->>'error' is distinct from new.execution_result->>'error'
      or new.failed_at is distinct from suffix_at then
      coherent := false;
    end if;

  elsif old.status in ('EXECUTING', 'FAILED') and new.status = 'EXECUTED' then
    if new_audit_length <> old_audit_length + 1
      or suffix_last->>'transition' <> 'EXECUTED'
      or new.executed_at is distinct from suffix_at
      or new.execution_attempts <> old.execution_attempts
      or new.execution_attempts < 1
      or new.execution_request is distinct from old.execution_request
      or new.execution_request->>'mode' is distinct from expected_mode
      or coalesce(btrim(new.execution_request->>'requested_at'), '') = ''
      or new.execution_result->>'mode' is distinct from expected_mode
      or new.execution_result->>'external_send_performed' is distinct from 'false'
      or new.execution_result ? 'error'
      or new.resulting_activity_id is null
      or suffix_last->>'execution_mode' is distinct from expected_mode
      or suffix_last->>'resulting_activity_id' is distinct from new.resulting_activity_id
      or suffix_last->>'resulting_task_id' is distinct from new.resulting_task_id
      or new.failed_at is not null then
      coherent := false;
    end if;

    if new.execution_type = 'INTERNAL_TASK' then
      if new.resulting_task_id is null
        or coalesce(new.execution_result->>'outcome', '') not in (
          'TASK_CREATED', 'TASK_REUSED', 'RECOVERED_LINKED_EFFECTS'
        )
        or coalesce(linked_task_source, '') not in (
          'revenue_action', 'deal_intelligence'
        )
        or (new.execution_result->>'outcome' = 'TASK_CREATED'
          and coalesce(linked_task_source, '') <> 'revenue_action')
        or (new.execution_result->>'outcome' = 'TASK_REUSED'
          and coalesce(linked_task_source, '') <> 'deal_intelligence') then
        coherent := false;
      end if;
    elsif new.execution_type = 'COMMUNICATION_DRAFT' then
      if new.resulting_task_id is not null
        or coalesce(new.execution_result->>'outcome', '') not in (
          'USER_CONFIRMED_COMPLETION', 'RECOVERED_LINKED_EFFECTS'
        ) then
        coherent := false;
      end if;
    else
      coherent := false;
    end if;

  else
    coherent := false;
  end if;

  if not coherent then
    raise exception using
      errcode = '23514',
      message = 'Runtime RevenueAction lifecycle evidence is incoherent.';
  end if;
  return new;
end;
$function$;

revoke all on function tge.guard_runtime_revenue_action_lifecycle()
  from public, tge_runtime;
