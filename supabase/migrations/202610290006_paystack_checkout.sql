create table public.paystack_checkout_requests (
 id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id) on delete cascade,
 order_id uuid not null, customer_id uuid not null, initiated_by uuid not null references auth.users(id) on delete restrict,
 reference text not null unique, amount numeric(14,2) not null check(amount>0 and amount<=100000000000),
 status text not null default 'pending' check(status in ('pending','succeeded','failed','expired')), payment_id uuid,
 expires_at timestamptz not null default(now()+interval '30 minutes'), created_at timestamptz not null default now(),
 completed_at timestamptz, provider_transaction_id text,
 foreign key(order_id,business_id) references public.orders(id,business_id) on delete restrict,
 foreign key(customer_id,business_id) references public.customers(id,business_id) on delete restrict,
 foreign key(payment_id,business_id) references public.payments(id,business_id) on delete restrict
);
create index paystack_checkout_pending_order_idx on public.paystack_checkout_requests(business_id,order_id,expires_at) where status='pending';
revoke all on public.paystack_checkout_requests from public,anon,authenticated;
alter table public.paystack_checkout_requests enable row level security;
create or replace function public.create_paystack_checkout_request(p_order_id uuid,p_amount numeric)
returns table(request_id uuid,reference text,amount numeric,customer_email text,customer_name text)
language plpgsql security definer set search_path='' as $$
declare v_user_id uuid:=(select auth.uid()); v_business_id uuid; v_customer_id uuid; v_stage public.order_stage;
v_email text; v_customer_name text; v_total numeric; v_received numeric; v_reserved numeric; v_reference text; v_request_id uuid;
begin
 if v_user_id is null then raise exception 'Sign in to start checkout.'; end if;
 if p_amount is null or p_amount<=0 or round(p_amount*100)<>p_amount*100 then raise exception 'Enter a valid amount in naira.'; end if;
 select o.business_id,o.customer_id,o.stage,c.email,trim(c.first_name||' '||c.last_name) into v_business_id,v_customer_id,v_stage,v_email,v_customer_name
 from public.orders o join public.customers c on c.id=o.customer_id and c.business_id=o.business_id where o.id=p_order_id and c.archived_at is null for update of o;
 if v_business_id is null then raise exception 'Order not found.'; end if;
 if v_stage='cancelled' then raise exception 'Cancelled orders cannot be paid.'; end if;
 if v_email is null or position('@' in v_email)<2 then raise exception 'Add a valid email address to the customer record before online checkout.'; end if;
 if not exists(select 1 from public.business_memberships m where m.business_id=v_business_id and m.user_id=v_user_id and m.is_active and m.role in ('owner','supervisor')) then raise exception 'Owner or supervisor access is required.'; end if;
 select coalesce(sum(i.quantity*p.unit_price),0) into v_total from public.order_items i join public.order_item_prices p on p.order_item_id=i.id and p.business_id=i.business_id where i.business_id=v_business_id and i.order_id=p_order_id;
 select coalesce(sum(pay.amount),0)-coalesce((select sum(a.amount) from public.payment_adjustments a join public.payments ap on ap.id=a.payment_id and ap.business_id=a.business_id where ap.business_id=v_business_id and ap.order_id=p_order_id),0) into v_received from public.payments pay where pay.business_id=v_business_id and pay.order_id=p_order_id;
 select coalesce(sum(r.amount),0) into v_reserved from public.paystack_checkout_requests r where r.business_id=v_business_id and r.order_id=p_order_id and r.status='pending' and r.expires_at>now();
 if p_amount>v_total-v_received-v_reserved then raise exception 'Checkout amount exceeds the unreserved order balance.'; end if;
 v_request_id:=gen_random_uuid(); v_reference:='MW-'||replace(v_request_id::text,'-','');
 insert into public.paystack_checkout_requests(id,business_id,order_id,customer_id,initiated_by,reference,amount) values(v_request_id,v_business_id,p_order_id,v_customer_id,v_user_id,v_reference,p_amount);
 return query select v_request_id,v_reference,p_amount,trim(v_email),v_customer_name;
end; $$;
create or replace function public.complete_paystack_checkout(p_reference text,p_amount_kobo bigint,p_currency text,p_transaction_id text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_request public.paystack_checkout_requests%rowtype; v_payment_id uuid;
begin
 if coalesce((select auth.role()),'')<>'service_role' then raise exception 'Payment completion is restricted to the payment service.'; end if;
 select * into v_request from public.paystack_checkout_requests where reference=p_reference for update;
 if not found then raise exception 'Checkout reference not found.'; end if;
 if p_currency<>'NGN' or p_amount_kobo::numeric<>v_request.amount*100 then raise exception 'Verified transaction does not match checkout amount and currency.'; end if;
 if v_request.status='succeeded' then return v_request.payment_id; end if;
 if p_transaction_id is null or length(p_transaction_id)>64 then raise exception 'Invalid Paystack transaction id.'; end if;
 insert into public.payments(business_id,order_id,amount,method,reference,note,received_at,recorded_by)
 values(v_request.business_id,v_request.order_id,v_request.amount,'card',v_request.reference,'Paystack online payment · transaction '||p_transaction_id,now(),v_request.initiated_by) returning id into v_payment_id;
 update public.paystack_checkout_requests set status='succeeded',payment_id=v_payment_id,provider_transaction_id=p_transaction_id,completed_at=now() where id=v_request.id;
 return v_payment_id;
end; $$;
revoke all on function public.create_paystack_checkout_request(uuid,numeric) from public,anon;
grant execute on function public.create_paystack_checkout_request(uuid,numeric) to authenticated;
revoke all on function public.complete_paystack_checkout(text,bigint,text,text) from public,anon,authenticated;
grant execute on function public.complete_paystack_checkout(text,bigint,text,text) to service_role;

