create type public.voucher_status as enum ('active', 'redeemed', 'expired');
revoke all on type public.voucher_status from public, anon;
grant usage on type public.voucher_status to authenticated;

create table public.vouchers (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
  code text not null unique check (code ~ '^MW-[A-HJ-NP-Z2-9]{4}$'), customer_id uuid not null,
  discount_percentage smallint not null default 15 check (discount_percentage between 1 and 100),
  status public.voucher_status not null default 'active', source_order_id uuid not null unique,
  expires_at timestamptz not null default (now() + interval '30 days'), redeemed_order_id uuid, redeemed_at timestamptz,
  created_at timestamptz not null default now(), unique (id, business_id),
  foreign key (customer_id, business_id) references public.customers(id, business_id) on delete restrict,
  foreign key (source_order_id, business_id) references public.orders(id, business_id) on delete restrict,
  foreign key (redeemed_order_id, business_id) references public.orders(id, business_id) on delete restrict,
  check ((status = 'redeemed') = (redeemed_order_id is not null and redeemed_at is not null))
);
create index vouchers_customer_active_idx on public.vouchers (business_id, customer_id, expires_at) where status = 'active';
create table public.order_voucher_discounts (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
 order_id uuid not null, voucher_id uuid not null, discount_percentage smallint not null check (discount_percentage between 1 and 100),
 discount_amount numeric(14,2) not null check (discount_amount >= 0), created_at timestamptz not null default now(),
 unique (order_id), unique (voucher_id), unique (id,business_id),
 foreign key (order_id,business_id) references public.orders(id,business_id) on delete restrict,
 foreign key (voucher_id,business_id) references public.vouchers(id,business_id) on delete restrict
);
create index order_voucher_discount_business_idx on public.order_voucher_discounts(business_id,order_id);

create table public.voucher_activity (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
 voucher_id uuid not null, event_type text not null check (event_type in ('created','redeemed','expired')), order_id uuid,
 actor_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
 foreign key (voucher_id,business_id) references public.vouchers(id,business_id) on delete restrict,
 foreign key (order_id,business_id) references public.orders(id,business_id) on delete restrict
);
create index voucher_activity_voucher_idx on public.voucher_activity(business_id,voucher_id,created_at desc);
revoke all on public.vouchers,public.voucher_activity,public.order_voucher_discounts from public,anon,authenticated;
grant select on public.vouchers,public.voucher_activity,public.order_voucher_discounts to authenticated;
alter table public.vouchers enable row level security;
alter table public.voucher_activity enable row level security;
alter table public.order_voucher_discounts enable row level security;
create policy "owners and supervisors can read vouchers" on public.vouchers for select to authenticated using (public.has_business_role(business_id,'owner') or public.has_business_role(business_id,'supervisor'));
create policy "owners and supervisors can read order voucher discounts" on public.order_voucher_discounts for select to authenticated using (public.has_business_role(business_id,'owner') or public.has_business_role(business_id,'supervisor'));
create policy "owners and supervisors can read voucher history" on public.voucher_activity for select to authenticated using (public.has_business_role(business_id,'owner') or public.has_business_role(business_id,'supervisor'));

create or replace function public.get_or_create_order_voucher(p_order_id uuid)
returns table(id uuid,code text,discount_percentage smallint,status public.voucher_status,expires_at timestamptz,customer_phone text,customer_name text,order_ref text)
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid()); v_business uuid; v_customer uuid; v_stage public.order_stage; v_fulfilled timestamptz; v_phone text; v_name text; v_ref text; v_id uuid; v_code text; v_chars constant text:='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; v_try integer;
begin
 if v_user is null then raise exception 'Sign in to create a voucher link.'; end if;
 select o.business_id,o.customer_id,o.stage,o.fulfilled_at,c.phone,trim(c.first_name||' '||c.last_name),o.order_ref into v_business,v_customer,v_stage,v_fulfilled,v_phone,v_name,v_ref from public.orders o join public.customers c on c.id=o.customer_id and c.business_id=o.business_id where o.id=p_order_id and c.archived_at is null;
 if v_business is null then raise exception 'Order or active customer not found.'; end if;
 if not exists(select 1 from public.business_memberships m where m.business_id=v_business and m.user_id=v_user and m.is_active and m.role in ('owner','supervisor')) then raise exception 'Owner or supervisor access is required.'; end if;
 if v_stage<>'completed' or v_fulfilled is null then raise exception 'A voucher is available after the order is completed.'; end if;
 update public.vouchers set status='expired' where source_order_id=p_order_id and status='active' and expires_at<=now();
 insert into public.voucher_activity(business_id,voucher_id,event_type,order_id) select v.business_id,v.id,'expired',p_order_id from public.vouchers v where v.source_order_id=p_order_id and v.status='expired' and not exists(select 1 from public.voucher_activity a where a.voucher_id=v.id and a.event_type='expired');
 select voucher.id into v_id from public.vouchers voucher where voucher.source_order_id=p_order_id;
 if v_id is null then
  for v_try in 1..20 loop
   v_code:='MW-'||(select string_agg(substr(v_chars,floor(random()*length(v_chars)+1)::integer,1),'') from generate_series(1,4));
   begin
    insert into public.vouchers(business_id,code,customer_id,source_order_id) values(v_business,v_code,v_customer,p_order_id) returning vouchers.id into v_id;
    insert into public.voucher_activity(business_id,voucher_id,event_type,order_id,actor_id) values(v_business,v_id,'created',p_order_id,v_user); exit;
   exception when unique_violation then select voucher.id into v_id from public.vouchers voucher where voucher.source_order_id=p_order_id; if v_id is not null then exit; end if; v_id:=null;
   end;
  end loop;
 end if;
 if v_id is null then raise exception 'Could not allocate a voucher code. Try again.'; end if;
 return query select v.id,v.code,v.discount_percentage,v.status,v.expires_at,v_phone,v_name,v_ref from public.vouchers v where v.id=v_id;
