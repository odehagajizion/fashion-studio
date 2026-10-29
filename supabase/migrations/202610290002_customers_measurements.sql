create table public.customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_ref text not null default ('CUS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  first_name text not null check (length(trim(first_name)) between 1 and 80),
  last_name text not null check (length(trim(last_name)) between 1 and 80),
  phone text not null check (length(trim(phone)) between 3 and 40),
  email text,
  notes text,
  archived_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, customer_ref),
  unique (id, business_id)
);

create index customers_business_name_idx
  on public.customers (business_id, lower(last_name), lower(first_name));
create index customers_business_phone_idx
  on public.customers (business_id, phone);

create or replace function public.set_customer_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_customer_updated_at();

revoke all on public.customers from anon, authenticated;
grant select on public.customers to authenticated;
grant insert (business_id, first_name, last_name, phone, email, notes, created_by)
  on public.customers to authenticated;
grant update (first_name, last_name, phone, email, notes, archived_at)
  on public.customers to authenticated;

alter table public.customers enable row level security;

create policy "owners and supervisors can read customers"
  on public.customers for select to authenticated
  using (
    public.has_business_role(business_id, 'owner')
    or public.has_business_role(business_id, 'supervisor')
  );

create policy "owners and supervisors can create customers"
  on public.customers for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      public.has_business_role(business_id, 'owner')
      or public.has_business_role(business_id, 'supervisor')
    )
  );

create policy "owners and supervisors can update customers"
  on public.customers for update to authenticated
  using (
    public.has_business_role(business_id, 'owner')
    or public.has_business_role(business_id, 'supervisor')
  )
  with check (
    public.has_business_role(business_id, 'owner')
    or public.has_business_role(business_id, 'supervisor')
  );

create table public.measurement_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null,
  taken_at date not null default current_date,
  notes text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (customer_id, business_id)
    references public.customers (id, business_id) on delete restrict
);

create index measurement_sessions_customer_date_idx
  on public.measurement_sessions (business_id, customer_id, taken_at desc);

create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  measurement_session_id uuid not null,
  field_name text not null check (length(trim(field_name)) between 1 and 80),
  value numeric(8, 2) not null check (value > 0 and value <= 1000),
  unit text not null check (unit in ('cm', 'in')),
  note text,
  created_at timestamptz not null default now(),
  foreign key (measurement_session_id, business_id)
    references public.measurement_sessions (id, business_id) on delete cascade
);

create unique index measurements_session_field_idx
  on public.measurements (measurement_session_id, lower(field_name));
create index measurements_business_session_idx
  on public.measurements (business_id, measurement_session_id);

revoke all on public.measurement_sessions, public.measurements from anon, authenticated;
grant select on public.measurement_sessions, public.measurements to authenticated;

alter table public.measurement_sessions enable row level security;
alter table public.measurements enable row level security;

create policy "owners and supervisors can read measurement sessions"
  on public.measurement_sessions for select to authenticated
  using (
    public.has_business_role(business_id, 'owner')
    or public.has_business_role(business_id, 'supervisor')
  );

create policy "owners and supervisors can read measurements"
  on public.measurements for select to authenticated
  using (
    public.has_business_role(business_id, 'owner')
    or public.has_business_role(business_id, 'supervisor')
  );

create or replace function public.create_measurement_session(
  p_customer_id uuid,
  p_taken_at date,
  p_notes text,
  p_measurements jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_business_id uuid;
  v_session_id uuid;
  v_item jsonb;
  v_name text;
  v_value numeric;
  v_unit text;
begin
  if v_user_id is null then
    raise exception 'You must sign in to record measurements.';
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
    raise exception 'The customer was not found in your active studio.';
  end if;

  if p_measurements is null or jsonb_typeof(p_measurements) is distinct from 'array' then
    raise exception 'Measurements must be provided as a list.';
  end if;
  if jsonb_array_length(p_measurements) < 1 or jsonb_array_length(p_measurements) > 50 then
    raise exception 'Add between 1 and 50 measurement fields.';
  end if;

  insert into public.measurement_sessions (business_id, customer_id, taken_at, notes, created_by)
  values (v_business_id, p_customer_id, coalesce(p_taken_at, current_date), nullif(trim(p_notes), ''), v_user_id)
  returning id into v_session_id;

  for v_item in select element.value from jsonb_array_elements(p_measurements) as element(value)
  loop
    v_name := nullif(trim(v_item->>'field_name'), '');
    if v_name is null or length(v_name) > 80 then
      raise exception 'Each measurement needs a field name up to 80 characters.';
    end if;

    v_value := (v_item->>'value')::numeric;
    if v_value <= 0 or v_value > 1000 then
      raise exception 'Measurement values must be greater than zero and no more than 1000.';
    end if;

    v_unit := v_item->>'unit';
    if v_unit not in ('cm', 'in') then
      raise exception 'Measurement units must be cm or in.';
    end if;

    insert into public.measurements (business_id, measurement_session_id, field_name, value, unit, note)
    values (v_business_id, v_session_id, v_name, v_value, v_unit, nullif(trim(v_item->>'note'), ''));
  end loop;

  return v_session_id;
end;
$$;

revoke all on function public.create_measurement_session(uuid, date, text, jsonb) from public, anon;
grant execute on function public.create_measurement_session(uuid, date, text, jsonb) to authenticated;





