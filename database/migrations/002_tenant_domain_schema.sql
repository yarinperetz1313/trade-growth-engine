do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tge_owner') then
    create role tge_owner nologin noinherit nosuperuser nocreatedb nocreaterole
      noreplication nobypassrls;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'tge_migrator') then
    create role tge_migrator nologin noinherit nosuperuser nocreatedb nocreaterole
      noreplication nobypassrls;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'tge_runtime') then
    create role tge_runtime nologin inherit nosuperuser nocreatedb nocreaterole
      noreplication nobypassrls;
  end if;
end
$$;

alter role tge_owner nologin noinherit nosuperuser nocreatedb nocreaterole
  noreplication nobypassrls;
alter role tge_migrator nologin noinherit nosuperuser nocreatedb nocreaterole
  noreplication nobypassrls;
alter role tge_runtime nologin inherit nosuperuser nocreatedb nocreaterole
  noreplication nobypassrls;

grant tge_owner to tge_migrator;

do $$
begin
  if session_user <> 'tge_migrator'
    and not pg_has_role(session_user, 'tge_migrator', 'MEMBER') then
    execute format('grant tge_migrator to %I', session_user);
  end if;
end
$$;

revoke all on schema public from public;
revoke all on all tables in schema public from public;
revoke all on all sequences in schema public from public;
revoke all on all functions in schema public from public;
revoke all on schema public from tge_owner, tge_migrator, tge_runtime;
revoke all on all tables in schema public from tge_owner, tge_migrator, tge_runtime;
revoke all on all sequences in schema public from tge_owner, tge_migrator, tge_runtime;
revoke all on all functions in schema public from tge_owner, tge_migrator, tge_runtime;

alter default privileges in schema public revoke all on tables from public;
alter default privileges in schema public revoke all on sequences from public;
alter default privileges in schema public revoke all on functions from public;

revoke all on schema tge_migration from public, tge_runtime;
revoke all on all tables in schema tge_migration from public, tge_runtime;
grant usage, create on schema tge_migration to tge_migrator;
alter schema tge_migration owner to tge_migrator;
alter table tge_migration.schema_migrations owner to tge_migrator;

set local role tge_owner;

create schema if not exists tge authorization tge_owner;
revoke all on schema tge from public;

alter default privileges in schema tge revoke all on tables from public;
alter default privileges in schema tge revoke all on sequences from public;
alter default privileges in schema tge revoke all on functions from public;

create table tge.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (btrim(slug) <> ''),
  name text not null check (btrim(name) <> ''),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tge.tenant_memberships (
  tenant_id uuid not null,
  subject_id text not null check (btrim(subject_id) <> ''),
  role text not null check (role in ('OWNER', 'ADMIN', 'MEMBER')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, subject_id),
  foreign key (tenant_id) references tge.tenants(id)
    on update restrict on delete restrict
);

create index tenant_memberships_subject_idx
  on tge.tenant_memberships(subject_id, tenant_id);

create table tge.prospects (
  tenant_id uuid not null,
  id text not null check (btrim(id) <> ''),
  business_name text not null check (btrim(business_name) <> ''),
  website text,
  email text,
  phone text,
  service text,
  location text,
  source text,
  source_url text,
  dedupe_key text,
  qualification_score numeric,
  qualification_status text,
  evidence jsonb not null default '[]'::jsonb
    check (jsonb_typeof(evidence) = 'array'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  legacy_payload jsonb check (
    legacy_payload is null or jsonb_typeof(legacy_payload) = 'object'
  ),
  source_ordinal bigint check (source_ordinal is null or source_ordinal >= 0),
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id) references tge.tenants(id)
    on update restrict on delete restrict,
  unique (tenant_id, dedupe_key)
);

create unique index prospects_source_ordinal_uidx
  on tge.prospects(tenant_id, source_ordinal)
  where source_ordinal is not null;
create index prospects_business_name_idx
  on tge.prospects(tenant_id, business_name);
create index prospects_location_idx
  on tge.prospects(tenant_id, location);

