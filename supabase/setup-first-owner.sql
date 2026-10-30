DO $$
DECLARE
  owner_email text := 'odehagajizion@gmail.com';
  owner_user_id uuid;
  v_business_id uuid;
BEGIN
  SELECT id INTO owner_user_id
  FROM auth.users
  WHERE lower(email) = lower(owner_email)
  LIMIT 1;

  IF owner_user_id IS NULL THEN
    RAISE EXCEPTION 'No Supabase Auth user found for %. Create the owner user first, then update owner_email.', owner_email;
  END IF;

  SELECT id INTO v_business_id
  FROM public.businesses
  WHERE created_by = owner_user_id AND name = 'MvendyWendy'
  LIMIT 1;

  IF v_business_id IS NULL THEN
    INSERT INTO public.businesses (name, created_by)
    VALUES ('MvendyWendy', owner_user_id)
    RETURNING id INTO v_business_id;
  END IF;

  INSERT INTO public.business_memberships (business_id, user_id, role, is_active)
  VALUES (v_business_id, owner_user_id, 'owner', true)
  ON CONFLICT (business_id, user_id)
  DO UPDATE SET role = 'owner', is_active = true;
END $$;