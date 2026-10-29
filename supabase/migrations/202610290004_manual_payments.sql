create type public.payment_method as enum ('cash', 'bank_transfer', 'card', 'other');
create type public.payment_adjustment_type as enum ('refund', 'reversal');

revoke all on type public.payment_method, public.payment_adjustment_type from public, anon;
grant usage on type public.payment_method, public.payment_adjustment_type to authenticated;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null,
  amount numeric(14, 2) not null check (amount > 0 and amount <= 100000000000),
  method public.payment_method not null,
  reference text check (reference is null or length(reference) <= 120),
  note text check (note is null or length(note) <= 1000),
  received_at timestamptz not null default now(),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (order_id, business_id)
    references public.orders (id, business_id) on delete restrict
);

create index payments_order_received_idx on public.payments (business_id, order_id, received_at desc);

create table public.payment_adjustments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  payment_id uuid not null,
  adjustment_type public.payment_adjustment_type not null,
  amount numeric(14, 2) not null check (amount > 0 and amount <= 100000000000),
  reason text not null check (length(trim(reason)) between 1 and 1000),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (payment_id, business_id)
    references public.payments (id, business_id) on delete restrict
);

create index payment_adjustments_payment_idx on public.payment_adjustments (business_id, payment_id, created_at desc);

revoke all on public.payments, public.payment_adjustments from anon, authenticated;
grant select on public.payments, public.payment_adjustments to authenticated;

alter table public.payments enable row level security;
alter table public.payment_adjustments enable row level security;

create policy "owners and supervisors can read payment records"
  on public.payments for select to authenticated
  using (
    public.has_business_role(business_id, 'owner')
    or public.has_business_role(business_id, 'supervisor')
  );

create policy "owners and supervisors can read payment adjustments"
  on public.payment_adjustments for select to authenticated
  using (
    public.has_business_role(business_id, 'owner')
    or public.has_business_role(business_id, 'supervisor')
  );

create or replace function public.record_manual_payment(
  p_order_id uuid,
  p_amount numeric,
  p_method public.payment_method,
  p_reference text default null,
  p_note text default null,
  p_received_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_business_id uuid;
  v_stage public.order_stage;
  v_role public.business_member_role;
  v_order_total numeric;
  v_payment_total numeric;
  v_adjustment_total numeric;
  v_payment_id uuid;
begin
  if v_user_id is null then raise exception 'You must sign in to record a payment.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 then raise exception 'Enter a valid payment amount.'; end if;
  if p_method is null then raise exception 'Choose a payment method.'; end if;

  select business_id, stage into v_business_id, v_stage
  from public.orders where id = p_order_id for update;
  if v_business_id is null then raise exception 'Order not found.'; end if;
  if v_stage = 'cancelled' then raise exception 'Payments cannot be added to a cancelled order.'; end if;

  select role into v_role from public.business_memberships
  where business_id = v_business_id and user_id = v_user_id and is_active = true;
  if v_role is null or v_role not in ('owner', 'supervisor') then raise exception 'Owner or supervisor access is required.'; end if;

  select coalesce(sum(item.quantity * price.unit_price), 0) into v_order_total
  from public.order_items as item
  join public.order_item_prices as price
    on price.order_item_id = item.id and price.business_id = item.business_id
  where item.business_id = v_business_id and item.order_id = p_order_id;
  select coalesce(sum(payment.amount), 0) into v_payment_total
  from public.payments as payment where payment.business_id = v_business_id and payment.order_id = p_order_id;
  select coalesce(sum(adjustment.amount), 0) into v_adjustment_total
  from public.payment_adjustments as adjustment
  join public.payments as payment on payment.id = adjustment.payment_id and payment.business_id = adjustment.business_id
  where adjustment.business_id = v_business_id and payment.order_id = p_order_id;

  if p_amount > v_order_total - v_payment_total + v_adjustment_total then
    raise exception 'Payment exceeds the order balance.';
  end if;

  insert into public.payments (business_id, order_id, amount, method, reference, note, received_at, recorded_by)
  values (v_business_id, p_order_id, p_amount, p_method, nullif(trim(p_reference), ''), nullif(trim(p_note), ''), coalesce(p_received_at, now()), v_user_id)
  returning id into v_payment_id;
  return v_payment_id;
end;
$$;

create or replace function public.record_payment_adjustment(
  p_payment_id uuid,
  p_adjustment_type public.payment_adjustment_type,
  p_amount numeric,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_business_id uuid;
  v_order_id uuid;
  v_payment_amount numeric;
  v_adjusted_amount numeric;
  v_role public.business_member_role;
  v_adjustment_id uuid;
begin
  if v_user_id is null then raise exception 'You must sign in to adjust a payment.'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000000000 then raise exception 'Enter a valid adjustment amount.'; end if;
  if p_adjustment_type is null then raise exception 'Choose refund or reversal.'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 or length(p_reason) > 1000 then raise exception 'Explain the payment adjustment.'; end if;

  select business_id, order_id, amount into v_business_id, v_order_id, v_payment_amount
  from public.payments where id = p_payment_id for update;
  if v_business_id is null then raise exception 'Payment not found.'; end if;
  perform 1 from public.orders where id = v_order_id for update;

  select role into v_role from public.business_memberships
  where business_id = v_business_id and user_id = v_user_id and is_active = true;
  if v_role is null or v_role not in ('owner', 'supervisor') then raise exception 'Owner or supervisor access is required.'; end if;

  select coalesce(sum(amount), 0) into v_adjusted_amount
  from public.payment_adjustments where business_id = v_business_id and payment_id = p_payment_id;
  if p_amount > v_payment_amount - v_adjusted_amount then
    raise exception 'Adjustments cannot exceed the remaining amount of this payment.';
  end if;

  insert into public.payment_adjustments (business_id, payment_id, adjustment_type, amount, reason, recorded_by)
  values (v_business_id, p_payment_id, p_adjustment_type, p_amount, trim(p_reason), v_user_id)
  returning id into v_adjustment_id;
  return v_adjustment_id;
end;
$$;

revoke all on function public.record_manual_payment(uuid, numeric, public.payment_method, text, text, timestamptz) from public, anon;
revoke all on function public.record_payment_adjustment(uuid, public.payment_adjustment_type, numeric, text) from public, anon;
grant execute on function public.record_manual_payment(uuid, numeric, public.payment_method, text, text, timestamptz) to authenticated;
grant execute on function public.record_payment_adjustment(uuid, public.payment_adjustment_type, numeric, text) to authenticated;
