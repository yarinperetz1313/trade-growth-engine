set local role tge_owner;

create function tge.guard_runtime_revenue_action_cancellation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  old_audit_length integer;
  new_audit_length integer;
  suffix_last jsonb;
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

  if new.status <> 'CANCELLED' or old.status = 'CANCELLED' then
    return new;
  end if;

  old_audit_length := jsonb_array_length(old.audit);
  new_audit_length := jsonb_array_length(new.audit);
  suffix_last := new.audit->(new_audit_length - 1);

  begin
    suffix_at := (suffix_last->>'at')::timestamptz;
  exception when others then
    coherent := false;
  end;

  if old.status not in ('RECOMMENDED', 'PREPARED', 'APPROVED', 'EXECUTING', 'FAILED')
    or new_audit_length <> old_audit_length + 1
    or suffix_last->>'transition' not in (
      'CANCELLED',
      'SUPERSEDED_BY_CURRENT_RECOMMENDATION',
      'SUPERSEDED_AS_STALE',
      'SUPERSEDED_OPPORTUNITY_CLOSED',
      'QUARANTINED_INVALID_EVIDENCE'
    )
    or new.cancelled_at is distinct from suffix_at
    or new.updated_at is distinct from suffix_at
    or new.proposed_execution is distinct from old.proposed_execution
    or new.execution_request is distinct from old.execution_request
    or new.execution_result is distinct from old.execution_result
    or new.execution_attempts is distinct from old.execution_attempts
    or new.prepared_at is distinct from old.prepared_at
    or new.approved_at is distinct from old.approved_at
    or new.executed_at is distinct from old.executed_at
    or new.rejected_at is distinct from old.rejected_at
    or new.failed_at is distinct from old.failed_at
    or new.rejection_reason is distinct from old.rejection_reason
    or new.resulting_task_id is distinct from old.resulting_task_id
    or new.resulting_activity_id is distinct from old.resulting_activity_id then
    coherent := false;
  end if;

  if not coherent then
    raise exception using
      errcode = '23514',
      message = 'Runtime RevenueAction cancellation evidence is incoherent.';
  end if;
  return new;
end;
$function$;

revoke all on function tge.guard_runtime_revenue_action_cancellation()
  from public, tge_runtime;

create trigger revenue_actions_runtime_cancellation_integrity
before update on tge.revenue_actions
for each row execute function tge.guard_runtime_revenue_action_cancellation();