create table tge.opportunities (
  tenant_id uuid not null,
  id text not null check (btrim(id) <> ''),
  prospect_id text,
  business_name text not null check (btrim(business_name) <> ''),
  stage text not null check (btrim(stage) <> ''),
  priority text,
  qualification_score numeric,
  commercial_value numeric,
  commercial_value_state text not null check (
    commercial_value_state in (
      'KNOWN', 'ZERO', 'NULL', 'MISSING', 'BLANK',
      'UNKNOWN_LITERAL', 'NON_NUMERIC'
    )
  ),
  commercial_value_raw jsonb,
  probability numeric check (
    probability is null or probability between 0 and 1
  ),
  weighted_value numeric,
  next_action text,
  contact_name text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  legacy_payload jsonb check (
    legacy_payload is null or jsonb_typeof(legacy_payload) = 'object'
  ),
  source_ordinal bigint check (source_ordinal is null or source_ordinal >= 0),
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id) references tge.tenants(id)
    on update restrict on delete restrict,
  foreign key (tenant_id, prospect_id) references tge.prospects(tenant_id, id)
    on update restrict on delete restrict,
  check (
    (commercial_value_state = 'KNOWN'
      and commercial_value > 0
      and jsonb_typeof(commercial_value_raw) = 'number')
    or (commercial_value_state = 'ZERO'
      and commercial_value = 0
      and jsonb_typeof(commercial_value_raw) = 'number')
    or (commercial_value_state = 'NULL'
      and commercial_value is null
      and commercial_value_raw = 'null'::jsonb)
    or (commercial_value_state = 'MISSING'
      and commercial_value is null
      and commercial_value_raw is null)
    or (commercial_value_state in ('BLANK', 'UNKNOWN_LITERAL', 'NON_NUMERIC')
      and commercial_value is null
      and jsonb_typeof(commercial_value_raw) = 'string')
  )
);

create unique index opportunities_source_ordinal_uidx
  on tge.opportunities(tenant_id, source_ordinal)
  where source_ordinal is not null;
create index opportunities_stage_idx
  on tge.opportunities(tenant_id, stage);
create index opportunities_prospect_idx
  on tge.opportunities(tenant_id, prospect_id);

create table tge.tasks (
  tenant_id uuid not null,
  id text not null check (btrim(id) <> ''),
  opportunity_id text not null,
  revenue_action_id text,
  title text not null check (btrim(title) <> ''),
  description text,
  due_at timestamptz,
  priority text,
  status text not null check (status in ('OPEN', 'COMPLETED', 'CANCELLED')),
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  legacy_payload jsonb check (
    legacy_payload is null or jsonb_typeof(legacy_payload) = 'object'
  ),
  source_ordinal bigint check (source_ordinal is null or source_ordinal >= 0),
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id) references tge.tenants(id)
    on update restrict on delete restrict,
  foreign key (tenant_id, opportunity_id)
    references tge.opportunities(tenant_id, id)
    on update restrict on delete restrict,
  unique (tenant_id, revenue_action_id),
  unique (tenant_id, id, opportunity_id, revenue_action_id),
  check (
    (status = 'COMPLETED' and completed_at is not null)
    or (status <> 'COMPLETED')
  )
);

create unique index tasks_source_ordinal_uidx
  on tge.tasks(tenant_id, source_ordinal)
  where source_ordinal is not null;
create index tasks_opportunity_order_idx
  on tge.tasks(
    tenant_id,
    opportunity_id,
    source_created_at desc,
    source_ordinal desc
  );
create index tasks_open_idx
  on tge.tasks(tenant_id, opportunity_id, status)
  where status = 'OPEN';

create table tge.activities (
  tenant_id uuid not null,
  id text not null check (btrim(id) <> ''),
  opportunity_id text not null,
  prospect_id text,
  revenue_action_id text,
  type text not null check (btrim(type) <> ''),
  description text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  legacy_payload jsonb check (
    legacy_payload is null or jsonb_typeof(legacy_payload) = 'object'
  ),
  source_ordinal bigint check (source_ordinal is null or source_ordinal >= 0),
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id) references tge.tenants(id)
    on update restrict on delete restrict,
  foreign key (tenant_id, opportunity_id)
    references tge.opportunities(tenant_id, id)
    on update restrict on delete restrict,
  foreign key (tenant_id, prospect_id)
    references tge.prospects(tenant_id, id)
    on update restrict on delete restrict,
  unique (tenant_id, revenue_action_id),
  unique (tenant_id, id, opportunity_id, revenue_action_id)
);

