/* eslint-disable @typescript-eslint/no-explicit-any -- rows from the scratch database are untyped */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminDb } from "@/lib/admin/__tests__/db-harness";
import { makeHelpers, type Person } from "./helpers";

// Stage 3: teams, seats, team projects, shared references and documents.
let db: AdminDb;
const { person, project, join, as, invite } = makeHelpers(() => db);

beforeAll(async () => {
  db = await AdminDb.create();
  // Give the unsubscribed team room to test seats; individual tests tighten it again where they need to.
  await db.pool.query("update public.team_limits set value = 6 where plan_key = 'unsubscribed' and limit_key = 'max_paid_seats'");
  await db.pool.query("update public.team_limits set value = 3 where plan_key = 'unsubscribed' and limit_key = 'max_guests'");
  // Supabase grants these on storage.objects; the scratch database does not.
  await db.pool.query("grant select, insert, update, delete on storage.objects to authenticated, service_role");
}, 120_000);
afterAll(async () => { await db.close(); });

const newTeam = async (owner: Person, name = "Lab") => db.rpc<string>("team_create", { p_actor: owner.id, p_name: name });
const tinvite = (actor: string, team: string, email: string, role: string) => db.rpc<{ invitation_id: string; token: string }>("team_invite", { p_actor: actor, p_team: team, p_email: email, p_role: role });
async function tjoin(owner: Person, team: string, who: Person, role: string) {
  const inv = await tinvite(owner.id, team, who.email, role);
  return db.rpc("collab_accept", { p_actor: who.id, p_token: inv.token });
}
const teamProject = async (owner: Person, team: string, title = "Team study") => {
  const id = (await db.pool.query("insert into public.studies (owner_id, title, team_id) values ($1, $2, $3) returning id", [owner.id, title, team])).rows[0].id as string;
  await db.pool.query("insert into public.protocol_versions (study_id, version_number, status, study_title) values ($1, 1, 'draft', $2)", [id, title]);
  return id;
};

