-- Collaboration, stage 6: admin console integration.
--
-- Extends the existing admin console (admin_assert, admin_audit_write, admin_rate_check) instead of adding a second admin system.
--   * Every function takes the acting administrator and checks it again (admin_assert); changes also refuse read-only administrators.
--   * Reads are aggregates or short ids and masked emails. NO private research content is returned: no protocol text, manuscripts,
--     comments, messages, file names, reference notes or project titles. Team names and people's names are account data, not research.
--   * Looking up one person or one team is itself written to the tamper-evident audit log, with the reason it was opened.
--   * Every change (credits to a pool, switching a pool off, withdrawing an invitation) needs a reason, is rate limited and is audited
--     inside the same function that makes it.

create or replace function public.admin_mask(p_email text) returns text language sql immutable
as $$ select case when p_email is null or position('@' in p_email) = 0 then 'unknown' else left(p_email, 1) || '***@' || split_part(p_email, '@', 2) end $$;

-- 1. Collaboration metrics ------------------------------------------------------------------------------------------------------------------

create or replace function public.admin_collab_overview(p_actor uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare q jsonb;
begin
  perform public.admin_assert(p_actor);
  q := public.collab_email_quota();
  return jsonb_build_object(
    'projects', jsonb_build_object(
      'shared', (select count(distinct study_id) from public.project_memberships),
      'team_projects', (select count(*) from public.studies where team_id is not null),
      'members_by_role', coalesce((select jsonb_object_agg(role, n) from (select role, count(*) n from public.project_memberships group by role) x), '{}'::jsonb),
      'dormant_memberships', (select count(*) from public.project_memberships m where public.study_role(m.study_id, m.user_id) is null)),
    'invitations', jsonb_build_object(
      'sent', (select count(*) from public.project_invitations where created_at between p_from and p_to) + (select count(*) from public.team_invitations where created_at between p_from and p_to),
      'accepted', (select count(*) from public.project_invitations where status = 'accepted' and responded_at between p_from and p_to) + (select count(*) from public.team_invitations where status = 'accepted' and responded_at between p_from and p_to),
      'declined', (select count(*) from public.project_invitations where status = 'declined' and responded_at between p_from and p_to) + (select count(*) from public.team_invitations where status = 'declined' and responded_at between p_from and p_to),
      'revoked', (select count(*) from public.project_invitations where status = 'revoked' and responded_at between p_from and p_to) + (select count(*) from public.team_invitations where status = 'revoked' and responded_at between p_from and p_to),
      'pending', (select count(*) from public.project_invitations where status = 'pending' and expires_at > now()) + (select count(*) from public.team_invitations where status = 'pending' and expires_at > now()),
      'expired_unanswered', (select count(*) from public.project_invitations where status = 'pending' and expires_at <= now()) + (select count(*) from public.team_invitations where status = 'pending' and expires_at <= now()),
      'delivery', coalesce((select jsonb_object_agg(delivery_status, n) from (select delivery_status, count(*) n from (
          select delivery_status from public.project_invitations where created_at between p_from and p_to
          union all select delivery_status from public.team_invitations where created_at between p_from and p_to) a group by delivery_status) x), '{}'::jsonb)),
    'reviews', jsonb_build_object(
      'submissions', (select count(*) from public.review_submissions where created_at between p_from and p_to),
      'approvals', (select count(*) from public.review_approvals where approved_at between p_from and p_to),
      'awaiting_review', (select count(*) from public.review_states where status in ('submitted', 'resubmitted')),
      'changes_requested', (select count(*) from public.review_states where status = 'changes_requested'),
      'open_threads', (select count(*) from public.review_threads where status = 'open')),
    'messages', jsonb_build_object('sent', coalesce((select sum(count) from public.collab_usage where metric = 'messages_sent' and day between p_from::date and p_to::date), 0)),
    'notifications', jsonb_build_object(
      'created', (select count(*) from public.notifications where created_at between p_from and p_to),
      'email_by_status', coalesce((select jsonb_object_agg(email_status, n) from (select email_status, count(*) n from public.notifications where created_at between p_from and p_to and email_status <> 'none' group by email_status) x), '{}'::jsonb)),
    'email_quota', q,
    'teams', jsonb_build_object(
      'total', (select count(*) from public.teams where archived_at is null),
      'active_plans', (select count(*) from public.team_subscriptions where status in ('active', 'past_due') and current_period_end > now()),
      'members', (select count(*) from public.team_memberships where seat_type = 'paid'),
      'guests', (select count(*) from public.team_memberships where seat_type = 'guest'),
      'pools_enabled', (select count(*) from public.team_credit_pools where enabled)));
end $$;

-- 2. Teams -----------------------------------------------------------------------------------------------------------------------------------

create or replace function public.admin_teams_page(p_actor uuid, p_search text default null, p_limit int default 25, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_like text := case when nullif(trim(coalesce(p_search, '')), '') is null then null else '%' || replace(replace(replace(lower(trim(p_search)), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
begin
  perform public.admin_assert(p_actor);
  return (select jsonb_build_object('total', (select count(*) from public.teams t where v_like is null or lower(t.name) like v_like escape '\'), 'rows', coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'created_at', r.created_at, 'owner', r.owner_name, 'owner_email', public.admin_mask(r.owner_email),
      'state', r.ent ->> 'state', 'paid_seats', (r.ent ->> 'max_paid_seats')::int, 'seats_used', r.seats_used, 'guests', r.guests, 'projects', r.projects,
      'pool_enabled', coalesce(r.pool_enabled, false), 'pool_balance', coalesce(r.pool_balance, 0)) order by r.created_at desc), '[]'::jsonb))
    from (select t.id, t.name, t.created_at, o.full_name as owner_name, ou.email as owner_email, public.team_entitlements(t.id) as ent,
                 (select count(*) from public.team_memberships m where m.team_id = t.id and m.seat_type = 'paid') as seats_used,
                 (select count(*) from public.team_memberships m where m.team_id = t.id and m.seat_type = 'guest') as guests,
                 (select count(*) from public.studies s where s.team_id = t.id) as projects,
                 pl.enabled as pool_enabled, pl.balance_mcr / 1000.0 as pool_balance
            from public.teams t
            left join public.team_memberships om on om.team_id = t.id and om.role = 'owner'
            left join public.profiles o on o.id = om.user_id left join auth.users ou on ou.id = om.user_id
            left join public.team_credit_pools pl on pl.team_id = t.id
           where v_like is null or lower(t.name) like v_like escape '\'
           order by t.created_at desc limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)) r);
end $$;

-- One team. Opening it is audited. Shows accounts, plan, money and credits, never a project's content.
create or replace function public.admin_team_detail(p_actor uuid, p_team uuid, p_reason text default null, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_name text;
begin
  perform public.admin_assert(p_actor);
  select name into v_name from public.teams where id = p_team;
  if v_name is null then raise exception 'unknown_team' using errcode = 'P0002'; end if;
  perform public.admin_audit_write(p_actor, 'team.view', 'team', p_team::text, p_reason, '{}'::jsonb, p_ip);
  return jsonb_build_object('team', jsonb_build_object('id', p_team, 'name', v_name),
    'entitlements', public.team_entitlements(p_team),
    'subscription', (select to_jsonb(s) - 'provider_subscription_id' - 'billing_owner' from public.team_subscriptions s where s.team_id = p_team),
    'members', coalesce((select jsonb_agg(jsonb_build_object('name', pr.full_name, 'email', public.admin_mask(u.email), 'role', m.role, 'seat', m.seat_type, 'joined', m.created_at,
        'projects_owned', (select count(*) from public.studies s where s.team_id = p_team and s.owner_id = m.user_id)) order by m.created_at)
        from public.team_memberships m join public.profiles pr on pr.id = m.user_id join auth.users u on u.id = m.user_id where m.team_id = p_team), '[]'::jsonb),
    'projects', coalesce((select jsonb_agg(jsonb_build_object('ref', left(s.id::text, 8), 'status', s.status, 'people', (select count(*) from public.project_memberships pm where pm.study_id = s.id) + 1,
        'submissions', (select count(*) from public.review_submissions rs where rs.study_id = s.id), 'last_activity', s.last_activity_at) order by s.last_activity_at desc)
        from public.studies s where s.team_id = p_team), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'amount', amount, 'currency', currency, 'status', status, 'at', created_at, 'id', id) order by created_at desc)
        from (select * from public.payments where team_id = p_team order by created_at desc limit 30) x), '[]'::jsonb),
    'pool', (select jsonb_build_object('enabled', enabled, 'balance', balance_mcr / 1000.0, 'reserved', reserved_mcr / 1000.0, 'team_limit', monthly_team_limit_mcr / 1000.0, 'member_limit', default_member_limit_mcr / 1000.0) from public.team_credit_pools where team_id = p_team),
    'pool_ledger', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'credits', amount_mcr / 1000.0, 'note', note, 'at', created_at) order by created_at desc)
        from (select * from public.team_credit_transactions where team_id = p_team order by created_at desc limit 30) x), '[]'::jsonb),
    'open_reservations', (select count(*) from public.team_ai_reservations where team_id = p_team and status = 'open'),
    'documents', jsonb_build_object('count', (select count(*) from public.team_documents where team_id = p_team and deleted_at is null), 'bytes', (select coalesce(sum(size_bytes), 0) from public.team_documents where team_id = p_team and deleted_at is null)),
    'activity', coalesce((select jsonb_agg(jsonb_build_object('action', action, 'at', created_at) order by created_at desc) from (select action, created_at from public.collab_events where team_id = p_team order by created_at desc limit 25) x), '[]'::jsonb));