create unique index activities_source_ordinal_uidx
  on tge.activities(tenant_id, source_ordinal)
  where source_ordinal is not null;
create index activities_opportunity_order_idx
  on tge.activities(
    tenant_id,
    opportunity_id,
    source_created_at desc,
    source_ordinal desc
  );

create table tge.revenue_actions (
  tenant_id uuid not null,
  id text not null check (btrim(id) <> ''),
  opportunity_id text not null,
  action_type text not null check (btrim(action_type) <> ''),
  execution_type text not null check (
    execution_type in ('COMMUNICATION_DRAFT', 'INTERNAL_TASK')
  ),
  approval_requirement text not null check (approval_requirement = 'HUMAN'),
  risk_class text not null check (
    risk_class in ('INTERNAL', 'EXTERNAL_CONSEQUENTIAL')
  ),
  status text not null check (
    status in (
      'RECOMMENDED', 'PREPARED', 'APPROVED', 'EXECUTING', 'EXECUTED',
      'REJECTED', 'CANCELLED', 'FAILED'
    )
  ),
  priority text,
  title text not null check (btrim(title) <> ''),
  reason text not null,
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  recommendation_snapshot jsonb not null
    check (jsonb_typeof(recommendation_snapshot) = 'object'),
  basis_fingerprint text not null
    check (basis_fingerprint ~ '^[0-9a-f]{64}$'),
  proposed_execution jsonb check (
    proposed_execution is null or jsonb_typeof(proposed_execution) = 'object'
  ),
  execution_request jsonb check (
    execution_request is null or jsonb_typeof(execution_request) = 'object'
  ),
  execution_result jsonb check (
    execution_result is null or jsonb_typeof(execution_result) = 'object'
  ),
  source text not null check (btrim(source) <> ''),
  audit jsonb not null default '[]'::jsonb
    check (jsonb_typeof(audit) = 'array'),
  execution_attempts integer not null default 0 check (execution_attempts >= 0),
  prepared_at timestamptz,
  approved_at timestamptz,
  executed_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  rejection_reason text,
  resulting_task_id text,
  resulting_activity_id text,
  legacy_payload jsonb check (
    legacy_payload is null or jsonb_typeof(legacy_payload) = 'object'
  ),
  source_ordinal bigint check (source_ordinal is null or source_ordinal >= 0),
  source_created_at timestamptz,
  source_updated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id) references tge.tenants(id)
    on update restrict on delete restrict,
  foreign key (tenant_id, opportunity_id)
    references tge.opportunities(tenant_id, id)
    on update restrict on delete restrict,
  unique (tenant_id, id, opportunity_id, resulting_task_id),
  unique (tenant_id, id, opportunity_id, resulting_activity_id),
  foreign key (tenant_id, resulting_task_id, opportunity_id, id)
    references tge.tasks(tenant_id, id, opportunity_id, revenue_action_id)
    on update restrict on delete restrict
    deferrable initially deferred,
  foreign key (tenant_id, resulting_activity_id, opportunity_id, id)
    references tge.activities(tenant_id, id, opportunity_id, revenue_action_id)
    on update restrict on delete restrict
    deferrable initially deferred,
  check (
    (status = 'RECOMMENDED')
    or (status = 'PREPARED' and prepared_at is not null)
    or (status in ('APPROVED', 'EXECUTING')
      and prepared_at is not null and approved_at is not null)
    or (status = 'EXECUTED'
      and approved_at is not null and executed_at is not null)
    or (status = 'REJECTED' and rejected_at is not null)
    or (status = 'CANCELLED' and cancelled_at is not null)
    or (status = 'FAILED' and approved_at is not null and failed_at is not null)
  )
);

create unique index revenue_actions_source_ordinal_uidx
  on tge.revenue_actions(tenant_id, source_ordinal)
  where source_ordinal is not null;
create unique index revenue_actions_active_identity_uidx
  on tge.revenue_actions(
    tenant_id,
    opportunity_id,
    action_type,
    basis_fingerprint
  )
  where status in ('RECOMMENDED', 'PREPARED', 'APPROVED', 'EXECUTING', 'FAILED');
create index revenue_actions_history_idx
  on tge.revenue_actions(
    tenant_id,
    opportunity_id,
    source_created_at desc,
    source_ordinal desc,
    created_at desc
  );