describe("teams and invitations", () => {
  it("creates a team with the creator as owner on a paid seat, within a per-account limit", async () => {
    const o = await person("Owner");
    const t = await newTeam(o);
    const m = (await db.pool.query("select role, seat_type from public.team_memberships where team_id = $1", [t])).rows;
    expect(m).toEqual([{ role: "owner", seat_type: "paid" }]);
    await newTeam(o, "Two"); await newTeam(o, "Three");
    await expect(newTeam(o, "Four")).rejects.toThrow(/too_many_teams/);
    await expect(newTeam(await person("X"), "x")).rejects.toThrow(/invalid_name/);
  });

  it("shares team invitations through the same hashed-token, email-matched accept path", async () => {
    const o = await person("Owner"); const t = await newTeam(o); const m = await person("Mem"); const other = await person("Other");
    const inv = await tinvite(o.id, t, m.email, "member");
    const row = (await db.pool.query("select * from public.team_invitations where id = $1", [inv.invitation_id])).rows[0];
    expect(JSON.stringify(row)).not.toContain(inv.token);
    expect(await db.rpc("collab_invitation_preview", { p_actor: other.id, p_token: inv.token })).toEqual({ state: "invalid" });
    const prev = await db.rpc("collab_invitation_preview", { p_actor: m.id, p_token: inv.token });
    expect(prev).toMatchObject({ kind: "team", state: "pending", role: "member" });
    await expect(db.rpc("collab_accept", { p_actor: other.id, p_token: inv.token })).rejects.toThrow(/invitation_invalid/);
    expect(await db.rpc("collab_accept", { p_actor: m.id, p_token: inv.token })).toMatchObject({ kind: "team", role: "member" });
    expect((await db.rpc("team_list", { p_actor: m.id }))[0]).toMatchObject({ id: t, role: "member", seat_type: "paid" });
    const mine = await db.rpc("collab_my_invitations", { p_actor: (await person("Later")).id });
    expect(mine).toEqual([]);
  });

  it("lists team invitations next to project ones and accepts them by id", async () => {
    const o = await person("Owner"); const t = await newTeam(o); const m = await person("Mem");
    await tinvite(o.id, t, m.email, "guest");
    const mine = await db.rpc("collab_my_invitations", { p_actor: m.id });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ kind: "team", role: "guest" });
    await db.rpc("collab_accept_by_id", { p_actor: m.id, p_invitation: mine[0].invitation_id });
    expect((await db.pool.query("select seat_type from public.team_memberships where user_id = $1", [m.id])).rows[0].seat_type).toBe("guest");
    await expect(db.rpc("collab_accept_by_id", { p_actor: m.id, p_invitation: mine[0].invitation_id })).resolves.toMatchObject({ already: true });
  });

  it("separates paid seats from guest seats and enforces both limits", async () => {
    await db.pool.query("update public.team_limits set value = 2 where plan_key = 'unsubscribed' and limit_key = 'max_paid_seats'");
    await db.pool.query("update public.team_limits set value = 1 where plan_key = 'unsubscribed' and limit_key = 'max_guests'");
    try {
      const o = await person("Owner"); const t = await newTeam(o);
      await tinvite(o.id, t, "m1@test.local", "member");
      await expect(tinvite(o.id, t, "m2@test.local", "member")).rejects.toThrow(/no_paid_seat/);
      await expect(tinvite(o.id, t, "m3@test.local", "administrator")).rejects.toThrow(/no_paid_seat/);
      await tinvite(o.id, t, "g1@test.local", "guest");
      await expect(tinvite(o.id, t, "g2@test.local", "guest")).rejects.toThrow(/no_guest_seat/);
      // the database refuses direct inserts too
      const x = await person("X");
      await expect(db.pool.query("insert into public.team_memberships (team_id, user_id, role, seat_type) values ($1, $2, 'member', 'paid') ", [t, x.id])).resolves.toBeTruthy();
      const y = await person("Y");
      await expect(db.pool.query("insert into public.team_memberships (team_id, user_id, role, seat_type) values ($1, $2, 'member', 'paid') ", [t, y.id])).rejects.toThrow(/no_paid_seat/);
      const t2 = await newTeam(await person("Owner2"));
      await expect(db.pool.query("insert into public.team_memberships (team_id, user_id, role, seat_type) values ($1, $2, 'guest', 'paid') ", [t2, y.id])).rejects.toThrow(/check/);
    } finally {
      await db.pool.query("update public.team_limits set value = 6 where plan_key = 'unsubscribed' and limit_key = 'max_paid_seats'");
      await db.pool.query("update public.team_limits set value = 3 where plan_key = 'unsubscribed' and limit_key = 'max_guests'");
    }
  });

  it("lets only owners and administrators invite, and only the owner appoint administrators", async () => {
    const o = await person("Owner"); const t = await newTeam(o); const a = await person("Admin"); const m = await person("Mem");
    await tjoin(o, t, a, "administrator"); await tjoin(o, t, m, "member");
    await expect(tinvite(m.id, t, "z@test.local", "member")).rejects.toThrow(/not_team_admin/);
    await expect(tinvite(a.id, t, "z@test.local", "administrator")).rejects.toThrow(/not_team_admin/);
    await tinvite(a.id, t, "z@test.local", "member");
    await expect(db.rpc("team_change_role", { p_actor: a.id, p_team: t, p_user: m.id, p_role: "administrator" })).rejects.toThrow(/not_team_admin/);
    await db.rpc("team_change_role", { p_actor: o.id, p_team: t, p_user: m.id, p_role: "guest" });
    expect((await db.pool.query("select seat_type from public.team_memberships where user_id = $1", [m.id])).rows[0].seat_type).toBe("guest");
    await expect(db.rpc("team_change_role", { p_actor: o.id, p_team: t, p_user: o.id, p_role: "member" })).rejects.toThrow(/invalid_role/);
  });

  it("hides a team from non-members and blocks direct writes", async () => {
    const o = await person("Owner"); const t = await newTeam(o); const x = await person("X"); const g = await person("G");
    await tjoin(o, t, g, "guest");
    expect(await as(x.id, "select id from public.teams where id = $1", [t])).toHaveLength(0);
    expect(await as(o.id, "select id from public.teams where id = $1", [t])).toHaveLength(1);
    expect(await as(g.id, "select id from public.teams where id = $1", [t])).toHaveLength(1);
    expect(await as(g.id, "select user_id from public.team_memberships where team_id = $1", [t])).toHaveLength(1); // a guest sees only themselves
    expect(await as(o.id, "select user_id from public.team_memberships where team_id = $1", [t])).toHaveLength(2);
    await expect(as(x.id, "insert into public.team_memberships (team_id, user_id, role, seat_type) values ($1, $2, 'member', 'paid')", [t, x.id])).rejects.toThrow(/permission denied/);
    await expect(as(o.id, "update public.team_memberships set role = 'owner' where team_id = $1", [t])).rejects.toThrow(/permission denied/);
    await expect(as(x.id, "select public.team_create($1, 'Hack')", [x.id])).rejects.toThrow(/permission denied/);
    await expect(as(o.id, "select token_hash from public.team_invitations")).rejects.toThrow(/permission denied/);
  });
});

