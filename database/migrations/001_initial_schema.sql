create extension if not exists pgcrypto;

create table if not exists prospects (
  id uuid primary key default gen_random_uuid(),

  business_name text not null,

  website text,

  email text,

  phone text,

  service text,

  location text,

  source text,

  source_url text,

  dedupe_key text unique,

  qualification_score numeric,

  qualification_status text,

  evidence jsonb default '[]'::jsonb,

  metadata jsonb default '{}'::jsonb,

  created_at timestamptz
    not null
    default now(),

  updated_at timestamptz
    not null
    default now()
);

create index if not exists
prospects_business_name_idx
on prospects(business_name);

create index if not exists
prospects_location_idx
on prospects(location);

create index if not exists
prospects_qualification_idx
on prospects(qualification_score);


create table if not exists leads (
  id uuid primary key default gen_random_uuid(),

  prospect_id uuid
    references prospects(id)
    on delete set null,

  business_name text not null,

  status text
    not null
    default 'NEW',

  owner text,

  score numeric,

  value_estimate numeric,

  metadata jsonb
    default '{}'::jsonb,

  created_at timestamptz
    not null
    default now(),

  updated_at timestamptz
    not null
    default now()
);

create index if not exists
leads_status_idx
on leads(status);


create table if not exists outreach_events (
  id uuid primary key default gen_random_uuid(),

  lead_id uuid
    references leads(id)
    on delete cascade,

  channel text
    not null,

  event_type text
    not null,

  subject text,

  body text,

  metadata jsonb
    default '{}'::jsonb,

  created_at timestamptz
    not null
    default now()
);

create index if not exists
outreach_events_lead_idx
on outreach_events(lead_id);

create index if not exists
outreach_events_type_idx
on outreach_events(event_type);


create table if not exists experiments (
  id uuid primary key default gen_random_uuid(),

  experiment_key text unique,

  name text not null,

  status text
    not null
    default 'DRAFT',

  configuration jsonb
    default '{}'::jsonb,

  metrics jsonb
    default '{}'::jsonb,

  created_at timestamptz
    not null
    default now(),

  updated_at timestamptz
    not null
    default now()
);


create table if not exists reports (
  id uuid primary key default gen_random_uuid(),

  report_type text,

  title text,

  data jsonb
    default '{}'::jsonb,

  created_at timestamptz
    not null
    default now()
);


create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),

  event_type text not null,

  entity_type text,

  entity_id text,

  payload jsonb
    default '{}'::jsonb,

  created_at timestamptz
    not null
    default now()
);