alter table tge.tasks
  add constraint tasks_revenue_action_fk
  foreign key (tenant_id, revenue_action_id, opportunity_id, id)
  references tge.revenue_actions(
    tenant_id, id, opportunity_id, resulting_task_id
  )
  on update restrict on delete restrict
  deferrable initially deferred;

alter table tge.activities
  add constraint activities_revenue_action_fk
  foreign key (tenant_id, revenue_action_id, opportunity_id, id)
  references tge.revenue_actions(
    tenant_id, id, opportunity_id, resulting_activity_id
  )
  on update restrict on delete restrict
  deferrable initially deferred;

create table tge.import_batches (
  tenant_id uuid not null,
  id text not null check (btrim(id) <> ''),
  status text not null check (
    status in ('STAGED', 'PREVIEWED', 'READY', 'COMMITTED', 'FAILED', 'EXPIRED')
  ),
  source_filename text not null check (btrim(source_filename) <> ''),
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  authorized_by_subject_id text,
  authorization_reference text,
  authorization_verified_at timestamptz,
  authorization_refusal jsonb check (
    authorization_refusal is null
    or jsonb_typeof(authorization_refusal) = 'object'
  ),
  preview_summary jsonb check (
    preview_summary is null or jsonb_typeof(preview_summary) = 'object'
  ),
  conflict_summary jsonb check (
    conflict_summary is null or jsonb_typeof(conflict_summary) = 'object'
  ),
  commit_idempotency_key text,
  commit_metadata jsonb check (
    commit_metadata is null or jsonb_typeof(commit_metadata) = 'object'
  ),
  committed_at timestamptz,
  raw_storage_key text,
  raw_expires_at timestamptz not null,
  metadata_retain_until timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id) references tge.tenants(id)
    on update restrict on delete restrict,
  unique (tenant_id, commit_idempotency_key),
  check (raw_expires_at <= created_at + interval '7 days'),
  check (metadata_retain_until >= created_at + interval '12 months'),
  check (
    (
      authorization_verified_at is not null
      and num_nonnulls(authorized_by_subject_id, authorization_reference) = 1
      and authorization_refusal is null
    )
    or (
      status = 'FAILED'
      and authorization_verified_at is null
      and authorized_by_subject_id is null
      and authorization_reference is null
      and authorization_refusal is not null
    )
  ),
  check (
    (status = 'COMMITTED'
      and committed_at is not null
      and commit_idempotency_key is not null
      and commit_metadata is not null)
    or status <> 'COMMITTED'
  )
);

create index import_batches_status_idx
  on tge.import_batches(tenant_id, status, created_at desc);
create index import_batches_raw_expiry_idx
  on tge.import_batches(raw_expires_at)
  where raw_storage_key is not null;
create index import_batches_metadata_retention_idx
  on tge.import_batches(metadata_retain_until);

create table tge.import_staging_records (
  tenant_id uuid not null,
  import_batch_id text not null,
  id text not null check (btrim(id) <> ''),
  source_collection text not null check (
    source_collection in (
      'prospects', 'opportunities', 'activities', 'tasks', 'revenue_actions'
    )
  ),
  source_id text not null check (btrim(source_id) <> ''),
  source_ordinal bigint not null check (source_ordinal >= 0),
  raw_payload jsonb,
  raw_payload_sha256 text not null check (raw_payload_sha256 ~ '^[0-9a-f]{64}$'),
  disposition text not null check (
    disposition in (
      'PENDING', 'EXACT_DUPLICATE', 'AMBIGUOUS',
      'ACCEPT', 'REJECT', 'COMMITTED'
    )
  ),
  conflict_details jsonb check (
    conflict_details is null or jsonb_typeof(conflict_details) = 'object'
  ),
  idempotency_key text not null check (btrim(idempotency_key) <> ''),
  committed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, import_batch_id, id),
  foreign key (tenant_id, import_batch_id)
    references tge.import_batches(tenant_id, id)
    on update restrict on delete restrict,
  unique (tenant_id, import_batch_id, source_collection, source_id),
  unique (tenant_id, import_batch_id, source_collection, source_ordinal),
  unique (
    tenant_id, import_batch_id, source_collection, source_ordinal, source_id
  ),
  unique (tenant_id, import_batch_id, idempotency_key),
  check (
    (disposition = 'AMBIGUOUS' and conflict_details is not null)
    or disposition <> 'AMBIGUOUS'
  ),
  check (
    (disposition = 'COMMITTED'
      and committed_at is not null)
    or disposition <> 'COMMITTED'
  )
);

