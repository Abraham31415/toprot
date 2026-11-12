/* eslint-disable @typescript-eslint/no-explicit-any -- rows from the scratch database are untyped */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminDb } from "@/lib/admin/__tests__/db-harness";

// Stage 1: memberships, invitations, roles and RLS, run against a scratch Postgres with every migration applied.
let db: AdminDb;

async function person(name: string, plan: "free" | "pro" = "free", label: "student" | "supervisor" = "student") {
  const email = `${name.toLowerCase()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
  const id = await db.user(email);
  await db.pool.query("insert into public.profiles (id, role, full_name) values ($1, $2, $3) on conflict (id) do update set role = excluded.role, full_name = excluded.full_name", [id, label, name]);
  if (plan === "pro") {
    await db.pool.query(
      `insert into public.ai_subscriptions (user_id, plan, status, current_period_start, current_period_end, provider, provider_subscription_id)
       values ($1, 'pro', 'active', now() - interval '1 day', now() + interval '20 days', 'dodo', $2)`, [id, `sub_${id}`]);
  }
  return { id, email };
}
async function project(owner: string, title = "Study") {
  return (await db.pool.query("insert into public.studies (owner_id, title) values ($1, $2) returning id", [owner, title])).rows[0].id as string;
}
const invite = (actor: string, study: string, email: string, role: string, label: string | null = null) =>
  db.rpc<{ invitation_id: string; token: string }>("collab_invite", { p_actor: actor, p_study: study, p_email: email, p_role: role, p_label: label });
async function join(owner: string, study: string, member: { id: string; email: string }, role: string) {
  const inv = await invite(owner, study, member.email, role);
  return db.rpc("collab_accept", { p_actor: member.id, p_token: inv.token });
}
const as = <T = any>(user: string, sql: string, params: unknown[] = []) => db.asRole<T>("authenticated", user, sql, params);

beforeAll(async () => { db = await AdminDb.create(); }, 120_000);
afterAll(async () => { await db.close(); });

describe("invitation tokens", () => {
  it("stores only a hash, never the token", async () => {
    const o = await person("Owner"); const s = await project(o.id); const m = await person("Member");
    const inv = await invite(o.id, s, m.email, "reviewer");
    const row = (await db.pool.query("select * from public.project_invitations where id = $1", [inv.invitation_id])).rows[0];
    expect(inv.token).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(inv.token);
    expect(row.token_hash).toBe((await db.pool.query("select public.collab_hash_token($1) h", [inv.token])).rows[0].h);
  });

  it("accepts only for the invited email, once, and reveals nothing on a mismatch", async () => {
    const o = await person("Owner"); const s = await project(o.id); const m = await person("Member"); const other = await person("Other");
    const inv = await invite(o.id, s, m.email, "reviewer");
    await db.rpcFails("collab_accept", { p_actor: other.id, p_token: inv.token }, "invitation_invalid");
    await db.rpcFails("collab_accept", { p_actor: m.id, p_token: "0".repeat(64) }, "invitation_invalid");
    const preview = await db.rpc("collab_invitation_preview", { p_actor: other.id, p_token: inv.token });
    expect(preview).toEqual({ state: "invalid" });
    const ok = await db.rpc("collab_accept", { p_actor: m.id, p_token: inv.token });
    expect(ok.role).toBe("reviewer");
    await db.rpcFails("collab_accept", { p_actor: other.id, p_token: inv.token }, "invitation_invalid");
    expect((await db.pool.query("select count(*)::int n from public.project_memberships where study_id = $1", [s])).rows[0].n).toBe(1);
  });

  it("rejects expired, revoked and declined invitations; resend rotates the token", async () => {
    const o = await person("Owner"); const s = await project(o.id);
    const a = await person("A"), b = await person("B"), c = await person("C");
    const ia = await invite(o.id, s, a.email, "reviewer");
    await db.pool.query("update public.project_invitations set expires_at = now() - interval '1 minute' where id = $1", [ia.invitation_id]);
    await db.rpcFails("collab_accept", { p_actor: a.id, p_token: ia.token }, "invitation_expired");
    const ib = await invite(o.id, s, b.email, "reviewer");
    await db.rpc("collab_revoke", { p_actor: o.id, p_invitation: ib.invitation_id });
    await db.rpcFails("collab_accept", { p_actor: b.id, p_token: ib.token }, "invitation_closed");
    const ic = await invite(o.id, s, c.email, "reviewer");
    await db.rpc("collab_decline", { p_actor: c.id, p_invitation: ic.invitation_id });
    await db.rpcFails("collab_accept", { p_actor: c.id, p_token: ic.token }, "invitation_closed");

    const d = await person("D"); const id_ = await invite(o.id, s, d.email, "reviewer");
    await db.pool.query("update public.project_invitations set last_sent_at = now() - interval '1 hour' where id = $1", [id_.invitation_id]);
    const again = await db.rpc<{ token: string }>("collab_resend", { p_actor: o.id, p_invitation: id_.invitation_id });
    expect(again.token).not.toBe(id_.token);
    await db.rpcFails("collab_accept", { p_actor: d.id, p_token: id_.token }, "invitation_invalid");
    await db.rpc("collab_accept", { p_actor: d.id, p_token: again.token });
  });

  it("limits resend frequency and only the owner can invite, resend or revoke", async () => {
    const o = await person("Owner"); const s = await project(o.id); const m = await person("M"); const x = await person("X");
    const inv = await invite(o.id, s, m.email, "reviewer");
    await db.rpcFails("collab_resend", { p_actor: o.id, p_invitation: inv.invitation_id }, "resend_too_soon");
    await db.rpcFails("collab_resend", { p_actor: x.id, p_invitation: inv.invitation_id }, "not_owner");
    await db.rpcFails("collab_revoke", { p_actor: x.id, p_invitation: inv.invitation_id }, "not_owner");
    await db.rpcFails("collab_invite", { p_actor: x.id, p_study: s, p_email: "z@test.local", p_role: "reviewer", p_label: null }, "not_owner");
    await db.rpcFails("collab_invite", { p_actor: o.id, p_study: s, p_email: m.email, p_role: "reviewer", p_label: null }, "already_invited");
    await db.rpcFails("collab_invite", { p_actor: o.id, p_study: s, p_email: o.email, p_role: "reviewer", p_label: null }, "cannot_invite_self");
    await db.rpcFails("collab_invite", { p_actor: o.id, p_study: s, p_email: "not-an-email", p_role: "reviewer", p_label: null }, "invalid_email");
  });

  it("rate limits invitations per owner and per recipient", async () => {
    const o = await person("Owner", "pro"); const s = await project(o.id);
    await db.pool.query("update public.billing_settings set value_num = 2 where key = 'collab_invites_per_email_per_day'");
    const victim = "victim@test.local";
    const s2 = await project((await person("O2", "pro")).id);
    const o2 = (await db.pool.query("select owner_id from public.studies where id = $1", [s2])).rows[0].owner_id;
    await invite(o.id, s, victim, "viewer");
    await invite(o2, s2, victim, "viewer");
    const o3 = await person("O3", "pro"); const s3 = await project(o3.id);
    await db.rpcFails("collab_invite", { p_actor: o3.id, p_study: s3, p_email: victim, p_role: "viewer", p_label: null }, "rate_limited_recipient");
    await db.pool.query("update public.billing_settings set value_num = 3 where key = 'collab_invites_per_email_per_day'");
    await db.pool.query("update public.billing_settings set value_num = 1 where key = 'collab_invites_per_owner_per_day'");
    await db.rpcFails("collab_invite", { p_actor: o.id, p_study: s, p_email: "second@test.local", p_role: "viewer", p_label: null }, "rate_limited_owner");
    await db.pool.query("update public.billing_settings set value_num = 20 where key = 'collab_invites_per_owner_per_day'");
  });
});

describe("plan limits cannot be bypassed", () => {
  it("lets Free invite reviewers only, at most two per project, whatever the label says", async () => {
    const o = await person("FreeOwner"); const s = await project(o.id);
    for (const role of ["editor", "viewer"]) await db.rpcFails("collab_invite", { p_actor: o.id, p_study: s, p_email: "a@test.local", p_role: role, p_label: null }, "role_not_in_plan");
    // a "co-investigator" label does not change the role limit
    await db.rpcFails("collab_invite", { p_actor: o.id, p_study: s, p_email: "a@test.local", p_role: "editor", p_label: "co_investigator" }, "role_not_in_plan");
    await invite(o.id, s, "r1@test.local", "reviewer", "supervisor");
    await invite(o.id, s, "r2@test.local", "reviewer", "co_investigator");
    await db.rpcFails("collab_invite", { p_actor: o.id, p_study: s, p_email: "r3@test.local", p_role: "reviewer", p_label: "supervisor" }, "role_limit_reached");
  });

  it("enforces limits in the database for direct inserts and role changes too", async () => {
    const o = await person("FreeOwner"); const s = await project(o.id); const a = await person("A"); const b = await person("B"); const c = await person("C");
    await join(o.id, s, a, "reviewer"); await join(o.id, s, b, "reviewer");
    const ins = (u: string, r: string) => db.pool.query("insert into public.project_memberships (study_id, user_id, role) values ($1,$2,$3)", [s, u, r]);
    await expect(ins(c.id, "reviewer")).rejects.toThrow(/role_limit_reached/);
    await expect(ins(c.id, "editor")).rejects.toThrow(/role_not_in_plan/);
    await expect(ins(o.id, "reviewer")).rejects.toThrow(/owner_cannot_be_member/);
    await expect(db.rpc("collab_change_role", { p_actor: o.id, p_study: s, p_user: a.id, p_role: "editor" })).rejects.toThrow(/role_not_in_plan/);
  });

  it("lets Pro invite editors, reviewers and viewers within configured limits", async () => {
    const o = await person("ProOwner", "pro"); const s = await project(o.id);
    await invite(o.id, s, "e@test.local", "editor", "co_investigator");
    await invite(o.id, s, "v@test.local", "viewer");
    await invite(o.id, s, "r@test.local", "reviewer", "supervisor");
    await db.pool.query("update public.collab_role_limits set max_per_project = 1 where plan_key = 'pro' and role = 'editor'");
    await db.rpcFails("collab_invite", { p_actor: o.id, p_study: s, p_email: "e2@test.local", p_role: "editor", p_label: null }, "role_limit_reached");
    await db.pool.query("update public.collab_role_limits set max_per_project = 5 where plan_key = 'pro' and role = 'editor'");
  });

  it("makes editor and viewer memberships dormant when the owner drops to Free", async () => {
    const o = await person("ProOwner", "pro"); const s = await project(o.id); const e = await person("E"); const r = await person("R");
    await join(o.id, s, e, "editor"); await join(o.id, s, r, "reviewer");
    expect((await as(e.id, "select public.study_role($1) r", [s]))[0].r).toBe("editor");
    await db.pool.query("update public.ai_subscriptions set status = 'canceled' where user_id = $1", [o.id]);
    expect((await as(e.id, "select public.study_role($1) r", [s]))[0].r).toBeNull();
    expect((await as(r.id, "select public.study_role($1) r", [s]))[0].r).toBe("reviewer");
    expect(await as(e.id, "select id from public.studies where id = $1", [s])).toHaveLength(0);
  });

  it("a profile label of supervisor or student grants nothing", async () => {
    const o = await person("Owner"); const s = await project(o.id);
    const sup = await person("Sup", "free", "supervisor");
    expect(await as(sup.id, "select id from public.studies where id = $1", [s])).toHaveLength(0);
    expect((await as(sup.id, "select public.study_role($1) r", [s]))[0].r).toBeNull();
  });
});

describe("row level security by role", () => {
  it("owner, editor, reviewer, viewer and stranger see and change the right things", async () => {
    const o = await person("Owner", "pro"); const s = await project(o.id, "Shared study");
    const e = await person("Ed"), r = await person("Rev"), v = await person("View"), x = await person("Stranger");
    await join(o.id, s, e, "editor"); await join(o.id, s, r, "reviewer"); await join(o.id, s, v, "viewer");
    await db.pool.query("insert into public.protocol_versions (study_id, version_number, status, study_title) values ($1, 1, 'draft', 'T')", [s]);
    await db.pool.query("insert into public.milestones (study_id, milestone_type) values ($1, 'protocol_written')", [s]);

    for (const u of [o.id, e.id, r.id, v.id]) {
      expect(await as(u, "select id from public.studies where id = $1", [s])).toHaveLength(1);
      expect(await as(u, "select id from public.protocol_versions where study_id = $1", [s])).toHaveLength(1);
    }
    expect(await as(x.id, "select id from public.studies where id = $1", [s])).toHaveLength(0);
    expect(await as(x.id, "select id from public.protocol_versions where study_id = $1", [s])).toHaveLength(0);

    const upd = (u: string) => as(u, "update public.protocol_versions set research_question = 'q' where study_id = $1 returning id", [s]);
    expect(await upd(o.id)).toHaveLength(1);
    expect(await upd(e.id)).toHaveLength(1);
    for (const u of [v.id, x.id]) expect(await upd(u)).toHaveLength(0);

    // editors cannot lock, register or approve
    await expect(as(e.id, "update public.protocol_versions set status = 'registered' where study_id = $1", [s])).rejects.toThrow(/editor_cannot_lock_protocol/);
    await expect(as(e.id, "update public.protocol_versions set approval_requested_at = now() where study_id = $1", [s])).rejects.toThrow(/editor_cannot_lock_protocol/);
    await expect(as(e.id, "delete from public.protocol_versions where study_id = $1", [s])).rejects.toThrow(/only_owner_can_delete_versions/);

    // only the owner can change or delete the study itself
    for (const u of [e.id, r.id, v.id]) {
      expect(await as(u, "update public.studies set title = 'hijack' where id = $1 returning id", [s])).toHaveLength(0);
      expect(await as(u, "delete from public.studies where id = $1 returning id", [s])).toHaveLength(0);
    }
    // writes to milestones: editor yes, viewer and reviewer no
    expect(await as(e.id, "update public.milestones set status = 'complete' where study_id = $1 returning id", [s])).toHaveLength(1);
    expect(await as(r.id, "update public.milestones set status = 'pending' where study_id = $1 returning id", [s])).toHaveLength(0);
    await expect(as(v.id, "insert into public.milestones (study_id, milestone_type) values ($1, 'ethics_approved')", [s])).rejects.toThrow(/row-level security/);
  });

  it("memberships and invitations: members read, nobody writes through the API, tokens never leave", async () => {
    const o = await person("Owner"); const s = await project(o.id); const m = await person("M"); const x = await person("X");
    await join(o.id, s, m, "reviewer");
    const inv = await invite(o.id, s, "later@test.local", "reviewer");
    expect(await as(m.id, "select user_id from public.project_memberships where study_id = $1", [s])).toHaveLength(1);
    expect(await as(x.id, "select user_id from public.project_memberships where study_id = $1", [s])).toHaveLength(0);
    await expect(as(m.id, "update public.project_memberships set role = 'editor' where study_id = $1", [s])).rejects.toThrow(/permission denied/);
    await expect(as(x.id, "insert into public.project_memberships (study_id, user_id, role) values ($1, $2, 'reviewer')", [s, x.id])).rejects.toThrow(/permission denied/);
    await expect(as(o.id, "select token_hash from public.project_invitations where study_id = $1", [s])).rejects.toThrow(/permission denied/);
    expect(await as(o.id, "select id from public.project_invitations where study_id = $1", [s])).toHaveLength(2); // the accepted one and the pending one
    expect(await as(m.id, "select id from public.project_invitations where study_id = $1", [s])).toHaveLength(0);
    await expect(as(x.id, "update public.project_invitations set status = 'accepted' where id = $1", [inv.invitation_id])).rejects.toThrow(/permission denied/);
    // the service functions are not callable from a browser session
    await expect(as(x.id, "select public.collab_accept($1, 'abc')", [x.id])).rejects.toThrow(/permission denied/);
    await expect(as(x.id, "select public.collab_invite($1, $2, 'a@b.co', 'reviewer', null)", [x.id, s])).rejects.toThrow(/permission denied/);
  });

  it("cannot probe another account's access through study_role", async () => {
    const o = await person("Owner"); const s = await project(o.id); const x = await person("X");
    expect((await as(x.id, "select public.study_role($1, $2) r", [s, o.id]))[0].r).toBeNull();
  });

  it("a removed member loses table access immediately, and cannot rejoin with the old token", async () => {
    const o = await person("Owner"); const s = await project(o.id); const m = await person("M");
    const inv = await invite(o.id, s, m.email, "reviewer");
    await db.rpc("collab_accept", { p_actor: m.id, p_token: inv.token });
    expect(await as(m.id, "select id from public.studies where id = $1", [s])).toHaveLength(1);
    await db.rpc("collab_remove_member", { p_actor: o.id, p_study: s, p_user: m.id });
    expect(await as(m.id, "select id from public.studies where id = $1", [s])).toHaveLength(0);
    await db.rpcFails("collab_accept", { p_actor: m.id, p_token: inv.token }, "");
    expect(await db.rpc("collab_shared_with", { p_actor: m.id })).toEqual([]);
  });

  it("only the owner can remove others; a member can leave on their own", async () => {
    const o = await person("Owner"); const s = await project(o.id); const a = await person("A"); const b = await person("B");
    await join(o.id, s, a, "reviewer"); await join(o.id, s, b, "reviewer");
    await db.rpcFails("collab_remove_member", { p_actor: a.id, p_study: s, p_user: b.id }, "not_owner");
    await db.rpc("collab_remove_member", { p_actor: a.id, p_study: s, p_user: a.id });
    await db.rpcFails("collab_change_role", { p_actor: a.id, p_study: s, p_user: b.id, p_role: "viewer" }, "not_owner");
  });

  it("people see each other's name only when they share a project", async () => {
    const o = await person("Owner"); const s = await project(o.id); const m = await person("Mem"); const x = await person("Strange");
    await join(o.id, s, m, "reviewer");
    expect(await as(m.id, "select full_name from public.profiles where id = $1", [o.id])).toHaveLength(1);
    expect(await as(o.id, "select full_name from public.profiles where id = $1", [m.id])).toHaveLength(1);
    expect(await as(x.id, "select full_name from public.profiles where id = $1", [o.id])).toHaveLength(0);
  });

  it("legacy supervisor tables are read-only history and cannot be used to grant access", async () => {
    const o = await person("Owner"); const s = await project(o.id); const x = await person("X");
    await expect(as(x.id, "insert into public.study_supervisors (study_id, supervisor_id, workspace_id) values ($1, $2, gen_random_uuid())", [s, x.id])).rejects.toThrow(/permission denied/);
    await expect(as(o.id, "insert into public.supervisor_invitations (study_id, invited_email, invited_by, token) values ($1, 'a@b.co', $2, 't')", [s, o.id])).rejects.toThrow(/permission denied/);
  });
});

describe("project details for the dialog", () => {
  it("returns members and (for the owner only) pending invitations with limits", async () => {
    const o = await person("Owner"); const s = await project(o.id); const m = await person("M");
    await join(o.id, s, m, "reviewer"); await invite(o.id, s, "pend@test.local", "reviewer");
    const ownerView = await db.rpc("collab_project_people", { p_actor: o.id, p_study: s });
    expect(ownerView.your_role).toBe("owner");
    expect(ownerView.members).toHaveLength(1);
    expect(ownerView.invitations).toHaveLength(1);
    expect(ownerView.limits.reviewer).toEqual({ max: 2, used: 2 });
    const memberView = await db.rpc("collab_project_people", { p_actor: m.id, p_study: s });
    expect(memberView.invitations).toEqual([]);
    await db.rpcFails("collab_project_people", { p_actor: (await person("S")).id, p_study: s }, "forbidden");
  });

  it("lists the invitations waiting for an email address and shared projects", async () => {
    const o = await person("Owner"); const s = await project(o.id, "Waiting"); const m = await person("M");
    await invite(o.id, s, m.email, "reviewer", "supervisor");
    const mine = await db.rpc("collab_my_invitations", { p_actor: m.id });
    expect(mine).toHaveLength(1);
    expect(mine[0].study_title).toBe("Waiting");
    await db.rpc("collab_accept_by_id", { p_actor: m.id, p_invitation: mine[0].invitation_id });
    expect(await db.rpc("collab_my_invitations", { p_actor: m.id })).toEqual([]);
    const shared = await db.rpc("collab_shared_with", { p_actor: m.id });
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ title: "Waiting", role: "reviewer", owner_name: "Owner" });
  });
});
