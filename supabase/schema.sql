-- Reimagining Shopping: Supabase PostgreSQL foundation
-- Run in a new Supabase project. Authentication is provided by auth.users.
create extension if not exists pgcrypto;

create type public.app_role as enum ('customer','seller','admin');
create type public.order_status as enum ('placed','confirmed','packed','shipped','out_for_delivery','delivered','cancelled');
create type public.return_status as enum ('requested','approved','rejected','picked_up','refunded','closed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text not null,
  mobile text,
  alternative_mobile text,
  role public.app_role not null default 'customer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_format check (email ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'),
  constraint profiles_mobile_format check (mobile is null or mobile ~ '^[6-9][0-9]{9}$'),
  constraint profiles_alt_mobile_format check (alternative_mobile is null or alternative_mobile ~ '^[6-9][0-9]{9}$')
);

create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_name text not null,
  mobile text not null check (mobile ~ '^[6-9][0-9]{9}$'),
  house text not null,
  street text not null,
  city text not null,
  district text not null,
  state text not null,
  pin_code char(6) not null check (pin_code ~ '^[1-9][0-9]{5}$'),
  landmark text,
  address_type text not null default 'home' check (address_type in ('home','office','other')),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index addresses_one_default_per_user on public.addresses(user_id) where is_default;

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  parent_id uuid references public.categories(id),
  image_url text,
  is_active boolean not null default true
);

create table public.sellers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.profiles(id),
  display_name text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','suspended')),
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references public.sellers(id),
  category_id uuid not null references public.categories(id),
  name text not null,
  brand text,
  description text,
  image_urls text[] not null default '{}',
  price_paise integer not null check (price_paise >= 0),
  mrp_paise integer not null check (mrp_paise >= price_paise),
  inventory integer not null default 0 check (inventory >= 0),
  rating numeric(2,1) not null default 0 check (rating between 0 and 5),
  review_count integer not null default 0,
  attributes jsonb not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index products_category_active on public.products(category_id, is_active);
create index products_price on public.products(price_paise) where is_active;
create index products_search on public.products using gin (to_tsvector('simple', coalesce(name,'') || ' ' || coalesce(brand,'') || ' ' || coalesce(description,'')));

-- A single Snap Store product may have separately sourced marketplace listings.
-- Keep retailer IDs, prices, ratings and links tied to their original source.
create table public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  marketplace text not null check (marketplace in ('amazon','flipkart','meesho')),
  external_product_id text not null,
  product_url text not null,
  affiliate_url text,
  listing_title text not null,
  image_url text,
  price_paise integer check (price_paise is null or price_paise >= 0),
  mrp_paise integer check (mrp_paise is null or mrp_paise >= price_paise),
  -- Ratings are nullable and provider-specific; never infer product ratings from seller scores.
  product_rating numeric(2,1) check (product_rating is null or product_rating between 0 and 5),
  product_rating_count integer check (product_rating_count is null or product_rating_count >= 0),
  seller_rating numeric(2,1) check (seller_rating is null or seller_rating between 0 and 5),
  seller_rating_count integer check (seller_rating_count is null or seller_rating_count >= 0),
  reviews_url text,
  source_attribution text not null,
  checked_at timestamptz,
  is_available boolean not null default true,
  provider_metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(marketplace, external_product_id)
);
create index marketplace_listings_product on public.marketplace_listings(product_id, is_available);
create index marketplace_listings_market_price on public.marketplace_listings(marketplace, price_paise) where is_available;

create table public.carts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  updated_at timestamptz not null default now(),
  primary key(user_id, product_id)
);
create table public.wishlist (
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(user_id, product_id)
);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  discount_type text not null check (discount_type in ('percentage','fixed')),
  discount_value integer not null check (discount_value > 0),
  minimum_order_paise integer not null default 0,
  max_discount_paise integer,
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default true
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique default ('RS-' || upper(substr(encode(gen_random_bytes(8),'hex'),1,12))),
  user_id uuid not null references public.profiles(id),
  status public.order_status not null default 'placed',
  customer_name text not null,
  customer_email text not null,
  customer_mobile text not null check (customer_mobile ~ '^[6-9][0-9]{9}$'),
  -- Immutable checkout snapshot: later address edits cannot alter order history.
  delivery_address jsonb not null,
  subtotal_paise integer not null check (subtotal_paise >= 0),
  discount_paise integer not null default 0 check (discount_paise >= 0),
  cashback_applied_paise integer not null default 0 check (cashback_applied_paise >= 0),
  delivery_paise integer not null default 0 check (delivery_paise >= 0),
  total_paise integer not null check (total_paise >= 0),
  payment_method text not null,
  payment_status text not null default 'pending' check (payment_status in ('pending','authorized','paid','failed','refunded')),
  estimated_delivery_date date,
  created_at timestamptz not null default now()
);
create index orders_user_created on public.orders(user_id, created_at desc);
create index orders_number on public.orders(order_number);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  product_image_url text,
  quantity integer not null check (quantity > 0),
  unit_price_paise integer not null check (unit_price_paise >= 0),
  discount_paise integer not null default 0 check (discount_paise >= 0),
  return_until date
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id),
  provider text not null,
  provider_order_id text,
  provider_payment_id text,
  amount_paise integer not null check (amount_paise >= 0),
  status text not null default 'created',
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.cashback_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  order_id uuid references public.orders(id),
  amount_paise integer not null check (amount_paise <> 0),
  status text not null default 'pending' check (status in ('pending','earned','expired','reversed')),
  expires_at timestamptz,
  description text not null,
  created_at timestamptz not null default now()
);