describe("team projects: membership never grants access", () => {
  it("lets owners create team projects, others only with a paid seat, and never move a project into a team", async () => {
    const o = await person("Owner"); const t = await newTeam(o); const m = await person("Mem"); const g = await person("Guest"); const x = await person("X");
    await tjoin(o, t, m, "member"); await tjoin(o, t, g, "guest");
    const asInsert = (u: Person, team: string) => as(u.id, "insert into public.studies (owner_id, title, team_id) values ($1, 'T', $2) returning id", [u.id, team]);
    expect(await asInsert(m, t)).toHaveLength(1);
    await expect(asInsert(g, t)).rejects.toThrow(/not_team_member/);
    await expect(asInsert(x, t)).rejects.toThrow(/not_team_member/);
    const personal = await project(x.id);
    await expect(as(x.id, "update public.studies set team_id = $2 where id = $1", [personal, t])).rejects.toThrow(/team_id_immutable/);
    const mine = await project(m.id);
    await expect(as(m.id, "update public.studies set team_id = $2 where id = $1", [mine, t])).rejects.toThrow(/team_id_immutable/);
  });

  it("applies the team project limit but not the personal project limit", async () => {
    const o = await person("Owner"); const t = await newTeam(o);
    for (let i = 0; i < 3; i++) await teamProject(o, t, `P${i}`);
    await expect(teamProject(o, t, "P4")).rejects.toThrow(/team_project_limit/);
    // the owner's personal limit (3 on Free) is not consumed by team projects
    for (let i = 0; i < 3; i++) await project(o.id, `Mine${i}`);
    await expect(project(o.id, "Mine4")).rejects.toThrow(/plan_project_limit/);
  });

  it("gives team owners, administrators and members NO access to a project's content", async () => {
    const o = await person("Owner"); const t = await newTeam(o); const a = await person("Admin"); const m = await person("Mem"); const g = await person("Guest");
    await tjoin(o, t, a, "administrator"); await tjoin(o, t, m, "member"); await tjoin(o, t, g, "guest");
    const p = await teamProject(m, t, "Secret protocol");
    for (const u of [o, a, g]) {
      expect(await as(u.id, "select id from public.studies where id = $1", [p])).toHaveLength(0);
      expect(await as(u.id, "select id from public.protocol_versions where study_id = $1", [p])).toHaveLength(0);
    }
    expect(await as(m.id, "select id from public.studies where id = $1", [p])).toHaveLength(1);
    // but they can see that it exists
    const ov = await db.rpc("team_overview", { p_actor: a.id, p_team: t });
    expect(ov.projects.map((x: any) => [x.title, x.your_role])).toEqual([["Secret protocol", null]]);
    expect(JSON.stringify(ov)).not.toContain("research_question");
    // a guest sees neither the project nor the other members' list
    const gv = await db.rpc("team_overview", { p_actor: g.id, p_team: t });
    expect(gv.projects).toEqual([]);
    expect(gv.members.map((x: any) => x.role).sort()).toEqual(["administrator", "guest", "owner"]);
  });

  it("adds team members to a project explicitly, guests as reviewers only", async () => {
    const o = await person("Owner"); const t = await newTeam(o); const m = await person("Mem"); const e = await person("Ed"); const g = await person("Guest"); const x = await person("X");
    await db.pool.query("update public.team_limits set value = 6 where plan_key = 'unsubscribed' and limit_key = 'max_paid_seats'");
    await tjoin(o, t, m, "member"); await tjoin(o, t, e, "member"); await tjoin(o, t, g, "guest");
    await db.pool.query("insert into public.ai_subscriptions (user_id, plan, status, current_period_start, current_period_end, provider, provider_subscription_id) values ($1, 'pro', 'active', now() - interval '1 day', now() + interval '20 days', 'dodo', 'sub_t1')", [m.id]);
    const p = await teamProject(m, t);
    await db.rpc("team_project_add_member", { p_actor: m.id, p_study: p, p_user: e.id, p_role: "editor" });
    await db.rpc("team_project_add_member", { p_actor: m.id, p_study: p, p_user: g.id, p_role: "reviewer" });
    await expect(db.rpc("team_project_add_member", { p_actor: m.id, p_study: p, p_user: g.id, p_role: "editor" })).rejects.toThrow(/guest_reviewer_only/);
    await expect(db.rpc("team_project_add_member", { p_actor: m.id, p_study: p, p_user: x.id, p_role: "viewer" })).rejects.toThrow(/not_team_member/);
    await expect(db.rpc("team_project_add_member", { p_actor: e.id, p_study: p, p_user: g.id, p_role: "viewer" })).rejects.toThrow(/not_owner/);
    expect(await as(e.id, "select id from public.protocol_versions where study_id = $1", [p])).toHaveLength(1);
    expect(await as(g.id, "select id from public.protocol_versions where study_id = $1", [p])).toHaveLength(1);
    // outside people may only be invited as reviewers; editors and viewers need a paid seat
    await expect(invite(m.id, p, "outsider@test.local", "editor")).rejects.toThrow(/team_seat_required/);
    await expect(invite(m.id, p, "outsider@test.local", "viewer")).rejects.toThrow(/team_seat_required/);
    await invite(m.id, p, "outsider@test.local", "reviewer");
    await db.pool.query("insert into public.project_memberships (study_id, user_id, role) select $1, $2, 'viewer'", [p, g.id]).then(
      () => { throw new Error("guest viewer should be refused"); }, (err) => expect(String(err)).toMatch(/team_seat_required/));
  });

  it("removes a departing member's project access, refuses while they own projects, and supports transfer", async () => {
    const o = await person("Owner"); const t = await newTeam(o); const m = await person("Mem"); const n = await person("New");
    await tjoin(o, t, m, "member"); await tjoin(o, t, n, "member");
    const p = await teamProject(m, t, "Mine"); const q = await teamProject(o, t, "Owners");
    await db.pool.query("insert into public.ai_subscriptions (user_id, plan, status, current_period_start, current_period_end, provider, provider_subscription_id) values ($1, 'pro', 'active', now() - interval '1 day', now() + interval '20 days', 'dodo', 'sub_t2')", [o.id]);
    await db.rpc("team_project_add_member", { p_actor: o.id, p_study: q, p_user: m.id, p_role: "editor" });
    expect(await as(m.id, "select id from public.protocol_versions where study_id = $1", [q])).toHaveLength(1);
    await expect(db.rpc("team_remove_member", { p_actor: o.id, p_team: t, p_user: m.id })).rejects.toThrow(/owns_team_projects/);
    await db.rpc("team_project_transfer", { p_actor: o.id, p_study: p, p_new_owner: n.id });
    expect(await as(m.id, "select id from public.studies where id = $1", [p])).toHaveLength(0);
    expect(await as(n.id, "select id from public.studies where id = $1", [p])).toHaveLength(1);
    await db.rpc("team_remove_member", { p_actor: o.id, p_team: t, p_user: m.id });
    expect(await as(m.id, "select id from public.protocol_versions where study_id = $1", [q])).toHaveLength(0);
    expect(await as(m.id, "select id from public.teams where id = $1", [t])).toHaveLength(0);
    await expect(db.rpc("team_overview", { p_actor: m.id, p_team: t })).rejects.toThrow(/forbidden/);
    expect((await db.rpc("collab_notifications", { p_actor: m.id })).map((x: any) => x.kind)).toContain("team_removed");
    await expect(db.rpc("team_remove_member", { p_actor: o.id, p_team: t, p_user: o.id })).rejects.toThrow(/owner_cannot_leave/);
  });
});