end $$;

create or replace function public.admin_failed_invitations(p_actor uuid, p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert(p_actor);
  return coalesce((select jsonb_agg(x order by (x ->> 'at') desc) from (
    select jsonb_build_object('kind', 'project', 'id', i.id, 'email', public.admin_mask(i.email), 'role', i.role, 'status', i.status, 'delivery', i.delivery_status, 'error', i.delivery_error, 'at', i.created_at, 'sends', i.send_count) as x
      from public.project_invitations i where i.delivery_status in ('failed', 'not_configured') and i.status = 'pending' and i.expires_at > now()
    union all
    select jsonb_build_object('kind', 'team', 'id', t.id, 'email', public.admin_mask(t.email), 'role', t.role, 'status', t.status, 'delivery', t.delivery_status, 'error', t.delivery_error, 'at', t.created_at, 'sends', t.send_count)
      from public.team_invitations t where t.delivery_status in ('failed', 'not_configured') and t.status = 'pending' and t.expires_at > now()
    limit least(greatest(p_limit, 1), 200)) a), '[]'::jsonb);
end $$;

-- 3. Money and credits -----------------------------------------------------------------------------------------------------------------------

create or replace function public.admin_team_financials(p_actor uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v_base numeric := public.team_price('team'); v_seat numeric := public.team_price('team_seat'); v_free int := public.billing_setting_num('team_base_paid_seats')::int;
begin
  perform public.admin_assert(p_actor);
  return jsonb_build_object(
    'billing_enabled', public.billing_setting_num('teams_billing_enabled') >= 1,
    'prices', jsonb_build_object('base', v_base, 'seat', v_seat, 'base_seats', v_free),
    'active_subscriptions', (select count(*) from public.team_subscriptions where status = 'active' and current_period_end > now()),
    'past_due', (select count(*) from public.team_subscriptions where status = 'past_due'),
    'cancelling', (select count(*) from public.team_subscriptions where status = 'active' and cancel_at_period_end and current_period_end > now()),
    'paid_seats', (select coalesce(sum(paid_seats), 0) from public.team_subscriptions where status = 'active' and current_period_end > now()),
    -- Recurring revenue is an ESTIMATE from today's stored prices and the seats currently subscribed. Recorded payments are below.
    'mrr_estimate_usd', case when v_base is null then null else (select coalesce(sum(v_base + greatest(paid_seats - v_free, 0) * coalesce(v_seat, 0)), 0) from public.team_subscriptions where status = 'active' and current_period_end > now()) end,
    'payments', coalesce((select jsonb_object_agg(kind, jsonb_build_object('count', n, 'usd', total)) from (select kind, count(*) n, sum(amount) total from public.payments
        where team_id is not null and status = 'succeeded' and created_at between p_from and p_to group by kind) x), '{}'::jsonb),
    'refunds_usd', (select coalesce(sum(amount), 0) from public.payments where team_id is not null and status = 'refunded' and refunded_at between p_from and p_to),
    'failed_payments', (select count(*) from public.payments where team_id is not null and status = 'failed' and created_at between p_from and p_to),
    'pool', jsonb_build_object(
      'credits_added', (select coalesce(sum(amount_mcr), 0) / 1000.0 from public.team_credit_transactions where amount_mcr > 0 and created_at between p_from and p_to),
      'credits_used', (select coalesce(-sum(amount_mcr), 0) / 1000.0 from public.team_credit_transactions where kind = 'usage' and created_at between p_from and p_to),
      'outstanding_balance', (select coalesce(sum(balance_mcr), 0) / 1000.0 from public.team_credit_pools),
      'held', (select coalesce(sum(reserved_mcr), 0) / 1000.0 from public.team_credit_pools)),
    'team_funded_ai', jsonb_build_object(
      'requests', (select count(*) from public.ai_usage_events where funding_source = 'team' and status = 'committed' and created_at between p_from and p_to),
      'provider_cost_usd', (select coalesce(sum(cost_micro_usd), 0) / 1000000.0 from public.ai_usage_events where funding_source = 'team' and status = 'committed' and created_at between p_from and p_to),
      'overrun_credits', (select coalesce(sum(overrun_mcr), 0) / 1000.0 from public.team_ai_reservations where settled_at between p_from and p_to)));
end $$;

-- 4. Investigation ---------------------------------------------------------------------------------------------------------------------------

-- Where does this person have access, and how? By exact email. Shows roles and short project references, never titles or content.
create or replace function public.admin_investigate_person(p_actor uuid, p_email text, p_reason text, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_user uuid; v_email text := lower(trim(coalesce(p_email, '')));
begin
  perform public.admin_assert(p_actor);
  if p_reason is null or length(trim(p_reason)) < 10 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  perform public.admin_rate_check(p_actor, 'collab.investigate', 60);
  select id into v_user from auth.users where lower(email) = v_email;
  perform public.admin_audit_write(p_actor, 'collab.investigate', 'email', public.admin_mask(v_email), trim(p_reason), jsonb_build_object('found', v_user is not null), p_ip);
  if v_user is null then
    return jsonb_build_object('found', false, 'invitations', coalesce((select jsonb_agg(jsonb_build_object('kind', k, 'role', role, 'status', status, 'at', created_at, 'delivery', delivery_status) order by created_at desc) from (
      select 'project' as k, role, status, created_at, delivery_status from public.project_invitations where email = v_email
      union all select 'team', role, status, created_at, delivery_status from public.team_invitations where email = v_email) z), '[]'::jsonb));
  end if;
  return jsonb_build_object('found', true, 'user', jsonb_build_object('id', v_user, 'personal_plan', public.billing_user_plan(v_user)),
    'owns', (select count(*) from public.studies where owner_id = v_user),
    'project_roles', coalesce((select jsonb_agg(jsonb_build_object('ref', left(m.study_id::text, 8), 'role', m.role, 'effective', public.study_role(m.study_id, v_user), 'owner_plan', public.collab_project_plan(m.study_id), 'since', m.created_at) order by m.created_at desc)
        from public.project_memberships m where m.user_id = v_user), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('team', t.name, 'role', tm.role, 'seat', tm.seat_type, 'state', public.team_entitlements(t.id) ->> 'state') order by tm.created_at)
        from public.team_memberships tm join public.teams t on t.id = tm.team_id where tm.user_id = v_user), '[]'::jsonb),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object('kind', k, 'role', role, 'status', status, 'at', created_at, 'delivery', delivery_status) order by created_at desc) from (
        select 'project' as k, role, status, created_at, delivery_status from public.project_invitations where email = v_email
        union all select 'team', role, status, created_at, delivery_status from public.team_invitations where email = v_email) z), '[]'::jsonb),
    'ai_funding', (select jsonb_build_object('team', t.name) from public.user_ai_funding f join public.teams t on t.id = f.team_id where f.user_id = v_user),
    'recent_events', coalesce((select jsonb_agg(jsonb_build_object('action', action, 'at', created_at) order by created_at desc) from (select action, created_at from public.collab_events where actor_id = v_user or target_user = v_user order by created_at desc limit 20) x), '[]'::jsonb));