create table public.returns (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id),
  user_id uuid not null references public.profiles(id),
  request_type text not null check (request_type in ('return','replacement','refund')),
  reason text not null,
  proof_urls text[] not null default '{}',
  status public.return_status not null default 'requested',
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.returns(id),
  amount_paise integer not null check (amount_paise >= 0),
  destination text not null check (destination in ('original_payment','wallet')),
  provider_ref text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Phone price alerts: delivery is handled by a trusted push worker, never by the LLM.
create table public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  target_price_paise integer not null check (target_price_paise > 0),
  active boolean not null default true,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  unique(user_id, product_id)
);
create index price_alerts_active_target on public.price_alerts(active, target_price_paise);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  subscription jsonb not null,
  device_label text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions(user_id);

-- Role checks are centralized and security definer avoids recursive profile RLS.
create or replace function public.has_role(required_role public.app_role)
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles where id = auth.uid() and role = required_role) $$;

-- Create a customer profile automatically after Supabase Auth signup.
create or replace function public.create_customer_profile()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles(id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name',''), new.email);
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.create_customer_profile();

-- Customers cannot promote themselves by editing their own profile.
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.has_role('admin') then
    raise exception 'Only an administrator can change account roles';
  end if;
  return new;
end;
$$;
create trigger profiles_guard_role before update on public.profiles
for each row execute procedure public.guard_profile_role();

alter table public.profiles enable row level security;
alter table public.addresses enable row level security;
alter table public.categories enable row level security;
alter table public.sellers enable row level security;
alter table public.products enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.carts enable row level security;
alter table public.wishlist enable row level security;
alter table public.coupons enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;
alter table public.cashback_transactions enable row level security;
alter table public.returns enable row level security;
alter table public.refunds enable row level security;
alter table public.notifications enable row level security;
alter table public.price_alerts enable row level security;
alter table public.push_subscriptions enable row level security;

create policy "Profiles view own" on public.profiles for select using (id = auth.uid() or public.has_role('admin'));
create policy "Profiles update own" on public.profiles for update using (id = auth.uid() or public.has_role('admin')) with check (id = auth.uid() or public.has_role('admin'));
create policy "Addresses manage own" on public.addresses for all using (user_id = auth.uid() or public.has_role('admin')) with check (user_id = auth.uid() or public.has_role('admin'));
create policy "Active categories readable" on public.categories for select using (is_active or public.has_role('admin'));
create policy "Approved products readable" on public.products for select using (is_active and (seller_id is null or exists(select 1 from public.sellers s where s.id = seller_id and s.status = 'approved')) or public.has_role('admin'));
create policy "Sellers view own" on public.sellers for select using (owner_id = auth.uid() or public.has_role('admin'));
create policy "Seller product management" on public.products for all using (public.has_role('admin') or exists(select 1 from public.sellers s where s.id = seller_id and s.owner_id = auth.uid() and s.status = 'approved')) with check (public.has_role('admin') or exists(select 1 from public.sellers s where s.id = seller_id and s.owner_id = auth.uid() and s.status = 'approved'));
create policy "Available marketplace listings readable" on public.marketplace_listings for select using (is_available or public.has_role('admin'));
create policy "Cart manage own" on public.carts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Wishlist manage own" on public.wishlist for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Active coupons readable" on public.coupons for select using (is_active or public.has_role('admin'));
create policy "Orders view own" on public.orders for select using (user_id = auth.uid() or public.has_role('admin'));
create policy "Order items view own" on public.order_items for select using (exists(select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.has_role('admin'))));
create policy "Payments view own" on public.payments for select using (exists(select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.has_role('admin'))));
create policy "Cashback view own" on public.cashback_transactions for select using (user_id = auth.uid() or public.has_role('admin'));
create policy "Returns view own" on public.returns for select using (user_id = auth.uid() or public.has_role('admin'));
create policy "Returns request own" on public.returns for insert with check (user_id = auth.uid());
create policy "Refunds view own" on public.refunds for select using (exists(select 1 from public.returns r where r.id = return_id and (r.user_id = auth.uid() or public.has_role('admin'))));
create policy "Notifications view own" on public.notifications for select using (user_id = auth.uid() or public.has_role('admin'));
create policy "Notifications update own" on public.notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Price alerts manage own" on public.price_alerts for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Push subscriptions manage own" on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Orders, payments, wallet changes, inventory and privileged administration should
-- be written by trusted backend functions (service role), never by browser clients.
