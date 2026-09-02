set local role tge_owner;

alter table tge.revenue_actions
  add constraint revenue_actions_case_link_unique
  unique (tenant_id, id, opportunity_id);

create table tge.revenue_leak_cases (
  tenant_id uuid not null,
  id text not null check (btrim(id) <> ''),
  leak_type text not null check (leak_type = 'STALLED_OPPORTUNITY'),
  state text not null check (
    state in ('OPEN', 'SNOOZED', 'DISMISSED', 'SUPERSEDED')
  ),
  source_system text not null check (source_system = 'TGE'),
  source_entity_type text not null check (source_entity_type = 'OPPORTUNITY'),
  source_entity_id text not null check (btrim(source_entity_id) <> ''),
  opportunity_id text not null check (btrim(opportunity_id) <> ''),
  source_observed_at timestamptz not null,
  source_observed_version text not null check (btrim(source_observed_version) <> ''),
  detector_id text not null check (btrim(detector_id) <> ''),
  detector_version text not null check (btrim(detector_version) <> ''),
  reason_code text not null check (reason_code ~ '^[A-Z][A-Z0-9_]*$'),
  evidence_classification text not null check (
    evidence_classification in ('OBSERVED', 'DERIVED', 'MIXED')
  ),
  evidence_snapshot jsonb not null check (
    jsonb_typeof(evidence_snapshot) = 'object'
    and evidence_snapshot ? 'facts'
    and jsonb_typeof(evidence_snapshot->'facts') = 'object'
    and evidence_snapshot->'facts' <> '{}'::jsonb
    and evidence_snapshot ? 'classification'
    and evidence_snapshot->>'classification' = evidence_classification
  ),
  evidence_fingerprint text not null check (evidence_fingerprint ~ '^[0-9a-f]{64}$'),
  series_key text not null check (series_key ~ '^[0-9a-f]{64}$'),
  semantic_key text not null check (semantic_key ~ '^[0-9a-f]{64}$'),
  commercial_value_classification text not null check (
    commercial_value_classification in ('KNOWN', 'UNKNOWN', 'NOT_APPLICABLE')
  ),
  revenue_at_risk numeric(20,6),
  currency text,
  recommended_action_type text not null check (btrim(recommended_action_type) <> ''),
  due_at timestamptz,
  supersession_condition jsonb not null check (
    jsonb_typeof(supersession_condition) = 'object'
    and supersession_condition <> '{}'::jsonb
  ),
  supersedes_case_id text,
  superseded_by_case_id text,
  revenue_action_id text,
  revenue_action_fingerprint text check (revenue_action_fingerprint is null or revenue_action_fingerprint ~ '^[0-9a-f]{64}$'),
  revenue_action_status_at_link text check (
    revenue_action_status_at_link is null
    or revenue_action_status_at_link in (
      'RECOMMENDED', 'PREPARED', 'APPROVED', 'EXECUTING', 'EXECUTED',
      'REJECTED', 'CANCELLED', 'FAILED'
    )
  ),
  revenue_action_linked_at timestamptz,
  snoozed_at timestamptz,
  snoozed_until timestamptz,
  snooze_reason text,
  dismissed_at timestamptz,
  dismissal_reason text,
  superseded_at timestamptz,
  supersession_reason text,
  detected_at timestamptz not null,
  updated_at timestamptz not null,
  created_at timestamptz not null,
  audit jsonb not null check (
    jsonb_typeof(audit) = 'array'
    and jsonb_array_length(audit) >= 1
  ),
  primary key (tenant_id, id),
  unique (tenant_id, id, series_key),
  foreign key (tenant_id) references tge.tenants(id)
    on update restrict on delete restrict,
  foreign key (tenant_id, opportunity_id)
    references tge.opportunities(tenant_id, id)
    on update restrict on delete restrict,
  foreign key (tenant_id, supersedes_case_id, series_key)
    references tge.revenue_leak_cases(tenant_id, id, series_key)
    on update restrict on delete restrict
    deferrable initially deferred,
  foreign key (tenant_id, superseded_by_case_id, series_key)
    references tge.revenue_leak_cases(tenant_id, id, series_key)
    on update restrict on delete restrict
    deferrable initially deferred,
  foreign key (tenant_id, revenue_action_id, opportunity_id)
    references tge.revenue_actions(tenant_id, id, opportunity_id)
    on update restrict on delete restrict,
  check (source_entity_id = opportunity_id),
  check (
    (
      commercial_value_classification = 'KNOWN'
      and revenue_at_risk is not null
      and revenue_at_risk >= 0
      and currency is not null
      and currency ~ '^[A-Z]{3}$'
    )
    or (
      commercial_value_classification in ('UNKNOWN', 'NOT_APPLICABLE')
      and revenue_at_risk is null
      and currency is null
    )
  ),
  check (
    (
      revenue_action_id is null
      and revenue_action_fingerprint is null
      and revenue_action_status_at_link is null
      and revenue_action_linked_at is null
    )
    or (
      revenue_action_id is not null
      and revenue_action_fingerprint is not null
      and revenue_action_status_at_link is not null
      and revenue_action_linked_at is not null
    )
  ),
  check (
    (state = 'OPEN')
    or (
      state = 'SNOOZED'
      and snoozed_at is not null
      and snoozed_until is not null
      and snoozed_until > snoozed_at
      and snooze_reason is not null
      and btrim(snooze_reason) <> ''
    )
    or (
      state = 'DISMISSED'
      and dismissed_at is not null
      and dismissal_reason is not null
      and btrim(dismissal_reason) <> ''
    )
    or (
      state = 'SUPERSEDED'
      and superseded_at is not null
      and superseded_by_case_id is not null
      and supersession_reason is not null
      and btrim(supersession_reason) <> ''
    )
  ),
  check (
    state = 'SUPERSEDED'
    or (
      superseded_at is null
      and superseded_by_case_id is null
      and supersession_reason is null
    )
  ),
  check (
    source_observed_at <= detected_at
    and updated_at >= detected_at
    and created_at = detected_at
  )
);

