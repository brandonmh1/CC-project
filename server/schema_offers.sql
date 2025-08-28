create table merchants (
  id text primary key,
  brand text not null,
  aliases text[] default '{}',
  domains text[] default '{}',
  mccs int[] default '{}',
  logo_url text
);

create table offers (
  id text primary key,
  issuer text not null,
  title text not null,
  body text,
  terms_url text,
  offer_type text check (offer_type in ('statement_credit','points_multiplier','portal_deal','rebate','gift_card')) not null,
  value jsonb not null,                       -- {percent, fixed_amount, points_multiplier}
  min_spend_cents int default 0,
  start_at timestamptz not null,
  end_at timestamptz not null,
  merchant_id text references merchants(id) on delete cascade,
  card_scope jsonb default '"all"',          -- "all" or [card_ids]
  categories text[] default '{}',             -- internal category ids (e.g., 'online','department_store')
  targeting text default 'public',            -- public | targeted | by_invite
  enrollment_required boolean default false,
  stackability jsonb default '{"with_category_multipliers":true,"with_portal_multipliers":false}',
  geo_scope text default 'US'
);

-- helpful search indexes
create index on merchants using gin (aliases);
create index on merchants using gin (domains);
create index on offers using gin (categories);
create index on offers (merchant_id);
create index on offers (start_at, end_at);