create index import_staging_disposition_idx
  on tge.import_staging_records(tenant_id, import_batch_id, disposition);

create table tge.import_id_map (
  tenant_id uuid not null,
  import_batch_id text not null,
  source_collection text not null,
  source_id text not null check (btrim(source_id) <> ''),
  source_ordinal bigint not null check (source_ordinal >= 0),
  target_prospect_id text,
  target_opportunity_id text,
  target_task_id text,
  target_activity_id text,
  target_revenue_action_id text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, import_batch_id, source_collection, source_id),
  foreign key (tenant_id, import_batch_id)
    references tge.import_batches(tenant_id, id)
    on update restrict on delete restrict,
  foreign key (
    tenant_id, import_batch_id, source_collection, source_ordinal, source_id
  ) references tge.import_staging_records(
    tenant_id, import_batch_id, source_collection, source_ordinal, source_id
  ) on update restrict on delete restrict,
  foreign key (tenant_id, target_prospect_id)
    references tge.prospects(tenant_id, id)
    on update restrict on delete restrict,
  foreign key (tenant_id, target_opportunity_id)
    references tge.opportunities(tenant_id, id)
    on update restrict on delete restrict,
  foreign key (tenant_id, target_task_id)
    references tge.tasks(tenant_id, id)
    on update restrict on delete restrict,
  foreign key (tenant_id, target_activity_id)
    references tge.activities(tenant_id, id)
    on update restrict on delete restrict,
  foreign key (tenant_id, target_revenue_action_id)
    references tge.revenue_actions(tenant_id, id)
    on update restrict on delete restrict,
  unique (tenant_id, import_batch_id, target_prospect_id),
  unique (tenant_id, import_batch_id, target_opportunity_id),
  unique (tenant_id, import_batch_id, target_task_id),
  unique (tenant_id, import_batch_id, target_activity_id),
  unique (tenant_id, import_batch_id, target_revenue_action_id),
  check (
    num_nonnulls(
      target_prospect_id,
      target_opportunity_id,
      target_task_id,
      target_activity_id,
      target_revenue_action_id
    ) = 1
  ),
  constraint import_id_map_source_target_type_check check (
    (source_collection = 'prospects' and target_prospect_id is not null)
    or (
      source_collection = 'opportunities'
      and target_opportunity_id is not null
    )
    or (source_collection = 'tasks' and target_task_id is not null)
    or (source_collection = 'activities' and target_activity_id is not null)
    or (
      source_collection = 'revenue_actions'
      and target_revenue_action_id is not null
    )
  )
);

create index import_id_map_target_prospect_idx
  on tge.import_id_map(tenant_id, target_prospect_id)
  where target_prospect_id is not null;
create index import_id_map_target_opportunity_idx
  on tge.import_id_map(tenant_id, target_opportunity_id)
  where target_opportunity_id is not null;
create index import_id_map_target_task_idx
  on tge.import_id_map(tenant_id, target_task_id)
  where target_task_id is not null;
create index import_id_map_target_activity_idx
  on tge.import_id_map(tenant_id, target_activity_id)
  where target_activity_id is not null;
create index import_id_map_target_revenue_action_idx
  on tge.import_id_map(tenant_id, target_revenue_action_id)
  where target_revenue_action_id is not null;

create table tge.audit_events (
  tenant_id uuid not null,
  id text not null check (btrim(id) <> ''),
  event_type text not null check (btrim(event_type) <> ''),
  subject_id text,
  entity_type text,
  entity_id text,
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  source_ordinal bigint check (source_ordinal is null or source_ordinal >= 0),
  occurred_at timestamptz not null default now(),
  retain_until timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id) references tge.tenants(id)
    on update restrict on delete restrict,
  check (retain_until >= occurred_at + interval '12 months')
);

create index audit_events_tenant_time_idx
  on tge.audit_events(tenant_id, occurred_at desc, source_ordinal desc);
create index audit_events_retention_idx
  on tge.audit_events(retain_until);
