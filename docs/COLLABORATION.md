# Collaboration and Teams

Everything below is built on the existing ownership (`studies.owner_id`), billing (`payments`, Dodo verification) and AI ledger (`ai_reserve`/`ai_commit`). Nothing is duplicated, and nothing here changes production data until the migrations are applied.

## Migrations (apply in order, only after review; none has been applied to production)

| File | What it adds |
| --- | --- |
| `20261120090000_collab_foundation.sql` | `project_memberships`, `project_invitations`, `collab_role_limits`, `collab_events`; `study_role()`; every study table's RLS rewritten to membership roles; storage policies; legacy `study_supervisors` / `supervisor_invitations` copied in and made read-only |
| `20261121090000_collab_supervision.sql` | review submissions (snapshots), per-supervisor states and history, immutable approvals, section threads, notifications |
| `20261122090000_collab_teams.sql` | teams, seats, team projects, shared references (links), documents on a private bucket, team invitations |
| `20261123090000_collab_advanced.sql` | compare-and-set protocol saves, snapshots, messages (+ realtime policies), notification preferences, email queue, usage counters |
| `20261124090000_collab_billing.sql` | Teams plan (inactive), team subscriptions, team payments, credit pools, funding sources; `ai_reserve` / `ai_commit` / `billing_fulfill_payment` / `billing_refund_payment` extended |
| `20261125090000_collab_admin.sql` | admin reports, audited investigation and privileged changes |

The migrations also copy existing supervisors into `project_memberships` and keep pending legacy invitations alive (token hashed). They never delete rows.

## Roles and permissions

Project roles come only from `studies.owner_id` and `project_memberships`. A profile label (student, lecturer, supervisor) grants nothing.

| Role | Read | Comment | Edit content | Review / approve | Invite, remove, lock protocol, delete |
| --- | --- | --- | --- | --- | --- |
| Owner | yes | yes | yes | no (cannot approve own work) | yes |
| Editor | yes | yes | yes | no | no |
| Reviewer | yes | yes | no | yes | no |
| Viewer | yes | no | no | no | no |

Enforcement, in three layers: the server (`lib/collab/access.ts` calls `study_role` for every action), the database (SECURITY DEFINER functions re-check the actor; row level security through `can_read_study` / `can_write_study`; triggers stop editors locking a protocol and stop non-owners deleting versions) and storage policies. Direct browser writes to membership, invitation, approval, billing and pool tables are not possible (no privileges, no policies).

Plan limits are data: `collab_role_limits` (Free: 2 reviewers and nothing else; Pro: 5 reviewers, 5 editors, 10 viewers; Team: 10 / 20 / 20) and `billing_settings` (invitation expiry, per-owner and per-recipient daily limits, resend cooldown). They count the role column, so a "co-investigator" label cannot bypass them. If an owner's plan stops including a role, those memberships go dormant (no access) and return when the plan does.

## Features by stage

