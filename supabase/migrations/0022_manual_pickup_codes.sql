-- Merchant desktop pickup codes.
-- Keep the low-entropy code hash outside public so authenticated clients cannot
-- enumerate hashes from the orders table. Existing SB2_ QR tokens and the
-- public.redeem_order(text) contract used by Flutter are unchanged.

begin;

create table if not exists private.pickup_manual_codes (
  order_id uuid primary key references public.orders(id) on delete cascade,
  code_hash bytea not null unique check (octet_length(code_hash) = 32),
  expires_at timestamptz not null,
  issued_at timestamptz not null default now()
);
alter table private.pickup_manual_codes enable row level security;
revoke all on table private.pickup_manual_codes from public, anon, authenticated, service_role;

create table if not exists private.pickup_manual_code_attempts (
  id bigint generated always as identity primary key,
  merchant_id uuid not null references public.merchants(id) on delete cascade,
  failed_at timestamptz not null default now()
);
create index if not exists pickup_manual_attempts_merchant_time_idx
  on private.pickup_manual_code_attempts (merchant_id, failed_at desc);
alter table private.pickup_manual_code_attempts enable row level security;
revoke all on table private.pickup_manual_code_attempts from public, anon, authenticated, service_role;

create or replace function public.issue_pickup_manual_code(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders;
  v_code text;
  v_expires_at timestamptz;
  v_previous_hash bytea;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found or v_order.consumer_id is distinct from v_uid then
    raise exception 'order not found';
  end if;
  if v_order.status <> 'ready'
     or v_order.payment_verified_at is null
     or not private.pickup_payment_is_verified(v_order.id) then
    raise exception 'order is not redeemable';
  end if;
  if v_order.expires_at <= now() then
    raise exception 'order has expired';
  end if;
  if v_order.pickup_start_at is not null
     and now() < v_order.pickup_start_at then
    raise exception 'pickup window has not started';
  end if;
  if v_order.pickup_end_at is not null
     and now() >= v_order.pickup_end_at then
    raise exception 'pickup window has ended';
  end if;

  v_expires_at := least(
    now() + interval '5 minutes',
    v_order.expires_at,
    coalesce(v_order.pickup_end_at, v_order.expires_at)
  );

  -- Serialize issuance so a concurrent request cannot claim the same 8 digits.
  perform pg_advisory_xact_lock(hashtext('savebite:manual-pickup-code'));
  delete from private.pickup_manual_codes where expires_at <= now();
  select code_hash into v_previous_hash from private.pickup_manual_codes where order_id = v_order.id;

  -- Use cryptographic randomness and retain leading zeroes.
  loop
    v_code := lpad(
      ((('x' || encode(extensions.gen_random_bytes(4), 'hex'))::bit(32)::bigint)
        % 100000000)::text,
      8,
      '0'
    );
    exit when extensions.digest(v_code, 'sha256') is distinct from v_previous_hash
      and not exists (
        select 1
        from private.pickup_manual_codes c
        where c.order_id <> v_order.id
          and c.code_hash = extensions.digest(v_code, 'sha256')
          and c.expires_at > now()
      );
  end loop;

  insert into private.pickup_manual_codes (order_id, code_hash, expires_at, issued_at)
  values (v_order.id, extensions.digest(v_code, 'sha256'), v_expires_at, now())
  on conflict (order_id) do update
    set code_hash = excluded.code_hash,
        expires_at = excluded.expires_at,
        issued_at = excluded.issued_at;

  return jsonb_build_object(
    'order_id', v_order.id,
    'order_reference', v_order.order_reference,
    'code', v_code,
    'expires_at', v_expires_at
  );
end
$$;

create or replace function public.redeem_manual_pickup_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, extensions, pg_catalog
as $$
declare
  v_uid uuid := auth.uid();
  v_merchant_id uuid;
  v_order public.orders;
  v_attempts integer;
  v_code text := btrim(coalesce(p_code, ''));
  v_message text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select id into v_merchant_id
  from public.merchants
  where user_id = v_uid and deleted_at is null
  limit 1;
  if v_merchant_id is null then
    raise exception 'merchant not found';
  end if;

  -- Serialize attempts per merchant so parallel requests cannot exceed the
  -- configured rolling window.
  perform pg_advisory_xact_lock(hashtextextended(v_merchant_id::text, 0));
  delete from private.pickup_manual_code_attempts
  where merchant_id = v_merchant_id and failed_at < now() - interval '24 hours';

  select count(*)::integer into v_attempts
  from private.pickup_manual_code_attempts
  where merchant_id = v_merchant_id
    and failed_at > now() - interval '15 minutes';

  if v_attempts >= 5 then
    return jsonb_build_object(
      'ok', false,
      'code', 'too_many_attempts',
      'message', 'Terlalu banyak percobaan gagal. Coba lagi setelah 15 menit.'
    );
  end if;

  if v_code !~ '^[0-9]{8}$' then
    insert into private.pickup_manual_code_attempts (merchant_id) values (v_merchant_id);
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_pickup_code',
      'message', 'Kode pickup harus terdiri dari 8 angka.'
    );
  end if;

  select o.* into v_order
  from private.pickup_manual_codes c
  join public.orders o on o.id = c.order_id
  where c.code_hash = extensions.digest(v_code, 'sha256')
  for update of c, o;

  if not found or v_order.merchant_id is distinct from v_merchant_id then
    insert into private.pickup_manual_code_attempts (merchant_id) values (v_merchant_id);
    return jsonb_build_object(
      'ok', false,
      'code', 'invalid_pickup_code',
      'message', 'Kode tidak valid atau bukan untuk toko ini.'
    );
  end if;

  if v_order.status <> 'ready'
     or v_order.payment_verified_at is null
     or not private.pickup_payment_is_verified(v_order.id) then
    v_message := 'Pesanan belum siap atau pembayarannya belum terverifikasi.';
  elsif not exists (
    select 1 from private.pickup_manual_codes c
    where c.order_id = v_order.id
      and c.expires_at > now()
  ) then
    v_message := 'Kode pickup sudah kedaluwarsa.';
  elsif v_order.expires_at <= now() then
    v_message := 'Masa berlaku pesanan sudah berakhir.';
  elsif v_order.pickup_start_at is not null and now() < v_order.pickup_start_at then
    v_message := 'Jendela pickup belum dimulai.';
  elsif v_order.pickup_end_at is not null and now() >= v_order.pickup_end_at then
    v_message := 'Jendela pickup sudah berakhir.';
  end if;

  if v_message is not null then
    insert into private.pickup_manual_code_attempts (merchant_id) values (v_merchant_id);
    return jsonb_build_object(
      'ok', false,
      'code', 'pickup_not_eligible',
      'message', v_message
    );
  end if;

  update public.orders
  set status = 'redeemed',
      redeemed_at = now(),
      pickup_token_used_at = case when pickup_token_hash is not null then now() else pickup_token_used_at end,
      pickup_token_hash = null,
      pickup_code_hint = null,
      pickup_token_issued_at = null,
      pickup_token_expires_at = null
  where id = v_order.id
  returning * into v_order;

  delete from private.pickup_manual_codes where order_id = v_order.id;

  insert into public.transactions
    (merchant_id, title, subtitle, amount, kind, reference_type,
     reference_id, idempotency_key, metadata, created_by)
  values
    (v_order.merchant_id,
     'Order ' || v_order.order_reference,
     'Pendapatan bersih setelah komisi Rp' || v_order.commission_amount,
     v_order.merchant_net_amount, 'income', 'order', v_order.id,
     'order:' || v_order.id, jsonb_build_object(
       'subtotal', v_order.subtotal,
       'commission_amount', v_order.commission_amount,
       'service_fee', v_order.service_fee
     ), v_uid)
  on conflict (reference_type, reference_id, kind)
    where reference_type is not null and reference_id is not null
    do nothing;

  update public.merchants
  set bags_saved = bags_saved + v_order.quantity
  where id = v_order.merchant_id;

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'order_reference', v_order.order_reference,
    'pickup_code', v_order.order_reference,
    'quantity', v_order.quantity,
    'customer_name', v_order.consumer_name,
    'bag_title', v_order.bag_title,
    'created_at', v_order.created_at,
    'redeemed_at', v_order.redeemed_at,
    'merchant_net_amount', v_order.merchant_net_amount
  );
end
$$;

revoke all on function public.issue_pickup_manual_code(uuid)
  from public, anon, authenticated;
revoke all on function public.redeem_manual_pickup_code(text)
  from public, anon, authenticated;
grant execute on function public.issue_pickup_manual_code(uuid)
  to authenticated;
grant execute on function public.redeem_manual_pickup_code(text)
  to authenticated;

comment on function public.issue_pickup_manual_code(uuid) is
  'Returns a one-time 8-digit pickup code to the owning consumer. Stores only its SHA-256 hash and expires after five minutes or the order pickup deadline.';
comment on function public.redeem_manual_pickup_code(text) is
  'Merchant-only one-time redemption for an 8-digit pickup code, with payment, merchant, expiry, pickup-window, replay and rolling attempt-limit checks.';

commit;
