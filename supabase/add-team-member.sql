-- Create an active supervisor or tailor membership after creating that user in Supabase Auth.
-- Replace both email addresses and set the requested role below.
DO $$
DECLARE
  owner_email text := 'odehagajizion@gmail.com';
  member_email text := 'mvendywendy@gmail.com';
  member_role public.business_member_role := 'tailor'; -- 'tailor' or 'supervisor'
  owner_user_id uuid;
  member_user_id uuid;
  business_id uuid;
BEGIN
  IF member_role NOT IN ('tailor', 'supervisor') THEN
    RAISE EXCEPTION 'Team role must be tailor or supervisor.';
  END IF;

  SELECT id INTO owner_user_id FROM auth.users WHERE lower(email) = lower(owner_email) LIMIT 1;
  SELECT id INTO member_user_id FROM auth.users WHERE lower(email) = lower(member_email) LIMIT 1;
  IF owner_user_id IS NULL OR member_user_id IS NULL THEN
    RAISE EXCEPTION 'Create both Auth users before adding a team membership.';
  END IF;
  IF owner_user_id = member_user_id THEN
    RAISE EXCEPTION 'The owner cannot be added as a team member.';
  END IF;

  SELECT membership.business_id INTO business_id
  FROM public.business_memberships AS membership
  WHERE membership.user_id = owner_user_id AND membership.role = 'owner' AND membership.is_active = true
  LIMIT 1;
  IF business_id IS NULL THEN RAISE EXCEPTION 'No active studio owner membership found.'; END IF;

  INSERT INTO public.business_memberships (business_id, user_id, role, is_active)
  VALUES (business_id, member_user_id, member_role, true)
  ON CONFLICT (business_id, user_id) DO UPDATE SET role = EXCLUDED.role, is_active = true;
END $$;
