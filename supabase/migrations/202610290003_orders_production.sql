create type public.order_stage as enum (
  'not_started',
  'in_production',
  'awaiting_fitting',
  'ready_for_pickup',
  'completed',
  'cancelled'
);
create type public.fulfillment_method as enum ('pickup', 'delivery');

revoke all on type public.order_stage, public.fulfillment_method from public, anon;
grant usage on type public.order_stage, public.fulfillment_method to authenticated;

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null,
  measurement_session_id uuid,
  order_ref text not null default ('ORD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  stage public.order_stage not null default 'not_started',
  due_date date,
  fitting_date date,
  pickup_date date,
  delivery_date date,
  fulfillment_method public.fulfillment_method not null default 'pickup',
  fulfilled_at timestamptz,
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, order_ref),
  unique (id, business_id),
  foreign key (customer_id, business_id)
    references public.customers (id, business_id) on delete restrict,
  foreign key (measurement_session_id, business_id)
    references public.measurement_sessions (id, business_id) on delete restrict
);

create index orders_business_stage_due_idx
  on public.orders (business_id, stage, due_date);
create index orders_business_customer_created_idx
  on public.orders (business_id, customer_id, created_at desc);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null,
  garment_name text not null check (length(trim(garment_name)) between 1 and 120),
  description text,
  quantity integer not null default 1 check (quantity between 1 and 100),
  created_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (order_id, business_id)
    references public.orders (id, business_id) on delete cascade
);

create index order_items_order_idx on public.order_items (business_id, order_id);
create table public.order_item_prices (
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_item_id uuid not null,
  unit_price numeric(12, 2) not null check (unit_price >= 0 and unit_price <= 1000000000),
  created_at timestamptz not null default now(),
  primary key (order_item_id, business_id),
  foreign key (order_item_id, business_id)
    references public.order_items (id, business_id) on delete cascade
);

create index order_item_prices_business_item_idx on public.order_item_prices (business_id, order_item_id);

create table public.order_assignments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null,
  user_id uuid not null,
  assigned_by uuid not null references auth.users(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  unique (order_id, user_id),
  foreign key (order_id, business_id)
    references public.orders (id, business_id) on delete cascade,
  foreign key (business_id, user_id)
    references public.business_memberships (business_id, user_id) on delete restrict
);

create index order_assignments_user_order_idx on public.order_assignments (business_id, user_id, order_id);

create table public.order_activity (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id uuid not null,
  activity_type text not null check (activity_type in ('created', 'stage_changed', 'schedule_changed', 'fulfilled')),
  details jsonb not null default '{}'::jsonb,
  note text,
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (order_id, business_id)
    references public.orders (id, business_id) on delete cascade
);

create index order_activity_order_created_idx on public.order_activity (business_id, order_id, created_at desc);

create or replace function public.is_assigned_to_order(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.order_assignments as assignment
    join public.business_memberships as membership
      on membership.business_id = assignment.business_id
     and membership.user_id = assignment.user_id
    where assignment.order_id = target_order_id
      and assignment.user_id = (select auth.uid())
      and membership.is_active = true
  );
$$;

create or replace function public.is_assigned_to_customer(target_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.orders as studio_order
    join public.order_assignments as assignment
      on assignment.business_id = studio_order.business_id
     and assignment.order_id = studio_order.id
    join public.business_memberships as membership
      on membership.business_id = assignment.business_id
     and membership.user_id = assignment.user_id
    where studio_order.customer_id = target_customer_id
      and assignment.user_id = (select auth.uid())
      and membership.is_active = true
  );
$$;

create or replace function public.is_assigned_to_measurement_session(target_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.orders as studio_order
    join public.order_assignments as assignment
      on assignment.business_id = studio_order.business_id
     and assignment.order_id = studio_order.id
    join public.business_memberships as membership
      on membership.business_id = assignment.business_id
     and membership.user_id = assignment.user_id
    where studio_order.measurement_session_id = target_session_id
      and assignment.user_id = (select auth.uid())
      and membership.is_active = true
  );
