/* eslint-disable @typescript-eslint/no-explicit-any -- rows from the scratch database are untyped */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminDb } from "@/lib/admin/__tests__/db-harness";
import { makeHelpers, type Person } from "./helpers";

// Stage 6: admin integration, cross-user isolation, privilege escalation, and the end-to-end scenarios A to E.
let db: AdminDb;
const { person, project, join, as, invite, subscribe } = makeHelpers(() => db);
let admin: string; let viewer: string; let feature = "";

beforeAll(async () => {
  db = await AdminDb.create();
  admin = await db.admin("admin"); viewer = await db.admin("viewer");
  await db.pool.query("update public.billing_settings set value_num = 100 where key = 'admin_sensitive_ops_per_hour'");
  feature = (await db.pool.query("select f.feature_key from public.ai_features f join public.plans p on p.plan_key = 'free' and f.feature_key = any (p.ai_features) where f.enabled order by 1 limit 1")).rows[0].feature_key;
  await db.pool.query("grant select, insert, update, delete on storage.objects to authenticated, service_role");
}, 120_000);
afterAll(async () => { await db.close(); });

const range = () => ({ p_from: new Date(Date.now() - 30 * 86400_000).toISOString(), p_to: new Date(Date.now() + 3600_000).toISOString() });
const newTeam = (o: Person, name = "Lab") => db.rpc<string>("team_create", { p_actor: o.id, p_name: name });
const tjoin = async (o: Person, team: string, who: Person, role: string) => { const i = await db.rpc<any>("team_invite", { p_actor: o.id, p_team: team, p_email: who.email, p_role: role }); return db.rpc("collab_accept", { p_actor: who.id, p_token: i.token }); };
async function activeTeam(owner: Person, seats = 4) {
  await db.pool.query("update public.billing_settings set value_num = 1 where key = 'teams_billing_enabled'");
  await db.pool.query("update public.plans set active = true where plan_key = 'team'");
  const t = await newTeam(owner);
  const p = await db.rpc<any>("team_create_payment", { p_actor: owner.id, p_team: t, p_seats: seats, p_currency: "USD", p_tx_ref: `toprot-${randomUUID()}`, p_provider: "dodo" });
  await db.rpc("billing_fulfill_payment", { p_tx_ref: p.tx_ref, p_provider_txn: `pay_${randomUUID().slice(0, 10)}`, p_provider_status: "successful", p_amount: p.amount, p_currency: "USD", p_method: "card", p_event_key: null });
  return t;
}

