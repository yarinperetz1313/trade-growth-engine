set local role tge_owner;

alter table tge.import_id_map
  add column source_system text,
  add column source_record_id text,
  add column canonical_payload_sha256 text,
  add column commit_idempotency_key text;

alter table tge.import_id_map
  add constraint import_id_map_canonical_identity_check check (
    (
      source_system is null
      and source_record_id is null
      and canonical_payload_sha256 is null
      and commit_idempotency_key is null
    )
    or (
      source_system is not null
      and btrim(source_system) <> ''
      and octet_length(source_system) <= 128
      and source_record_id is not null
      and btrim(source_record_id) <> ''
      and octet_length(source_record_id) <= 512
      and canonical_payload_sha256 is not null
      and canonical_payload_sha256 ~ '^[0-9a-f]{64}$'
      and commit_idempotency_key is not null
      and btrim(commit_idempotency_key) <> ''
      and octet_length(commit_idempotency_key) <= 255
    )
  );

create unique index import_id_map_source_identity_uidx
  on tge.import_id_map(
    tenant_id,
    source_system,
    source_collection,
    source_record_id
  )
  where source_system is not null;

create unique index import_id_map_global_target_prospect_uidx
  on tge.import_id_map(tenant_id, target_prospect_id)
  where source_system is not null and target_prospect_id is not null;
create unique index import_id_map_global_target_opportunity_uidx
  on tge.import_id_map(tenant_id, target_opportunity_id)
  where source_system is not null and target_opportunity_id is not null;
create unique index import_id_map_global_target_task_uidx
  on tge.import_id_map(tenant_id, target_task_id)
  where source_system is not null and target_task_id is not null;
create unique index import_id_map_global_target_activity_uidx
  on tge.import_id_map(tenant_id, target_activity_id)
  where source_system is not null and target_activity_id is not null;

create function tge.lock_import_commit_batch(
  requested_tenant_id uuid,
  requested_batch_id text
)
returns setof tge.import_batches
language sql
volatile
security definer
set search_path = pg_catalog, tge
as $function$
  select batch.*
  from tge.import_batches batch
  where requested_tenant_id is not null
    and requested_tenant_id is not distinct from tge.current_tenant_id()
    and requested_batch_id is not null
    and btrim(requested_batch_id) <> ''
    and batch.tenant_id = requested_tenant_id
    and batch.id = requested_batch_id
  for update
$function$;

create function tge.lock_import_commit_records(
  requested_tenant_id uuid,
  requested_batch_id text
)
returns setof tge.import_staging_records
language sql
volatile
security definer
set search_path = pg_catalog, tge
as $function$
  select record.*
  from tge.import_staging_records record
  where requested_tenant_id is not null
    and requested_tenant_id is not distinct from tge.current_tenant_id()
    and requested_batch_id is not null
    and btrim(requested_batch_id) <> ''
    and record.tenant_id = requested_tenant_id
    and record.import_batch_id = requested_batch_id
    and exists (
      select 1
      from tge.import_batches batch
      where batch.tenant_id = record.tenant_id
        and batch.id = record.import_batch_id
        and batch.status = 'PREVIEWED'
    )
  order by record.source_ordinal
  for update
$function$;

