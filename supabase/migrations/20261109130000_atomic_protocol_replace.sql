-- Atomic replace-all writes for protocol objectives and variables.
--
-- The server actions used to run `delete ... where protocol_version_id = X` and then a separate
-- `insert`. If the insert failed (duplicate variable_slug, transient error) after the delete had
-- committed, the user's rows were gone for good. These functions do both in a single statement
-- context, so any failure rolls the delete back and the old rows survive.
--
-- SECURITY INVOKER (the default, stated explicitly): the caller's RLS still applies to every row
-- touched. The existing policies (protocol_objectives_owner_all / protocol_variables_owner_all)
-- already limit writes to the study owner. RLS does not look at the version status for child
-- tables, so the functions additionally require the version to be a draft, and raise clear
-- errors rather than silently deleting zero rows for a non-owner.
--
-- `rows` is a JSON array; position in the array becomes display_order. An empty array clears the
-- list. Invalid enum values, missing required fields and duplicate slugs abort the whole call.

create or replace function public.replace_protocol_objectives(version_id uuid, rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_study_id uuid;
  v_status protocol_status;
begin
  if rows is null or jsonb_typeof(rows) <> 'array' then
    raise exception 'rows must be a JSON array' using errcode = '22023';
  end if;

  -- Locks the version row so concurrent saves (or a registration) serialise behind this one.
  -- Under the caller's RLS, so an unrelated user simply does not see it.
  select pv.study_id, pv.status into v_study_id, v_status
  from protocol_versions pv
  where pv.id = version_id
  for update;

  if not found then
    raise exception 'Protocol version not found' using errcode = 'P0002';
  end if;
  if not is_study_owner(v_study_id) then
    raise exception 'Only the study owner can edit protocol objectives' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only a draft protocol version can be edited' using errcode = '55000';
  end if;

  delete from protocol_objectives po where po.protocol_version_id = version_id;

  insert into protocol_objectives (protocol_version_id, objective_type, description, display_order)
  select version_id, x.objective_type, x.description, (e.ord - 1)::int
  from jsonb_array_elements(rows) with ordinality as e(elem, ord)
  cross join lateral jsonb_to_record(e.elem) as x(objective_type objective_type, description text)
  order by e.ord;
end;
$$;

create or replace function public.replace_protocol_variables(version_id uuid, rows jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_study_id uuid;
  v_status protocol_status;
begin
  if rows is null or jsonb_typeof(rows) <> 'array' then
    raise exception 'rows must be a JSON array' using errcode = '22023';
  end if;

  select pv.study_id, pv.status into v_study_id, v_status
  from protocol_versions pv
  where pv.id = version_id
  for update;

  if not found then
    raise exception 'Protocol version not found' using errcode = 'P0002';
  end if;
  if not is_study_owner(v_study_id) then
    raise exception 'Only the study owner can edit protocol variables' using errcode = '42501';
  end if;
  if v_status <> 'draft' then
    raise exception 'Only a draft protocol version can be edited' using errcode = '55000';
  end if;

  delete from protocol_variables pvar where pvar.protocol_version_id = version_id;

  insert into protocol_variables (
    protocol_version_id, variable_name, variable_slug, variable_type, role,
    unit, value_labels, measurement_timepoint, description, display_order
  )
  select
    version_id, x.variable_name, x.variable_slug, x.variable_type,
    coalesce(x.role, 'other'::variable_role),
    x.unit, x.value_labels, x.measurement_timepoint, x.description, (e.ord - 1)::int
  from jsonb_array_elements(rows) with ordinality as e(elem, ord)
  cross join lateral jsonb_to_record(e.elem) as x(
    variable_name text, variable_slug text, variable_type variable_type, role variable_role,
    unit text, value_labels jsonb, measurement_timepoint text, description text
  )
  order by e.ord;
end;
$$;

-- Only signed-in users may call these (RLS and the checks above do the real gatekeeping).
revoke all on function public.replace_protocol_objectives(uuid, jsonb) from public, anon;
revoke all on function public.replace_protocol_variables(uuid, jsonb) from public, anon;
grant execute on function public.replace_protocol_objectives(uuid, jsonb) to authenticated;
grant execute on function public.replace_protocol_variables(uuid, jsonb) to authenticated;