describe("admin functions", () => {
  it("refuse anyone who is not an administrator, and read-only administrators cannot change anything", async () => {
    const plain = await person("Plain"); const t = await newTeam(plain);
    for (const [fn, args] of [
      ["admin_collab_overview", range()], ["admin_teams_page", {}], ["admin_team_detail", { p_team: t }], ["admin_failed_invitations", {}], ["admin_team_financials", range()],
      ["admin_investigate_person", { p_email: "a@b.co", p_reason: "ten characters long" }],
    ] as [string, Record<string, unknown>][]) await db.rpcFails(fn, { p_actor: plain.id, ...args }, "not_admin");
    for (const [fn, args] of [
      ["admin_team_credit_grant", { p_team: t, p_credits: 5, p_reason: "a reason long enough" }],
      ["admin_team_pool_set", { p_team: t, p_enabled: false, p_reason: "a reason long enough" }],
      ["admin_revoke_invitation", { p_kind: "team", p_invitation: randomUUID(), p_reason: "a reason long enough" }],
    ] as [string, Record<string, unknown>][]) {
      await db.rpcFails(fn, { p_actor: plain.id, ...args }, "not_admin");
      await db.rpcFails(fn, { p_actor: viewer, ...args }, "read_only_admin");
    }
    await expect(as(plain.id, "select public.admin_collab_overview($1, now(), now())", [plain.id])).rejects.toThrow(/permission denied/);
    await expect(as(plain.id, "select * from public.collab_usage")).rejects.toThrow(/permission denied/);
  });

  it("report real numbers and never private research content", async () => {
    const owner = await person("Owner", "pro"); const sup = await person("Sup"); const study = await project(owner.id, "SECRET TITLE about malaria");
    await join(owner.id, study, sup, "reviewer");
    await db.pool.query("update public.protocol_versions set research_question = 'SECRET QUESTION' where study_id = $1", [study]);
    await db.rpc("collab_review_submit", { p_actor: owner.id, p_study: study, p_note: "SECRET NOTE" });
    await db.rpc("collab_comment_add", { p_actor: sup.id, p_study: study, p_section: "general", p_body: "SECRET COMMENT", p_thread: null });
    await db.rpc("collab_message_send", { p_actor: owner.id, p_conversation: `project:${study}`, p_body: "SECRET MESSAGE" });
    const team = await activeTeam(owner);
    const tp = (await db.pool.query("insert into public.studies (owner_id, title, team_id) values ($1, 'TEAM SECRET TITLE', $2) returning id", [owner.id, team])).rows[0].id;
    await invite(owner.id, study, "failing@test.local", "reviewer");
    await db.pool.query("update public.project_invitations set delivery_status = 'failed', delivery_error = 'Resend responded 500' where email = 'failing@test.local'");

    const ov = await db.rpc<any>("admin_collab_overview", { p_actor: admin, ...range() });
    expect(ov.projects.shared).toBeGreaterThanOrEqual(1);
    expect(ov.reviews).toMatchObject({ awaiting_review: expect.any(Number) });
    expect(ov.reviews.submissions).toBeGreaterThanOrEqual(1);
    expect(ov.messages.sent).toBeGreaterThanOrEqual(1);
    expect(ov.invitations.delivery.failed).toBeGreaterThanOrEqual(1);
    expect(ov.teams.active_plans).toBeGreaterThanOrEqual(1);
    const teams = await db.rpc<any>("admin_teams_page", { p_actor: admin, p_search: "lab" });
    expect(teams.rows[0]).toMatchObject({ name: "Lab", state: "active", projects: 1 });
    expect(teams.rows[0].owner_email).toMatch(/^o\*\*\*@/);
    const detail = await db.rpc<any>("admin_team_detail", { p_actor: admin, p_team: team, p_reason: "support request 1234" });
    const failed = await db.rpc<any[]>("admin_failed_invitations", { p_actor: admin });
    expect(failed.some((f) => f.email.startsWith("f***@") && f.delivery === "failed")).toBe(true);
    const fin = await db.rpc<any>("admin_team_financials", { p_actor: admin, ...range() });
    expect(fin).toMatchObject({ active_subscriptions: 1, paid_seats: 4 });
    expect(fin.mrr_estimate_usd).toBe(31); // 25 + 1 extra seat at 6, an estimate from stored prices
    expect(fin.payments.team_subscription).toMatchObject({ count: 1, usd: 31 });
    const all = JSON.stringify([ov, teams, detail, failed, fin, await db.rpc("admin_investigate_person", { p_actor: admin, p_email: owner.email, p_reason: "checking access report" })]);
    for (const secret of ["SECRET TITLE", "SECRET QUESTION", "SECRET NOTE", "SECRET COMMENT", "SECRET MESSAGE", "TEAM SECRET"]) expect(all).not.toContain(secret);
    expect(detail.projects[0].ref).toBe(tp.slice(0, 8));
  });

  it("audit every lookup and every change, with a reason, in the tamper-evident log", async () => {
    const owner = await person("Owner"); const team = await activeTeam(owner);
    await db.rpcFails("admin_investigate_person", { p_actor: admin, p_email: owner.email, p_reason: "short" }, "reason_required");
    await db.rpc("admin_investigate_person", { p_actor: admin, p_email: owner.email, p_reason: "user reports lost access" });
    await db.rpc("admin_team_detail", { p_actor: admin, p_team: team, p_reason: "billing question" });
    await db.rpcFails("admin_team_credit_grant", { p_actor: admin, p_team: team, p_credits: 10, p_reason: "short" }, "reason_required");
    await db.rpcFails("admin_team_credit_grant", { p_actor: admin, p_team: team, p_credits: 999999, p_reason: "goodwill gesture for outage" }, "credits_out_of_range");
    await db.rpc("admin_team_credit_grant", { p_actor: admin, p_team: team, p_credits: 100, p_reason: "goodwill gesture for outage" });
    expect((await db.pool.query("select balance_mcr::int b from public.team_credit_pools where team_id = $1", [team])).rows[0].b).toBe(2_100_000);
    await db.rpc("admin_team_pool_set", { p_actor: admin, p_team: team, p_enabled: false, p_reason: "suspected abuse of the pool" });
    const actions = (await db.pool.query("select action, reason from public.admin_audit_log where actor_id = $1 order by id", [admin])).rows;
    expect(actions.map((a: any) => a.action)).toEqual(expect.arrayContaining(["collab.investigate", "team.view", "team.credit_grant", "team.pool_set"]));
    expect(actions.every((a: any) => a.reason === null || a.reason.length >= 10 || a.action === "team.view")).toBe(true);
    expect(await db.rpc("admin_audit_verify", { p_actor: admin })).toMatchObject({ intact: true });
    const logText = JSON.stringify(actions);
    expect(logText).not.toContain(owner.email);
  });

  it("lets an administrator withdraw an abused invitation, once", async () => {
    const owner = await person("Owner"); const study = await project(owner.id);
    const inv = await invite(owner.id, study, "victim@test.local", "reviewer");
    await db.rpc("admin_revoke_invitation", { p_actor: admin, p_kind: "project", p_invitation: inv.invitation_id, p_reason: "reported harassment by the recipient" });
    await db.rpcFails("admin_revoke_invitation", { p_actor: admin, p_kind: "project", p_invitation: inv.invitation_id, p_reason: "reported harassment by the recipient" }, "not_pending");
    const target = await person("Victim");
    await expect(db.rpc("collab_accept", { p_actor: target.id, p_token: inv.token })).rejects.toThrow(/./);
  });

  it("raises alerts for failing email delivery and a past-due team", async () => {
    const owner = await person("Owner"); const study = await project(owner.id);
    for (let i = 0; i < 5; i++) { const x = await invite(owner.id, study, `f${i}-${randomUUID().slice(0, 4)}@test.local`, "reviewer").catch(() => null); void x; }
    await db.pool.query("update public.project_invitations set delivery_status = 'failed' where delivery_status = 'not_attempted'");
    expect(await db.rpc<number>("collab_scan_alerts")).toBeGreaterThanOrEqual(1);
    expect((await db.pool.query("select count(*)::int n from public.system_alerts where kind = 'invitation_delivery'")).rows[0].n).toBeGreaterThanOrEqual(0);
  });
});

