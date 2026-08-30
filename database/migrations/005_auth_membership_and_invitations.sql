set local role tge_owner;

alter table tge.tenant_memberships
  add column identity_issuer text not null default 'urn:tge:legacy',
  add column status text not null default 'ACTIVE';

alter table tge.tenant_memberships
  add constraint tenant_memberships_identity_issuer_check
    check (btrim(identity_issuer) <> ''),
  add constraint tenant_memberships_status_check
    check (status in ('ACTIVE', 'SUSPENDED', 'REVOKED'));

alter table tge.tenant_memberships
  drop constraint tenant_memberships_pkey,
  add primary key (tenant_id, identity_issuer, subject_id);

drop index tge.tenant_memberships_subject_idx;
create index tenant_memberships_identity_idx
  on tge.tenant_memberships(identity_issuer, subject_id, tenant_id)
  where status = 'ACTIVE';

create function tge.current_identity_issuer()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.identity_issuer', true), '')
$$;

create function tge.current_invitation_token_hash()
returns text
language sql
stable
set search_path = pg_catalog
as $$
  select nullif(current_setting('app.invitation_token_hash', true), '')
$$;

create function tge.set_identity_context(
  requested_identity_issuer text,
  requested_subject_id text
)
returns void
language plpgsql
volatile
set search_path = pg_catalog
as $$
begin
  if requested_identity_issuer is null
    or btrim(requested_identity_issuer) = '' then
    raise exception 'identity issuer is required' using errcode = '22004';
  end if;
  if requested_subject_id is null or btrim(requested_subject_id) = '' then
    raise exception 'subject context is required' using errcode = '22004';
  end if;

  perform set_config('app.tenant_id', '', true);
  perform set_config('app.identity_issuer', requested_identity_issuer, true);
  perform set_config('app.subject_id', requested_subject_id, true);
end
$$;

create function tge.set_request_context(
  requested_tenant_id uuid,
  requested_identity_issuer text,
  requested_subject_id text
)
returns void
language plpgsql
volatile
set search_path = pg_catalog
as $$
begin
  if requested_tenant_id is null then
    raise exception 'tenant context is required' using errcode = '22004';
  end if;
  if requested_identity_issuer is null
    or btrim(requested_identity_issuer) = '' then
    raise exception 'identity issuer is required' using errcode = '22004';
  end if;
  if requested_subject_id is null or btrim(requested_subject_id) = '' then
    raise exception 'subject context is required' using errcode = '22004';
  end if;

  perform set_config('app.tenant_id', requested_tenant_id::text, true);
  perform set_config('app.identity_issuer', requested_identity_issuer, true);
  perform set_config('app.subject_id', requested_subject_id, true);
end
$$;

drop policy membership_lookup on tge.tenant_memberships;
create policy membership_lookup on tge.tenant_memberships
  for select
  using (
    tenant_id = tge.current_tenant_id()
    or (
      tge.current_tenant_id() is null
      and identity_issuer = tge.current_identity_issuer()
      and subject_id = tge.current_subject_id()
    )
  );

create policy membership_activation on tge.tenant_memberships
  for insert
  with check (
    tenant_id = tge.current_tenant_id()
    and identity_issuer = tge.current_identity_issuer()
    and subject_id = tge.current_subject_id()
    and status = 'ACTIVE'
  );

create table tge.assisted_invitations (
  tenant_id uuid not null,
  id uuid not null default gen_random_uuid(),
  token_hash text not null unique
    check (token_hash ~ '^[0-9a-f]{64}$'),
  normalized_email text not null
    check (
      btrim(normalized_email) <> ''
      and normalized_email = lower(normalized_email)
    ),
  intended_role text not null check (intended_role in ('ADMIN', 'MEMBER')),
  status text not null default 'PENDING'
    check (status in ('PENDING', 'CONSUMED', 'REVOKED')),
  expected_identity_issuer text,
  expected_subject_id text,
  created_by_subject_id text not null check (btrim(created_by_subject_id) <> ''),
  consumed_by_identity_issuer text,
  consumed_by_subject_id text,
  revoked_by_subject_id text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, id),
  foreign key (tenant_id) references tge.tenants(id)
    on update restrict on delete restrict,
  check (expires_at > created_at),
  check (num_nonnulls(expected_identity_issuer, expected_subject_id) in (0, 2)),
  check (
    (expected_identity_issuer is null or btrim(expected_identity_issuer) <> '')
    and (expected_subject_id is null or btrim(expected_subject_id) <> '')
  ),
  check (
    (status = 'PENDING' and consumed_at is null and revoked_at is null)
    or (
      status = 'CONSUMED'
      and consumed_at is not null
      and consumed_by_identity_issuer is not null
      and consumed_by_subject_id is not null
      and revoked_at is null
    )
    or (
      status = 'REVOKED'
      and revoked_at is not null
      and revoked_by_subject_id is not null
      and consumed_at is null
    )
  )
);

create index assisted_invitations_tenant_status_idx
  on tge.assisted_invitations(tenant_id, status, expires_at);
create index assisted_invitations_expected_identity_idx
  on tge.assisted_invitations(
    expected_identity_issuer,
    expected_subject_id,
    tenant_id
  )
  where status = 'PENDING';

alter table tge.assisted_invitations enable row level security;
alter table tge.assisted_invitations force row level security;

create policy tenant_scope on tge.assisted_invitations
  for all
  using (tenant_id = tge.current_tenant_id())
  with check (tenant_id = tge.current_tenant_id());

create policy invitation_token_lookup on tge.assisted_invitations
  for select
  using (token_hash = tge.current_invitation_token_hash());

create function tge.invitation_available(requested_token_hash text)
returns boolean
language plpgsql
volatile
security invoker
set search_path = pg_catalog, tge
as $$
declare
  available boolean;
begin
  if requested_token_hash is null
    or requested_token_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  perform set_config('app.tenant_id', '', true);
  perform set_config('app.invitation_token_hash', requested_token_hash, true);
  select exists (
    select 1
    from tge.assisted_invitations invitation
    where invitation.token_hash = requested_token_hash
      and invitation.status = 'PENDING'
      and invitation.expires_at > clock_timestamp()
      and invitation.expected_identity_issuer is not null
      and invitation.expected_subject_id is not null
  ) into available;
  return available;
end
$$;

create function tge.consume_assisted_invitation(
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
as $$
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
$$;

revoke all on tge.assisted_invitations from public;
grant select, insert, update on tge.assisted_invitations to tge_runtime;

grant execute on function tge.current_identity_issuer() to tge_runtime;
grant execute on function tge.current_invitation_token_hash() to tge_runtime;
grant execute on function tge.set_identity_context(text, text) to tge_runtime;
grant execute on function tge.set_request_context(uuid, text, text) to tge_runtime;
grant execute on function tge.invitation_available(text) to tge_runtime;
grant execute on function tge.consume_assisted_invitation(
  text, text, text, text, text
) to tge_runtime;

revoke execute on all functions in schema tge from public;