$$;

revoke all on function public.is_assigned_to_order(uuid) from public, anon;
revoke all on function public.is_assigned_to_customer(uuid) from public, anon;
revoke all on function public.is_assigned_to_measurement_session(uuid) from public, anon;
grant execute on function public.is_assigned_to_order(uuid) to authenticated;
grant execute on function public.is_assigned_to_customer(uuid) to authenticated;
grant execute on function public.is_assigned_to_measurement_session(uuid) to authenticated;

revoke all on public.orders, public.order_items, public.order_item_prices, public.order_assignments, public.order_activity from anon, authenticated;
grant select on public.orders, public.order_items, public.order_item_prices, public.order_assignments, public.order_activity to authenticated;

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_prices enable row level security;
alter table public.order_assignments enable row level security;
alter table public.order_activity enable row level security;

create policy "owners and supervisors can read all business orders"
  on public.orders for select to authenticated
  using (
    public.has_business_role(business_id, 'owner')
    or public.has_business_role(business_id, 'supervisor')
    or public.is_assigned_to_order(id)
  );

create policy "authorized team can read order garments"
  on public.order_items for select to authenticated
  using (
    public.has_business_role(business_id, 'owner')
    or public.has_business_role(business_id, 'supervisor')
    or public.is_assigned_to_order(order_id)
  );

create policy "owners and supervisors can read order prices"
  on public.order_item_prices for select to authenticated
  using (
    public.has_business_role(business_id, 'owner')
    or public.has_business_role(business_id, 'supervisor')
  );

create policy "team can read permitted assignments"
  on public.order_assignments for select to authenticated
  using (
    (user_id = (select auth.uid()) and public.is_active_business_member(business_id))
    or public.has_business_role(business_id, 'owner')
    or public.has_business_role(business_id, 'supervisor')
  );

create policy "team can read permitted order activity"
  on public.order_activity for select to authenticated
  using (
    public.has_business_role(business_id, 'owner')
    or public.has_business_role(business_id, 'supervisor')
    or public.is_assigned_to_order(order_id)
  );

create policy "assigned tailors can read assigned customers"
  on public.customers for select to authenticated
  using (public.is_assigned_to_customer(id));

create policy "assigned tailors can read assigned measurement sessions"
  on public.measurement_sessions for select to authenticated
  using (public.is_assigned_to_measurement_session(id));

create policy "assigned tailors can read assigned measurements"
  on public.measurements for select to authenticated
  using (public.is_assigned_to_measurement_session(measurement_session_id));