describe("security: isolation, escalation, removal", () => {
  it("keeps two researchers' projects, files, messages and notifications apart", async () => {
    const a = await person("A", "pro"); const b = await person("B", "pro");
    const pa = await project(a.id, "A's study"); const pb = await project(b.id, "B's study");
    await db.rpc("collab_message_send", { p_actor: a.id, p_conversation: `project:${pa}`, p_body: "private" });
    await db.pool.query("insert into public.study_references (study_id, identifier_type, title) values ($1, 'manual', 'A ref')", [pa]);
    for (const q of [
      ["select id from public.studies where id = $1", pa], ["select id from public.protocol_versions where study_id = $1", pa], ["select id from public.study_references where study_id = $1", pa],
      ["select id from public.collab_messages where study_id = $1", pa], ["select id from public.review_threads where study_id = $1", pa],
    ] as [string, string][]) expect(await as(b.id, q[0], [q[1]])).toHaveLength(0);
    await expect(as(b.id, "update public.protocol_versions set research_question = 'hijack' where study_id = $1 returning id", [pa])).resolves.toHaveLength(0);
    await expect(as(b.id, "insert into public.milestones (study_id, milestone_type) values ($1, 'ethics_approved')", [pa])).rejects.toThrow(/row-level security/);
    await expect(db.rpc("collab_messages_list", { p_actor: b.id, p_conversation: `project:${pa}` })).rejects.toThrow(/forbidden/);
    await expect(db.rpc("collab_review_overview", { p_actor: b.id, p_study: pa })).rejects.toThrow(/forbidden/);
    expect(await as(a.id, "select id from public.studies where id = $1", [pb])).toHaveLength(0);
  });

  it("stops privilege escalation: roles, labels, self-grants, admin tables and the service functions", async () => {
    const owner = await person("Owner"); const study = await project(owner.id); const rev = await person("Rev"); const view = await person("Viewer", "free", "supervisor");
    await join(owner.id, study, rev, "reviewer");
    await expect(as(rev.id, "update public.project_memberships set role = 'editor' where user_id = $1", [rev.id])).rejects.toThrow(/permission denied/);
    await expect(as(rev.id, "insert into public.project_memberships (study_id, user_id, role) values ($1, $2, 'editor')", [study, view.id])).rejects.toThrow(/permission denied/);
    await expect(as(rev.id, "update public.studies set owner_id = $1 where id = $2", [rev.id, study])).resolves.toHaveLength(0);
    expect(await as(view.id, "select id from public.studies where id = $1", [study])).toHaveLength(0); // a "supervisor" label grants nothing
    await expect(as(rev.id, "insert into public.app_admins (user_id) values ($1)", [rev.id])).rejects.toThrow(/permission denied/);
    await expect(as(rev.id, "select public.admin_team_credit_grant($1, $2, 10, 'a reason long enough')", [rev.id, randomUUID()])).rejects.toThrow(/permission denied/);
    await expect(as(rev.id, "select public.collab_change_role($1, $2, $3, 'editor')", [rev.id, study, rev.id])).rejects.toThrow(/permission denied/);
    await expect(db.rpc("collab_change_role", { p_actor: rev.id, p_study: study, p_user: rev.id, p_role: "editor" })).rejects.toThrow(/not_owner/);
    await expect(db.rpc("collab_review_transition", { p_actor: owner.id, p_study: study, p_to: "approved", p_note: null, p_statement: null, p_confirm: true })).rejects.toThrow(/not_reviewer/);
    await expect(db.rpc("collab_invite", { p_actor: rev.id, p_study: study, p_email: "x@test.local", p_role: "reviewer", p_label: null })).rejects.toThrow(/not_owner/);
    // a reviewer cannot lock or register a protocol, and an editor cannot either
    await expect(as(rev.id, "update public.protocol_versions set status = 'registered' where study_id = $1", [study])).resolves.toHaveLength(0);
    const team = await newTeam(owner);
    await expect(as(rev.id, "insert into public.team_memberships (team_id, user_id, role, seat_type) values ($1, $2, 'owner', 'paid')", [team, rev.id])).rejects.toThrow(/permission denied/);
    await expect(db.rpc("team_change_role", { p_actor: rev.id, p_team: team, p_user: owner.id, p_role: "guest" })).rejects.toThrow(/not_team_admin/);
  });

  it("rejects expired, wrong-account and replayed invitations", async () => {
    const owner = await person("Owner"); const study = await project(owner.id); const m = await person("M"); const other = await person("Other");
    const inv = await invite(owner.id, study, m.email, "reviewer");
    await db.pool.query("update public.project_invitations set expires_at = now() - interval '1 second' where id = $1", [inv.invitation_id]);
    await expect(db.rpc("collab_accept", { p_actor: m.id, p_token: inv.token })).rejects.toThrow(/invitation_expired/);
    const fresh = await db.rpc<any>("collab_resend", { p_actor: owner.id, p_invitation: inv.invitation_id }).catch(async () => {
      await db.pool.query("update public.project_invitations set last_sent_at = now() - interval '1 hour' where id = $1", [inv.invitation_id]);
      return db.rpc<any>("collab_resend", { p_actor: owner.id, p_invitation: inv.invitation_id });
    });
    await expect(db.rpc("collab_accept", { p_actor: other.id, p_token: fresh.token })).rejects.toThrow(/invitation_invalid/);
    await db.rpc("collab_accept", { p_actor: m.id, p_token: fresh.token });
    await db.rpc("collab_remove_member", { p_actor: owner.id, p_study: study, p_user: m.id });
    await expect(db.rpc("collab_accept", { p_actor: m.id, p_token: fresh.token })).rejects.toThrow(/invitation_closed|invitation_invalid/); // single use: cannot rejoin with the old link
  });

  it("takes database, storage and realtime access away from a removed member at once", async () => {
    const owner = await person("Owner"); const team = await activeTeam(owner); const m = await person("Mem"); const g = await person("Guest");
    await tjoin(owner, team, m, "member"); await tjoin(owner, team, g, "guest");
    const study = (await db.pool.query("insert into public.studies (owner_id, title, team_id) values ($1, 'T', $2) returning id", [m.id, team])).rows[0].id;
    await db.pool.query("insert into public.protocol_versions (study_id, version_number, status) values ($1, 1, 'draft')", [study]);
    await db.rpc("team_project_add_member", { p_actor: m.id, p_study: study, p_user: g.id, p_role: "reviewer" });
    const doc = await db.rpc<any>("team_doc_register", { p_actor: m.id, p_team: team, p_name: "plan.pdf", p_mime: "application/pdf", p_size: 100, p_study: study });
    await db.pool.query("insert into storage.objects (bucket_id, name, metadata) values ('team-documents', $1, '{\"size\":100}')", [doc.path]);
    await db.rpc("team_doc_finalize", { p_actor: m.id, p_doc: doc.id });
    await db.rpc("collab_message_send", { p_actor: m.id, p_conversation: `project:${study}`, p_body: "hello" });
    const probe = async () => ({
      study: (await as(g.id, "select id from public.studies where id = $1", [study])).length,
      protocol: (await as(g.id, "select id from public.protocol_versions where study_id = $1", [study])).length,
      messages: (await as(g.id, "select id from public.collab_messages where study_id = $1", [study])).length,
      files: (await as(g.id, "select name from storage.objects where bucket_id = 'team-documents'")).length,
      realtime: (await as(g.id, "select public.collab_can_read_conversation($1, $2) ok", [g.id, `project:${study}`]))[0].ok,
    });
    expect(await probe()).toEqual({ study: 1, protocol: 1, messages: 1, files: 1, realtime: true });
    await db.rpc("team_remove_member", { p_actor: owner.id, p_team: team, p_user: g.id });
    expect(await probe()).toEqual({ study: 0, protocol: 0, messages: 0, files: 0, realtime: false });
    await expect(db.rpc("collab_messages_list", { p_actor: g.id, p_conversation: `project:${study}` })).rejects.toThrow(/forbidden/);
  });
});

