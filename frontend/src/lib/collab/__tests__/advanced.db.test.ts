/* eslint-disable @typescript-eslint/no-explicit-any -- rows from the scratch database are untyped */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminDb } from "@/lib/admin/__tests__/db-harness";
import { makeHelpers } from "./helpers";

// Stage 4: conflict-aware protocol saves, history, messaging, preferences, email queue and quotas.
let db: AdminDb;
const { person, project, join, as, asWrite } = makeHelpers(() => db);

beforeAll(async () => { db = await AdminDb.create(); }, 120_000);
afterAll(async () => { await db.close(); });

async function setup() {
  const owner = await person("Owner", "pro"); const ed = await person("Ed"); const rev = await person("Rev"); const view = await person("View");
  const study = await project(owner.id);
  await join(owner.id, study, ed, "editor"); await join(owner.id, study, rev, "reviewer"); await join(owner.id, study, view, "viewer");
  const version = (await db.pool.query("select id from public.protocol_versions where study_id = $1", [study])).rows[0].id as string;
  return { owner, ed, rev, view, study, version };
}
const save = (u: string, version: string, base: object, patch: object) =>
  asWrite(u, "select public.save_protocol_section($1, $2::jsonb, $3::jsonb) r", [version, JSON.stringify(base), JSON.stringify(patch)]).then((r) => r[0].r);

describe("conflict-aware protocol saves", () => {
  it("saves, and merges edits to different fields from two people", async () => {
    const { owner, ed, version } = await setup();
    expect(await save(owner.id, version, { research_question: "Does X cause Y?" }, { research_question: "Does X cause Y in infants?" })).toEqual({ ok: true });
    expect(await save(ed.id, version, { setting: null }, { setting: "Mulago" })).toEqual({ ok: true });
    const row = (await db.pool.query("select research_question, setting, updated_by from public.protocol_versions where id = $1", [version])).rows[0];
    expect(row).toMatchObject({ research_question: "Does X cause Y in infants?", setting: "Mulago", updated_by: ed.id });
  });

  it("refuses to overwrite a field someone else changed, and returns their text", async () => {
    const { owner, ed, version } = await setup();
    await save(owner.id, version, { research_question: "Does X cause Y?" }, { research_question: "Owner's version" });
    const r = await save(ed.id, version, { research_question: "Does X cause Y?" }, { research_question: "Editor's version" });
    expect(r.ok).toBe(false);
    expect(r.conflicts).toEqual({ research_question: "Owner's version" });
    expect(r.updated_by).toBe("Owner");
    expect((await db.pool.query("select research_question from public.protocol_versions where id = $1", [version])).rows[0].research_question).toBe("Owner's version");
    // saving again from the up-to-date base succeeds; saving identical text is not a conflict
    expect((await save(ed.id, version, { research_question: "Owner's version" }, { research_question: "Merged" })).ok).toBe(true);
    expect((await save(owner.id, version, { research_question: "stale" }, { research_question: "Merged" })).ok).toBe(true);
  });

  it("is limited to content fields, draft versions, and people who may write", async () => {
    const { rev, view, owner, version } = await setup();
    await expect(save(owner.id, version, {}, { status: "registered" })).rejects.toThrow(/invalid_field/);
    await expect(save(owner.id, version, {}, { registered_by: owner.id })).rejects.toThrow(/invalid_field/);
    await expect(save(rev.id, version, { setting: null }, { setting: "x" })).rejects.toThrow(/not_allowed/);
    await expect(save(view.id, version, { setting: null }, { setting: "x" })).rejects.toThrow(/not_allowed/);
    await expect(save((await person("Stranger")).id, version, {}, { setting: "x" })).rejects.toThrow(/version_not_found/);
    await db.pool.query("update public.protocol_versions set status = 'registered', registered_at = now() where id = $1", [version]);
    await expect(save(owner.id, version, {}, { setting: "x" })).rejects.toThrow(/version_locked/);
  });

  it("keeps history, restores it, and can undo a restore", async () => {
    const { owner, ed, version } = await setup();
    await save(owner.id, version, { research_question: "Does X cause Y?" }, { research_question: "Second" });
    const snaps = (await db.pool.query("select id, content from public.protocol_snapshots where version_id = $1", [version])).rows;
    expect(snaps).toHaveLength(1);
    expect(snaps[0].content.research_question).toBe("Does X cause Y?");
    await save(owner.id, version, { research_question: "Second" }, { research_question: "Third" });
    expect((await db.pool.query("select count(*)::int n from public.protocol_snapshots where version_id = $1 and kind = 'auto'", [version])).rows[0].n).toBe(1); // 10 minute throttle
    await asWrite(ed.id, "select public.restore_protocol_snapshot($1)", [snaps[0].id]);
    expect((await db.pool.query("select research_question from public.protocol_versions where id = $1", [version])).rows[0].research_question).toBe("Does X cause Y?");
    const before = (await db.pool.query("select content from public.protocol_snapshots where version_id = $1 and kind = 'restore'", [version])).rows;
    expect(before[0].content.research_question).toBe("Third");
    const manual = (await asWrite(owner.id, "select public.snapshot_protocol($1, 'Before submission') id", [version]))[0].id;
    expect(manual).toBeTruthy();
  });

  it("only members can read history, and only writers can restore", async () => {
    const { owner, rev, view, version } = await setup();
    await save(owner.id, version, { setting: null }, { setting: "A" });
    const snap = (await db.pool.query("select id from public.protocol_snapshots where version_id = $1", [version])).rows[0].id;
    expect(await as(rev.id, "select id from public.protocol_snapshots")).toHaveLength(1);
    expect(await as((await person("S")).id, "select id from public.protocol_snapshots")).toHaveLength(0);
    await expect(as(view.id, "select public.restore_protocol_snapshot($1)", [snap])).rejects.toThrow(/not_allowed/);
    await expect(as(owner.id, "insert into public.protocol_snapshots (version_id, study_id, kind, content) select id, study_id, 'manual', '{}' from public.protocol_versions limit 1")).rejects.toThrow(/permission denied/);
  });
});