create function tge.record_import_commit_outcome(
  requested_tenant_id uuid,
  requested_batch_id text,
  requested_record_id text,
  requested_disposition text,
  requested_committed_at timestamptz,
  requested_metadata jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, tge
as $function$
declare
  affected integer;
  staged_record tge.import_staging_records%rowtype;
begin
  if requested_tenant_id is null
    or requested_tenant_id is distinct from tge.current_tenant_id()
    or requested_batch_id is null
    or btrim(requested_batch_id) = ''
    or requested_record_id is null
    or btrim(requested_record_id) = ''
    or requested_disposition is null
    or requested_disposition not in ('COMMITTED', 'EXACT_DUPLICATE')
    or requested_committed_at is null
    or requested_metadata is null
    or jsonb_typeof(requested_metadata) is distinct from 'object'
    or requested_metadata->>'canonical_payload_sha256' is null
    or requested_metadata->>'canonical_payload_sha256'
      !~ '^[0-9a-f]{64}$'
    or coalesce(btrim(requested_metadata->>'source_system'), '') = ''
    or coalesce(btrim(requested_metadata->>'source_record_id'), '') = ''
    or coalesce(btrim(requested_metadata->>'target_id'), '') = '' then
    raise exception using
      errcode = '23514',
      message = 'Canonical import row outcome is invalid.';
  end if;

  select record.*
  into staged_record
  from tge.import_staging_records record
  join tge.import_batches batch
    on batch.tenant_id = record.tenant_id
   and batch.id = record.import_batch_id
  where record.tenant_id = requested_tenant_id
    and record.import_batch_id = requested_batch_id
    and record.id = requested_record_id
    and record.disposition = 'PENDING'
    and batch.status = 'PREVIEWED'
  for update of record;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'Canonical import row outcome transition is invalid.';
  end if;

  if not exists (
    select 1
    from tge.import_id_map identity_map
    where identity_map.tenant_id = staged_record.tenant_id
      and identity_map.source_collection = staged_record.source_collection
      and identity_map.source_system = requested_metadata->>'source_system'
      and identity_map.source_record_id =
        requested_metadata->>'source_record_id'
      and identity_map.canonical_payload_sha256 =
        requested_metadata->>'canonical_payload_sha256'
      and coalesce(
        identity_map.target_prospect_id,
        identity_map.target_opportunity_id,
        identity_map.target_task_id,
        identity_map.target_activity_id,
        identity_map.target_revenue_action_id
      ) = requested_metadata->>'target_id'
      and (
        requested_disposition = 'EXACT_DUPLICATE'
        or (
          identity_map.import_batch_id = staged_record.import_batch_id
          and identity_map.source_id = staged_record.source_id
          and identity_map.source_ordinal = staged_record.source_ordinal
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Canonical import row outcome lacks authoritative ID-map evidence.';
  end if;

  update tge.import_staging_records record
  set
    disposition = requested_disposition,
    committed_at = requested_committed_at,
    metadata = record.metadata || jsonb_build_object(
      'canonical_commit', requested_metadata
    ),
    updated_at = requested_committed_at
  where record.tenant_id = requested_tenant_id
    and record.import_batch_id = requested_batch_id
    and record.id = requested_record_id
    and record.disposition = 'PENDING';

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception using
      errcode = '23514',
      message = 'Canonical import row outcome transition is invalid.';
  end if;
end
$function$;

create function tge.record_import_commit_attempt(
  requested_tenant_id uuid,
  requested_batch_id text,
  requested_summary jsonb,
  requested_at timestamptz
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, tge
as $function$
declare
  affected integer;
begin
  if requested_tenant_id is null
    or requested_tenant_id is distinct from tge.current_tenant_id()
    or requested_batch_id is null
    or btrim(requested_batch_id) = ''
    or requested_at is null
    or requested_summary is null
    or jsonb_typeof(requested_summary) is distinct from 'object'
    or requested_summary->>'outcome' is null
    or requested_summary->>'outcome' not in ('CONFLICTED', 'FAILED')
    or requested_summary->>'inputFingerprint' is null
    or requested_summary->>'inputFingerprint' !~ '^[0-9a-f]{64}$'
    or requested_summary->>'requestFingerprint' is null
    or requested_summary->>'requestFingerprint' !~ '^[0-9a-f]{64}$'
    or requested_summary->'summary' is null
    or jsonb_typeof(requested_summary->'summary') is distinct from 'object' then
    raise exception using
      errcode = '23514',
      message = 'Canonical import attempt outcome is invalid.';
  end if;

  update tge.import_batches
  set
    conflict_summary = requested_summary,
    updated_at = requested_at
  where tenant_id = requested_tenant_id
    and id = requested_batch_id
    and status = 'PREVIEWED';

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception using
      errcode = '23514',
      message = 'Canonical import attempt lifecycle is invalid.';
  end if;
end
$function$;

create function tge.record_import_commit_lifecycle_conflict(
  requested_tenant_id uuid,
  requested_batch_id text,
  requested_summary jsonb,
  requested_at timestamptz
)
returns void
language plpgsql
volatile
security definer
set search_path = pg_catalog, tge
as $function$
declare
  affected integer;
begin
  if requested_tenant_id is null
    or requested_tenant_id is distinct from tge.current_tenant_id()
    or requested_batch_id is null
    or btrim(requested_batch_id) = ''
    or requested_at is null
    or requested_summary is null
    or jsonb_typeof(requested_summary) is distinct from 'object'
    or requested_summary->>'outcome' is null
    or requested_summary->>'outcome' is distinct from 'CONFLICTED'
    or requested_summary->>'lifecycleStatus' is null
    or requested_summary->>'inputFingerprint' is null
    or requested_summary->>'inputFingerprint' !~ '^[0-9a-f]{64}$'
    or requested_summary->>'requestFingerprint' is null
    or requested_summary->>'requestFingerprint' !~ '^[0-9a-f]{64}$'
    or requested_summary->'summary' is null
    or jsonb_typeof(requested_summary->'summary') is distinct from 'object' then
    raise exception using
      errcode = '23514',
      message = 'Canonical import lifecycle conflict evidence is invalid.';
  end if;

  update tge.import_batches
  set
    conflict_summary = requested_summary,
    updated_at = requested_at
  where tenant_id = requested_tenant_id
    and id = requested_batch_id
    and status not in ('PREVIEWED', 'COMMITTED')
    and status = requested_summary->>'lifecycleStatus';

  get diagnostics affected = row_count;
  if affected <> 1 then
    raise exception using
      errcode = '23514',
      message = 'Canonical import lifecycle conflict is invalid.';
  end if;
end
$function$;

create function tge.finalize_import_commit(
  requested_tenant_id uuid,
  requested_batch_id text,
  requested_idempotency_key text,
  requested_commit_metadata jsonb,
  requested_committed_at timestamptz
)
returns setof tge.import_batches
language plpgsql
volatile
security definer
set search_path = pg_catalog, tge
as $function$
declare
  locked_batch tge.import_batches%rowtype;
  staged_count bigint;
  committed_count bigint;
  duplicate_count bigint;
begin
  if requested_tenant_id is null
    or requested_tenant_id is distinct from tge.current_tenant_id()
    or requested_batch_id is null
    or btrim(requested_batch_id) = ''
    or requested_idempotency_key is null
    or btrim(requested_idempotency_key) = ''
    or octet_length(requested_idempotency_key) > 255
    or requested_committed_at is null
    or requested_commit_metadata is null
    or jsonb_typeof(requested_commit_metadata) is distinct from 'object'
    or requested_commit_metadata->>'requestFingerprint' is null
    or requested_commit_metadata->>'requestFingerprint'
      !~ '^[0-9a-f]{64}$'
    or requested_commit_metadata->>'inputFingerprint' is null
    or requested_commit_metadata->>'inputFingerprint'
      !~ '^[0-9a-f]{64}$'
    or requested_commit_metadata#>>'{result,outcome}' is null
    or requested_commit_metadata#>>'{result,outcome}' <> 'COMMITTED' then
    raise exception using
      errcode = '23514',
      message = 'Canonical import finalization evidence is invalid.';
  end if;

  select batch.*
  into locked_batch
  from tge.import_batches batch
  where batch.tenant_id = requested_tenant_id
    and batch.id = requested_batch_id
    and batch.status = 'PREVIEWED'
  for update;

  if not found then
    return;
  end if;

  select
    count(*)::bigint,
    count(*) filter (where disposition = 'COMMITTED')::bigint,
    count(*) filter (where disposition = 'EXACT_DUPLICATE')::bigint
  into staged_count, committed_count, duplicate_count
  from tge.import_staging_records
  where tenant_id = requested_tenant_id
    and import_batch_id = requested_batch_id;

  if staged_count <> coalesce((locked_batch.preview_summary->>'rowCount')::bigint, -1)
    or staged_count <> coalesce(
      (requested_commit_metadata#>>'{result,summary,total}')::bigint,
      -1
    )
    or committed_count <> coalesce(
      (requested_commit_metadata#>>'{result,summary,committed}')::bigint,
      -1
    )
    or duplicate_count <> coalesce(
      (requested_commit_metadata#>>'{result,summary,skipped}')::bigint,
      -1
    )
    or exists (
      select 1
      from tge.import_staging_records record
      where record.tenant_id = requested_tenant_id
        and record.import_batch_id = requested_batch_id
        and record.disposition not in ('COMMITTED', 'EXACT_DUPLICATE')
    )
    or exists (
      select 1
      from tge.import_staging_records record
      where record.tenant_id = requested_tenant_id
        and record.import_batch_id = requested_batch_id
        and record.disposition = 'COMMITTED'
        and not exists (
          select 1
          from tge.import_id_map identity_map
          where identity_map.tenant_id = record.tenant_id
            and identity_map.import_batch_id = record.import_batch_id
            and identity_map.source_collection = record.source_collection
            and identity_map.source_id = record.source_id
            and identity_map.source_ordinal = record.source_ordinal
            and identity_map.canonical_payload_sha256 =
              record.metadata#>>'{canonical_commit,canonical_payload_sha256}'
            and identity_map.source_record_id =
              record.metadata#>>'{canonical_commit,source_record_id}'
        )
    )
    or exists (
      select 1
      from tge.import_staging_records record
      where record.tenant_id = requested_tenant_id
        and record.import_batch_id = requested_batch_id
        and record.disposition = 'EXACT_DUPLICATE'
        and not exists (
          select 1
          from tge.import_id_map identity_map
          where identity_map.tenant_id = record.tenant_id
            and identity_map.source_collection = record.source_collection
            and identity_map.source_system =
              record.metadata#>>'{canonical_commit,source_system}'
            and identity_map.source_record_id =
              record.metadata#>>'{canonical_commit,source_record_id}'
            and identity_map.canonical_payload_sha256 =
              record.metadata#>>'{canonical_commit,canonical_payload_sha256}'
            and coalesce(
              identity_map.target_prospect_id,
              identity_map.target_opportunity_id,
              identity_map.target_task_id,
              identity_map.target_activity_id,
              identity_map.target_revenue_action_id
            ) = record.metadata#>>'{canonical_commit,target_id}'
        )
    ) then
    raise exception using
      errcode = '23514',
      message = 'Canonical import row outcomes do not reconcile.';
  end if;

  return query
  update tge.import_batches
  set
    status = 'COMMITTED',
    conflict_summary = requested_commit_metadata#>'{result,summary}',
    commit_idempotency_key = requested_idempotency_key,
    commit_metadata = requested_commit_metadata,
    committed_at = requested_committed_at,
    updated_at = requested_committed_at
  where tenant_id = requested_tenant_id
    and id = requested_batch_id
    and status = 'PREVIEWED'
  returning *;
end
$function$;

revoke all on function tge.lock_import_commit_batch(
  uuid, text
) from public, tge_runtime;
revoke all on function tge.lock_import_commit_records(
  uuid, text
) from public, tge_runtime;
revoke all on function tge.record_import_commit_outcome(
  uuid, text, text, text, timestamptz, jsonb
) from public, tge_runtime;
revoke all on function tge.record_import_commit_attempt(
  uuid, text, jsonb, timestamptz
) from public, tge_runtime;
revoke all on function tge.record_import_commit_lifecycle_conflict(
  uuid, text, jsonb, timestamptz
) from public, tge_runtime;
revoke all on function tge.finalize_import_commit(
  uuid, text, text, jsonb, timestamptz
) from public, tge_runtime;

grant execute on function tge.lock_import_commit_batch(
  uuid, text
) to tge_runtime;
grant execute on function tge.lock_import_commit_records(
  uuid, text
) to tge_runtime;
grant execute on function tge.record_import_commit_outcome(
  uuid, text, text, text, timestamptz, jsonb
) to tge_runtime;
grant execute on function tge.record_import_commit_attempt(
  uuid, text, jsonb, timestamptz
) to tge_runtime;
grant execute on function tge.record_import_commit_lifecycle_conflict(
  uuid, text, jsonb, timestamptz
) to tge_runtime;
grant execute on function tge.finalize_import_commit(
  uuid, text, text, jsonb, timestamptz
) to tge_runtime;

revoke execute on all functions in schema tge from public;
