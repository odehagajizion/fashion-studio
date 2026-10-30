alter table public.business_membership_activity
  drop constraint business_membership_activity_activity_type_check;
alter table public.business_membership_activity
  add constraint business_membership_activity_activity_type_check
  check (activity_type in ('invited', 'role_changed', 'access_changed'));

drop function public.list_business_team();
create function public.list_business_team()
returns table (user_id uuid, email text, role public.business_member_role, is_active boolean, created_at timestamptz, invite_pending boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare v_business_id uuid;
begin
  select m.business_id into v_business_id from public.business_memberships m
  where m.user_id = (select auth.uid()) and m.is_active = true and m.role = 'owner'
  order by m.created_at limit 1;
  if v_business_id is null then raise exception 'Owner access is required.'; end if;
  return query
  select m.user_id, coalesce(u.email::text, 'No email'), m.role, m.is_active, m.created_at,
    (u.email_confirmed_at is null)
  from public.business_memberships m join auth.users u on u.id = m.user_id
  where m.business_id = v_business_id order by (m.role = 'owner') desc, m.is_active desc, u.email;
end;
$$;
revoke all on function public.list_business_team() from public, anon;
grant execute on function public.list_business_team() to authenticated;

create or replace function public.link_invited_team_member(p_user_id uuid, p_role public.business_member_role, p_email text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_business_id uuid;
  v_auth_email text;
begin
  if v_actor_id is null then raise exception 'Sign in to invite a team member.'; end if;
  select m.business_id into v_business_id from public.business_memberships m
  where m.user_id = v_actor_id and m.is_active = true and m.role = 'owner'
  order by m.created_at limit 1;
  if v_business_id is null then raise exception 'Owner access is required.'; end if;
  if p_user_id is null or p_role is null or p_role not in ('supervisor', 'tailor') then
    raise exception 'Choose a valid team account and role.';
  end if;
  if p_email is null or length(trim(p_email)) < 3 or length(trim(p_email)) > 320 then
    raise exception 'Enter a valid email address.';
  end if;
  select lower(u.email::text) into v_auth_email from auth.users u where u.id = p_user_id;
  if v_auth_email is null or v_auth_email <> lower(trim(p_email)) then
    raise exception 'The invited account email does not match.';
  end if;
  if exists (select 1 from public.business_memberships m where m.business_id = v_business_id and m.user_id = p_user_id) then
    raise exception 'This account is already linked to the studio.';
  end if;
  insert into public.business_memberships (business_id, user_id, role, is_active)
  values (v_business_id, p_user_id, p_role, true);
  insert into public.business_membership_activity (business_id, member_id, actor_id, activity_type, details)
  values (v_business_id, p_user_id, v_actor_id, 'invited',
    jsonb_build_object('email', lower(trim(p_email)), 'role', p_role));
end;
$$;
revoke all on function public.link_invited_team_member(uuid, public.business_member_role, text) from public, anon;
grant execute on function public.link_invited_team_member(uuid, public.business_member_role, text) to authenticated;

