alter table public.order_items add column estimated_hours numeric(8,2) not null default 8 check (estimated_hours > 0 and estimated_hours <= 500);
alter table public.order_items add column line_number integer;
with numbered as (
  select id, row_number() over (partition by order_id order by created_at, id)::integer as position
  from public.order_items
)
update public.order_items item set line_number = numbered.position from numbered where numbered.id = item.id;
alter table public.order_items alter column line_number set not null;
create unique index order_items_order_line_idx on public.order_items(order_id, line_number);

create or replace function public.set_order_item_line_number()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.line_number is null then
    select coalesce(max(item.line_number), 0) + 1 into new.line_number
    from public.order_items item where item.order_id = new.order_id;
  end if;
  return new;
end;
$$;
create trigger order_items_assign_line_number before insert on public.order_items
  for each row execute function public.set_order_item_line_number();

alter table public.orders add column is_express boolean not null default false;

create table public.business_production_settings (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  express_fee_percentage numeric(5,2) not null default 25 check (express_fee_percentage between 0 and 100),
  updated_at timestamptz not null default now()
);
insert into public.business_production_settings(business_id) select id from public.businesses on conflict (business_id) do nothing;
revoke all on public.business_production_settings from public, anon, authenticated;
grant select on public.business_production_settings to authenticated;
alter table public.business_production_settings enable row level security;
create policy "owners and supervisors can read production settings" on public.business_production_settings
  for select to authenticated using (public.has_business_role(business_id, 'owner') or public.has_business_role(business_id, 'supervisor'));

create table public.order_express_charges (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null unique, fee_percentage numeric(5,2) not null check (fee_percentage between 0 and 100),
  amount numeric(14,2) not null check (amount >= 0 and amount <= 100000000000), created_at timestamptz not null default now(),
  foreign key (order_id, business_id) references public.orders(id, business_id) on delete restrict
);
create index order_express_charges_business_order_idx on public.order_express_charges(business_id, order_id);
revoke all on public.order_express_charges from public, anon, authenticated;
grant select on public.order_express_charges to authenticated;
alter table public.order_express_charges enable row level security;
create policy "owners and supervisors can read express charges" on public.order_express_charges
  for select to authenticated using (public.has_business_role(business_id, 'owner') or public.has_business_role(business_id, 'supervisor'));

create or replace function public.update_business_express_fee_percentage(p_percentage numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid()); v_business uuid;
begin
  if p_percentage is null or p_percentage < 0 or p_percentage > 100 then raise exception 'Enter an express fee percentage between 0 and 100.'; end if;
  select business_id into v_business from public.business_memberships
    where user_id = v_user and is_active and role = 'owner' order by created_at limit 1;
  if v_business is null then raise exception 'Owner access is required.'; end if;
  insert into public.business_production_settings(business_id, express_fee_percentage, updated_at)
    values (v_business, p_percentage, now())
    on conflict (business_id) do update set express_fee_percentage = excluded.express_fee_percentage, updated_at = now();
end;
$$;
revoke all on function public.update_business_express_fee_percentage(numeric) from public, anon;
grant execute on function public.update_business_express_fee_percentage(numeric) to authenticated;

