-- Data Studio statistical entitlements follow the researcher's subscription tier, not team membership.
--
--   free      basic     essential descriptive and common inferential statistics
--   pro       standard  + regression, diagnostic accuracy, reliability, Bland-Altman, bootstrapping and other expanded methods
--   advanced  advanced  every implemented method (survival, Cox, Mantel-Haenszel, PCA, ...)
--   team      advanced  the same statistics as Advanced; Teams adds collaboration, not exclusive methods
--
-- Which method needs which tier lives in frontend/src/lib/datastudio/engine/registry.ts; the plan-to-tier mapping below must match
-- PLAN_METHOD_TIER in frontend/src/lib/datastudio/entitlements.ts (checked by data-studio.db.test.ts).
--
-- Before this migration the advanced tier was granted only to Team, so individual researchers could never run survival analysis, Cox
-- regression, Mantel-Haenszel or PCA. This adds an individual Advanced plan to carry that tier.
--
-- The Advanced plan is created INACTIVE, so it cannot be bought. Its price, credits, project limit and Data Studio quotas are set by
-- 20261128090000_subscription_plans_final.sql; the values below are only the starting point copied from Pro.

-- 1. The Advanced plan (individual) ---------------------------------------------------------------------------------------------------------
insert into public.plans (plan_key, name, tagline, is_paid, tier_rank, monthly_credits, intro_credits, max_projects, ai_features, bullets, active, sort)
select 'advanced', 'Toprot Advanced', 'Every statistical method in Data Studio, for individual researchers.', true, p.tier_rank, p.monthly_credits, 0, p.max_projects,
       p.ai_features,
       array['Everything in Pro', 'All Data Studio statistical methods, including survival analysis, Cox regression, Mantel-Haenszel and PCA'],
       false, p.sort + 1
  from public.plans p where p.plan_key = 'pro'
on conflict (plan_key) do nothing;

-- Keep Teams after Advanced in display order (sort only; tier_rank and everything else about Teams is unchanged).
update public.plans set sort = greatest(sort, (select sort + 1 from public.plans where plan_key = 'advanced'))
 where plan_key = 'team' and exists (select 1 from public.plans where plan_key = 'advanced');

-- 2. Data Studio limits for Advanced (quotas finalised in 20261128090000) ----------------------------------------------------------------
insert into public.ds_plan_limits
  (plan_key, max_datasets_per_project, max_rows, max_columns, max_upload_bytes, max_project_storage_bytes, max_versions_per_dataset, max_analyses_per_day, method_tier, exports)
select 'advanced', l.max_datasets_per_project, l.max_rows, l.max_columns, l.max_upload_bytes, l.max_project_storage_bytes, l.max_versions_per_dataset,
       l.max_analyses_per_day, 'advanced', l.exports
  from public.ds_plan_limits l
 where l.plan_key = 'pro' and exists (select 1 from public.plans where plan_key = 'advanced')
on conflict (plan_key) do update set method_tier = 'advanced', updated_at = now();

-- 3. Pin every plan's method tier to the entitlement table (idempotent; quotas are left as they are) -------------------------------------
update public.ds_plan_limits l set method_tier = v.tier, updated_at = now()
  from (values ('free', 'basic'), ('pro', 'standard'), ('advanced', 'advanced'), ('team', 'advanced')) as v(plan_key, tier)
 where l.plan_key = v.plan_key and l.method_tier is distinct from v.tier;

comment on column public.ds_plan_limits.method_tier is
  'Statistical methods this plan may run: basic (Free), standard (Pro), advanced (Advanced and Teams). Teams grants the same statistics as Advanced; it adds collaboration, not methods. Must match PLAN_METHOD_TIER in frontend/src/lib/datastudio/entitlements.ts.';
