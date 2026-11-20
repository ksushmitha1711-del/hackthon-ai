-- Product reviews and feedback for the static storefront.
-- Run after supabase/schema.sql in the Supabase SQL editor.
create table if not exists public.product_reviews (
  id uuid primary key default gen_random_uuid(),
  product_id integer not null,
  reviewer_name text not null check (length(trim(reviewer_name)) between 2 and 80),
  rating smallint not null check (rating between 1 and 5),
  review_text text not null check (length(trim(review_text)) between 10 and 2000),
  submission_key uuid not null,
  photo_url text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  verified_purchase boolean not null default false,
  helpful_count integer not null default 0 check (helpful_count >= 0),
  created_at timestamptz not null default now(),
  unique(product_id, submission_key)
);
create index if not exists product_reviews_public_idx on public.product_reviews(product_id, created_at desc) where status='approved';
create table if not exists public.customer_feedback (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 80),
  email text,
  category text not null check (category in ('suggestion','complaint','experience')),
  message text not null check (length(trim(message)) between 10 and 2000),
  status text not null default 'new' check (status in ('new','reviewing','resolved','closed')),
  created_at timestamptz not null default now()
);
alter table public.product_reviews enable row level security;
alter table public.customer_feedback enable row level security;
drop policy if exists "Approved reviews readable" on public.product_reviews;
create policy "Approved reviews readable" on public.product_reviews for select using (status='approved' or public.has_role('admin'));
drop policy if exists "Anyone may submit a review" on public.product_reviews;
create policy "Anyone may submit a review" on public.product_reviews for insert with check (status='pending' and verified_purchase=false and helpful_count=0);
drop policy if exists "Admins moderate reviews" on public.product_reviews;
create policy "Admins moderate reviews" on public.product_reviews for update using (public.has_role('admin')) with check (public.has_role('admin'));
drop policy if exists "Anyone may submit feedback" on public.customer_feedback;
create policy "Anyone may submit feedback" on public.customer_feedback for insert with check (status='new');
drop policy if exists "Admins manage feedback" on public.customer_feedback;
create policy "Admins manage feedback" on public.customer_feedback for all using (public.has_role('admin')) with check (public.has_role('admin'));
create table if not exists public.review_helpful_votes (
  review_id uuid not null references public.product_reviews(id) on delete cascade,
  voter_key uuid not null,
  created_at timestamptz not null default now(),
  primary key (review_id, voter_key)
);
alter table public.review_helpful_votes enable row level security;
drop function if exists public.mark_review_helpful(uuid);
create or replace function public.mark_review_helpful(review_id uuid, voter_key uuid)
returns boolean language plpgsql security definer set search_path=public
as $$
declare added integer;
begin
  insert into public.review_helpful_votes(review_id, voter_key)
  select review_id, voter_key from public.product_reviews where id=review_id and status='approved'
  on conflict do nothing;
  get diagnostics added = row_count;
  if added=1 then
    update public.product_reviews set helpful_count=helpful_count+1 where id=review_id and status='approved';
  end if;
  return added=1;
end;
$$;
grant execute on function public.mark_review_helpful(uuid, uuid) to anon, authenticated;
-- Create a public Storage bucket named review-photos in Supabase before enabling uploads.
-- Keep uploads small and configure moderation/retention in the Supabase dashboard.

-- Explicit API grants; row-level policies above still control each operation.
grant select, insert, update on public.product_reviews to anon, authenticated;
grant select, insert, update on public.customer_feedback to anon, authenticated;

-- Exact retailer links and current offers. Only an administrator can publish or verify an offer.
create table if not exists public.product_offers (
  id uuid primary key default gen_random_uuid(),
  product_id integer not null,
  marketplace text not null check (marketplace in ('Amazon','Flipkart','Myntra','Meesho','Ajio','Tata CLiQ','Croma','Reliance Digital','Nykaa','Official site')),
  product_url text not null check (product_url ~ '^https://'),
  price numeric(12,2) not null check (price > 0),
  currency char(3) not null default 'INR' check (currency='INR'),
  discount_percent numeric(5,2) check (discount_percent is null or discount_percent between 0 and 100),
  warranty text,
  features jsonb not null default '[]'::jsonb,
  specifications jsonb not null default '{}'::jsonb,
  official_store_confirmed boolean not null default false,
  source_reference text,
  checked_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);
alter table public.product_offers add column if not exists features jsonb not null default '[]'::jsonb;
alter table public.product_offers add column if not exists specifications jsonb not null default '{}'::jsonb;
create index if not exists product_offers_product_expiry on public.product_offers(product_id, expires_at, price);
alter table public.product_offers enable row level security;
drop policy if exists "Current offers readable" on public.product_offers;
create policy "Current offers readable" on public.product_offers for select using (expires_at > now());
drop policy if exists "Admins manage offers" on public.product_offers;
create policy "Admins manage offers" on public.product_offers for all using (public.has_role('admin')) with check (public.has_role('admin'));
grant select, insert, update, delete on public.product_offers to anon, authenticated;
