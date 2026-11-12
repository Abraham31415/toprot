# Admin console

The admin console is at `/admin`. It answers: how many people use ToProt, who pays, what AI costs, what people do, where traffic comes from, and whether payments, credits and AI are working. Everything on it is read from the application's own records. Nothing is seeded or estimated silently.

## Setting it up

1. **Apply the migration** `supabase/migrations/20261119090000_admin_console.sql` to the Supabase project (SQL editor, or `supabase db push`). Until it is applied, every admin page shows "The admin reporting functions are not installed" instead of failing. The migration only adds tables, functions and one view; it changes no existing data and no existing function.
2. **Become an administrator** (once, by you, in the SQL editor). There is deliberately no page or API that grants administrator access:

   ```sql
   insert into app_admins (user_id, role)
   select id, 'owner' from auth.users where email = 'YOUR EMAIL'
   on conflict (user_id) do update set role = 'owner';
   ```

   Roles: `owner` and `admin` can read and change; `viewer` can read only. If you were already added for the old billing page you are an `admin`; run the statement above to make yourself `owner`.
3. **Turn on two-step verification.** In Supabase, Authentication, make sure TOTP multi-factor is enabled. Then open `/admin`: you are sent to `/admin/security` to scan a QR code with an authenticator app. Admin pages and actions refuse a session that has not entered a code. `ADMIN_MFA_REQUIRED=false` turns the requirement off and shows a warning bar; use it only if the project cannot do MFA.
4. **Set environment variables** (Vercel, Settings, Environment Variables; names are in `frontend/.env.local.example`).

| Variable | Needed for | Required |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | All admin data (server only, already set) | Yes |
| `ADMIN_TIMEZONE` | Day and month boundaries, for example `Africa/Kampala` | No, default UTC |
| `ADMIN_MFA_REQUIRED` | Set `false` only to switch MFA off | No |
| `ANALYTICS_SALT` | Salt for the daily visitor code | Recommended |
| `ANTHROPIC_ADMIN_API_KEY` | Cost reconciliation (an Admin API key from the Anthropic Console) | Optional |
| `VERCEL_API_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID` | Recent deployments | Optional |
| `AI_ADMIN_ALERT_EMAIL`, `RESEND_API_KEY` | Emailing critical alerts from the daily job | Optional |

5. **Enter your own cost figures** in `/admin/settings`: monthly hosting cost, the payment fee percentage, and your storage limit. Until you do, the console shows them as not available instead of using zero.

## Pages

| Page | What it shows |
|---|---|
| Dashboard | Users, financial, AI and research KPIs, with a period filter and open alerts |
| Users, user detail | Searchable, paged list; per account the plan, payments, credits, AI usage, counts and actions |
| Subscriptions | Counts, renewals, cancellations requested versus access ended, conversion, a paged table |
| Teams | States plainly that Teams are not offered; shows supervisor workspaces |
| Revenue | Collected revenue, refunds, estimated fees, AI cost, estimated contribution, charts, payments list |
| AI Credits, credit ledger | Allocated, consumed, expired, reserved, available, exposure, ledger consistency; per-user ledger |
| AI Costs | Requests, tokens, cost, failures, budgets, limits, reconciliation with Anthropic |
| Traffic and funnel | Page views, visitors, sources, countries, devices, landing pages, funnel and campaigns |
| Research Activity | Aggregate use of tools, with trends |
| System Health | Alerts, payment events, AI failures, storage, job runs, application errors, deployments |
| Audit Logs | Every administrative change, with an integrity check and CSV export |
| Settings | Budgets, per-feature limits, cost figures, administrator safeguards, integration status |
| Guides | Draft and published research guides (see `docs/GUIDES.md`) |

The old `/admin/billing` address redirects to Revenue.

## How access is protected

- Administrators are rows in `app_admins`. Row level security is on with no policy, and the browser roles have no privileges on it, so the website cannot add or change an administrator. A test proves a signed-in user cannot insert into it.
- Every page and every action calls `requireAdmin()` itself; the layout only draws the frame. A signed-out visitor is sent to the login page; a signed-in non-administrator gets a 404.
- Every database function takes the acting administrator's id and re-checks it (`admin_assert`), and none is executable by `anon` or `authenticated`. The service key exists only on the server.
- Changes (suspending an account, promotional credits, settings) need a reason of at least 10 characters, are written to `admin_audit_log` inside the same database function that makes the change, and are rate limited per administrator per hour. Promotional credits are also capped per grant and per day.
- The audit log is append-only (update, delete and truncate are refused by triggers) and each entry stores a SHA-256 hash that includes the previous entry's hash. `admin_audit_verify` recomputes the chain and the Audit page and System Health page show whether it is intact. A database owner can bypass triggers, but not without breaking the chain.
- Opening an account's detail page is itself logged. It shows counts and dates, never project titles or research content.
- CSV exports are limited to 10 per hour, are never cached, neutralise spreadsheet formulas, and are logged.