describe("messages", () => {
  it("lets people who can comment post, others read or nothing, with unread counts", async () => {
    const { owner, ed, rev, view, study } = await setup(); const x = await person("X");
    const conv = `project:${study}`;
    const send = (u: string, b: string) => db.rpc("collab_message_send", { p_actor: u, p_conversation: conv, p_body: b });
    await send(owner.id, "Hello"); await send(rev.id, "Please check section 3"); await send(ed.id, "On it");
    await expect(send(view.id, "can I?")).rejects.toThrow(/not_allowed/);
    await expect(send(x.id, "hi")).rejects.toThrow(/not_allowed/);
    await expect(send(owner.id, "   ")).rejects.toThrow(/invalid_message/);
    const list = await db.rpc("collab_messages_list", { p_actor: view.id, p_conversation: conv });
    expect(list.map((m: any) => m.body)).toEqual(["Hello", "Please check section 3", "On it"]);
    await expect(db.rpc("collab_messages_list", { p_actor: x.id, p_conversation: conv })).rejects.toThrow(/forbidden/);
    expect((await db.rpc("collab_unread_messages", { p_actor: view.id }))[conv]).toBe(3);
    expect((await db.rpc("collab_unread_messages", { p_actor: owner.id }))[conv]).toBe(2); // own messages are never unread
    await db.rpc("collab_mark_conversation_read", { p_actor: view.id, p_conversation: conv });
    expect((await db.rpc("collab_unread_messages", { p_actor: view.id }))[conv]).toBeUndefined();
    await send(rev.id, "One more");
    expect((await db.rpc("collab_unread_messages", { p_actor: view.id }))[conv]).toBe(1);
    expect(await db.rpc("collab_unread_messages", { p_actor: x.id })).toEqual({});
  });

  it("applies row level security for realtime subscribers, and removed members lose it at once", async () => {
    const { owner, rev, study } = await setup(); const x = await person("X");
    await db.rpc("collab_message_send", { p_actor: owner.id, p_conversation: `project:${study}`, p_body: "secret plan" });
    expect(await as(rev.id, "select id from public.collab_messages")).toHaveLength(1);
    expect(await as(x.id, "select id from public.collab_messages")).toHaveLength(0);
    await expect(as(rev.id, "insert into public.collab_messages (study_id, author_id, body) values ($1, $2, 'spoof')", [study, rev.id])).rejects.toThrow(/permission denied/);
    await db.rpc("collab_remove_member", { p_actor: owner.id, p_study: study, p_user: rev.id });
    expect(await as(rev.id, "select id from public.collab_messages")).toHaveLength(0);
    await expect(db.rpc("collab_messages_list", { p_actor: rev.id, p_conversation: `project:${study}` })).rejects.toThrow(/forbidden/);
    expect((await as(x.id, "select public.collab_can_read_conversation($1, $2) ok", [owner.id, `project:${study}`]))[0].ok).toBe(false);
  });

  it("rate limits messages", async () => {
    const { owner, study } = await setup();
    await db.pool.query("update public.billing_settings set value_num = 3 where key = 'collab_messages_per_minute'");
    try {
      for (let i = 0; i < 3; i++) await db.rpc("collab_message_send", { p_actor: owner.id, p_conversation: `project:${study}`, p_body: `m${i}` });
      await expect(db.rpc("collab_message_send", { p_actor: owner.id, p_conversation: `project:${study}`, p_body: "too many" })).rejects.toThrow(/rate_limited/);
    } finally { await db.pool.query("update public.billing_settings set value_num = 20 where key = 'collab_messages_per_minute'"); }
  });

  it("supports team conversations for paid members only", async () => {
    const o = await person("Owner"); const t = await db.rpc<string>("team_create", { p_actor: o.id, p_name: "Lab" }); const g = await person("Guest");
    const inv = await db.rpc<any>("team_invite", { p_actor: o.id, p_team: t, p_email: g.email, p_role: "guest" });
    await db.rpc("collab_accept", { p_actor: g.id, p_token: inv.token });
    await db.rpc("collab_message_send", { p_actor: o.id, p_conversation: `team:${t}`, p_body: "Team meeting at 3" });
    await expect(db.rpc("collab_message_send", { p_actor: g.id, p_conversation: `team:${t}`, p_body: "hi" })).rejects.toThrow(/not_allowed/);
    await expect(db.rpc("collab_messages_list", { p_actor: g.id, p_conversation: `team:${t}` })).rejects.toThrow(/forbidden/);
    expect(await as(g.id, "select id from public.collab_messages")).toHaveLength(0);
  });
});

