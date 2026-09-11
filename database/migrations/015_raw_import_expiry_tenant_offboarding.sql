set local role tge_owner;

reset role;

do $role$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'tge_maintenance') then
    create role tge_maintenance nologin noinherit nosuperuser nocreatedb
      nocreaterole noreplication nobypassrls;
  end if;
end
$role$;

alter role tge_maintenance nologin noinherit nosuperuser nocreatedb nocreaterole
  noreplication nobypassrls;
revoke tge_owner from tge_maintenance;
revoke tge_migrator from tge_maintenance;
revoke tge_runtime from tge_maintenance;

do $database$
begin
  execute format(
    'revoke all privileges on database %I from tge_maintenance',
    current_database()
  );
  execute format(
    'grant connect on database %I to tge_maintenance',
    current_database()
  );
end
$database$;

set local role tge_owner;

alter table tge.import_batches
  add column raw_cleanup_state text not null default 'PENDING',
  add column raw_cleanup_attempts integer not null default 0,
  add column raw_cleanup_started_at timestamptz,
  add column raw_cleanup_completed_at timestamptz,
  add column raw_cleanup_failure_code text,
  add column raw_cleanup_retryable boolean not null default false;

do $constraint$
declare
  legacy_constraints text[];
begin
  select array_agg(constraint_record.conname order by constraint_record.conname)
  into legacy_constraints
  from pg_catalog.pg_constraint constraint_record
  where constraint_record.conrelid = 'tge.import_batches'::regclass
    and constraint_record.contype = 'c'
    and pg_catalog.pg_get_constraintdef(constraint_record.oid)
      ~ 'raw_expires_at.*<=.*created_at';

  if cardinality(legacy_constraints) is distinct from 1 then
    raise exception 'Expected one legacy raw-expiry constraint.';
  end if;
  execute format(
    'alter table tge.import_batches drop constraint %I',
    legacy_constraints[1]
  );
end
$constraint$;

alter table tge.import_batches
  add constraint import_batches_raw_exact_expiry_check
    check (raw_expires_at = created_at + interval '168 hours'),
  add constraint import_batches_raw_cleanup_state_check check (
    raw_cleanup_state in ('PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED')
  ),
  add constraint import_batches_raw_cleanup_attempts_check
    check (raw_cleanup_attempts >= 0),
  add constraint import_batches_raw_cleanup_truth_check check (
    (
      raw_cleanup_state = 'PENDING'
      and raw_cleanup_attempts = 0
      and raw_cleanup_started_at is null
      and raw_cleanup_completed_at is null
      and raw_cleanup_failure_code is null
      and raw_cleanup_retryable = false
    )
    or (
      raw_cleanup_state = 'IN_PROGRESS'
      and raw_cleanup_attempts > 0
      and raw_cleanup_started_at is not null
      and raw_cleanup_completed_at is null
      and raw_cleanup_failure_code is null
      and raw_cleanup_retryable = false
    )
    or (
      raw_cleanup_state = 'SUCCEEDED'
      and raw_cleanup_attempts > 0
      and raw_cleanup_started_at is not null
      and raw_cleanup_completed_at is not null
      and raw_cleanup_failure_code is null
      and raw_cleanup_retryable = false
    )
    or (
      raw_cleanup_state = 'FAILED'
      and raw_cleanup_attempts > 0
      and raw_cleanup_started_at is not null
      and raw_cleanup_completed_at is null
      and raw_cleanup_failure_code = 'RAW_IMPORT_CLEANUP_FAILED'
      and raw_cleanup_retryable = true
    )
  );

create index import_batches_raw_cleanup_due_idx
  on tge.import_batches(raw_expires_at, tenant_id, id)
  where raw_cleanup_state in ('PENDING', 'FAILED');

create function tge.guard_runtime_import_retention_clock()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
declare
  authoritative_at timestamptz;
  runtime_session boolean;
begin
  runtime_session := (
    pg_catalog.pg_has_role(session_user, 'tge_runtime', 'member')
    and coalesce((
      select not rolsuper
      from pg_catalog.pg_roles
      where rolname = session_user
    ), false)
  );
  if not runtime_session then return new; end if;
  authoritative_at := clock_timestamp();
  new.created_at := authoritative_at;
  new.updated_at := authoritative_at;
  new.authorization_verified_at := authoritative_at;
  new.raw_expires_at := authoritative_at + interval '168 hours';
  new.metadata_retain_until := authoritative_at + interval '12 months';
  new.raw_cleanup_state := 'PENDING';
  new.raw_cleanup_attempts := 0;
  new.raw_cleanup_started_at := null;
  new.raw_cleanup_completed_at := null;
  new.raw_cleanup_failure_code := null;
  new.raw_cleanup_retryable := false;
  return new;
end
$function$;

create trigger import_batches_runtime_retention_clock
before insert on tge.import_batches
for each row execute function tge.guard_runtime_import_retention_clock();

create function tge.guard_import_batch_tenant_writable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, tge
as $function$
declare
  runtime_session boolean;
begin
  runtime_session := (
    pg_catalog.pg_has_role(session_user, 'tge_runtime', 'member')
    and coalesce((
      select not rolsuper
      from pg_catalog.pg_roles
      where rolname = session_user
    ), false)
  );
  if not runtime_session then return new; end if;

  perform 1
  from tge.tenants tenant
  where tenant.id = new.tenant_id
    and tenant.metadata->>'offboarding_state'
      is distinct from 'OFFBOARDED_ACCESS_REVOKED'
  for share;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'Import batch write denied.';
  end if;
  return new;
end
$function$;

create trigger import_batches_tenant_writable
before insert on tge.import_batches
for each row execute function tge.guard_import_batch_tenant_writable();

create function tge.guard_import_staging_writable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, tge
as $function$
declare
  runtime_session boolean;
  target_batch record;