end $$;

-- 5. Privileged changes (each audited, reasoned and rate limited) --------------------------------------------------------------------------

create or replace function public.admin_team_credit_grant(p_actor uuid, p_team uuid, p_credits int, p_reason text, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_max numeric := public.billing_setting_num('admin_grant_max_credits'); v_day numeric;
begin
  perform public.admin_assert(p_actor, true);
  if p_reason is null or length(trim(p_reason)) < 10 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  if p_credits is null or p_credits < 1 or p_credits > v_max then raise exception 'credits_out_of_range' using errcode = 'P0001', detail = v_max::text; end if;
  if not exists (select 1 from public.teams where id = p_team) then raise exception 'unknown_team' using errcode = 'P0002'; end if;
  perform public.admin_rate_check(p_actor, 'team.credit', public.billing_setting_num('admin_sensitive_ops_per_hour')::int);
  select coalesce(sum((details ->> 'credits')::numeric), 0) into v_day from public.admin_audit_log where actor_id = p_actor and action in ('credits.grant', 'team.credit_grant') and created_at > now() - interval '24 hours';
  if v_day + p_credits > public.billing_setting_num('admin_grant_daily_max_credits') then raise exception 'daily_limit_reached' using errcode = 'P0001'; end if;
  insert into public.team_credit_pools (team_id) values (p_team) on conflict do nothing;
  update public.team_credit_pools set balance_mcr = balance_mcr + p_credits::bigint * 1000, updated_at = now() where team_id = p_team;
  insert into public.team_credit_transactions (team_id, kind, amount_mcr, note) values (p_team, 'adjustment', p_credits::bigint * 1000, 'Admin grant: ' || left(trim(p_reason), 150));
  perform public.admin_audit_write(p_actor, 'team.credit_grant', 'team', p_team::text, trim(p_reason), jsonb_build_object('credits', p_credits), p_ip);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_team_pool_set(p_actor uuid, p_team uuid, p_enabled boolean, p_reason text, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  perform public.admin_assert(p_actor, true);
  if p_reason is null or length(trim(p_reason)) < 10 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  perform public.admin_rate_check(p_actor, 'team.pool', public.billing_setting_num('admin_sensitive_ops_per_hour')::int);
  if not exists (select 1 from public.team_credit_pools where team_id = p_team) then raise exception 'no_pool' using errcode = 'P0002'; end if;
  update public.team_credit_pools set enabled = p_enabled, updated_at = now() where team_id = p_team;
  perform public.admin_audit_write(p_actor, 'team.pool_set', 'team', p_team::text, trim(p_reason), jsonb_build_object('enabled', p_enabled), p_ip);
  return jsonb_build_object('ok', true);
end $$;

-- Withdraw an invitation that is being abused (for example sent to a harassed address).
create or replace function public.admin_revoke_invitation(p_actor uuid, p_kind text, p_invitation uuid, p_reason text, p_ip text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int;
begin
  perform public.admin_assert(p_actor, true);
  if p_reason is null or length(trim(p_reason)) < 10 then raise exception 'reason_required' using errcode = 'P0001'; end if;
  perform public.admin_rate_check(p_actor, 'invitation.', public.billing_setting_num('admin_sensitive_ops_per_hour')::int);
  if p_kind = 'project' then update public.project_invitations set status = 'revoked', responded_at = now() where id = p_invitation and status = 'pending';
  elsif p_kind = 'team' then update public.team_invitations set status = 'revoked', responded_at = now() where id = p_invitation and status = 'pending';
  else raise exception 'invalid_kind' using errcode = '22023'; end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not_pending' using errcode = 'P0001'; end if;
  perform public.admin_audit_write(p_actor, 'invitation.revoke', p_kind, p_invitation::text, trim(p_reason), '{}'::jsonb, p_ip);
  return jsonb_build_object('ok', true);
end $$;

-- 6. Alerts for the system health page ---------------------------------------------------------------------------------------------------------

create or replace function public.collab_scan_alerts() returns int language plpgsql security definer set search_path = public, pg_temp
as $$
declare n int := public.collab_check_quota_alerts(); v_failed int; v_total int;
begin
  select count(*) filter (where delivery_status = 'failed'), count(*) into v_failed, v_total from (
    select delivery_status from public.project_invitations where created_at > now() - interval '24 hours'
    union all select delivery_status from public.team_invitations where created_at > now() - interval '24 hours') x;
  if v_failed >= 5 then
    if public.system_alert_raise('invitation_delivery', 'warning', v_failed || ' invitation emails failed to send in the last 24 hours', jsonb_build_object('failed', v_failed, 'total', v_total), 'invitation_delivery:' || (now() at time zone 'UTC')::date) then n := n + 1; end if;
  end if;
  if (select count(*) from public.team_subscriptions where status = 'past_due') > 0 then
    if public.system_alert_raise('team_past_due', 'info', (select count(*) from public.team_subscriptions where status = 'past_due') || ' team subscription(s) are in a payment grace period', '{}'::jsonb, 'team_past_due:' || (now() at time zone 'UTC')::date) then n := n + 1; end if;
  end if;
  return n;
end $$;

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and (p.proname like 'admin\_%' or p.proname = 'collab_scan_alerts')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