describe("shared references", () => {
  it("shares by association without exposing private notes and tags, and links into other projects", async () => {
    const o = await person("Owner"); const t = await newTeam(o); const m = await person("Mem");
    await tjoin(o, t, m, "member");
    const p = await teamProject(o, t, "Source"); const q = await teamProject(m, t, "Target");
    const ref = (await db.pool.query("insert into public.study_references (study_id, identifier_type, title, authors, year, notes, tags) values ($1, 'manual', 'A shared paper', '{Smith J}', 2021, 'PRIVATE NOTE', '{secret}') returning id", [p])).rows[0].id;
    await db.rpc("team_share_reference", { p_actor: o.id, p_team: t, p_reference: ref });
    const lib = await db.rpc("team_library", { p_actor: m.id, p_team: t });
    expect(lib).toHaveLength(1);
    expect(JSON.stringify(lib)).not.toMatch(/PRIVATE NOTE|secret/);
    await db.rpc("study_link_reference", { p_actor: m.id, p_study: q, p_team_reference: lib[0].id });
    const linked = await as(m.id, "select public.study_linked_references($1) r", [q]);
    expect(linked[0].r).toHaveLength(1);
    expect(linked[0].r[0]).toMatchObject({ title: "A shared paper", tags: [] });
    expect(JSON.stringify(linked)).not.toMatch(/PRIVATE NOTE/);
    expect((await db.pool.query("select count(*)::int n from public.study_references")).rows[0].n).toBe(1); // no duplicate row
    // a stranger gets nothing, and cannot link or share
    const x = await person("X");
    expect((await as(x.id, "select public.study_linked_references($1) r", [q]))[0].r).toEqual([]);
    await expect(db.rpc("study_link_reference", { p_actor: x.id, p_study: q, p_team_reference: lib[0].id })).rejects.toThrow(/not_allowed/);
    await expect(db.rpc("team_share_reference", { p_actor: m.id, p_team: t, p_reference: ref })).rejects.toThrow(/not_allowed/); // not an editor of the source project
    await db.rpc("team_unshare_reference", { p_actor: o.id, p_team_reference: lib[0].id });
    expect((await as(m.id, "select public.study_linked_references($1) r", [q]))[0].r).toEqual([]);
  });

  it("drops links a removed member made when they leave", async () => {
    const o = await person("Owner"); const t = await newTeam(o); const m = await person("Mem");
    await tjoin(o, t, m, "member");
    const p = await teamProject(o, t); const q = await teamProject(m, t);
    const ref = (await db.pool.query("insert into public.study_references (study_id, identifier_type, title) values ($1, 'manual', 'R') returning id", [p])).rows[0].id;
    await db.rpc("team_share_reference", { p_actor: o.id, p_team: t, p_reference: ref });
    const lib = await db.rpc("team_library", { p_actor: o.id, p_team: t });
    await db.rpc("study_link_reference", { p_actor: m.id, p_study: q, p_team_reference: lib[0].id });
    await db.rpc("team_project_transfer", { p_actor: o.id, p_study: q, p_new_owner: o.id });
    await db.rpc("team_remove_member", { p_actor: o.id, p_team: t, p_user: m.id });
    expect((await db.pool.query("select count(*)::int n from public.study_reference_links where study_id = $1", [q])).rows[0].n).toBe(0);
  });
});