begin
  runtime_session := (
    pg_catalog.pg_has_role(session_user, 'tge_runtime', 'member')
    and coalesce((
      select not rolsuper
      from pg_catalog.pg_roles
      where rolname = session_user
    ), false)
  );
  if not runtime_session then return new; end if;

  perform 1
  from tge.tenants tenant
  where tenant.id = new.tenant_id
    and tenant.metadata->>'offboarding_state'
      is distinct from 'OFFBOARDED_ACCESS_REVOKED'
  for share;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'Import staging write denied.';
  end if;

  select batch.status, batch.raw_expires_at, batch.raw_cleanup_state
  into target_batch
  from tge.import_batches batch
  where batch.tenant_id = new.tenant_id
    and batch.id = new.import_batch_id
  for share;

  if not found
    or target_batch.status not in ('STAGED', 'PREVIEWED')
    or target_batch.raw_expires_at <= clock_timestamp()
    or target_batch.raw_cleanup_state not in ('PENDING', 'FAILED') then
    raise exception using
      errcode = '23514',
      message = 'Import staging write denied.';
  end if;
  return new;
end
$function$;

create trigger import_staging_writable
before insert on tge.import_staging_records
for each row execute function tge.guard_import_staging_writable();

revoke all on function tge.guard_runtime_import_retention_clock()
  from public, tge_runtime;
revoke all on function tge.guard_import_batch_tenant_writable()
  from public, tge_runtime;
revoke all on function tge.guard_import_staging_writable()
  from public, tge_runtime;

drop policy tenant_scope on tge.import_staging_records;

create policy tenant_insert on tge.import_staging_records
  for insert
  with check (tenant_id = tge.current_tenant_id());

create policy tenant_select_unexpired on tge.import_staging_records
  for select
  using (
    tenant_id = tge.current_tenant_id()
    and exists (
      select 1
      from tge.import_batches batch
      where batch.tenant_id = import_staging_records.tenant_id
        and batch.id = import_staging_records.import_batch_id
        and batch.raw_expires_at > clock_timestamp()
        and batch.raw_cleanup_state in ('PENDING', 'FAILED')
    )
  );

-- Runtime has no direct UPDATE grant. This policy exists for the established
-- tenant-bound security-definer commit functions, whose row locks and outcome
-- writes must remain available only while raw evidence is unexpired.
create policy tenant_update_unexpired on tge.import_staging_records
  for update
  using (
    tenant_id = tge.current_tenant_id()
    and exists (
      select 1
      from tge.import_batches batch
      where batch.tenant_id = import_staging_records.tenant_id
        and batch.id = import_staging_records.import_batch_id
        and batch.raw_expires_at > clock_timestamp()
        and batch.raw_cleanup_state in ('PENDING', 'FAILED')
    )
  )
  with check (
    tenant_id = tge.current_tenant_id()
    and exists (
      select 1
      from tge.import_batches batch
      where batch.tenant_id = import_staging_records.tenant_id
        and batch.id = import_staging_records.import_batch_id
        and batch.raw_expires_at > clock_timestamp()
        and batch.raw_cleanup_state in ('PENDING', 'FAILED')
    )
  );

