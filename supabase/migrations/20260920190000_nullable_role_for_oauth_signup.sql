-- Google OAuth signups never pass a `role` in raw_user_meta_data, so the trigger
-- was silently defaulting everyone who signed up with Google to 'student' with
-- no way to become a supervisor. Make role nullable so OAuth users land in an
-- onboarding step instead, and only auto-create a workspace when a role was
-- actually supplied (i.e. the email/password signup form, which always sets one).

alter table public.profiles alter column role drop not null;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name, institution)
  values (
    new.id,
    (new.raw_user_meta_data->>'role')::user_role,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    new.raw_user_meta_data->>'institution'
  );

  if new.raw_user_meta_data->>'role' = 'supervisor' then
    insert into public.workspaces (supervisor_id, name)
    values (new.id, coalesce(new.raw_user_meta_data->>'full_name', 'My') || '''s workspace');
  end if;

  return new;
end;
$$;
