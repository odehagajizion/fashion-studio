create type public.expense_category as enum (
  'fabric_materials', 'rent_utilities', 'staff_wages', 'transport', 'marketing', 'other'
);
revoke all on type public.expense_category from public, anon;
grant usage on type public.expense_category to authenticated;

create table public.studio_expenses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  expense_date date not null default current_date,
  amount numeric(14, 2) not null check (amount > 0 and amount <= 100000000000),
  category public.expense_category not null,
  note text check (note is null or length(note) <= 1000),
  order_id uuid,
  receipt_path text check (receipt_path is null or length(receipt_path) <= 500),
  recorded_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  recorded_by_label text not null default coalesce(
    nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''), auth.jwt() ->> 'email', 'Studio user'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, business_id),
  foreign key (order_id, business_id) references public.orders (id, business_id) on delete restrict
);
create index studio_expenses_business_date_idx on public.studio_expenses (business_id, expense_date desc, created_at desc);
create index studio_expenses_order_idx on public.studio_expenses (business_id, order_id) where order_id is not null;

create table public.expense_activity (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  expense_id uuid not null,
  event_type text not null check (event_type in ('created', 'updated')),
  before_state jsonb,
  after_state jsonb not null,
  actor_id uuid references auth.users(id) on delete set null,
  actor_label text not null,
  created_at timestamptz not null default now(),
  foreign key (expense_id, business_id) references public.studio_expenses (id, business_id) on delete restrict
);
create index expense_activity_expense_idx on public.expense_activity (business_id, expense_id, created_at desc);

revoke all on public.studio_expenses, public.expense_activity from public, anon;
grant select on public.studio_expenses to authenticated;
grant insert (id, business_id, expense_date, amount, category, note, order_id, receipt_path) on public.studio_expenses to authenticated;
grant update (expense_date, amount, category, note, order_id, receipt_path) on public.studio_expenses to authenticated;
grant select on public.expense_activity to authenticated;
alter table public.studio_expenses enable row level security;
alter table public.expense_activity enable row level security;

create policy "owners can read studio expenses" on public.studio_expenses for select to authenticated
  using (public.has_business_role(business_id, 'owner'));
create policy "owners can create studio expenses" on public.studio_expenses for insert to authenticated
  with check (public.has_business_role(business_id, 'owner') and recorded_by = (select auth.uid()));
create policy "owners can update studio expenses" on public.studio_expenses for update to authenticated
  using (public.has_business_role(business_id, 'owner'))
  with check (public.has_business_role(business_id, 'owner'));
create policy "owners can read expense audit history" on public.expense_activity for select to authenticated
  using (public.has_business_role(business_id, 'owner'));

create or replace function public.set_studio_expense_updated_at()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.audit_studio_expense_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_actor_label text := coalesce(
    nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''), auth.jwt() ->> 'email', 'Studio user'
  );
begin
  if tg_op = 'INSERT' then
    insert into public.expense_activity (business_id, expense_id, event_type, after_state, actor_id, actor_label)
    values (new.business_id, new.id, 'created', to_jsonb(new), v_actor_id, v_actor_label);
    return new;
  end if;
  insert into public.expense_activity (business_id, expense_id, event_type, before_state, after_state, actor_id, actor_label)
  values (new.business_id, new.id, 'updated', to_jsonb(old), to_jsonb(new), v_actor_id, v_actor_label);
  return new;
end;
$$;
create trigger studio_expenses_set_updated_at before update on public.studio_expenses
  for each row execute function public.set_studio_expense_updated_at();
create trigger studio_expenses_audit_changes after insert or update on public.studio_expenses
  for each row execute function public.audit_studio_expense_change();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('expense-receipts', 'expense-receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
create policy "owners manage their expense receipt files" on storage.objects for all to authenticated
  using (
    bucket_id = 'expense-receipts' and exists (
      select 1 from public.business_memberships as membership
      where membership.business_id::text = (storage.foldername(name))[1]
        and membership.user_id = (select auth.uid()) and membership.role = 'owner' and membership.is_active = true
    )
  )
  with check (
    bucket_id = 'expense-receipts' and exists (
      select 1 from public.business_memberships as membership
      where membership.business_id::text = (storage.foldername(name))[1]
        and membership.user_id = (select auth.uid()) and membership.role = 'owner' and membership.is_active = true
    )
  );