describe("notification preferences and email queue", () => {
  it("defaults to in-app plus review emails, and honours each choice", async () => {
    const { owner, rev, study } = await setup();
    await db.rpc("collab_review_submit", { p_actor: owner.id, p_study: study, p_note: null });
    const n = (await db.pool.query("select in_app, email_status from public.notifications where user_id = $1", [rev.id])).rows;
    expect(n).toEqual([{ in_app: true, email_status: "pending" }]); // review requests email by default
    await db.rpc("collab_comment_add", { p_actor: owner.id, p_study: study, p_section: "general", p_body: "hello", p_thread: null });
    expect((await db.pool.query("select email_status from public.notifications where user_id = $1 and kind = 'comment'", [rev.id])).rows[0].email_status).toBe("none");
    await db.rpc("collab_prefs_set", { p_actor: rev.id, p_prefs: { comment_inapp: false, review_email: false } });
    expect(await db.rpc("collab_prefs_get", { p_actor: rev.id })).toMatchObject({ comment_inapp: false, review_email: false, review_inapp: true });
    await db.rpc("collab_comment_add", { p_actor: owner.id, p_study: study, p_section: "general", p_body: "again", p_thread: null });
    expect((await db.pool.query("select count(*)::int n from public.notifications where user_id = $1 and kind = 'comment'", [rev.id])).rows[0].n).toBe(1); // second one muted
    expect((await db.rpc("collab_notifications", { p_actor: rev.id })).filter((x: any) => x.kind === "comment")).toHaveLength(1);
    await expect(db.rpc("collab_prefs_set", { p_actor: rev.id, p_prefs: { evil: true } })).rejects.toThrow(/invalid_preference/);
    await expect(db.rpc("collab_prefs_set", { p_actor: rev.id, p_prefs: { review_email: "yes" } })).rejects.toThrow(/invalid_preference/);
  });

  it("never marks an email as sent until the provider accepted it, and retries failures", async () => {
    const { owner, rev, study } = await setup();
    await db.pool.query("delete from public.notifications");
    await db.rpc("collab_review_submit", { p_actor: owner.id, p_study: study, p_note: null });
    const claimed = await db.rpc<any[]>("collab_claim_emails", { p_limit: 10 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0].email).toBe((await db.pool.query("select email from auth.users where id = $1", [rev.id])).rows[0].email);
    expect((await db.pool.query("select email_status, email_attempts from public.notifications where id = $1", [claimed[0].id])).rows[0]).toEqual({ email_status: "sending", email_attempts: 1 });
    expect(await db.rpc("collab_claim_emails", { p_limit: 10 })).toEqual([]); // already claimed
    await db.rpc("collab_mark_email", { p_id: claimed[0].id, p_status: "not_configured", p_error: "RESEND_API_KEY is not set" });
    const row = (await db.pool.query("select email_status, email_error from public.notifications where id = $1", [claimed[0].id])).rows[0];
    expect(row).toEqual({ email_status: "not_configured", email_error: "RESEND_API_KEY is not set" });
    expect((await db.rpc<any>("collab_email_quota")).day_used).toBe(0); // nothing was sent, nothing is counted
    await expect(db.rpc("collab_mark_email", { p_id: claimed[0].id, p_status: "sent" })).rejects.toThrow(/invalid_status/);
  });

  it("counts only accepted emails, throttles noisy recipients, pauses at the quota and raises alerts", async () => {
    const { owner, rev, study } = await setup();
    await db.pool.query("delete from public.notifications");
    await db.pool.query("update public.billing_settings set value_num = 2 where key = 'collab_emails_per_user_per_hour'");
    for (let i = 0; i < 4; i++) await db.rpc("collab_notify", { p_user: rev.id, p_kind: "review_requested", p_study: study, p_title: `R${i}`, p_body: null, p_link: null });
    const got = await db.rpc<any[]>("collab_claim_emails", { p_limit: 10 });
    expect(got).toHaveLength(2); // the per-hour cap is 2, so two more are held back as throttled
    expect((await db.pool.query("select count(*)::int n from public.notifications where email_status = 'throttled'")).rows[0].n).toBe(2);
    expect((await db.rpc<any>("collab_email_quota")).day_used).toBe(0); // claimed is not sent
    for (const g of got) await db.rpc("collab_mark_email", { p_id: g.id, p_status: "provider_accepted", p_message_id: "re_" + g.id });
    await db.rpc("collab_mark_email", { p_id: got[0].id, p_status: "failed" }); // already accepted: ignored
    expect((await db.rpc<any>("collab_email_quota")).day_used).toBe(2);

    await db.pool.query("update public.billing_settings set value_num = 2 where key = 'collab_resend_daily_limit'");
    expect(await db.rpc<any>("collab_email_quota")).toMatchObject({ day_used: 2, day_limit: 2, blocked: true });
    await db.pool.query("update public.billing_settings set value_num = 100 where key = 'collab_emails_per_user_per_hour'");
    await db.rpc("collab_notify", { p_user: owner.id, p_kind: "review_requested", p_study: study, p_title: "Held", p_body: null, p_link: null });
    expect(await db.rpc("collab_claim_emails", { p_limit: 10 })).toEqual([]); // over the daily quota: held, not lost
    expect((await db.pool.query("select email_status from public.notifications where title = 'Held'")).rows[0].email_status).toBe("pending");
    const alert = (await db.pool.query("select severity from public.system_alerts where kind = 'email_quota' and acknowledged_at is null")).rows;
    expect(alert.length).toBeGreaterThan(0);
    expect(alert[0].severity).toBe("critical");
    await db.pool.query("update public.billing_settings set value_num = 100 where key = 'collab_resend_daily_limit'");
    expect((await db.rpc<any[]>("collab_claim_emails", { p_limit: 10 })).length).toBe(1); // sending resumes
  });

  it("recovers an email claim that was never completed", async () => {
    const { owner, study } = await setup();
    await db.pool.query("delete from public.notifications");
    await db.rpc("collab_notify", { p_user: owner.id, p_kind: "review_requested", p_study: study, p_title: "Stuck", p_body: null, p_link: null });
    const first = await db.rpc<any[]>("collab_claim_emails", { p_limit: 10 });
    expect(first).toHaveLength(1);
    await db.pool.query("update public.notifications set email_at = now() - interval '20 minutes'");
    const again = await db.rpc<any[]>("collab_claim_emails", { p_limit: 10 });
    expect(again).toHaveLength(1);
  });

  it("keeps everything service-only and records realtime joins for monitoring", async () => {
    const { owner } = await setup();
    await expect(as(owner.id, "select public.collab_claim_emails(5)")).rejects.toThrow(/permission denied/);
    await expect(as(owner.id, "select public.collab_prefs_set($1, '{}')", [owner.id])).rejects.toThrow(/permission denied/);
    await expect(as(owner.id, "select * from public.collab_usage")).rejects.toThrow(/permission denied/);
    await db.rpc("collab_usage_bump", { p_metric: "realtime_joins", p_n: 3 });
    expect((await db.rpc<any>("collab_email_quota")).realtime_joins_today).toBeGreaterThanOrEqual(3);
  });
});
