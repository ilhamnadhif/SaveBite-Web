-- SaveBite: Admin workspace and consumer complaints.
-- Covers seller verification, account suspension, complaint handling, and the
-- transaction report. Apply after 0024_hosted_snap_checkout.sql.

begin;

-- ---------------------------------------------------------------------------
-- Account suspension
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists suspended_at timestamptz,
  add column if not exists suspended_reason text;

create or replace function public.current_account_is_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.deleted_at is null
      and p.suspended_at is null
  )
$$;

create or replace function private.assert_account_active(p_uid uuid)
returns void
language plpgsql
volatile
security definer
set search_path = private, public, pg_catalog
as $$
declare
  v_deleted_at timestamptz;
  v_suspended_at timestamptz;
begin
  if p_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select p.deleted_at, p.suspended_at
  into v_deleted_at, v_suspended_at
  from public.profiles p
  where p.id = p_uid
  for share;

  if not found then
    raise exception 'account is unavailable' using errcode = '55000';
  end if;
  if v_deleted_at is not null then
    raise exception 'account deletion is pending' using errcode = '55000';
  end if;
  if v_suspended_at is not null then
    raise exception 'account is suspended' using errcode = '55000';
  end if;
end
$$;

revoke all on function private.assert_account_active(uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Admin role
-- ---------------------------------------------------------------------------

-- Admins are granted by an operator with SQL, never from a client. `last_mode`
-- cannot carry this role because clients may write it.
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
revoke all on public.admin_users from public, anon, authenticated;
grant select on public.admin_users to authenticated;

drop policy if exists admin_users_read_self on public.admin_users;
create policy admin_users_read_self on public.admin_users
for select
using (user_id = (select auth.uid()));

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.admin_users a
    join public.profiles p on p.id = a.user_id
    where a.user_id = auth.uid()
      and p.deleted_at is null
      and p.suspended_at is null
  )
$$;

revoke all on function public.current_user_is_admin()
  from public, anon, authenticated;
grant execute on function public.current_user_is_admin() to authenticated;

create or replace function private.require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not public.current_user_is_admin() then
    raise exception 'admin access required' using errcode = '42501';
  end if;
  return v_uid;
end
$$;

revoke all on function private.require_admin()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Seller verification
-- ---------------------------------------------------------------------------

-- Existing stores take the column default and stay public; only then does the
-- default become `pending`, so stores created from now on wait for an admin.
-- This is a separate column because `merchants.status` feeds the guard triggers
-- that block writes to non-active merchants. Clients get no direct grant on the
-- new columns: owners read them through get_my_merchant(), admins through RPCs.
alter table public.merchants
  add column if not exists verification_status text not null default 'verified',
  add column if not exists verification_note text,
  add column if not exists verified_at timestamptz;

alter table public.merchants
  alter column verification_status set default 'pending';

alter table public.merchants
  drop constraint if exists merchants_verification_status_check;
alter table public.merchants
  add constraint merchants_verification_status_check
  check (verification_status in ('pending', 'verified', 'rejected'));

create or replace function public.merchant_is_public(p_merchant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.merchants m
    join public.profiles p on p.id = m.user_id
    where m.id = p_merchant_id
      and m.status = 'active'
      and m.verification_status = 'verified'
      and m.user_id is not null
      and p.deleted_at is null
      and p.suspended_at is null
  )
$$;

create or replace function public.get_my_merchant()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select to_jsonb(owned)
  from (
    select m.id, m.store_name, m.description, m.address, m.distance,
           m.lat, m.lng, m.category, m.open_time, m.close_time, m.logo_url,
           m.status, m.rating, m.review_count, m.bags_saved,
           m.created_at, m.updated_at, m.deleted_at,
           m.verification_status, m.verification_note
    from public.merchants m
    where m.user_id = auth.uid()
      and m.deleted_at is null
    limit 1
  ) owned
$$;

-- A rejected seller who edits the store goes back to the review queue.
create or replace function public.requeue_rejected_merchant()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
begin
  if current_user = 'authenticated' and old.verification_status = 'rejected' then
    new.verification_status := 'pending';
    new.verification_note := null;
  end if;
  return new;