create policy maintenance_scope on tge.import_batches
  for all
  using (pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member'))
  with check (pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member'));

create policy maintenance_scope on tge.import_staging_records
  for all
  using (pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member'))
  with check (pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member'));

create policy maintenance_scope on tge.tenants
  for all
  using (pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member'))
  with check (pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member'));

create policy maintenance_scope on tge.tenant_memberships
  for all
  using (pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member'))
  with check (pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member'));

create policy maintenance_scope on tge.assisted_invitations
  for all
  using (pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member'))
  with check (pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member'));

create function tge.deletion_evidence_count(value jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $function$
  select jsonb_typeof(value) = 'number'
    and value::text ~ '^(0|[1-9][0-9]{0,9})$'
    and (value::text)::numeric <= 1000000000
$function$;

create function tge.deletion_evidence_facts_valid(
  kind text,
  value jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, tge
as $function$
declare
  key text;
  expected text[];
begin
  expected := case kind
    when 'RAW_IMPORT_EVIDENCE' then array[
      'raw_import_rows_scrubbed',
      'canonical_records_retained',
      'audit_events_retained',
      'external_actions_performed'
    ]
    when 'TENANT_OFFBOARDING' then array[
      'raw_import_batches_scrubbed',
      'raw_import_rows_scrubbed',
      'memberships_revoked',
      'invitations_deleted',
      'canonical_records_retained',
      'audit_events_retained',
      'pilot_evidence_events_retained',
      'external_actions_performed'
    ]
    else null
  end;
  if expected is null
    or jsonb_typeof(value) <> 'object'
    or coalesce((
      select array_agg(key_name order by key_name)
      from jsonb_object_keys(value) key_name
    ), array[]::text[]) is distinct from (
      select array_agg(required order by required)
      from unnest(expected) required
    )
    or value->'external_actions_performed' is distinct from 'false'::jsonb then
    return false;
  end if;
  foreach key in array expected loop
    if key <> 'external_actions_performed'
      and tge.deletion_evidence_count(value->key) is not true then
      return false;
    end if;
  end loop;
  return true;
end
$function$;

create table tge.data_deletion_evidence (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  evidence_type text not null check (
    evidence_type in ('RAW_IMPORT_EVIDENCE', 'TENANT_OFFBOARDING')
  ),
  status text not null check (status in ('SUCCEEDED', 'FAILED')),
  resource_reference_hash text not null check (
    resource_reference_hash ~ '^[0-9a-f]{64}$'
  ),
  attempt_number integer not null check (attempt_number > 0),
  failure_code text check (
    failure_code is null or failure_code in (
      'RAW_IMPORT_CLEANUP_FAILED', 'TENANT_OFFBOARDING_FAILED'
    )
  ),
  retryable boolean not null,
  facts jsonb not null check (
    tge.deletion_evidence_facts_valid(evidence_type, facts) is true
  ),
  occurred_at timestamptz not null,
  retain_until timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (tenant_id, id),
  unique (tenant_id, evidence_type, resource_reference_hash, attempt_number),
  foreign key (tenant_id) references tge.tenants(id)
    on update restrict on delete restrict,
  check (retain_until >= occurred_at + interval '12 months'),
  check (
    (status = 'SUCCEEDED' and failure_code is null and retryable = false)
    or (status = 'FAILED' and failure_code is not null and retryable = true)
  )
);

alter table tge.data_deletion_evidence owner to tge_owner;
alter table tge.data_deletion_evidence enable row level security;
alter table tge.data_deletion_evidence force row level security;

create policy tenant_scope on tge.data_deletion_evidence
  for select
  using (tenant_id = tge.current_tenant_id());

create policy maintenance_scope on tge.data_deletion_evidence
  for all
  using (pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member'))
  with check (pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member'));

create function tge.guard_data_deletion_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '23514', message = 'Deletion evidence is immutable.';
  end if;
  if tg_op = 'UPDATE' then
    raise exception using errcode = '23514', message = 'Deletion evidence is immutable.';
  end if;
  return new;
end
$function$;

create trigger data_deletion_evidence_immutable
before update or delete on tge.data_deletion_evidence
for each row execute function tge.guard_data_deletion_evidence();

create table tge.tenant_offboarding_requests (
  tenant_id uuid primary key,
  request_id uuid not null unique default gen_random_uuid(),
  state text not null check (
    state in ('PENDING', 'IN_PROGRESS', 'OFFBOARDED_ACCESS_REVOKED', 'FAILED')
  ),
  scope text not null check (scope = 'ACCESS_AND_RAW_EVIDENCE_ONLY'),
  requested_by_subject_hash text not null check (
    requested_by_subject_hash ~ '^[0-9a-f]{64}$'
  ),
  requested_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_attempt_at timestamptz,
  completed_at timestamptz,
  failure_code text check (
    failure_code is null or failure_code = 'TENANT_OFFBOARDING_FAILED'
  ),
  retryable boolean not null default false,
  deletion_evidence jsonb check (
    deletion_evidence is null
    or tge.deletion_evidence_facts_valid(
      'TENANT_OFFBOARDING', deletion_evidence
    ) is true
  ),
  retain_until timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  foreign key (tenant_id) references tge.tenants(id)
    on update restrict on delete restrict,
  check (retain_until >= requested_at + interval '12 months'),
  check (
    (state = 'PENDING' and attempt_count = 0 and last_attempt_at is null
      and completed_at is null and failure_code is null and retryable = false
      and deletion_evidence is null)
    or (state = 'IN_PROGRESS' and attempt_count > 0 and last_attempt_at is not null
      and completed_at is null and failure_code is null and retryable = false
      and deletion_evidence is null)
    or (state = 'OFFBOARDED_ACCESS_REVOKED' and attempt_count > 0
      and last_attempt_at is not null and completed_at is not null
      and failure_code is null and retryable = false
      and deletion_evidence is not null)
    or (state = 'FAILED' and attempt_count > 0 and last_attempt_at is not null
      and completed_at is null and failure_code = 'TENANT_OFFBOARDING_FAILED'
      and retryable = true and deletion_evidence is null)
  )
);

alter table tge.tenant_offboarding_requests owner to tge_owner;
alter table tge.tenant_offboarding_requests enable row level security;
alter table tge.tenant_offboarding_requests force row level security;

create policy tenant_scope on tge.tenant_offboarding_requests
  for select
  using (tenant_id = tge.current_tenant_id());

create policy tenant_request_insert on tge.tenant_offboarding_requests
  for insert
  with check (tenant_id = tge.current_tenant_id());

create policy maintenance_scope on tge.tenant_offboarding_requests
  for all
  using (pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member'))
  with check (pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member'));

create function tge.scrub_import_batch_internal(
  target_tenant_id uuid,
  target_batch_id text,
  cleanup_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, tge
as $function$
declare
  scrubbed_rows integer;
  canonical_count integer;
  audit_count integer;
  current_attempt integer;
  result_summary jsonb;
begin
  if not pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member')
    or coalesce((
      select rolsuper from pg_catalog.pg_roles where rolname = session_user
    ), true)
    or target_tenant_id is null
    or target_batch_id is null
    or cleanup_at is null then
    raise exception using errcode = '42501', message = 'Maintenance operation denied.';
  end if;

  perform set_config('app.tenant_id', target_tenant_id::text, true);
  perform set_config('app.subject_id', 'urn:tge:maintenance', true);

  perform 1
  from tge.tenants tenant
  where tenant.id = target_tenant_id
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'Raw cleanup target is unavailable.';
  end if;

  select raw_cleanup_attempts into current_attempt
  from tge.import_batches
  where tenant_id = target_tenant_id and id = target_batch_id
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'Raw cleanup target is unavailable.';
  end if;

  update tge.import_staging_records
  set raw_payload = null,
      conflict_details = null,
      metadata = jsonb_build_object('raw_evidence_deleted', true),
      updated_at = cleanup_at
  where tenant_id = target_tenant_id
    and import_batch_id = target_batch_id
    and (raw_payload is not null or conflict_details is not null
      or metadata is distinct from jsonb_build_object('raw_evidence_deleted', true));
  get diagnostics scrubbed_rows = row_count;

  select
    (select count(*) from tge.prospects where tenant_id = target_tenant_id)
      + (select count(*) from tge.opportunities where tenant_id = target_tenant_id)
      + (select count(*) from tge.tasks where tenant_id = target_tenant_id)
      + (select count(*) from tge.activities where tenant_id = target_tenant_id)
      + (select count(*) from tge.revenue_actions where tenant_id = target_tenant_id)
      + (select count(*) from tge.revenue_leak_cases where tenant_id = target_tenant_id),
    (select count(*) from tge.audit_events where tenant_id = target_tenant_id)
  into canonical_count, audit_count;

  result_summary := jsonb_build_object(
    'raw_import_rows_scrubbed', scrubbed_rows,
    'canonical_records_retained', canonical_count,
    'audit_events_retained', audit_count,
    'external_actions_performed', false
  );

  update tge.import_batches
  set status = case when status = 'COMMITTED' then status else 'EXPIRED' end,
      source_filename = '[deleted]',
      raw_storage_key = null,
      preview_summary = jsonb_build_object(
        'format', coalesce(preview_summary->>'format', 'CSV'),
        'sourceCollection', preview_summary->'sourceCollection',
        'rowCount', preview_summary->'rowCount',
        'columnCount', preview_summary->'columnCount',
        'rawEvidenceAvailable', false
      ),
      conflict_summary = case when conflict_summary is null then null else
        jsonb_strip_nulls(jsonb_build_object(
          'outcome', conflict_summary->'outcome',
          'summary', conflict_summary->'summary',
          'inputFingerprint', conflict_summary->'inputFingerprint',
          'requestFingerprint', conflict_summary->'requestFingerprint',
          'lifecycleStatus', conflict_summary->'lifecycleStatus'
        )) end,
      commit_metadata = case when commit_metadata is null then null else
        jsonb_strip_nulls(jsonb_build_object(
          'inputFingerprint', commit_metadata->'inputFingerprint',
          'requestFingerprint', commit_metadata->'requestFingerprint',
          'targetCollection', commit_metadata->'targetCollection',
          'pilotEvidenceFacts', commit_metadata->'pilotEvidenceFacts',
          'result', jsonb_build_object(
            'outcome', coalesce(commit_metadata#>'{result,outcome}', '"COMMITTED"'::jsonb),
            'batch', jsonb_build_object('id', id, 'status', status),
            'rows', '[]'::jsonb,
            'summary', coalesce(commit_metadata#>'{result,summary}', '{}'::jsonb),
            'reconciled', true,
            'rawEvidenceAvailable', false
          )
        )) end,
      raw_cleanup_state = 'SUCCEEDED',
      raw_cleanup_completed_at = cleanup_at,
      raw_cleanup_failure_code = null,
      raw_cleanup_retryable = false,
      updated_at = cleanup_at
  where tenant_id = target_tenant_id and id = target_batch_id;

  insert into tge.data_deletion_evidence (
    tenant_id, evidence_type, status, resource_reference_hash,
    attempt_number, failure_code, retryable, facts, occurred_at,
    retain_until, created_at
  ) values (
    target_tenant_id,
    'RAW_IMPORT_EVIDENCE',
    'SUCCEEDED',
    encode(sha256(convert_to(target_tenant_id::text || ':' || target_batch_id, 'UTF8')), 'hex'),
    current_attempt,
    null,
    false,
    result_summary,
    cleanup_at,
    cleanup_at + interval '12 months',
    cleanup_at
  );
  return result_summary;
end
$function$;

create function tge.process_due_raw_import_cleanup(requested_limit integer)
returns table (
  batch_id text,
  cleanup_state text,
  retryable boolean,
  attempt_count integer,
  failure_code text
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, tge
as $function$
declare
  candidate record;
  attempted_at timestamptz;
  failed_facts jsonb;
  retained_canonical_count integer;
  retained_audit_count integer;
  candidate_tenant_id uuid;
  processed_count integer := 0;
begin
  if not pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member')
    or coalesce((
      select rolsuper from pg_catalog.pg_roles where rolname = session_user
    ), true)
    or requested_limit is null or requested_limit < 1 or requested_limit > 100 then
    raise exception using errcode = '42501', message = 'Maintenance operation denied.';
  end if;

  while processed_count < requested_limit loop
    select tenant.id
    into candidate_tenant_id
    from tge.tenants tenant
    where exists (
      select 1
      from tge.import_batches due_batch
      where due_batch.tenant_id = tenant.id
        and due_batch.raw_expires_at <= clock_timestamp()
        and due_batch.raw_cleanup_state in ('PENDING', 'FAILED')
    )
    order by (
      select min(due_batch.raw_expires_at)
      from tge.import_batches due_batch
      where due_batch.tenant_id = tenant.id
        and due_batch.raw_expires_at <= clock_timestamp()
        and due_batch.raw_cleanup_state in ('PENDING', 'FAILED')
    ), tenant.id
    for update of tenant skip locked
    limit 1;
    exit when not found;

    select batch.tenant_id, batch.id
    into candidate
    from tge.import_batches batch
    where batch.tenant_id = candidate_tenant_id
      and batch.raw_expires_at <= clock_timestamp()
      and batch.raw_cleanup_state in ('PENDING', 'FAILED')
    order by batch.raw_expires_at, batch.id
    for update skip locked
    limit 1;
    exit when not found;
    processed_count := processed_count + 1;

    attempted_at := clock_timestamp();
    perform set_config('app.tenant_id', candidate.tenant_id::text, true);
    update tge.import_batches
    set raw_cleanup_state = 'IN_PROGRESS',
        raw_cleanup_attempts = raw_cleanup_attempts + 1,
        raw_cleanup_started_at = attempted_at,
        raw_cleanup_completed_at = null,
        raw_cleanup_failure_code = null,
        raw_cleanup_retryable = false,
        updated_at = attempted_at
    where tenant_id = candidate.tenant_id and id = candidate.id;

    begin
      perform tge.scrub_import_batch_internal(
        candidate.tenant_id, candidate.id, attempted_at
      );
    exception when others then
      select
        (select count(*) from tge.prospects where tenant_id = candidate.tenant_id)
          + (select count(*) from tge.opportunities where tenant_id = candidate.tenant_id)
          + (select count(*) from tge.tasks where tenant_id = candidate.tenant_id)
          + (select count(*) from tge.activities where tenant_id = candidate.tenant_id)
          + (select count(*) from tge.revenue_actions where tenant_id = candidate.tenant_id)
          + (select count(*) from tge.revenue_leak_cases where tenant_id = candidate.tenant_id),
        (select count(*) from tge.audit_events where tenant_id = candidate.tenant_id)
      into retained_canonical_count, retained_audit_count;
      failed_facts := jsonb_build_object(
        'raw_import_rows_scrubbed', 0,
        'canonical_records_retained', retained_canonical_count,
        'audit_events_retained', retained_audit_count,
        'external_actions_performed', false
      );
      update tge.import_batches
      set raw_cleanup_state = 'FAILED',
          raw_cleanup_completed_at = null,
          raw_cleanup_failure_code = 'RAW_IMPORT_CLEANUP_FAILED',
          raw_cleanup_retryable = true,
          updated_at = clock_timestamp()
      where tenant_id = candidate.tenant_id and id = candidate.id;
      insert into tge.data_deletion_evidence (
        tenant_id, evidence_type, status, resource_reference_hash,
        attempt_number, failure_code, retryable, facts, occurred_at,
        retain_until, created_at
      ) select
        candidate.tenant_id,
        'RAW_IMPORT_EVIDENCE',
        'FAILED',
        encode(sha256(convert_to(candidate.tenant_id::text || ':' || candidate.id, 'UTF8')), 'hex'),
        batch.raw_cleanup_attempts,
        'RAW_IMPORT_CLEANUP_FAILED',
        true,
        failed_facts,
        attempted_at,
        attempted_at + interval '12 months',
        attempted_at
      from tge.import_batches batch
      where batch.tenant_id = candidate.tenant_id and batch.id = candidate.id;
    end;

    select batch.id, batch.raw_cleanup_state, batch.raw_cleanup_retryable,
      batch.raw_cleanup_attempts, batch.raw_cleanup_failure_code
    into batch_id, cleanup_state, retryable, attempt_count, failure_code
    from tge.import_batches batch
    where batch.tenant_id = candidate.tenant_id and batch.id = candidate.id;
    return next;
  end loop;
end
$function$;

create function tge.request_tenant_offboarding(requested_confirmation text)
returns table (
  request_id uuid,
  state text,
  scope text,
  retryable boolean,
  requested_at timestamptz,
  completed_at timestamptz,
  deletion_evidence jsonb
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, tge
as $function$
declare
  authoritative_tenant uuid := tge.current_tenant_id();
  authoritative_subject text := tge.current_subject_id();
  authoritative_issuer text := tge.current_identity_issuer();
  authoritative_at timestamptz := clock_timestamp();
begin
  if requested_confirmation is distinct from 'OFFBOARD_ACCESS_AND_RAW_EVIDENCE'
    or authoritative_tenant is null
    or coalesce(btrim(authoritative_subject), '') = ''
    or coalesce(btrim(authoritative_issuer), '') = ''
    or not pg_catalog.pg_has_role(session_user, 'tge_runtime', 'member')
    or coalesce((
      select roles.rolsuper from pg_catalog.pg_roles roles
      where roles.rolname = session_user
    ), true)
    or not exists (
      select 1
      from tge.tenant_memberships membership
      where membership.tenant_id = authoritative_tenant
        and membership.identity_issuer = authoritative_issuer
        and membership.subject_id = authoritative_subject
        and membership.role = 'OWNER'
        and membership.status = 'ACTIVE'
    ) then
    raise exception using
      errcode = '42501',
      message = 'Tenant offboarding request denied.';
  end if;

  insert into tge.tenant_offboarding_requests (
    tenant_id, state, scope, requested_by_subject_hash, requested_at,
    retain_until, created_at, updated_at
  ) values (
    authoritative_tenant,
    'PENDING',
    'ACCESS_AND_RAW_EVIDENCE_ONLY',
    encode(sha256(convert_to(authoritative_issuer || ':' || authoritative_subject, 'UTF8')), 'hex'),
    authoritative_at,
    authoritative_at + interval '12 months',
    authoritative_at,
    authoritative_at
  ) on conflict (tenant_id) do nothing;

  return query
  select request.request_id, request.state, request.scope, request.retryable,
    request.requested_at, request.completed_at, request.deletion_evidence
  from tge.tenant_offboarding_requests request
  where request.tenant_id = authoritative_tenant;
end
$function$;

create function tge.process_pending_tenant_offboarding(requested_limit integer)
returns table (
  request_id uuid,
  state text,
  scope text,
  retryable boolean,
  failure_code text
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, tge
as $function$
declare
  candidate record;
  attempted_at timestamptz;
  completed timestamp with time zone;
  import_batch record;
  scrub_summary jsonb;
  facts jsonb;
  raw_batch_count integer;
  raw_row_count integer;
  membership_count integer;
  invitation_count integer;
  canonical_count integer;
  audit_count integer;
  pilot_count integer;
begin
  if not pg_catalog.pg_has_role(session_user, 'tge_maintenance', 'member')
    or coalesce((
      select rolsuper from pg_catalog.pg_roles where rolname = session_user
    ), true)
    or requested_limit is null or requested_limit < 1 or requested_limit > 100 then
    raise exception using errcode = '42501', message = 'Maintenance operation denied.';
  end if;

  for candidate in
    select request.tenant_id, request.request_id
    from tge.tenant_offboarding_requests request
    where request.state in ('PENDING', 'FAILED')
      and (request.state = 'PENDING' or request.retryable = true)
    order by request.requested_at, request.tenant_id
    for update skip locked
    limit requested_limit
  loop
    attempted_at := clock_timestamp();
    perform set_config('app.tenant_id', candidate.tenant_id::text, true);
    perform set_config('app.subject_id', 'urn:tge:maintenance', true);
    update tge.tenant_offboarding_requests request
    set state = 'IN_PROGRESS',
        attempt_count = attempt_count + 1,
        last_attempt_at = attempted_at,
        completed_at = null,
        failure_code = null,
        retryable = false,
        deletion_evidence = null,
        updated_at = attempted_at
    where request.tenant_id = candidate.tenant_id;

    begin
      perform 1
      from tge.tenants tenant
      where tenant.id = candidate.tenant_id
      for update;
      if not found then
        raise exception using
          errcode = '23514',
          message = 'Tenant offboarding target is unavailable.';
      end if;

      raw_batch_count := 0;
      raw_row_count := 0;
      for import_batch in
        select batch.id
        from tge.import_batches batch
        where batch.tenant_id = candidate.tenant_id
          and batch.raw_cleanup_state <> 'SUCCEEDED'
        order by batch.created_at, batch.id
        for update
      loop
        update tge.import_batches batch
        set raw_cleanup_state = 'IN_PROGRESS',
            raw_cleanup_attempts = raw_cleanup_attempts + 1,
            raw_cleanup_started_at = attempted_at,
            raw_cleanup_completed_at = null,
            raw_cleanup_failure_code = null,
            raw_cleanup_retryable = false,
            updated_at = attempted_at
        where batch.tenant_id = candidate.tenant_id
          and batch.id = import_batch.id;
        scrub_summary := tge.scrub_import_batch_internal(
          candidate.tenant_id, import_batch.id, attempted_at
        );
        raw_batch_count := raw_batch_count + 1;
        raw_row_count := raw_row_count
          + coalesce((scrub_summary->>'raw_import_rows_scrubbed')::integer, 0);
      end loop;

      select
        (select count(*) from tge.prospects where tenant_id = candidate.tenant_id)
          + (select count(*) from tge.opportunities where tenant_id = candidate.tenant_id)
          + (select count(*) from tge.tasks where tenant_id = candidate.tenant_id)
          + (select count(*) from tge.activities where tenant_id = candidate.tenant_id)
          + (select count(*) from tge.revenue_actions where tenant_id = candidate.tenant_id)
          + (select count(*) from tge.revenue_leak_cases where tenant_id = candidate.tenant_id),
        (select count(*) from tge.audit_events where tenant_id = candidate.tenant_id),
        (select count(*) from tge.pilot_evidence_events where tenant_id = candidate.tenant_id)
      into canonical_count, audit_count, pilot_count;

      delete from tge.assisted_invitations invitation
      where invitation.tenant_id = candidate.tenant_id;
      get diagnostics invitation_count = row_count;
      delete from tge.tenant_memberships membership
      where membership.tenant_id = candidate.tenant_id;
      get diagnostics membership_count = row_count;

      update tge.tenants tenant
      set slug = 'offboarded-' || tenant.id::text,
          name = 'Offboarded tenant',
          metadata = tenant.metadata || jsonb_build_object(
            'offboarding_state', 'OFFBOARDED_ACCESS_REVOKED'
          ),
          updated_at = attempted_at
      where tenant.id = candidate.tenant_id;

      facts := jsonb_build_object(
        'raw_import_batches_scrubbed', raw_batch_count,
        'raw_import_rows_scrubbed', raw_row_count,
        'memberships_revoked', membership_count,
        'invitations_deleted', invitation_count,
        'canonical_records_retained', canonical_count,
        'audit_events_retained', audit_count,
        'pilot_evidence_events_retained', pilot_count,
        'external_actions_performed', false
      );
      completed := clock_timestamp();
      update tge.tenant_offboarding_requests request
      set state = 'OFFBOARDED_ACCESS_REVOKED',
          completed_at = completed,
          failure_code = null,
          retryable = false,
          deletion_evidence = facts,
          updated_at = completed
      where request.tenant_id = candidate.tenant_id;

      insert into tge.data_deletion_evidence (
        tenant_id, evidence_type, status, resource_reference_hash,
        attempt_number, failure_code, retryable, facts, occurred_at,
        retain_until, created_at
      ) select
        request.tenant_id,
        'TENANT_OFFBOARDING',
        'SUCCEEDED',
        encode(sha256(convert_to(request.tenant_id::text || ':' || request.request_id::text, 'UTF8')), 'hex'),
        request.attempt_count,
        null,
        false,
        facts,
        completed,
        completed + interval '12 months',
        completed
      from tge.tenant_offboarding_requests request
      where request.tenant_id = candidate.tenant_id;
    exception when others then
      select
        (select count(*) from tge.prospects where tenant_id = candidate.tenant_id)
          + (select count(*) from tge.opportunities where tenant_id = candidate.tenant_id)
          + (select count(*) from tge.tasks where tenant_id = candidate.tenant_id)
          + (select count(*) from tge.activities where tenant_id = candidate.tenant_id)
          + (select count(*) from tge.revenue_actions where tenant_id = candidate.tenant_id)
          + (select count(*) from tge.revenue_leak_cases where tenant_id = candidate.tenant_id),
        (select count(*) from tge.audit_events where tenant_id = candidate.tenant_id),
        (select count(*) from tge.pilot_evidence_events where tenant_id = candidate.tenant_id)
      into canonical_count, audit_count, pilot_count;
      facts := jsonb_build_object(
        'raw_import_batches_scrubbed', 0,
        'raw_import_rows_scrubbed', 0,
        'memberships_revoked', 0,
        'invitations_deleted', 0,
        'canonical_records_retained', canonical_count,
        'audit_events_retained', audit_count,
        'pilot_evidence_events_retained', pilot_count,
        'external_actions_performed', false
      );
      update tge.tenant_offboarding_requests request
      set state = 'FAILED',
          completed_at = null,
          failure_code = 'TENANT_OFFBOARDING_FAILED',
          retryable = true,
          deletion_evidence = null,
          updated_at = clock_timestamp()
      where request.tenant_id = candidate.tenant_id;

      insert into tge.data_deletion_evidence (
        tenant_id, evidence_type, status, resource_reference_hash,
        attempt_number, failure_code, retryable, facts, occurred_at,
        retain_until, created_at
      ) select
        request.tenant_id,
        'TENANT_OFFBOARDING',
        'FAILED',
        encode(sha256(convert_to(request.tenant_id::text || ':' || request.request_id::text, 'UTF8')), 'hex'),
        request.attempt_count,
        'TENANT_OFFBOARDING_FAILED',
        true,
        facts,
        attempted_at,
        attempted_at + interval '12 months',
        attempted_at
      from tge.tenant_offboarding_requests request
      where request.tenant_id = candidate.tenant_id;
    end;

    select request.request_id, request.state, request.scope,
      request.retryable, request.failure_code
    into request_id, state, scope, retryable, failure_code
    from tge.tenant_offboarding_requests request
    where request.tenant_id = candidate.tenant_id;
    return next;
  end loop;
end
$function$;

create or replace function tge.lock_import_commit_batch(
  requested_tenant_id uuid,
  requested_batch_id text
)
returns setof tge.import_batches
language plpgsql
volatile
security definer
set search_path = pg_catalog, tge
as $function$
begin
  if requested_tenant_id is null
    or requested_tenant_id is distinct from tge.current_tenant_id()
    or requested_batch_id is null
    or btrim(requested_batch_id) = '' then
    return;
  end if;

  perform 1
  from tge.tenants tenant
  where tenant.id = requested_tenant_id
    and tenant.metadata->>'offboarding_state'
      is distinct from 'OFFBOARDED_ACCESS_REVOKED'
  for share;
  if not found then return; end if;

  return query
  select batch.*
  from tge.import_batches batch
  where batch.tenant_id = requested_tenant_id
    and batch.id = requested_batch_id
    and batch.raw_expires_at > clock_timestamp()
    and batch.raw_cleanup_state in ('PENDING', 'FAILED')
  for update;
end
$function$;

create function tge.lock_current_tenant_access_writable()
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog, tge
as $function$
declare
  authoritative_tenant uuid := tge.current_tenant_id();
  authoritative_subject text := tge.current_subject_id();
  authoritative_issuer text := tge.current_identity_issuer();
begin
  if authoritative_tenant is null
    or coalesce(btrim(authoritative_subject), '') = ''
    or coalesce(btrim(authoritative_issuer), '') = ''
    or not pg_catalog.pg_has_role(session_user, 'tge_runtime', 'member')
    or coalesce((
      select roles.rolsuper from pg_catalog.pg_roles roles
      where roles.rolname = session_user
    ), true) then
    return false;
  end if;

  if not exists (
    select 1
    from tge.tenant_memberships membership
    where membership.tenant_id = authoritative_tenant
      and membership.identity_issuer = authoritative_issuer
      and membership.subject_id = authoritative_subject
      and membership.role = 'OWNER'
      and membership.status = 'ACTIVE'
  ) then
    return false;
  end if;

  perform 1
  from tge.tenants tenant
  where tenant.id = authoritative_tenant
    and tenant.metadata->>'offboarding_state'
      is distinct from 'OFFBOARDED_ACCESS_REVOKED'
  for share;
  return found;
end
$function$;

create function tge.guard_runtime_assisted_invitation_insert()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, tge
as $function$
declare
  runtime_session boolean;
begin
  runtime_session := (
    pg_catalog.pg_has_role(session_user, 'tge_runtime', 'member')
    and coalesce((
      select not roles.rolsuper
      from pg_catalog.pg_roles roles
      where roles.rolname = session_user
    ), false)
  );
  if not runtime_session then return new; end if;

  if new.tenant_id is distinct from tge.current_tenant_id()
    or new.created_by_subject_id is distinct from tge.current_subject_id()
    or not tge.lock_current_tenant_access_writable() then
    raise exception using
      errcode = '23514',
      message = 'Invitation write denied.';
  end if;
  return new;
end
$function$;

create trigger assisted_invitations_runtime_insert_guard
before insert on tge.assisted_invitations
for each row execute function tge.guard_runtime_assisted_invitation_insert();

revoke all on function tge.guard_runtime_assisted_invitation_insert()
  from public, tge_runtime, tge_migrator, tge_maintenance;

create or replace function tge.consume_assisted_invitation(
  requested_token_hash text,
  requested_identity_issuer text,
  requested_subject_id text,
  membership_audit_id text,
  invitation_audit_id text
)
returns table (
  resolved_tenant_id uuid,
  resolved_role text
)
language plpgsql
volatile
security definer
set search_path = pg_catalog, tge
as $function$
declare
  invitation tge.assisted_invitations%rowtype;
  existing_membership tge.tenant_memberships%rowtype;
  membership_count integer;
  requested_at timestamptz := clock_timestamp();
begin
  if requested_token_hash is null
    or requested_token_hash !~ '^[0-9a-f]{64}$'
    or requested_identity_issuer is null
    or btrim(requested_identity_issuer) = ''
    or requested_subject_id is null
    or btrim(requested_subject_id) = ''
    or membership_audit_id is null
    or btrim(membership_audit_id) = ''
    or invitation_audit_id is null
    or btrim(invitation_audit_id) = '' then
    return;
  end if;

  perform set_config('app.tenant_id', '', true);
  perform set_config('app.identity_issuer', requested_identity_issuer, true);
  perform set_config('app.subject_id', requested_subject_id, true);
  perform set_config('app.invitation_token_hash', requested_token_hash, true);

  select candidate.*
  into invitation
  from tge.assisted_invitations candidate
  where candidate.token_hash = requested_token_hash
    and candidate.status = 'PENDING'
    and candidate.expires_at > requested_at
    and candidate.expected_identity_issuer = requested_identity_issuer
    and candidate.expected_subject_id = requested_subject_id;

  if not found then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array(requested_identity_issuer, requested_subject_id)::text,
      544745
    )
  );

  perform set_config('app.tenant_id', invitation.tenant_id::text, true);

  perform 1
  from tge.tenants tenant
  where tenant.id = invitation.tenant_id
    and tenant.metadata->>'offboarding_state'
      is distinct from 'OFFBOARDED_ACCESS_REVOKED'
  for share;
  if not found then
    return;
  end if;

  select candidate.*
  into invitation
  from tge.assisted_invitations candidate
  where candidate.tenant_id = invitation.tenant_id
    and candidate.id = invitation.id
    and candidate.token_hash = requested_token_hash
    and candidate.status = 'PENDING'
    and candidate.expires_at > requested_at
    and candidate.expected_identity_issuer = requested_identity_issuer
    and candidate.expected_subject_id = requested_subject_id
  for update;

  if not found then
    return;
  end if;

  perform set_config('app.tenant_id', '', true);

  select count(*)::integer
  into membership_count
  from tge.tenant_memberships membership
  where membership.identity_issuer = requested_identity_issuer
    and membership.subject_id = requested_subject_id;

  if membership_count > 1 then
    return;
  end if;

  select membership.*
  into existing_membership
  from tge.tenant_memberships membership
  where membership.identity_issuer = requested_identity_issuer
    and membership.subject_id = requested_subject_id
  limit 1;

  if found and (
    existing_membership.status <> 'ACTIVE'
    or existing_membership.tenant_id <> invitation.tenant_id
    or existing_membership.role <> invitation.intended_role
  ) then
    return;
  end if;

  perform set_config('app.tenant_id', invitation.tenant_id::text, true);

  if existing_membership.tenant_id is null then
    insert into tge.tenant_memberships (
      tenant_id,
      identity_issuer,
      subject_id,
      role,
      status,
      created_at,
      updated_at
    ) values (
      invitation.tenant_id,
      requested_identity_issuer,
      requested_subject_id,
      invitation.intended_role,
      'ACTIVE',
      requested_at,
      requested_at
    );

    insert into tge.audit_events (
      tenant_id,
      id,
      event_type,
      subject_id,
      entity_type,
      entity_id,
      payload,
      occurred_at,
      retain_until
    ) values (
      invitation.tenant_id,
      membership_audit_id,
      'MEMBERSHIP_ACTIVATED',
      requested_subject_id,
      'TENANT_MEMBERSHIP',
      requested_subject_id,
      jsonb_build_object(
        'identity_issuer', requested_identity_issuer,
        'role', invitation.intended_role,
        'invitation_id', invitation.id
      ),
      requested_at,
      requested_at + interval '12 months'
    );
  end if;

  update tge.assisted_invitations
  set
    status = 'CONSUMED',
    consumed_by_identity_issuer = requested_identity_issuer,
    consumed_by_subject_id = requested_subject_id,
    consumed_at = requested_at,
    updated_at = requested_at
  where tenant_id = invitation.tenant_id
    and id = invitation.id
    and status = 'PENDING';

  if not found then
    return;
  end if;

  insert into tge.audit_events (
    tenant_id,
    id,
    event_type,
    subject_id,
    entity_type,
    entity_id,
    payload,
    occurred_at,
    retain_until
  ) values (
    invitation.tenant_id,
    invitation_audit_id,
    'INVITATION_CONSUMED',
    requested_subject_id,
    'ASSISTED_INVITATION',
    invitation.id::text,
    jsonb_build_object('role', invitation.intended_role),
    requested_at,
    requested_at + interval '12 months'
  );

  return query select invitation.tenant_id, invitation.intended_role;
end
$function$;

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
    '015'::text as schema_version,
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

revoke all on tge.data_deletion_evidence from public, tge_runtime;
revoke all on tge.tenant_offboarding_requests from public;
grant select on tge.tenant_offboarding_requests to tge_runtime;

revoke all on all tables in schema tge from tge_maintenance;
revoke all on all sequences in schema tge from tge_maintenance;
revoke all on all functions in schema tge from tge_maintenance;
grant usage on schema tge to tge_maintenance;
revoke all on function tge.deletion_evidence_count(jsonb)
  from public, tge_runtime, tge_migrator, tge_maintenance;
revoke all on function tge.deletion_evidence_facts_valid(text, jsonb)
  from public, tge_runtime, tge_migrator, tge_maintenance;
revoke all on function tge.guard_data_deletion_evidence()
  from public, tge_runtime, tge_migrator, tge_maintenance;
revoke all on function tge.scrub_import_batch_internal(uuid, text, timestamptz)
  from public, tge_runtime, tge_migrator, tge_maintenance;
revoke all on function tge.process_due_raw_import_cleanup(integer)
  from public, tge_runtime, tge_migrator, tge_maintenance;
revoke all on function tge.process_pending_tenant_offboarding(integer)
  from public, tge_runtime, tge_migrator, tge_maintenance;
revoke all on function tge.request_tenant_offboarding(text) from public;
revoke all on function tge.lock_current_tenant_access_writable() from public;

grant execute on function tge.process_due_raw_import_cleanup(integer)
  to tge_maintenance;
grant execute on function tge.process_pending_tenant_offboarding(integer)
  to tge_maintenance;
grant execute on function tge.request_tenant_offboarding(text) to tge_runtime;
grant execute on function tge.lock_current_tenant_access_writable() to tge_runtime;
grant execute on function tge.pilot_runtime_readiness() to tge_runtime;

revoke execute on all functions in schema tge from public;