## Account suspension

Suspending an account writes a row to `account_suspensions` and bans the user in Supabase Auth. The request proxy checks the row on every page and action and sends the person to `/suspended`, so it takes effect immediately even though an existing sign-in token lasts up to an hour. Payment webhooks, sign-out and the auth callback are not blocked. Restoring deletes the row and lifts the ban. Administrators cannot be suspended.

## Credits

The existing credit rules are unchanged and still enforced in the database: only active Pro subscribers can buy packs, subscription credits are spent before purchased ones, purchased credits survive a subscription ending, and reservations are taken under row locks. The console adds one new way to add credits: an audited, capped promotional grant, stored as a separate expiring lot with a transaction of kind `adjustment`. It never edits a payment, a subscription or an existing lot. An administrator can take back the unused part of a grant they issued.

## What is real, estimated or unavailable

- **Recorded:** counts of accounts, payments, subscriptions, credit movements, AI requests, projects, calculations, references and documents. These cover the whole history.
- **Estimated, and labelled "Estimate":** MRR and ARR (active subscriptions at the current price), payment fees (the percentage you set), contribution (revenue minus refunds, estimated fees, AI cost and the hosting figure you entered), exposure from unused credits.
- **Tracked going forward only:** page views, visitors, sources, countries, devices, calculator runs and literature searches. They begin when this version is deployed; there is no earlier history and the console says when tracking began.
- **Not available:** chargebacks (the payment integration does not record disputes), Vercel Web Analytics data (Vercel offers no query interface, only drains), database size and bandwidth, and anything for Teams. Where a figure needs a setting that is not set, it shows "Not available", never zero.
- **Currencies** are listed separately and never converted or added together. MRR, fees and contribution use USD only.

## Traffic tracking

ToProt records page views itself, in its own database, without cookies and without storing addresses. Each event holds the page (ids removed), the referring site's name, campaign tags (`utm_source`, `utm_medium`, `utm_campaign`), the country the host reports, a device category, and a visitor code that changes every day. Private pages (the workspace, account and admin pages) are not tracked; Do Not Track and Global Privacy Control are respected; bots are ignored. A first-visit campaign is kept in an HttpOnly cookie for 30 days so a later registration can be credited to it. Events older than 400 days are deleted by the daily job.

If you also want Vercel Web Analytics, switch it on in Vercel; to bring its data in here you would add a Vercel drain pointing at an endpoint you build. That needs a paid Vercel plan and is not part of this version.

## Alerts

`admin_scan_alerts` runs from the daily job and when the dashboard opens. It raises, once per finding: failed subscription renewals, AI spend above three times a typical day or 90 percent of the daily budget, credit grants with no audit entry, a spike in new accounts, provider events received but never finished, repeated application errors, PDF storage near your configured limit, and the daily job not having run for 36 hours. Critical ones are emailed when `AI_ADMIN_ALERT_EMAIL` and `RESEND_API_KEY` are set; warnings stay on the console.

## Spending safeguards

Enforced in the application before a request starts: the daily platform budget (existing), a new monthly platform budget (`platform_monthly_budget_micro_usd`, default $150, 0 turns it off), per-user concurrent and per-minute limits, and per-feature limits on iterations, tool calls and cost per operation. A person's own spending limit is their credit balance. All are editable on the Settings page with a reason.

## Limitations

- Charts are simple and have no zoom; every chart has its numbers underneath.
- "Daily active" and "monthly active" count recorded actions, not sign-ins (the sign-in service keeps only the latest sign-in).
- The Anthropic reconciliation uses the documented `cost_report` endpoint, which Anthropic marks legacy in favour of `/v1/organizations/analytics/cost`. It has not been run against a live key.
- Scheduled reports by email are not built. Exports are on demand.
- Page-tracking and job-run records start empty; the System Health and Traffic pages say so until data arrives.
