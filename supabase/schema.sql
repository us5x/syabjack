create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  approved boolean;
  chosen_name text;
begin
  -- Check the email directly instead of relying on auth.jwt()
  select exists (
    select 1
    from public.approved_users
    where lower(email) = lower(new.email)
  )
  into approved;

  if not approved then
    raise exception 'Your email is not approved for this private table';
  end if;

  chosen_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    split_part(new.email, '@', 1)
  );

  insert into public.profiles(id, email, display_name)
  values(
    new.id,
    new.email,
    left(chosen_name, 24)
  );

  return new;
end;
$$;