create unique index revenue_leak_cases_active_series_uidx
  on tge.revenue_leak_cases(tenant_id, series_key)
  where state in ('OPEN', 'SNOOZED');

create unique index revenue_leak_cases_active_semantic_uidx
  on tge.revenue_leak_cases(tenant_id, semantic_key)
  where state in ('OPEN', 'SNOOZED');

create index revenue_leak_cases_opportunity_history_idx
  on tge.revenue_leak_cases(tenant_id, opportunity_id, detected_at desc, id);

create index revenue_leak_cases_action_idx
  on tge.revenue_leak_cases(tenant_id, revenue_action_id)
  where revenue_action_id is not null;

alter table tge.revenue_leak_cases owner to tge_owner;
alter table tge.revenue_leak_cases enable row level security;
alter table tge.revenue_leak_cases force row level security;

create policy tenant_scope on tge.revenue_leak_cases
  for all
  using (tenant_id = tge.current_tenant_id())
  with check (tenant_id = tge.current_tenant_id());

create function tge.guard_runtime_revenue_leak_case_history()
returns trigger
language plpgsql
set search_path = pg_catalog, tge
as $function$
declare
  runtime_session boolean;
  old_audit_length integer;
  new_audit_length integer;
  audit_index integer;
  suffix jsonb;
  suffix_at timestamptz;
  immutable_old jsonb;
  immutable_new jsonb;
  linked_action_fingerprint text;
  linked_action_status text;