end
$$;

revoke all on function public.requeue_rejected_merchant()
  from public, anon, authenticated;

drop trigger if exists requeue_rejected_merchant on public.merchants;
create trigger requeue_rejected_merchant
before update on public.merchants
for each row execute function public.requeue_rejected_merchant();

-- Hiding a store does not stop a direct checkout call for one of its bags.
create or replace function public.reject_unverified_merchant_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if not exists (
    select 1
    from public.merchants m
    where m.id = new.merchant_id
      and m.verification_status = 'verified'
  ) then
    raise exception 'merchant is not verified' using errcode = '55000';
  end if;
  return new;
end
$$;

revoke all on function public.reject_unverified_merchant_order()
  from public, anon, authenticated;

drop trigger if exists reject_unverified_merchant_order on public.orders;
create trigger reject_unverified_merchant_order
before insert on public.orders
for each row execute function public.reject_unverified_merchant_order();

create or replace function public.admin_list_merchants(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  perform private.require_admin();
  return (
    select coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb)
    from (
      select m.id, m.store_name, m.category, m.address, m.logo_url, m.status,
             m.verification_status, m.verification_note, m.verified_at,
             m.created_at, p.name as owner_name, p.email as owner_email,
             (select count(*) from public.surprise_bags b
              where b.merchant_id = m.id) as bag_count
      from public.merchants m
      left join public.profiles p on p.id = m.user_id
      where m.deleted_at is null
        and (p_status is null or m.verification_status = p_status)
      order by case m.verification_status
                 when 'pending' then 0
                 when 'rejected' then 1
                 else 2
               end,
               m.created_at desc
      limit 500
    ) row_data
  );
end
$$;

