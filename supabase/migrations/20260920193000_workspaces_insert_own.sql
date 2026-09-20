-- The onboarding flow (frontend/src/app/onboarding/actions.ts) lets a Google
-- OAuth user who chooses "supervisor" create their own workspace directly via
-- the client SDK, unlike the original email/password signup path where the
-- security-definer handle_new_user trigger does it (bypassing RLS). Only
-- select/update policies existed on workspaces, so that insert was rejected.

create policy "workspaces_insert_own" on workspaces
  for insert with check (supervisor_id = auth.uid());