create or replace function public.create_order(
  p_customer_id uuid,
  p_measurement_session_id uuid,
  p_due_date date,
  p_fitting_date date,
  p_pickup_date date,
  p_delivery_date date,
  p_fulfillment_method public.fulfillment_method,
  p_notes text,
  p_items jsonb
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
  v_order_item_id uuid;
  v_stage public.order_stage := 'not_started';
  v_item jsonb;
  v_garment_name text;
  v_quantity integer;
  v_unit_price numeric;
  v_description text;
begin
  if v_user_id is null then
    raise exception 'You must sign in to create an order.';
  end if;

  select membership.business_id into v_business_id
  from public.business_memberships as membership
  where membership.user_id = v_user_id
    and membership.is_active = true
    and membership.role in ('owner', 'supervisor')
  order by membership.created_at
  limit 1;
  if v_business_id is null then
    raise exception 'An active owner or supervisor membership is required.';
  end if;

  if not exists (
    select 1 from public.customers as customer
    where customer.id = p_customer_id
      and customer.business_id = v_business_id
      and customer.archived_at is null
  ) then
    raise exception 'Choose an active customer from your studio.';
  end if;

  if p_measurement_session_id is not null and not exists (
    select 1 from public.measurement_sessions as session
    where session.id = p_measurement_session_id
      and session.customer_id = p_customer_id
      and session.business_id = v_business_id
  ) then
    raise exception 'The selected measurement session does not belong to this customer.';
  end if;

  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'Order garments must be provided as a list.';
  end if;
  if jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 20 then
    raise exception 'Add between 1 and 20 garments to an order.';
  end if;
  if p_fulfillment_method is null then
    raise exception 'Choose pickup or delivery.';
  end if;

  insert into public.orders (
    business_id, customer_id, measurement_session_id, due_date, fitting_date,
    pickup_date, delivery_date, fulfillment_method, notes, created_by
  ) values (
    v_business_id, p_customer_id, p_measurement_session_id, p_due_date, p_fitting_date,
    p_pickup_date, p_delivery_date, p_fulfillment_method, nullif(trim(p_notes), ''), v_user_id
  ) returning id into v_order_id;

  for v_item in select element.value from jsonb_array_elements(p_items) as element(value)
  loop
    v_garment_name := nullif(trim(v_item->>'garment_name'), '');
    if v_garment_name is null or length(v_garment_name) > 120 then
      raise exception 'Each garment needs a name up to 120 characters.';
    end if;
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity < 1 or v_quantity > 100 then
      raise exception 'Garment quantity must be between 1 and 100.';
    end if;
    v_unit_price := (v_item->>'unit_price')::numeric;
    if v_unit_price < 0 or v_unit_price > 1000000000 then
      raise exception 'Enter a valid garment price.';
    end if;
    v_description := nullif(trim(v_item->>'description'), '');

    insert into public.order_items (business_id, order_id, garment_name, description, quantity)
    values (v_business_id, v_order_id, v_garment_name, v_description, v_quantity)
    returning id into v_order_item_id;
    insert into public.order_item_prices (business_id, order_item_id, unit_price)
    values (v_business_id, v_order_item_id, v_unit_price);
  end loop;

  insert into public.order_activity (business_id, order_id, activity_type, details, actor_id)
  values (v_business_id, v_order_id, 'created', jsonb_build_object('stage', v_stage), v_user_id);

  return v_order_id;
end;
$$;

create or replace function public.update_order_stage(
  p_order_id uuid,
  p_stage public.order_stage,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_business_id uuid;
  v_old_stage public.order_stage;
  v_fulfilled_at timestamptz;
  v_role public.business_member_role;
begin
  if v_user_id is null then raise exception 'You must sign in.'; end if;
  select business_id, stage, fulfilled_at into v_business_id, v_old_stage, v_fulfilled_at
  from public.orders where id = p_order_id for update;
  if v_business_id is null then raise exception 'Order not found.'; end if;
  select role into v_role from public.business_memberships
  where business_id = v_business_id and user_id = v_user_id and is_active = true;
  if v_role is null then raise exception 'Active studio membership required.'; end if;
  if v_fulfilled_at is not null then raise exception 'Fulfilled orders cannot be changed.'; end if;
  if p_stage = 'completed' then raise exception 'Use the fulfillment action to complete an order.'; end if;
  if v_role = 'tailor' and not public.is_assigned_to_order(p_order_id) then
    raise exception 'You can only update orders assigned to you.';
  end if;
  if v_role = 'tailor' and p_stage not in ('in_production', 'awaiting_fitting') then
    raise exception 'Tailors can move assigned work to production or fitting.';
  end if;
  if p_stage is null then raise exception 'Choose a production stage.'; end if;
  if p_stage = v_old_stage and nullif(trim(p_note), '') is null then return; end if;

  update public.orders set stage = p_stage, updated_at = now() where id = p_order_id;
  insert into public.order_activity (business_id, order_id, activity_type, details, note, actor_id)
  values (
    v_business_id, p_order_id, 'stage_changed',
    jsonb_build_object('from', v_old_stage, 'to', p_stage),
    nullif(trim(p_note), ''), v_user_id
  );
end;
$$;

create or replace function public.update_order_schedule(
  p_order_id uuid,
  p_due_date date,
  p_fitting_date date,
  p_pickup_date date,
  p_delivery_date date,
  p_fulfillment_method public.fulfillment_method,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_business_id uuid;
  v_role public.business_member_role;
  v_fulfilled_at timestamptz;
  v_before jsonb;
  v_after jsonb;
begin
  if v_user_id is null then raise exception 'You must sign in.'; end if;
  select business_id, fulfilled_at into v_business_id, v_fulfilled_at from public.orders where id = p_order_id for update;
  if v_business_id is null then raise exception 'Order not found.'; end if;
  select role into v_role from public.business_memberships
  where business_id = v_business_id and user_id = v_user_id and is_active = true;
  if v_role is null or v_role not in ('owner', 'supervisor') then raise exception 'Owner or supervisor access is required.'; end if;
  if v_fulfilled_at is not null then raise exception 'Fulfilled orders cannot be rescheduled.'; end if;

  select jsonb_build_object('due_date', due_date, 'fitting_date', fitting_date, 'pickup_date', pickup_date, 'delivery_date', delivery_date, 'fulfillment_method', fulfillment_method)
  into v_before from public.orders where id = p_order_id;
  update public.orders set due_date = p_due_date, fitting_date = p_fitting_date,
    pickup_date = p_pickup_date, delivery_date = p_delivery_date,
    fulfillment_method = p_fulfillment_method, updated_at = now()
  where id = p_order_id;
  select jsonb_build_object('due_date', due_date, 'fitting_date', fitting_date, 'pickup_date', pickup_date, 'delivery_date', delivery_date, 'fulfillment_method', fulfillment_method)
  into v_after from public.orders where id = p_order_id;
  if v_before is distinct from v_after then
    insert into public.order_activity (business_id, order_id, activity_type, details, note, actor_id)
    values (v_business_id, p_order_id, 'schedule_changed', jsonb_build_object('before', v_before, 'after', v_after), nullif(trim(p_note), ''), v_user_id);
  end if;
end;
$$;

create or replace function public.complete_order_fulfillment(p_order_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_business_id uuid;
  v_role public.business_member_role;
  v_fulfilled_at timestamptz;
  v_current_stage public.order_stage;
begin
  if v_user_id is null then raise exception 'You must sign in.'; end if;
  select business_id, fulfilled_at, stage into v_business_id, v_fulfilled_at, v_current_stage
  from public.orders where id = p_order_id for update;
  if v_business_id is null then raise exception 'Order not found.'; end if;
  select role into v_role from public.business_memberships
  where business_id = v_business_id and user_id = v_user_id and is_active = true;
  if v_role is null or v_role not in ('owner', 'supervisor') then raise exception 'Owner or supervisor access is required.'; end if;
  if v_fulfilled_at is not null then raise exception 'This order has already been fulfilled.'; end if;
  if v_current_stage = 'cancelled' then raise exception 'Cancelled orders cannot be fulfilled.'; end if;
  if v_current_stage <> 'ready_for_pickup' then raise exception 'Move the order to ready for pickup before recording fulfilment.'; end if;

  update public.orders set stage = 'completed', fulfilled_at = now(), updated_at = now()
  where id = p_order_id;
  insert into public.order_activity (business_id, order_id, activity_type, details, note, actor_id)
  values (v_business_id, p_order_id, 'fulfilled', jsonb_build_object('fulfilled_at', now()), nullif(trim(p_note), ''), v_user_id);
end;
$$;

revoke all on function public.create_order(uuid, uuid, date, date, date, date, public.fulfillment_method, text, jsonb) from public, anon;
revoke all on function public.update_order_stage(uuid, public.order_stage, text) from public, anon;
revoke all on function public.update_order_schedule(uuid, date, date, date, date, public.fulfillment_method, text) from public, anon;
revoke all on function public.complete_order_fulfillment(uuid, text) from public, anon;
grant execute on function public.create_order(uuid, uuid, date, date, date, date, public.fulfillment_method, text, jsonb) to authenticated;
grant execute on function public.update_order_stage(uuid, public.order_stage, text) to authenticated;
grant execute on function public.update_order_schedule(uuid, date, date, date, date, public.fulfillment_method, text) to authenticated;
grant execute on function public.complete_order_fulfillment(uuid, text) to authenticated;