create or replace function public.admin_set_merchant_verification(
  p_merchant_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_merchant public.merchants;
begin
  perform private.require_admin();
  if p_status is null or p_status not in ('verified', 'rejected') then
    raise exception 'invalid verification status';
  end if;
  if p_status = 'rejected' and char_length(coalesce(v_note, '')) < 5 then
    raise exception 'verification note is required';
  end if;

  update public.merchants
  set verification_status = p_status,
      verification_note = case when p_status = 'rejected' then v_note end,
      verified_at = case when p_status = 'verified' then now() end
  where id = p_merchant_id and deleted_at is null
  returning * into v_merchant;

  if not found then
    raise exception 'merchant not found';
  end if;

  if v_merchant.user_id is not null then
    insert into public.notifications
      (user_id, title, body, type, group_label, read, dedupe_key,
       entity_type, entity_id, data)
    values (
      v_merchant.user_id,
      case when p_status = 'verified' then 'Toko terverifikasi'
           else 'Verifikasi toko ditolak' end,
      case when p_status = 'verified'
           then v_merchant.store_name || ' sudah tampil untuk pembeli.'
           else 'Alasan: ' || v_note end,
      'system', 'Hari ini', false,
      'merchant-verification:' || v_merchant.id || ':'
        || extract(epoch from now())::bigint,
      'merchant', v_merchant.id, '{}'::jsonb
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  return jsonb_build_object(
    'id', v_merchant.id,
    'verification_status', v_merchant.verification_status,
    'verification_note', v_merchant.verification_note,
    'verified_at', v_merchant.verified_at
  );
end
$$;

-- ---------------------------------------------------------------------------
-- User management
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_users(p_search text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_search text := lower(nullif(btrim(coalesce(p_search, '')), ''));
begin
  perform private.require_admin();
  return (
    select coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb)
    from (
      select p.id, p.name, p.email, p.created_at, p.suspended_at,
             p.suspended_reason,
             exists (select 1 from public.admin_users a
                     where a.user_id = p.id) as is_admin,
             m.store_name,
             m.verification_status,
             (select count(*) from public.orders o
              where o.consumer_id = p.id) as order_count
      from public.profiles p
      left join public.merchants m
        on m.user_id = p.id and m.deleted_at is null
      where p.deleted_at is null
        and (
          v_search is null
          or position(v_search in lower(
               coalesce(p.name, '') || ' ' || coalesce(p.email, ''))) > 0
        )
      order by p.created_at desc
      limit 200
    ) row_data
  );
end
$$;

create or replace function public.admin_set_user_suspended(
  p_user_id uuid,
  p_suspended boolean,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_profile public.profiles;
begin
  if p_user_id = v_admin then
    raise exception 'admin cannot suspend their own account';
  end if;
  if exists (select 1 from public.admin_users a where a.user_id = p_user_id) then
    raise exception 'admin accounts cannot be suspended';
  end if;
  if p_suspended and char_length(coalesce(v_reason, '')) < 5 then
    raise exception 'suspension reason is required';
  end if;

  update public.profiles
  set suspended_at = case when p_suspended then now() end,
      suspended_reason = case when p_suspended then v_reason end
  where id = p_user_id and deleted_at is null
  returning * into v_profile;

  if not found then
    raise exception 'user not found';
  end if;

  return jsonb_build_object(
    'id', v_profile.id,
    'suspended_at', v_profile.suspended_at,
    'suspended_reason', v_profile.suspended_reason
  );
end
$$;

-- ---------------------------------------------------------------------------
-- Complaints
-- ---------------------------------------------------------------------------

create table if not exists public.complaints (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  consumer_id uuid references auth.users(id) on delete set null,
  merchant_id uuid not null references public.merchants(id),
  category text not null
    check (category in ('product', 'quantity', 'pickup', 'payment', 'other')),
  description text not null
    check (char_length(btrim(description)) between 10 and 1000),
  status text not null default 'open'
    check (status in ('open', 'in_review', 'resolved', 'rejected')),
  admin_note text,
  handled_by uuid references auth.users(id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists complaints_consumer_idx
  on public.complaints (consumer_id, created_at desc);
create index if not exists complaints_status_idx
  on public.complaints (status, created_at desc);

drop trigger if exists t_complaints_updated on public.complaints;
create trigger t_complaints_updated before update on public.complaints
  for each row execute function public.touch_updated_at();

alter table public.complaints enable row level security;
revoke all on public.complaints from public, anon, authenticated;
grant select on public.complaints to authenticated;

drop policy if exists complaints_read_own on public.complaints;
create policy complaints_read_own on public.complaints
for select
using (consumer_id = (select auth.uid()));

create or replace function public.submit_complaint(
  p_order_id uuid,
  p_category text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_description text := btrim(coalesce(p_description, ''));
  v_order public.orders;
  v_complaint public.complaints;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  perform private.assert_account_active(v_uid);
  if p_category is null
     or p_category not in ('product', 'quantity', 'pickup', 'payment', 'other') then
    raise exception 'invalid complaint category';
  end if;
  if char_length(v_description) not between 10 and 1000 then
    raise exception 'invalid complaint description';
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id and o.consumer_id = v_uid;

  if not found then
    raise exception 'order not found';
  end if;
  if v_order.payment_verified_at is null then
    raise exception 'order is not eligible for a complaint';
  end if;

  insert into public.complaints (order_id, consumer_id, merchant_id, category, description)
  values (v_order.id, v_uid, v_order.merchant_id, p_category, v_description)
  on conflict (order_id) do nothing
  returning * into v_complaint;

  if v_complaint.id is null then
    raise exception 'complaint already submitted';
  end if;

  return to_jsonb(v_complaint);
end
$$;

create or replace function public.admin_list_complaints(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  perform private.require_admin();
  return (
    select coalesce(jsonb_agg(to_jsonb(row_data)), '[]'::jsonb)
    from (
      select c.id, c.order_id, c.category, c.description, c.status,
             c.admin_note, c.handled_at, c.created_at,
             o.order_reference, o.bag_title, o.total_amount,
             o.status as order_status,
             coalesce(p.name, o.consumer_name, 'Pengguna') as consumer_name,
             p.email as consumer_email,
             m.store_name
      from public.complaints c
      join public.orders o on o.id = c.order_id
      join public.merchants m on m.id = c.merchant_id
      left join public.profiles p on p.id = c.consumer_id
      where p_status is null or c.status = p_status
      order by case c.status
                 when 'open' then 0
                 when 'in_review' then 1
                 else 2
               end,
               c.created_at desc
      limit 500
    ) row_data
  );
end
$$;

create or replace function public.admin_update_complaint(
  p_complaint_id uuid,
  p_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_admin uuid := private.require_admin();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_complaint public.complaints;
begin
  if p_status is null or p_status not in ('in_review', 'resolved', 'rejected') then
    raise exception 'invalid complaint status';
  end if;
  if p_status in ('resolved', 'rejected') and char_length(coalesce(v_note, '')) < 5 then
    raise exception 'complaint follow-up is required';
  end if;

  select * into v_complaint
  from public.complaints c
  where c.id = p_complaint_id
  for update;

  if not found then
    raise exception 'complaint not found';
  end if;
  if v_complaint.status in ('resolved', 'rejected') then
    raise exception 'complaint is already closed';
  end if;

  update public.complaints
  set status = p_status,
      admin_note = coalesce(v_note, admin_note),
      handled_by = v_admin,
      handled_at = now()
  where id = p_complaint_id
  returning * into v_complaint;

  if v_complaint.consumer_id is not null then
    insert into public.notifications
      (user_id, title, body, type, group_label, read, dedupe_key,
       entity_type, entity_id, data)
    values (
      v_complaint.consumer_id,
      case p_status
        when 'in_review' then 'Pengaduan sedang ditinjau'
        when 'resolved' then 'Pengaduan selesai'
        else 'Pengaduan ditolak'
      end,
      coalesce(v_complaint.admin_note, 'Admin sedang meninjau pengaduanmu.'),
      'system', 'Hari ini', false,
      'complaint:' || v_complaint.id || ':' || p_status,
      'complaint', v_complaint.id,
      jsonb_build_object('route', 'orders')
    )
    on conflict (user_id, dedupe_key) do nothing;
  end if;

  return to_jsonb(v_complaint);
end
$$;

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

-- Orders with a gateway-verified payment, which includes Midtrans sandbox
-- payments. A refunded pickup stays `redeemed` on the order, so the payment
-- attempt decides whether the money was kept. No refund amount is stored, so a
-- partial refund counts as not settled.
create or replace function private.verified_orders_between(p_from date, p_to date)
returns table (
  order_id uuid,
  merchant_id uuid,
  paid_day date,
  gross_amount integer,
  merchant_net_amount integer,
  platform_revenue integer,
  order_status text,
  settled boolean
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select o.id,
         o.merchant_id,
         (coalesce(o.paid_at, o.payment_verified_at) at time zone 'Asia/Jakarta')::date,
         o.total_amount,
         coalesce(o.merchant_net_amount, 0),
         coalesce(o.service_fee, 0) + coalesce(o.commission_amount, 0),
         o.status,
         o.status not in ('cancelled', 'refunded')
           and coalesce(pa.status, 'paid') not in ('refunded', 'partial_refund', 'disputed')
  from public.orders o
  left join public.payment_attempts pa on pa.order_id = o.id
  where not o.is_simulation
    and o.payment_verified_at is not null
    and (coalesce(o.paid_at, o.payment_verified_at) at time zone 'Asia/Jakarta')::date
        between p_from and p_to
$$;

revoke all on function private.verified_orders_between(date, date)
  from public, anon, authenticated, service_role;

create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  perform private.require_admin();
  return jsonb_build_object(
    'pending_merchants', (
      select count(*) from public.merchants m
      where m.verification_status = 'pending' and m.deleted_at is null
    ),
    'verified_merchants', (
      select count(*) from public.merchants m
      where m.verification_status = 'verified' and m.deleted_at is null
    ),
    'open_complaints', (
      select count(*) from public.complaints c
      where c.status in ('open', 'in_review')
    ),
    'total_users', (
      select count(*) from public.profiles p where p.deleted_at is null
    ),
    'suspended_users', (
      select count(*) from public.profiles p
      where p.deleted_at is null and p.suspended_at is not null
    ),
    'orders_today', (
      select count(*) from private.verified_orders_between(v_today, v_today) v
      where v.settled
    ),
    'gross_today', (
      select coalesce(sum(v.gross_amount), 0)
      from private.verified_orders_between(v_today, v_today) v
      where v.settled
    ),
    'gross_30d', (
      select coalesce(sum(v.gross_amount), 0)
      from private.verified_orders_between(v_today - 29, v_today) v
      where v.settled
    )
  );
end
$$;

create or replace function public.admin_transaction_report(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
begin
  perform private.require_admin();
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid report period';
  end if;
  if p_to - p_from > 366 then
    raise exception 'report period is too long';
  end if;

  return jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'summary', (
      select jsonb_build_object(
        'verified_orders', count(*),
        'settled_orders', count(*) filter (where v.settled),
        'unsettled_orders', count(*) filter (where not v.settled),
        'completed_orders', count(*) filter (where v.settled and v.order_status = 'redeemed'),
        'gross_amount', coalesce(sum(v.gross_amount) filter (where v.settled), 0),
        'merchant_net_amount', coalesce(sum(v.merchant_net_amount) filter (where v.settled), 0),
        'platform_revenue', coalesce(sum(v.platform_revenue) filter (where v.settled), 0)
      )
      from private.verified_orders_between(p_from, p_to) v
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', days.day,
               'orders', coalesce(totals.orders, 0),
               'gross_amount', coalesce(totals.gross_amount, 0)
             ) order by days.day), '[]'::jsonb)
      from (
        select d::date as day
        from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
      ) days
      left join (
        select v.paid_day, count(*) as orders, sum(v.gross_amount) as gross_amount
        from private.verified_orders_between(p_from, p_to) v
        where v.settled
        group by v.paid_day
      ) totals on totals.paid_day = days.day
    ),
    'top_merchants', (
      select coalesce(jsonb_agg(to_jsonb(ranked)), '[]'::jsonb)
      from (
        select m.id, m.store_name, count(*) as orders,
               sum(v.gross_amount) as gross_amount
        from private.verified_orders_between(p_from, p_to) v
        join public.merchants m on m.id = v.merchant_id
        where v.settled
        group by m.id, m.store_name
        order by sum(v.gross_amount) desc
        limit 5
      ) ranked
    )
  );
end
$$;

-- `create or replace` keeps these grants; they are restated for the audit.
revoke all on function public.current_account_is_active()
  from public, anon;
grant execute on function public.current_account_is_active()
  to authenticated;
revoke all on function public.merchant_is_public(uuid)
  from public, anon, authenticated;
grant execute on function public.merchant_is_public(uuid)
  to anon, authenticated;
revoke all on function public.get_my_merchant()
  from public, anon, authenticated;
grant execute on function public.get_my_merchant() to authenticated;

revoke all on function public.admin_list_merchants(text)
  from public, anon, authenticated;
revoke all on function public.admin_set_merchant_verification(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_list_users(text)
  from public, anon, authenticated;
revoke all on function public.admin_set_user_suspended(uuid, boolean, text)
  from public, anon, authenticated;
revoke all on function public.submit_complaint(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_list_complaints(text)
  from public, anon, authenticated;
revoke all on function public.admin_update_complaint(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.admin_dashboard_stats()
  from public, anon, authenticated;
revoke all on function public.admin_transaction_report(date, date)
  from public, anon, authenticated;

grant execute on function public.admin_list_merchants(text) to authenticated;
grant execute on function public.admin_set_merchant_verification(uuid, text, text) to authenticated;
grant execute on function public.admin_list_users(text) to authenticated;
grant execute on function public.admin_set_user_suspended(uuid, boolean, text) to authenticated;
grant execute on function public.submit_complaint(uuid, text, text) to authenticated;
grant execute on function public.admin_list_complaints(text) to authenticated;
grant execute on function public.admin_update_complaint(uuid, text, text) to authenticated;
grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.admin_transaction_report(date, date) to authenticated;

comment on table public.admin_users is
  'Accounts allowed into the Admin workspace. Granted by an operator with SQL.';
comment on column public.merchants.verification_status is
  'Admin review state. A store is only public once verified.';
comment on table public.complaints is
  'One consumer complaint per paid order, handled by an admin.';

commit;
