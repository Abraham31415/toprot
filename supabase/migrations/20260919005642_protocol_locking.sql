-- Enforce protocol immutability once registered, and let the study's
-- attached supervisor lock a draft they've approved.

create or replace function public.protect_registered_protocol()
returns trigger
language plpgsql
as $$
begin
  -- Superseding a registered version (by a new amendment being registered) may
  -- only flip `status`; every other column must be untouched.
  if OLD.status = 'registered' and NEW.status = 'superseded' then
    if (to_jsonb(NEW) - 'status') is distinct from (to_jsonb(OLD) - 'status') then
      raise exception 'Only status may change when superseding a registered protocol version';
    end if;
    return NEW;
  end if;

  if OLD.status in ('registered', 'superseded') then
    raise exception 'Registered protocol versions are immutable';
  end if;

  return NEW;
end;
$$;

create trigger protocol_versions_immutable
  before update on protocol_versions
  for each row execute function public.protect_registered_protocol();

-- A study's attached supervisor may lock a draft once the student has
-- requested their approval. The app only ever sends the lock fields in this
-- path; RLS can't restrict to specific columns, so this is enforced by
-- convention in the server action, same as amendments_supervisor_review.
create policy "protocol_versions_supervisor_approve" on protocol_versions for update
  using (is_study_supervisor(study_id) and status = 'draft' and approval_requested_at is not null)
  with check (is_study_supervisor(study_id));