1. **Foundation**: Share dialog on every project, Shared with me (`/shared`), invitation page (`/invite/<token>`). Tokens are 256 bit, stored as SHA-256 only, expire (14 days), are single use, and accepting requires the signed-in, confirmed email to equal the invited email. Mismatch looks identical to "not found". Resend issues a new token. Email is sent through Resend and the invitation records `provider_accepted`, `failed` or `not_configured`; the owner always gets a copyable link.
2. **Supervision**: `/studies/<id>/review` and the Supervision workspace (`/supervisor`, any account that is a reviewer on something). Draft, Submitted, Under review, Changes requested, Resubmitted, Approved, tracked per supervisor. A submission snapshots the protocol and manuscript text. Approval needs a signed-in reviewer, an explicit confirmation, and is stored as an immutable, versioned row. Comments attach to protocol sections or manuscripts (inline highlighting is not offered: the editor has no reliable anchor API). The UI states this is an internal workflow, not ethics approval.
3. **Teams** (`/teams`): owner, administrator, member, guest; paid and guest seats; dashboard of real counts; team projects (membership never grants access to a project; the project owner adds people; editors and viewers need a paid seat, guests can only review); shared references are links, not copies (private notes and tags never leave); documents in the private `team-documents` bucket with seat-based storage policies and short signed download links; activity timeline.
4. **Advanced**: protocol sections save with compare-and-set (different fields merge, the same field returns a conflict and keeps the person's text); protocol snapshots and restore; manuscripts already refuse stale revisions; project discussion and team chat with Realtime and presence, a polling fallback, unread counts and DB rate limits; in-app notifications that never depend on realtime; per-category preferences; queued emails with per-person throttles and daily/monthly Resend quotas (alerts in the admin console).
5. **Billing and credits**: see below.
6. **Admin** (`/admin/teams`, `/admin/teams/<id>`): collaboration metrics, undelivered invitations, team financials, audited person lookup, audited credit grants and pool switch, invitation withdrawal. No research content is returned by any admin function (tested).

## Billing and credits

* Prices (all in the database, `billing_prices` and `billing_settings`): 25 USD a month for 3 paid seats, 6 USD a month per extra seat. Each paid period adds 7,500 shared credits to the pool, plus 2,000 per paid seat beyond 3 (`team_seat_monthly_credits`); seats added mid-period add theirs once paid. The unused part of a period's grant expires at the end of the period (`period_grant_mcr`); purchased team packs and balances from before 20261128090000 do not. The Teams plan row is **inactive** and `teams_billing_enabled` is `0`, so nothing can be bought until the provider set-up in docs/billing.md is done.
* Money in uses the existing path: a pending `payments` row at the stored price, the Dodo checkout, then `fulfilDodoPayment` re-fetches and verifies the payment before `billing_fulfill_payment` (now with team branches) changes anything. Renewals, failed payments (7 day grace), cancellation (access to period end), refunds (undo only what the payment granted) and seat changes (add now with a one-off payment, reduce at renewal, never below seats in use) are covered by `billing.db.test.ts`.
* Individual Pro and Team entitlements are independent. The owner's personal plan covers personal projects; a team project follows the Team plan's limits only while that plan is active, otherwise the owner's own plan. Members never pay for the owner's seats, the owner's own seat is part of the base seats, and a renewing team subscription cannot be bought twice.
* AI: requests charge the requester's own credits by default. A team can enable a pool; each member opts in. A pool-funded request goes through the same reserve/commit ledger (platform budget, rate limits, idempotency) funded from a one-day advance lot that the pool creates for that single request; unused credit returns when it settles. Holds are atomic, balances have check constraints (never negative), settlement runs on every exit and `team_ai_reconcile` repairs and reports drift. Member and team monthly limits and an approval workflow for extra credits exist. If the pool cannot pay the person is told why; there is no silent fallback to personal credits. `ai_usage_events.funding_source` and `funding_team_id` record who paid for each operation. Credit never widens access: a project-linked request needs a role on that project.

## External configuration still needed (nothing below is assumed)

1. Apply the six migrations to Supabase after review (not done).
2. Resend: `RESEND_API_KEY` and `COLLAB_FROM_EMAIL` (a verified sender). Without them invitations still work through the copyable link and are recorded as `not_configured`. Quotas default to the free plan (100 a day, 3000 a month); edit `collab_resend_*` settings if your plan differs.
3. Supabase Realtime: enable Realtime for `public.collab_messages` (the migration adds it to the `supabase_realtime` publication and creates the `realtime.messages` policies when present) and allow private channels. Without it messages refresh every 15 seconds.
4. Cron: `vercel.json` adds `/api/collab/dispatch` (daily; emails are also sent right after review actions). Vercel hobby limits cron to daily.
5. Teams billing: create Dodo products for the Teams plan and the extra seat add-on, map them in `billing_provider_products` (`plan`/`team`, `plan`/`team_seat`), pay a test checkout in test mode and confirm it verifies, then `update billing_settings set value_num = 1 where key = 'teams_billing_enabled'` and `update plans set active = true where plan_key = 'team'`. The provider's subscription quantity for added or reduced seats must be updated at Dodo (flagged by `provider_seat_sync_pending`); this is not automated.

## Limitations

* No inline highlighting comments in the manuscript editor; comments are per section or manuscript.
* Protocol history covers text fields, not objectives and variables. Manuscripts keep their existing version history.
* Collaborative editing is conflict detection, not live co-editing: the later saver is told and keeps their text.
* Pool credits from purchased packs and adjustments do not expire by themselves (monthly shared grants do, see above); a pool request that exceeds its advance lot records the excess as an overrun the platform absorbs (audited, reported in admin financials).
* Transfer of team ownership is not built; removing a person who owns team projects requires transferring them first.
* Verified by automated tests: unit tests, a scratch PostgreSQL with every migration applied (RLS, storage and billing behaviour), 150+ collaboration tests and the existing 1000+ suite. Not verified here: a real Resend delivery, a real Dodo payment, Realtime over a live Supabase project, and manual screen-reader or touch-device walkthroughs. Components use real labels, roles, live regions, native `<dialog>`, keyboard-operable controls and the design system's responsive layout, and lint (including the accessibility rules) passes, but a person should walk through the dialogs, tables and conversation view with a keyboard and a screen reader before launch.