create or replace function public.create_order_with_capacity(
  p_customer_id uuid, p_measurement_session_id uuid, p_due_date date, p_fitting_date date,
  p_pickup_date date, p_delivery_date date, p_fulfillment_method public.fulfillment_method,
  p_notes text, p_items jsonb, p_voucher_id uuid, p_is_express boolean
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := (select auth.uid()); v_business uuid; v_tailors integer; v_queued_hours numeric := 0;
  v_new_hours numeric := 0; v_throughput numeric; v_days integer; v_workdays integer := 0;
  v_feasible_date date; v_order uuid; v_item jsonb; v_position integer := 0;
  v_subtotal numeric := 0; v_discount numeric := 0; v_fee_percentage numeric := 0; v_fee numeric := 0;
begin
  if v_user is null then raise exception 'Sign in to create an order.'; end if;
  select business_id into v_business from public.business_memberships
    where user_id = v_user and is_active and role in ('owner', 'supervisor') order by created_at limit 1;
  if v_business is null then raise exception 'Owner or supervisor access is required.'; end if;
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Order garments must be provided as a list.'; end if;
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if coalesce((v_item->>'estimated_hours')::numeric, 0) <= 0 or (v_item->>'estimated_hours')::numeric > 500 then
      raise exception 'Each garment needs an estimated labor duration greater than 0 and no more than 500 hours.';
    end if;
    v_new_hours := v_new_hours + coalesce((v_item->>'quantity')::numeric, 1) * (v_item->>'estimated_hours')::numeric;
  end loop;
  select count(*)::integer into v_tailors from public.business_memberships
    where business_id = v_business and is_active and role = 'tailor';
  select coalesce(sum(item.quantity * item.estimated_hours), 0) into v_queued_hours
    from public.orders studio_order join public.order_items item on item.order_id = studio_order.id and item.business_id = studio_order.business_id
    where studio_order.business_id = v_business and studio_order.stage = 'in_production' and studio_order.fulfilled_at is null;
  v_throughput := v_tailors * 8;
  if v_throughput > 0 then
    v_days := ceil((v_queued_hours + v_new_hours) / v_throughput)::integer + 1;
    v_feasible_date := timezone('Africa/Lagos', now())::date;
    while v_workdays < v_days loop
      v_feasible_date := v_feasible_date + 1;
      if extract(isodow from v_feasible_date) < 6 then v_workdays := v_workdays + 1; end if;
    end loop;
    if p_due_date is not null and p_due_date < v_feasible_date and not coalesce(p_is_express, false) then
      raise exception 'This date is ahead of studio capacity. Apply express fee?';
    end if;
    if coalesce(p_is_express, false) and (p_due_date is null or p_due_date >= v_feasible_date) then
      raise exception 'Express orders need a ready date earlier than the suggested capacity date.';
    end if;
  elsif coalesce(p_is_express, false) then
    raise exception 'Add an active tailor before accepting an express order.';
  end if;

  v_order := public.create_order_with_voucher(p_customer_id, p_measurement_session_id, p_due_date, p_fitting_date,
    p_pickup_date, p_delivery_date, p_fulfillment_method, p_notes, p_items, p_voucher_id);
  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_position := v_position + 1;
    update public.order_items set estimated_hours = (v_item->>'estimated_hours')::numeric
      where order_id = v_order and business_id = v_business and line_number = v_position;
    v_subtotal := v_subtotal + (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric;
  end loop;
  if p_is_express then
    select coalesce(discount.discount_amount, 0) into v_discount from (select 1) seed
      left join public.order_voucher_discounts discount on discount.order_id = v_order and discount.business_id = v_business;
    select express_fee_percentage into v_fee_percentage from public.business_production_settings where business_id = v_business;
    v_fee := round(greatest(0, v_subtotal - v_discount) * coalesce(v_fee_percentage, 25) / 100, 2);
    update public.orders set is_express = true where id = v_order and business_id = v_business;
    insert into public.order_express_charges(business_id, order_id, fee_percentage, amount)
      values (v_business, v_order, coalesce(v_fee_percentage, 25), v_fee);
    update public.order_activity set details = details || jsonb_build_object('is_express', true, 'express_fee', v_fee)
      where order_id = v_order and activity_type = 'created';
  end if;
  return v_order;
end;
$$;
revoke all on function public.create_order_with_capacity(uuid,uuid,date,date,date,date,public.fulfillment_method,text,jsonb,uuid,boolean) from public, anon;
grant execute on function public.create_order_with_capacity(uuid,uuid,date,date,date,date,public.fulfillment_method,text,jsonb,uuid,boolean) to authenticated;


-- Keep future studio records initialized with the default 25% express rate.
create or replace function public.initialize_business_production_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.business_production_settings(business_id) values (new.id) on conflict (business_id) do nothing;
  return new;
end;
$$;
create trigger businesses_initialize_production_settings after insert on public.businesses
  for each row execute function public.initialize_business_production_settings();

-- Order creation must go through the capacity-aware transactional RPC.
revoke all on function public.create_order(uuid,uuid,date,date,date,date,public.fulfillment_method,text,jsonb) from public, anon, authenticated;
revoke all on function public.create_order_with_voucher(uuid,uuid,date,date,date,date,public.fulfillment_method,text,jsonb,uuid) from public, anon, authenticated;


create or replace function public.record_manual_payment(p_order_id uuid,p_amount numeric,p_method public.payment_method,p_reference text default null,p_note text default null,p_received_at timestamptz default now())
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid()); v_business uuid; v_stage public.order_stage; v_role public.business_member_role; v_total numeric; v_paid numeric; v_adjustments numeric; v_payment uuid;
begin
 if v_user is null then raise exception 'You must sign in to record a payment.'; end if;
 if p_amount is null or p_amount<=0 or p_amount>100000000000 then raise exception 'Enter a valid payment amount.'; end if;
 if p_method is null then raise exception 'Choose a payment method.'; end if;
 select business_id,stage into v_business,v_stage from public.orders where id=p_order_id for update;
 if v_business is null then raise exception 'Order not found.'; end if;
 if v_stage='cancelled' then raise exception 'Payments cannot be added to a cancelled order.'; end if;
 select role into v_role from public.business_memberships where business_id=v_business and user_id=v_user and is_active;
 if v_role is null or v_role not in ('owner','supervisor') then raise exception 'Owner or supervisor access is required.'; end if;
 select greatest(0,coalesce(sum(i.quantity*p.unit_price),0)-coalesce(d.discount_amount,0)+coalesce(rush.amount,0)) into v_total
 from public.orders o left join public.order_items i on i.order_id=o.id and i.business_id=o.business_id
 left join public.order_item_prices p on p.order_item_id=i.id and p.business_id=i.business_id
 left join public.order_voucher_discounts d on d.order_id=o.id and d.business_id=o.business_id
 left join public.order_express_charges rush on rush.order_id=o.id and rush.business_id=o.business_id
 where o.id=p_order_id and o.business_id=v_business group by d.discount_amount,rush.amount;
 select coalesce(sum(amount),0) into v_paid from public.payments where business_id=v_business and order_id=p_order_id;
 select coalesce(sum(a.amount),0) into v_adjustments from public.payment_adjustments a join public.payments p on p.id=a.payment_id and p.business_id=a.business_id where a.business_id=v_business and p.order_id=p_order_id;
 if p_amount>v_total-v_paid+v_adjustments then raise exception 'Payment exceeds the order balance.'; end if;
 insert into public.payments(business_id,order_id,amount,method,reference,note,received_at,recorded_by) values(v_business,p_order_id,p_amount,p_method,nullif(trim(p_reference),''),nullif(trim(p_note),''),coalesce(p_received_at,now()),v_user) returning id into v_payment;
 return v_payment;
end; $$;