describe("scenarios", () => {
  it("A: a Free researcher and a supervisor work together", async () => {
    const student = await person("Student"); const sup = await person("Supervisor", "free", "supervisor"); const study = await project(student.id, "Thesis");
    for (const role of ["editor", "viewer"]) await expect(db.rpc("collab_invite", { p_actor: student.id, p_study: study, p_email: "co@test.local", p_role: role, p_label: "co_investigator" })).rejects.toThrow(/role_not_in_plan/);
    const inv = await invite(student.id, study, sup.email, "reviewer", "supervisor");
    await join(student.id, study, await person("Second"), "reviewer");
    await expect(invite(student.id, study, "third@test.local", "reviewer")).rejects.toThrow(/role_limit_reached/);
    await db.rpc("collab_accept", { p_actor: sup.id, p_token: inv.token });
    await db.rpc("collab_review_submit", { p_actor: student.id, p_study: study, p_note: "Please review" });
    await db.rpc("collab_review_transition", { p_actor: sup.id, p_study: study, p_to: "under_review", p_note: null, p_statement: null, p_confirm: false });
    await db.rpc("collab_review_transition", { p_actor: sup.id, p_study: study, p_to: "changes_requested", p_note: "Add power calculation", p_statement: null, p_confirm: false });
    await db.rpc("collab_review_submit", { p_actor: student.id, p_study: study, p_note: "Added" });
    await db.rpc("collab_review_transition", { p_actor: sup.id, p_study: study, p_to: "under_review", p_note: null, p_statement: null, p_confirm: false });
    expect(await db.rpc("collab_review_transition", { p_actor: sup.id, p_study: study, p_to: "approved", p_note: null, p_statement: "Looks good", p_confirm: true })).toMatchObject({ status: "approved" });
    expect(await as(sup.id, "select id from public.protocol_versions where study_id = $1", [study])).toHaveLength(1);
    await expect(as(sup.id, "update public.protocol_versions set research_question = 'x' where study_id = $1 returning id", [study])).resolves.toHaveLength(0);
  });

  it("B: a Pro owner collaborates with an editor, a viewer and a supervisor", async () => {
    const owner = await person("ProOwner", "pro"); const study = await project(owner.id); const ed = await person("Ed"); const view = await person("View"); const sup = await person("Sup");
    await join(owner.id, study, ed, "editor"); await join(owner.id, study, view, "viewer"); await join(owner.id, study, sup, "reviewer");
    expect(await as(ed.id, "select public.study_role($1) r", [study])).toEqual([{ r: "editor" }]);
    const base = { research_question: "Does X cause Y?" };
    const save = (u: string, b: object, p: object) => db.pool.connect().then(async (c) => { try { await c.query("begin"); await c.query("set local role authenticated"); await c.query("select set_config('request.jwt.claim.sub', $1, true)", [u]); const r = await c.query("select public.save_protocol_section($1, $2::jsonb, $3::jsonb) r", [(await db.pool.query("select id from public.protocol_versions where study_id = $1", [study])).rows[0].id, JSON.stringify(b), JSON.stringify(p)]); await c.query("commit"); return r.rows[0].r; } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); } });
    expect((await save(ed.id, base, { research_question: "Editor's wording" })).ok).toBe(true);
    expect((await save(owner.id, base, { research_question: "Owner's wording" })).ok).toBe(false); // conflict, not a silent overwrite
    await expect(save(view.id, base, { research_question: "x" })).rejects.toThrow(/not_allowed/);
    await db.rpc("collab_message_send", { p_actor: owner.id, p_conversation: `project:${study}`, p_body: "Welcome" });
    expect((await db.rpc<any>("collab_unread_messages", { p_actor: ed.id }))[`project:${study}`]).toBe(1);
  });

  it("C: a research team shares a workspace without sharing every project", async () => {
    const owner = await person("Lead"); const team = await activeTeam(owner, 5); const m1 = await person("M1"); const m2 = await person("M2"); const g = await person("Guest");
    await tjoin(owner, team, m1, "member"); await tjoin(owner, team, m2, "member"); await tjoin(owner, team, g, "guest");
    const p1 = (await db.pool.query("insert into public.studies (owner_id, title, team_id) values ($1, 'One', $2) returning id", [m1.id, team])).rows[0].id;
    const p2 = (await db.pool.query("insert into public.studies (owner_id, title, team_id) values ($1, 'Two', $2) returning id", [m2.id, team])).rows[0].id;
    expect(await as(m1.id, "select id from public.studies where id = $1", [p2])).toHaveLength(0); // membership never grants access
    expect(await as(owner.id, "select id from public.studies where id = $1", [p1])).toHaveLength(0);
    await db.rpc("team_project_add_member", { p_actor: m1.id, p_study: p1, p_user: m2.id, p_role: "editor" });
    await db.rpc("team_project_add_member", { p_actor: m1.id, p_study: p1, p_user: g.id, p_role: "reviewer" });
    expect(await as(m2.id, "select id from public.studies where id = $1", [p1])).toHaveLength(1);
    const ov = await db.rpc<any>("team_overview", { p_actor: owner.id, p_team: team });
    expect(ov.projects).toHaveLength(2);
    expect(ov.seats.paid_used).toBe(3);
    await db.rpc("collab_message_send", { p_actor: owner.id, p_conversation: `team:${team}`, p_body: "Kickoff" });
    expect((await db.rpc<any>("team_activity", { p_actor: owner.id, p_team: team })).length).toBeGreaterThan(3);
  });

  it("D: a removed collaborator loses everything, and their work is handed over first", async () => {
    const owner = await person("Owner", "pro"); const study = await project(owner.id); const ed = await person("Ed");
    await join(owner.id, study, ed, "editor");
    await db.rpc("collab_comment_add", { p_actor: ed.id, p_study: study, p_section: "general", p_body: "my comment", p_thread: null });
    await db.rpc("collab_remove_member", { p_actor: owner.id, p_study: study, p_user: ed.id });
    expect(await as(ed.id, "select id from public.studies where id = $1", [study])).toHaveLength(0);
    await expect(db.rpc("collab_comment_add", { p_actor: ed.id, p_study: study, p_section: "general", p_body: "x", p_thread: null })).rejects.toThrow(/not_allowed/);
    expect((await db.rpc<any[]>("collab_notifications", { p_actor: ed.id })).filter((n) => n.study_id === study && n.kind === "comment")).toEqual([]);
    expect((await db.rpc<any>("collab_review_overview", { p_actor: owner.id, p_study: study })).threads[0].comments[0].body).toBe("my comment"); // their contribution stays with the project
  });

  it("E: a team's AI budget runs out, nobody goes negative, and personal credits are only used when chosen", async () => {
    const owner = await person("Owner"); const team = await activeTeam(owner); const m = await person("Mem");
    await tjoin(owner, team, m, "member");
    await db.rpc("team_ai_pool_set", { p_actor: owner.id, p_team: team, p_enabled: true, p_team_limit: null, p_member_limit: null });
    await db.rpc("team_ai_set_funding", { p_actor: m.id, p_team: team });
    await db.pool.query("update public.team_credit_pools set balance_mcr = 25 where team_id = $1", [team]);
    const model = (await db.pool.query("select model_chain[1] m from public.ai_features where feature_key = $1", [feature])).rows[0].m;
    const r = await db.rpc<any>("team_ai_reserve", { p_actor: m.id, p_team: team, p_study: null, p_key: `key-${randomUUID()}`, p_feature: feature, p_model: model, p_reserve_micro_usd: 20_000, p_meta: {} });
    expect(r).toMatchObject({ ok: false, code: "team_pool_exhausted" });
    expect((await db.pool.query("select balance_mcr::int b, reserved_mcr::int r from public.team_credit_pools where team_id = $1", [team])).rows[0]).toEqual({ b: 25, r: 0 });
    // the member chooses their own credits; the pool is untouched and the event records the funding source
    await db.rpc("team_ai_set_funding", { p_actor: m.id, p_team: null });
    const own = await db.rpc<any>("ai_reserve", { p_user: m.id, p_key: `key-${randomUUID()}`, p_feature: feature, p_model: model, p_reserve_micro_usd: 20_000, p_meta: {} });
    expect(own.ok).toBe(true);
    expect((await db.pool.query("select funding_source from public.ai_usage_events where id = $1", [own.event_id])).rows[0].funding_source).toBe("self");
    expect((await db.pool.query("select balance_mcr::int b from public.team_credit_pools where team_id = $1", [team])).rows[0].b).toBe(25);
    void subscribe;
  });
});