end; $$;

create or replace function public.list_active_customer_vouchers(p_customer_id uuid)
returns table(id uuid,code text,discount_percentage smallint,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_user uuid:=(select auth.uid()); v_business uuid;
begin
 select business_id into v_business from public.business_memberships where user_id=v_user and is_active and role in ('owner','supervisor') order by created_at limit 1;
 if v_business is null then raise exception 'Owner or supervisor access is required.'; end if;
 update public.vouchers set status='expired' where business_id=v_business and customer_id=p_customer_id and status='active' and expires_at<=now();
 insert into public.voucher_activity(business_id,voucher_id,event_type) select v.business_id,v.id,'expired' from public.vouchers v where v.business_id=v_business and v.customer_id=p_customer_id and v.status='expired' and not exists(select 1 from public.voucher_activity a where a.voucher_id=v.id and a.event_type='expired');
 return query select v.id,v.code,v.discount_percentage,v.expires_at from public.vouchers v where v.business_id=v_business and v.customer_id=p_customer_id and v.status='active' and v.expires_at>now() order by v.expires_at;
end; $$;

create or replace function public.create_order_with_voucher(p_customer_id uuid,p_measurement_session_id uuid,p_due_date date,p_fitting_date date,p_pickup_date date,p_delivery_date date,p_fulfillment_method public.fulfillment_method,p_notes text,p_items jsonb,p_voucher_id uuid default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_business uuid; v_order uuid; v_voucher public.vouchers%rowtype; v_subtotal numeric;
begin
 if p_voucher_id is not null then
  select business_id into v_business from public.business_memberships where user_id=(select auth.uid()) and is_active and role in ('owner','supervisor') order by created_at limit 1;
  if v_business is null then raise exception 'Owner or supervisor access is required.'; end if;
  select * into v_voucher from public.vouchers where id=p_voucher_id and business_id=v_business for update;
  if not found or v_voucher.status<>'active' or v_voucher.expires_at<=now() then raise exception 'This voucher is no longer active.'; end if;
  if v_voucher.customer_id<>p_customer_id then raise exception 'This voucher belongs to a different customer.'; end if;
 end if;
 v_order:=public.create_order(p_customer_id,p_measurement_session_id,p_due_date,p_fitting_date,p_pickup_date,p_delivery_date,p_fulfillment_method,p_notes,p_items);
 if p_voucher_id is not null then
  select coalesce(sum(i.quantity*p.unit_price),0) into v_subtotal from public.order_items i join public.order_item_prices p on p.order_item_id=i.id and p.business_id=i.business_id where i.order_id=v_order and i.business_id=v_business;
  insert into public.order_voucher_discounts(business_id,order_id,voucher_id,discount_percentage,discount_amount) values(v_business,v_order,v_voucher.id,v_voucher.discount_percentage,round(v_subtotal*v_voucher.discount_percentage/100.0,2));
  update public.vouchers set status='redeemed',redeemed_order_id=v_order,redeemed_at=now() where id=v_voucher.id;
  insert into public.voucher_activity(business_id,voucher_id,event_type,order_id,actor_id) values(v_business,v_voucher.id,'redeemed',v_order,(select auth.uid()));
 end if;
 return v_order;
end; $$;
revoke all on function public.get_or_create_order_voucher(uuid) from public,anon;
revoke all on function public.list_active_customer_vouchers(uuid) from public,anon;
revoke all on function public.create_order_with_voucher(uuid,uuid,date,date,date,date,public.fulfillment_method,text,jsonb,uuid) from public,anon;
grant execute on function public.get_or_create_order_voucher(uuid) to authenticated;
grant execute on function public.list_active_customer_vouchers(uuid) to authenticated;
grant execute on function public.create_order_with_voucher(uuid,uuid,date,date,date,date,public.fulfillment_method,text,jsonb,uuid) to authenticated;

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
 select greatest(0,coalesce(sum(i.quantity*p.unit_price),0)-coalesce(d.discount_amount,0)) into v_total from public.orders o left join public.order_items i on i.order_id=o.id and i.business_id=o.business_id left join public.order_item_prices p on p.order_item_id=i.id and p.business_id=i.business_id left join public.order_voucher_discounts d on d.order_id=o.id and d.business_id=o.business_id where o.id=p_order_id and o.business_id=v_business group by d.discount_amount;
 select coalesce(sum(amount),0) into v_paid from public.payments where business_id=v_business and order_id=p_order_id;
 select coalesce(sum(a.amount),0) into v_adjustments from public.payment_adjustments a join public.payments p on p.id=a.payment_id and p.business_id=a.business_id where a.business_id=v_business and p.order_id=p_order_id;
 if p_amount>v_total-v_paid+v_adjustments then raise exception 'Payment exceeds the order balance.'; end if;
 insert into public.payments(business_id,order_id,amount,method,reference,note,received_at,recorded_by) values(v_business,p_order_id,p_amount,p_method,nullif(trim(p_reference),''),nullif(trim(p_note),''),coalesce(p_received_at,now()),v_user) returning id into v_payment;
 return v_payment;
end; $$;
