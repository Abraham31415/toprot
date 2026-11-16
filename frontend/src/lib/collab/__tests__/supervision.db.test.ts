/* eslint-disable @typescript-eslint/no-explicit-any -- rows from the scratch database are untyped */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminDb } from "@/lib/admin/__tests__/db-harness";
import { makeHelpers } from "./helpers";

// Stage 2: the supervision review workflow, approvals, comments and notifications.
let db: AdminDb;
const { person, project, join, as } = makeHelpers(() => db);

beforeAll(async () => { db = await AdminDb.create(); }, 120_000);
afterAll(async () => { await db.close(); });

const submit = (actor: string, study: string, note: string | null = null) => db.rpc("collab_review_submit", { p_actor: actor, p_study: study, p_note: note });
const move = (actor: string, study: string, to: string, extra: Record<string, unknown> = {}) =>
  db.rpc("collab_review_transition", { p_actor: actor, p_study: study, p_to: to, p_note: null, p_statement: null, p_confirm: false, ...extra });
const overview = (actor: string, study: string) => db.rpc("collab_review_overview", { p_actor: actor, p_study: study });

async function setup() {
  const owner = await person("Owner"); const sup = await person("Sup"); const study = await project(owner.id, "Thesis");
  await join(owner.id, study, sup, "reviewer");
  return { owner, sup, study };
}

