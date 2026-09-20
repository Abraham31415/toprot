-- The previous migration made registered_by/approved_by ON DELETE SET NULL
-- so account deletion doesn't get blocked by attribution FKs. But that SET
-- NULL is itself an UPDATE on a (possibly) registered protocol_versions row,
-- which the immutability trigger correctly rejects as a content edit. Widen
-- the trigger to also allow: registered_by/approved_by moving to NULL (and
-- only to NULL, never reassigned to a different non-null value once locked).

create or replace function public.protect_registered_protocol()
returns trigger
language plpgsql
as $$
begin
  if OLD.status not in ('registered', 'superseded') then
    return NEW;
  end if;

  -- Every column except status/registered_by/approved_by must be untouched.
  if (to_jsonb(NEW) - 'status' - 'registered_by' - 'approved_by')
     is distinct from
     (to_jsonb(OLD) - 'status' - 'registered_by' - 'approved_by') then
    raise exception 'Registered protocol versions are immutable';
  end if;

  if NEW.status is distinct from OLD.status
     and not (OLD.status = 'registered' and NEW.status = 'superseded') then
    raise exception 'Registered protocol versions are immutable';
  end if;

  if NEW.registered_by is distinct from OLD.registered_by and NEW.registered_by is not null then
    raise exception 'Registered protocol versions are immutable';
  end if;

  if NEW.approved_by is distinct from OLD.approved_by and NEW.approved_by is not null then
    raise exception 'Registered protocol versions are immutable';
  end if;

  return NEW;
end;
$$;