describe("shared documents on a private bucket", () => {
  const put = async (path: string, size = 2048) => db.pool.query("insert into storage.objects (bucket_id, name, metadata) values ('team-documents', $1, $2)", [path, JSON.stringify({ size })]);
  const names = (u: string) => as(u, "select name from storage.objects where bucket_id = 'team-documents'");

  it("registers, uploads, finalises and reads with permission, and denies everyone else", async () => {
    const o = await person("Owner"); const t = await newTeam(o); const m = await person("Mem"); const g = await person("Guest"); const x = await person("X");
    await tjoin(o, t, m, "member"); await tjoin(o, t, g, "guest");
    const doc = await db.rpc("team_doc_register", { p_actor: m.id, p_team: t, p_name: "Protocol v1.pdf", p_mime: "application/pdf", p_size: 2048, p_study: null });
    expect(doc.path).toMatch(new RegExp(`^${t}/${doc.id}/`));
    // pending: nobody can read yet; only the uploader may insert the object
    await expect(as(x.id, "insert into storage.objects (bucket_id, name, metadata) values ('team-documents', $1, '{\"size\":1}')", [doc.path])).rejects.toThrow(/row-level security/);
    await expect(as(g.id, "insert into storage.objects (bucket_id, name, metadata) values ('team-documents', $1, '{\"size\":1}')", [doc.path])).rejects.toThrow(/row-level security/);
    await expect(db.rpc("team_doc_finalize", { p_actor: m.id, p_doc: doc.id })).rejects.toThrow(/upload_missing/);
    await put(doc.path);
    await db.rpc("team_doc_finalize", { p_actor: m.id, p_doc: doc.id });
    expect(await names(m.id)).toHaveLength(1);
    expect(await names(o.id)).toHaveLength(1);
    expect(await names(g.id)).toHaveLength(0); // guests do not see team-wide files
    expect(await names(x.id)).toHaveLength(0);
    expect(await as(x.id, "select id from public.team_documents")).toHaveLength(0);
    expect(await db.rpc("team_documents_list", { p_actor: g.id, p_team: t })).toEqual([]);
    expect(await db.rpc("team_documents_list", { p_actor: m.id, p_team: t })).toHaveLength(1);
  });

  it("lets project members, including guests, read a document attached to their project, and revokes on removal", async () => {
    const o = await person("Owner"); const t = await newTeam(o); const m = await person("Mem"); const g = await person("Guest");
    await tjoin(o, t, m, "member"); await tjoin(o, t, g, "guest");
    const p = await teamProject(m, t);
    await db.rpc("team_project_add_member", { p_actor: m.id, p_study: p, p_user: g.id, p_role: "reviewer" });
    const doc = await db.rpc("team_doc_register", { p_actor: m.id, p_team: t, p_name: "Data plan.docx", p_mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", p_size: 4096, p_study: p });
    await put(doc.path, 4096); await db.rpc("team_doc_finalize", { p_actor: m.id, p_doc: doc.id });
    expect(await names(g.id)).toHaveLength(1);
    expect(await db.rpc("team_documents_list", { p_actor: g.id, p_team: t })).toHaveLength(1);
    await db.rpc("collab_remove_member", { p_actor: m.id, p_study: p, p_user: g.id });
    expect(await names(g.id)).toHaveLength(0);
    await db.rpc("team_project_add_member", { p_actor: m.id, p_study: p, p_user: g.id, p_role: "reviewer" });
    expect(await names(g.id)).toHaveLength(1);
    await db.rpc("team_project_transfer", { p_actor: o.id, p_study: p, p_new_owner: o.id });
    await db.rpc("team_remove_member", { p_actor: o.id, p_team: t, p_user: g.id });
    expect(await names(g.id)).toHaveLength(0);
  });

  it("enforces size, type, quota, and who may delete", async () => {
    const o = await person("Owner"); const t = await newTeam(o); const m = await person("Mem"); const x = await person("X");
    await tjoin(o, t, m, "member");
    const reg = (actor: string, over: Record<string, unknown> = {}) => db.rpc("team_doc_register", { p_actor: actor, p_team: t, p_name: "a.pdf", p_mime: "application/pdf", p_size: 1000, p_study: null, ...over });
    await expect(reg(x.id)).rejects.toThrow(/not_team_member/);
    await expect(reg(m.id, { p_mime: "application/x-msdownload" })).rejects.toThrow(/unsupported_type/);
    await expect(reg(m.id, { p_size: 11 * 1048576 })).rejects.toThrow(/invalid_document/);
    await expect(reg(m.id, { p_name: "   " })).rejects.toThrow(/invalid_document/);
    const odd = await reg(m.id, { p_name: "../../etc/passwd" });
    expect(odd.path.split("/")).toHaveLength(3); // the file name can never add path segments
    await db.pool.query("update public.team_limits set value = 0 where plan_key = 'unsubscribed' and limit_key = 'max_storage_mb'");
    try { await expect(reg(m.id)).rejects.toThrow(/storage_full/); } finally { await db.pool.query("update public.team_limits set value = 50 where plan_key = 'unsubscribed' and limit_key = 'max_storage_mb'"); }
    const d = await reg(m.id); await put(d.path, 1000); await db.rpc("team_doc_finalize", { p_actor: m.id, p_doc: d.id });
    await expect(db.rpc("team_doc_delete", { p_actor: x.id, p_doc: d.id })).rejects.toThrow(/not_allowed/);
    const other = await person("Other"); await tjoin(o, t, other, "member");
    await expect(db.rpc("team_doc_delete", { p_actor: other.id, p_doc: d.id })).rejects.toThrow(/not_allowed/);
    expect(await db.rpc("team_doc_delete", { p_actor: o.id, p_doc: d.id })).toBe(d.path);
    expect(await names(m.id)).toHaveLength(0);
  });
});

describe("dashboard and activity", () => {
  it("reports real counts and an activity timeline for team members only", async () => {
    const o = await person("Owner"); const t = await newTeam(o); const m = await person("Mem"); const x = await person("X");
    await tjoin(o, t, m, "member");
    const p = await teamProject(m, t);
    await db.pool.query("insert into public.ai_subscriptions (user_id, plan, status, current_period_start, current_period_end, provider, provider_subscription_id) values ($1, 'pro', 'active', now() - interval '1 day', now() + interval '20 days', 'dodo', 'sub_t3')", [m.id]);
    const rev = await person("Rev"); await tjoin(o, t, rev, "guest");
    await db.rpc("team_project_add_member", { p_actor: m.id, p_study: p, p_user: rev.id, p_role: "reviewer" });
    await db.rpc("collab_review_submit", { p_actor: m.id, p_study: p, p_note: null });
    const ov = await db.rpc("team_overview", { p_actor: o.id, p_team: t });
    expect(ov.seats).toMatchObject({ paid_used: 2, guests_used: 1 });
    expect(ov.stats).toMatchObject({ projects: 1, active_projects: 1, documents: 0, shared_references: 0, submissions: 1, approvals: 0 });
    expect(ov.entitlements).toMatchObject({ state: "unsubscribed" });
    const act = await db.rpc("team_activity", { p_actor: o.id, p_team: t });
    expect(act.map((a: any) => a.action)).toEqual(expect.arrayContaining(["team_created", "team_member_joined", "review_submitted", "member_added_from_team"]));
    await expect(db.rpc("team_activity", { p_actor: x.id, p_team: t })).rejects.toThrow(/forbidden/);
    await expect(db.rpc("team_activity", { p_actor: rev.id, p_team: t })).rejects.toThrow(/forbidden/);
    await expect(db.rpc("team_overview", { p_actor: x.id, p_team: t })).rejects.toThrow(/forbidden/);
  });

  it("works for a user with a Free plan: team and personal entitlements stay separate", async () => {
    const free = await person("Free"); const t = await newTeam(free);
    expect((await db.rpc("team_overview", { p_actor: free.id, p_team: t })).entitlements.state).toBe("unsubscribed");
    expect(await db.rpc<string>("billing_user_plan", { p_user: free.id })).toBe("free");
    const p = await teamProject(free, t);
    expect(await db.rpc<string>("collab_project_plan", { p_study: p })).toBe("free"); // no active Team plan: the owner's own plan applies
    expect(await join(free.id, p, await person("Sup"), "reviewer")).toMatchObject({ role: "reviewer" });
  });
});
