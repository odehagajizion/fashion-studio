create table public.business_membership_activity (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  member_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  activity_type text not null check (activity_type in ('role_changed', 'access_changed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (business_id, member_id) references public.business_memberships(business_id, user_id) on delete cascade
);
create index business_membership_activity_team_idx on public.business_membership_activity (business_id, member_id, created_at desc);
revoke all on public.business_membership_activity from public, anon, authenticated;
grant select on public.business_membership_activity to authenticated;
alter table public.business_membership_activity enable row level security;
create policy "owners can read team membership history"
  on public.business_membership_activity for select to authenticated
  using (public.has_business_role(business_id, 'owner'));

create or replace function public.list_business_team()
returns table (user_id uuid, email text, role public.business_member_role, is_active boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
declare v_business_id uuid;
begin
  select m.business_id into v_business_id from public.business_memberships m
  where m.user_id = (select auth.uid()) and m.is_active = true and m.role = 'owner'
  order by m.created_at limit 1;
  if v_business_id is null then raise exception 'Owner access is required.'; end if;
  return query
  select m.user_id, coalesce(u.email::text, 'No email'), m.role, m.is_active, m.created_at
  from public.business_memberships m join auth.users u on u.id = m.user_id
  where m.business_id = v_business_id order by (m.role = 'owner') desc, m.is_active desc, u.email;
end;
$$;

create or replace function public.update_business_team_member(
  p_user_id uuid, p_role public.business_member_role, p_is_active boolean
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_business_id uuid;
  v_old_role public.business_member_role;
  v_old_active boolean;
  v_order_id uuid;
begin
  if v_actor_id is null then raise exception 'Sign in to manage team access.'; end if;
  select m.business_id into v_business_id from public.business_memberships m
  where m.user_id = v_actor_id and m.is_active = true and m.role = 'owner'
  order by m.created_at limit 1;
  if v_business_id is null then raise exception 'Owner access is required.'; end if;
  if p_user_id = v_actor_id then raise exception 'You cannot change your own owner access.'; end if;
  if p_role is null or p_role not in ('supervisor', 'tailor') then raise exception 'Team members can be supervisors or tailors.'; end if;
  if p_is_active is null then raise exception 'Choose whether this member has active access.'; end if;

  select m.role, m.is_active into v_old_role, v_old_active
  from public.business_memberships m where m.business_id = v_business_id and m.user_id = p_user_id for update;
  if not found then raise exception 'Team member was not found in this studio.'; end if;
  if v_old_role = 'owner' then raise exception 'Owner access cannot be changed from Team Management.'; end if;

  update public.business_memberships set role = p_role, is_active = p_is_active
  where business_id = v_business_id and user_id = p_user_id;

  if v_old_role <> p_role then
    insert into public.business_membership_activity (business_id, member_id, actor_id, activity_type, details)
    values (v_business_id, p_user_id, v_actor_id, 'role_changed', jsonb_build_object('from', v_old_role, 'to', p_role));
  end if;
  if v_old_active <> p_is_active then
    insert into public.business_membership_activity (business_id, member_id, actor_id, activity_type, details)
    values (v_business_id, p_user_id, v_actor_id, 'access_changed', jsonb_build_object('from', v_old_active, 'to', p_is_active));
  end if;

  if v_old_active and not p_is_active then
    for v_order_id in
      update public.order_assignments set unassigned_at = now()
      where business_id = v_business_id and user_id = p_user_id and unassigned_at is null
      returning order_id
    loop
      insert into public.order_activity (business_id, order_id, activity_type, details, note, actor_id)
      values (v_business_id, v_order_id, 'assignment_changed',
        jsonb_build_object('action', 'unassigned', 'user_id', p_user_id),
        'Automatically unassigned because team access was deactivated.', v_actor_id);
    end loop;
  end if;
end;
$$;
revoke all on function public.list_business_team() from public, anon;
grant execute on function public.list_business_team() to authenticated;
revoke all on function public.update_business_team_member(uuid, public.business_member_role, boolean) from public, anon;
grant execute on function public.update_business_team_member(uuid, public.business_member_role, boolean) to authenticated;

