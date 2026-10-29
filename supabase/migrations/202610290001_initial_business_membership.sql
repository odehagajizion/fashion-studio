create type public.business_member_role as enum ('owner', 'supervisor', 'tailor');

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.business_memberships (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  role public.business_member_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create index business_memberships_user_active_idx
  on public.business_memberships (user_id, is_active);

create or replace function public.is_active_business_member(target_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_memberships as membership
    where membership.business_id = target_business_id
      and membership.user_id = (select auth.uid())
      and membership.is_active = true
  );
$$;

create or replace function public.has_business_role(
  target_business_id uuid,
  required_role public.business_member_role
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.business_memberships as membership
    where membership.business_id = target_business_id
      and membership.user_id = (select auth.uid())
      and membership.is_active = true
      and membership.role = required_role
  );
$$;

revoke all on function public.is_active_business_member(uuid) from public, anon;
revoke all on function public.has_business_role(uuid, public.business_member_role) from public, anon;
grant execute on function public.is_active_business_member(uuid) to authenticated;
grant execute on function public.has_business_role(uuid, public.business_member_role) to authenticated;

revoke all on public.businesses from anon, authenticated;
revoke all on public.business_memberships from anon, authenticated;
grant select on public.businesses to authenticated;
grant select on public.business_memberships to authenticated;

alter table public.businesses enable row level security;
alter table public.business_memberships enable row level security;

create policy "members can read their business"
  on public.businesses for select to authenticated
  using (public.is_active_business_member(id));

create policy "users can read their own membership"
  on public.business_memberships for select to authenticated
  using (
    user_id = (select auth.uid())
    or public.has_business_role(business_id, 'owner')
    or public.has_business_role(business_id, 'supervisor')
  );