describe("review workflow", () => {
  it("walks Draft > Submitted > Under review > Changes requested > Resubmitted > Approved", async () => {
    const { owner, sup, study } = await setup();
    expect((await overview(owner.id, study)).reviewers[0].status).toBe("draft");
    await submit(owner.id, study, "First full draft");
    expect((await overview(owner.id, study)).reviewers[0].status).toBe("submitted");
    await move(sup.id, study, "under_review");
    await move(sup.id, study, "changes_requested", { p_note: "Clarify the sample size." });
    expect((await overview(sup.id, study)).reviewers[0].status).toBe("changes_requested");
    await submit(owner.id, study, "Clarified");
    expect((await overview(owner.id, study)).reviewers[0].status).toBe("resubmitted");
    await move(sup.id, study, "under_review");
    const ok = await move(sup.id, study, "approved", { p_confirm: true, p_statement: "Good to proceed." });
    expect(ok).toEqual({ status: "approved", approval_number: 1 });
    const ov = await overview(owner.id, study);
    expect(ov.reviewers[0].status).toBe("approved");
    expect(ov.reviewers[0].history.map((h: any) => h.to)).toEqual(["submitted", "under_review", "changes_requested", "resubmitted", "under_review", "approved"]);
    expect(ov.reviewers[0].approvals[0]).toMatchObject({ number: 1, current: true, statement: "Good to proceed.", submission: 2 });
  });

  it("refuses skipped steps and unconfirmed or note-less decisions", async () => {
    const { owner, sup, study } = await setup();
    await expect(move(sup.id, study, "under_review")).rejects.toThrow(/nothing_to_review/);
    await submit(owner.id, study);
    await expect(move(sup.id, study, "approved", { p_confirm: true })).rejects.toThrow(/invalid_transition/);
    await move(sup.id, study, "under_review");
    await expect(move(sup.id, study, "approved", { p_confirm: false })).rejects.toThrow(/confirmation_required/);
    await expect(move(sup.id, study, "changes_requested", { p_note: " " })).rejects.toThrow(/note_required/);
    await expect(move(sup.id, study, "draft")).rejects.toThrow(/invalid_transition/);
  });

  it("needs a supervisor to submit to, and only the owner or an editor may submit", async () => {
    const owner = await person("Owner", "pro"); const study = await project(owner.id);
    await expect(submit(owner.id, study)).rejects.toThrow(/no_reviewers/);
    const ed = await person("Ed"), v = await person("View"), sup = await person("Sup");
    await join(owner.id, study, ed, "editor"); await join(owner.id, study, v, "viewer"); await join(owner.id, study, sup, "reviewer");
    await expect(submit(v.id, study)).rejects.toThrow(/not_allowed/);
    await expect(submit(sup.id, study)).rejects.toThrow(/not_allowed/);
    await expect(submit((await person("Stranger")).id, study)).rejects.toThrow(/not_allowed/);
    await submit(ed.id, study);
  });

  it("only a reviewer on the project can decide, and an owner cannot approve their own work", async () => {
    const { owner, study } = await setup();
    await submit(owner.id, study);
    await expect(move(owner.id, study, "under_review")).rejects.toThrow(/not_reviewer/);
    await expect(move((await person("Other")).id, study, "under_review")).rejects.toThrow(/not_reviewer/);
    await expect(move(owner.id, study, "approved", { p_confirm: true })).rejects.toThrow(/not_reviewer/);
  });

  it("keeps independent histories for several supervisors", async () => {
    const owner = await person("Owner"); const study = await project(owner.id);
    const a = await person("A"), b = await person("B");
    await join(owner.id, study, a, "reviewer"); await join(owner.id, study, b, "reviewer");
    await submit(owner.id, study);
    await move(a.id, study, "under_review");
    await move(a.id, study, "changes_requested", { p_note: "Needs a power calculation." });
    await move(b.id, study, "under_review");
    await move(b.id, study, "approved", { p_confirm: true });
    const ov = await overview(owner.id, study);
    const byName = Object.fromEntries(ov.reviewers.map((r: any) => [r.full_name, r]));
    expect(byName.A.status).toBe("changes_requested");
    expect(byName.B.status).toBe("approved");
    expect(byName.A.approvals).toHaveLength(0);
    expect(byName.B.history).toHaveLength(3);
    expect(byName.A.history).toHaveLength(3);
  });

  it("blocks a new submission while a supervisor is mid-review", async () => {
    const { owner, sup, study } = await setup();
    await submit(owner.id, study);
    await move(sup.id, study, "under_review");
    await expect(submit(owner.id, study)).rejects.toThrow(/review_in_progress/);
  });

  it("makes approvals immutable and versioned, and a new submission starts a fresh cycle", async () => {
    const { owner, sup, study } = await setup();
    await submit(owner.id, study); await move(sup.id, study, "under_review");
    await move(sup.id, study, "approved", { p_confirm: true });
    await expect(db.pool.query("update public.review_approvals set statement = 'edited'")).rejects.toThrow(/approvals_are_immutable/);
    await expect(db.pool.query("delete from public.review_approvals")).rejects.toThrow(/approvals_are_immutable/);
    await expect(as(owner.id, "update public.review_approvals set statement = 'x'")).rejects.toThrow(/permission denied/);
    await submit(owner.id, study, "Revised after approval");
    await move(sup.id, study, "under_review");
    const second = await move(sup.id, study, "approved", { p_confirm: true });
    expect(second.approval_number).toBe(2);
    const a = (await overview(owner.id, study)).reviewers[0].approvals;
    expect(a.map((x: any) => [x.number, x.current])).toEqual([[2, true], [1, false]]);
  });

  it("pins each submission to a snapshot of the protocol and manuscript text", async () => {
    const { owner, study } = await setup();
    const m = (await db.pool.query("insert into public.manuscripts (study_id, title, content, created_by) values ($1, 'Draft', $2::jsonb, $3) returning id", [study, JSON.stringify({ type: "doc", content: [] }), owner.id])).rows[0].id;
    await submit(owner.id, study);
    await db.pool.query("update public.protocol_versions set research_question = 'Changed later' where study_id = $1", [study]);
    await db.pool.query("update public.manuscripts set content = $2::jsonb where id = $1", [m, JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] })]);
    const snap = (await db.pool.query("select snapshot from public.review_submissions where study_id = $1", [study])).rows[0].snapshot;
    expect(snap.protocol.research_question).toBe("Does X cause Y?");
    expect(snap.manuscripts).toHaveLength(1);
    const saved = (await db.pool.query("select content from public.manuscript_versions where id = $1", [snap.manuscripts[0].version_id])).rows[0].content;
    expect(saved.content).toEqual([]);
  });

  it("moves a supervisor who has not started onto the newest submission", async () => {
    const { owner, sup, study } = await setup();
    await submit(owner.id, study);
    await submit(owner.id, study);
    await move(sup.id, study, "under_review");
    const st = (await db.pool.query("select submission_id from public.review_states where study_id = $1", [study])).rows[0].submission_id;
    const latest = (await db.pool.query("select id from public.review_submissions where study_id = $1 order by submission_number desc limit 1", [study])).rows[0].id;
    expect(st).toBe(latest);
  });
});

