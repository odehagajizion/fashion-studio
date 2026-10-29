alter table public.order_assignments add column unassigned_at timestamptz;
alter table public.order_assignments drop constraint order_assignments_order_id_user_id_key;
create unique index order_assignments_one_active_user_idx
  on public.order_assignments (order_id, user_id) where unassigned_at is null;

alter table public.order_activity drop constraint order_activity_activity_type_check;
alter table public.order_activity add constraint order_activity_activity_type_check
  check (activity_type in ('created', 'stage_changed', 'schedule_changed', 'fulfilled', 'assignment_changed'));

create or replace function public.list_assignable_team_members()
returns table (user_id uuid, email text, role public.business_member_role)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business_id uuid;
begin
  select membership.business_id into v_business_id
  from public.business_memberships as membership
  where membership.user_id = (select auth.uid())
    and membership.is_active = true
    and membership.role in ('owner', 'supervisor')
  order by membership.created_at
  limit 1;
  if v_business_id is null then raise exception 'Owner or supervisor access is required.'; end if;

  return query
  select membership.user_id, users.email::text, membership.role
  from public.business_memberships as membership
  join auth.users as users on users.id = membership.user_id
  where membership.business_id = v_business_id
    and membership.is_active = true
    and membership.role in ('supervisor', 'tailor')
  order by membership.role, users.email;
end;
$$;

create or replace function public.assign_order_to_member(p_order_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_business_id uuid;
  v_role public.business_member_role;
  v_order_ref text;
  v_order_stage public.order_stage;
  v_fulfilled_at timestamptz;
  v_assignment_id uuid;
begin
  if v_user_id is null then raise exception 'You must sign in.'; end if;
  select business_id, order_ref, stage, fulfilled_at into v_business_id, v_order_ref, v_order_stage, v_fulfilled_at
  from public.orders where id = p_order_id for update;
  if v_business_id is null then raise exception 'Order not found.'; end if;
  if v_order_stage in ('completed', 'cancelled') or v_fulfilled_at is not null then raise exception 'Completed or cancelled orders cannot be assigned.'; end if;

  select membership.role into v_role
  from public.business_memberships as membership
  where membership.business_id = v_business_id and membership.user_id = v_user_id and membership.is_active = true;
  if v_role is null or v_role not in ('owner', 'supervisor') then raise exception 'Owner or supervisor access is required.'; end if;

  if not exists (
    select 1 from public.business_memberships as member
    where member.business_id = v_business_id and member.user_id = p_user_id
      and member.is_active = true and member.role in ('supervisor', 'tailor')
  ) then raise exception 'Choose an active supervisor or tailor from this studio.'; end if;

  insert into public.order_assignments (business_id, order_id, user_id, assigned_by)
  values (v_business_id, p_order_id, p_user_id, v_user_id)
  on conflict (order_id, user_id) where unassigned_at is null do nothing
  returning id into v_assignment_id;

  if v_assignment_id is not null then
    insert into public.order_activity (business_id, order_id, activity_type, details, actor_id)
    values (v_business_id, p_order_id, 'assignment_changed',
      jsonb_build_object('action', 'assigned', 'user_id', p_user_id), v_user_id);
  end if;
end;
$$;

create or replace function public.unassign_order_member(p_order_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_business_id uuid;
  v_role public.business_member_role;
begin
  if v_user_id is null then raise exception 'You must sign in.'; end if;
  select business_id into v_business_id from public.orders where id = p_order_id for update;
  if v_business_id is null then raise exception 'Order not found.'; end if;
  select membership.role into v_role
  from public.business_memberships as membership
  where membership.business_id = v_business_id and membership.user_id = v_user_id and membership.is_active = true;
  if v_role is null or v_role not in ('owner', 'supervisor') then raise exception 'Owner or supervisor access is required.'; end if;

  update public.order_assignments set unassigned_at = now()
  where business_id = v_business_id and order_id = p_order_id and user_id = p_user_id and unassigned_at is null;
  if found then
    insert into public.order_activity (business_id, order_id, activity_type, details, actor_id)
    values (v_business_id, p_order_id, 'assignment_changed',
      jsonb_build_object('action', 'unassigned', 'user_id', p_user_id), v_user_id);
  end if;
end;
$$;

revoke all on function public.list_assignable_team_members() from public, anon;
revoke all on function public.assign_order_to_member(uuid, uuid) from public, anon;
revoke all on function public.unassign_order_member(uuid, uuid) from public, anon;
grant execute on function public.list_assignable_team_members() to authenticated;
grant execute on function public.assign_order_to_member(uuid, uuid) to authenticated;
grant execute on function public.unassign_order_member(uuid, uuid) to authenticated;create or replace function public.is_assigned_to_order(target_order_id uuid)
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
      and assignment.unassigned_at is null
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
      and assignment.unassigned_at is null
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
      and assignment.unassigned_at is null
      and membership.is_active = true
  );
$$;