begin
  runtime_session := (
    pg_catalog.pg_has_role(session_user, 'tge_runtime', 'member')
    and coalesce((
      select not rolsuper from pg_catalog.pg_roles
      where rolname = session_user
    ), false)
  );

  if not runtime_session then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception using
      errcode = '23514',
      message = 'RevenueLeakCase rows cannot be deleted by runtime.';
  end if;

  if tg_op = 'INSERT' then
    begin
      suffix_at := (new.audit->0->>'at')::timestamptz;
    exception when others then
      suffix_at := null;
    end;
    if new.tenant_id is distinct from tge.current_tenant_id()
      or new.state <> 'OPEN'
      or jsonb_array_length(new.audit) <> 1
      or new.audit->0->>'transition' is distinct from 'OPEN'
      or new.audit->0->>'subject_id' is distinct from tge.current_subject_id()
      or new.audit->0->>'detector_id' is distinct from new.detector_id
      or new.audit->0->>'detector_version' is distinct from new.detector_version
      or new.audit->0->>'reason_code' is distinct from new.reason_code
      or suffix_at is distinct from new.detected_at
      or new.updated_at is distinct from new.detected_at
      or new.created_at is distinct from new.detected_at
      or new.superseded_by_case_id is not null
      or new.superseded_at is not null
      or new.supersession_reason is not null
      or new.revenue_action_id is not null
      or new.revenue_action_fingerprint is not null
      or new.revenue_action_status_at_link is not null
      or new.revenue_action_linked_at is not null
      or new.snoozed_at is not null
      or new.snoozed_until is not null
      or new.snooze_reason is not null
      or new.dismissed_at is not null
      or new.dismissal_reason is not null then
      raise exception using
        errcode = '23514',
        message = 'Runtime RevenueLeakCase creation evidence is incoherent.';
    end if;
    return new;
  end if;

  immutable_old := to_jsonb(old) - array[
    'state', 'updated_at', 'audit',
    'revenue_action_id', 'revenue_action_fingerprint',
    'revenue_action_status_at_link', 'revenue_action_linked_at',
    'snoozed_at', 'snoozed_until', 'snooze_reason',
    'dismissed_at', 'dismissal_reason',
    'superseded_by_case_id', 'superseded_at', 'supersession_reason'
  ];
  immutable_new := to_jsonb(new) - array[
    'state', 'updated_at', 'audit',
    'revenue_action_id', 'revenue_action_fingerprint',
    'revenue_action_status_at_link', 'revenue_action_linked_at',
    'snoozed_at', 'snoozed_until', 'snooze_reason',
    'dismissed_at', 'dismissal_reason',
    'superseded_by_case_id', 'superseded_at', 'supersession_reason'
  ];
  if immutable_new is distinct from immutable_old then
    raise exception using
      errcode = '23514',
      message = 'RevenueLeakCase detection evidence is immutable.';
  end if;

  old_audit_length := jsonb_array_length(old.audit);
  new_audit_length := jsonb_array_length(new.audit);
  if new_audit_length <> old_audit_length + 1 then
    raise exception using
      errcode = '23514',
      message = 'RevenueLeakCase audit history is append-only.';
  end if;
  for audit_index in 0..old_audit_length - 1 loop
    if new.audit->audit_index is distinct from old.audit->audit_index then
      raise exception using
        errcode = '23514',
        message = 'RevenueLeakCase audit history is append-only.';
    end if;
  end loop;

  suffix := new.audit->old_audit_length;
  begin
    suffix_at := (suffix->>'at')::timestamptz;
  exception when others then
    suffix_at := null;
  end;
  if suffix is null
    or jsonb_typeof(suffix) <> 'object'
    or suffix_at is distinct from new.updated_at
    or suffix->>'subject_id' is distinct from tge.current_subject_id() then
    raise exception using
      errcode = '23514',
      message = 'Runtime RevenueLeakCase audit evidence is incoherent.';
  end if;

  if old.revenue_action_id is null
    and new.revenue_action_id is not null
    and new.state = old.state then
    select action.basis_fingerprint, action.status
      into linked_action_fingerprint, linked_action_status
      from tge.revenue_actions action
      where action.tenant_id = new.tenant_id
        and action.id = new.revenue_action_id
        and action.opportunity_id = new.opportunity_id;
    if old.state not in ('OPEN', 'SNOOZED')
      or linked_action_fingerprint is null
      or new.revenue_action_fingerprint is distinct from linked_action_fingerprint
      or new.revenue_action_status_at_link is distinct from linked_action_status
      or suffix->>'transition' is distinct from 'REVENUE_ACTION_LINKED'
      or suffix->>'revenue_action_id' is distinct from new.revenue_action_id
      or suffix->>'revenue_action_fingerprint'
        is distinct from new.revenue_action_fingerprint
      or suffix->>'revenue_action_status'
        is distinct from new.revenue_action_status_at_link
      or new.revenue_action_linked_at is distinct from suffix_at
      or to_jsonb(new) - array[
        'updated_at', 'audit', 'revenue_action_id',
        'revenue_action_fingerprint', 'revenue_action_status_at_link',
        'revenue_action_linked_at'
      ] is distinct from to_jsonb(old) - array[
        'updated_at', 'audit', 'revenue_action_id',
        'revenue_action_fingerprint', 'revenue_action_status_at_link',
        'revenue_action_linked_at'
      ] then
      raise exception using
        errcode = '23514',
        message = 'Runtime RevenueLeakCase action linkage is incoherent.';
    end if;

  elsif old.state = 'OPEN' and new.state = 'SNOOZED' then
    if suffix->>'transition' is distinct from 'SNOOZED'
      or coalesce(btrim(suffix->>'reason'), '') = ''
      or suffix->>'reason' is distinct from new.snooze_reason
      or (suffix->>'wake_at')::timestamptz is distinct from new.snoozed_until
      or new.snoozed_at is distinct from suffix_at
      or new.snoozed_until <= new.snoozed_at
      or to_jsonb(new) - array[
        'state', 'updated_at', 'audit',
        'snoozed_at', 'snoozed_until', 'snooze_reason'
      ] is distinct from to_jsonb(old) - array[
        'state', 'updated_at', 'audit',
        'snoozed_at', 'snoozed_until', 'snooze_reason'
      ] then
      raise exception using
        errcode = '23514',
        message = 'Runtime RevenueLeakCase snooze evidence is incoherent.';
    end if;

  elsif old.state = 'SNOOZED' and new.state = 'OPEN' then
    if suffix->>'transition' is distinct from 'REOPENED'
      or coalesce(btrim(suffix->>'reason'), '') = ''
      or new.snoozed_at is not null
      or new.snoozed_until is not null
      or new.snooze_reason is not null
      or to_jsonb(new) - array[
        'state', 'updated_at', 'audit',
        'snoozed_at', 'snoozed_until', 'snooze_reason'
      ] is distinct from to_jsonb(old) - array[
        'state', 'updated_at', 'audit',
        'snoozed_at', 'snoozed_until', 'snooze_reason'
      ] then
      raise exception using
        errcode = '23514',
        message = 'Runtime RevenueLeakCase resume evidence is incoherent.';
    end if;

  elsif old.state in ('OPEN', 'SNOOZED') and new.state = 'DISMISSED' then
    if suffix->>'transition' is distinct from 'DISMISSED'
      or coalesce(btrim(suffix->>'reason'), '') = ''
      or suffix->>'reason' is distinct from new.dismissal_reason
      or new.dismissed_at is distinct from suffix_at
      or to_jsonb(new) - array[
        'state', 'updated_at', 'audit', 'dismissed_at', 'dismissal_reason'
      ] is distinct from to_jsonb(old) - array[
        'state', 'updated_at', 'audit', 'dismissed_at', 'dismissal_reason'
      ] then
      raise exception using
        errcode = '23514',
        message = 'Runtime RevenueLeakCase dismissal evidence is incoherent.';
    end if;

  elsif old.state in ('OPEN', 'SNOOZED') and new.state = 'SUPERSEDED' then
    if suffix->>'transition' is distinct from 'SUPERSEDED'
      or suffix->>'reason_code' is distinct from new.supersession_reason
      or suffix->>'superseded_by_case_id'
        is distinct from new.superseded_by_case_id
      or new.superseded_at is distinct from suffix_at
      or new.supersession_reason is distinct from 'CANONICAL_EVIDENCE_CHANGED'
      or to_jsonb(new) - array[
        'state', 'updated_at', 'audit', 'superseded_by_case_id',
        'superseded_at', 'supersession_reason'
      ] is distinct from to_jsonb(old) - array[
        'state', 'updated_at', 'audit', 'superseded_by_case_id',
        'superseded_at', 'supersession_reason'
      ] then
      raise exception using
        errcode = '23514',
        message = 'Runtime RevenueLeakCase supersession evidence is incoherent.';
    end if;

  else
    raise exception using
      errcode = '23514',
      message = 'Runtime RevenueLeakCase lifecycle transition is invalid.';
  end if;

  return new;
end;
$function$;

revoke all on function tge.guard_runtime_revenue_leak_case_history()
  from public, tge_runtime;

create trigger revenue_leak_cases_runtime_history_integrity
before insert or update or delete on tge.revenue_leak_cases
for each row execute function tge.guard_runtime_revenue_leak_case_history();

revoke all on tge.revenue_leak_cases from public;
grant select, insert, update on tge.revenue_leak_cases to tge_runtime;

revoke execute on all functions in schema tge from public;