describe("comments", () => {
  it("lets owner, editor and reviewer comment on a section, viewers read only", async () => {
    const owner = await person("Owner", "pro"); const study = await project(owner.id);
    const ed = await person("Ed"), v = await person("V"), sup = await person("Sup");
    await join(owner.id, study, ed, "editor"); await join(owner.id, study, v, "viewer"); await join(owner.id, study, sup, "reviewer");
    const t = await db.rpc("collab_comment_add", { p_actor: sup.id, p_study: study, p_section: "protocol:research_question", p_body: "Make this narrower.", p_thread: null });
    await db.rpc("collab_comment_add", { p_actor: owner.id, p_study: study, p_section: "protocol:research_question", p_body: "Done.", p_thread: t.thread_id });
    await db.rpc("collab_comment_add", { p_actor: ed.id, p_study: study, p_section: "general", p_body: "Fine by me.", p_thread: null });
    await expect(db.rpc("collab_comment_add", { p_actor: v.id, p_study: study, p_section: "general", p_body: "x", p_thread: null })).rejects.toThrow(/not_allowed/);
    await expect(db.rpc("collab_comment_add", { p_actor: (await person("S")).id, p_study: study, p_section: "general", p_body: "x", p_thread: null })).rejects.toThrow(/not_allowed/);
    await expect(db.rpc("collab_comment_add", { p_actor: sup.id, p_study: study, p_section: "protocol:Bad Field!", p_body: "x", p_thread: null })).rejects.toThrow(/invalid_section/);
    await expect(db.rpc("collab_comment_add", { p_actor: sup.id, p_study: study, p_section: "general", p_body: "   ", p_thread: null })).rejects.toThrow(/invalid_comment/);
    const ov = await overview(v.id, study);
    expect(ov.threads).toHaveLength(2);
    expect(ov.threads.find((x: any) => x.section === "protocol:research_question").comments.map((c: any) => c.body)).toEqual(["Make this narrower.", "Done."]);
    await db.rpc("collab_thread_resolve", { p_actor: owner.id, p_study: study, p_thread: t.thread_id, p_resolved: true });
    expect((await overview(owner.id, study)).threads.find((x: any) => x.id === t.thread_id).status).toBe("resolved");
    await expect(db.rpc("collab_thread_resolve", { p_actor: v.id, p_study: study, p_thread: t.thread_id, p_resolved: false })).rejects.toThrow(/not_allowed/);
  });

  it("hides threads from non-members at the table level and blocks direct writes", async () => {
    const { owner, sup, study } = await setup(); const x = await person("X");
    await db.rpc("collab_comment_add", { p_actor: owner.id, p_study: study, p_section: "general", p_body: "Hello", p_thread: null });
    expect(await as(sup.id, "select id from public.review_comments where study_id = $1", [study])).toHaveLength(1);
    expect(await as(x.id, "select id from public.review_comments where study_id = $1", [study])).toHaveLength(0);
    await expect(as(sup.id, "insert into public.review_comments (thread_id, study_id, author_id, body) select id, study_id, $1::uuid, 'spoof' from public.review_threads limit 1", [sup.id])).rejects.toThrow(/permission denied/);
    await expect(as(x.id, "select public.collab_review_overview($1, $2)", [x.id, study])).rejects.toThrow(/permission denied/);
  });
});

describe("notifications", () => {
  it("tells the right people, independent of any realtime channel, and lets people mark their own read", async () => {
    const { owner, sup, study } = await setup();
    await submit(owner.id, study, "Please review");
    const supN = await db.rpc("collab_notifications", { p_actor: sup.id });
    expect(supN[0]).toMatchObject({ kind: "review_requested", link: `/studies/${study}/review` });
    await move(sup.id, study, "under_review");
    await move(sup.id, study, "changes_requested", { p_note: "Please add a flow chart." });
    const ownerN = await db.rpc("collab_notifications", { p_actor: owner.id });
    expect(ownerN.map((n: any) => n.kind)).toEqual(expect.arrayContaining(["review_started", "changes_requested"]));
    expect(ownerN.find((n: any) => n.kind === "changes_requested").body).toContain("flow chart");
    expect(await db.rpc("collab_unread_count", { p_actor: owner.id })).toBe(2);
    expect(await as(owner.id, "select id from public.notifications")).toHaveLength(2);
    expect(await as(sup.id, "select id from public.notifications")).toHaveLength(1);
    expect(await db.rpc("collab_mark_read", { p_actor: owner.id, p_ids: null })).toBe(2);
    expect(await db.rpc("collab_unread_count", { p_actor: owner.id })).toBe(0);
    await expect(as(owner.id, "update public.notifications set title = 'forged'")).rejects.toThrow(/permission denied/);
  });

  it("does not notify someone who has lost access", async () => {
    const owner = await person("Owner"); const study = await project(owner.id); const sup = await person("Sup");
    await join(owner.id, study, sup, "reviewer");
    await db.rpc("collab_remove_member", { p_actor: owner.id, p_study: study, p_user: sup.id });
    await db.rpc("collab_comment_add", { p_actor: owner.id, p_study: study, p_section: "general", p_body: "Private again", p_thread: null });
    expect(await db.rpc("collab_notifications", { p_actor: sup.id })).toEqual([]);
  });
});

describe("supervision workspace", () => {
  it("lists only projects the account reviews, whatever its profile label, with review state", async () => {
    const owner = await person("Owner"); const lecturer = await person("Lecturer", "free", "student"); const s1 = await project(owner.id, "One"); await project(owner.id, "Two");
    await join(owner.id, s1, lecturer, "reviewer");
    await submit(owner.id, s1);
    const w = await db.rpc("collab_supervision_overview", { p_actor: lecturer.id });
    expect(w).toHaveLength(1);
    expect(w[0]).toMatchObject({ study_id: s1, review_status: "submitted", on_latest: true });
    expect(await db.rpc("collab_supervision_overview", { p_actor: owner.id })).toEqual([]);
  });
});
