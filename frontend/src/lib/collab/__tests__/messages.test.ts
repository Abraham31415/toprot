import { describe, expect, it, vi } from "vitest";
import { isConversation, listMessages, messageError, projectConversation, sendMessage, teamConversation } from "../messages";
import { dispatchNotificationEmails, notificationEmail } from "../notify-email";
import type { DbLike } from "../service";

const ID = "11111111-1111-4111-8111-111111111111";

function fakeDb(handlers: Record<string, () => { data?: unknown; error?: { message: string } }>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return { calls, db: { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return (handlers[fn] ?? (() => ({ data: null })))(); } } as unknown as DbLike };
}

describe("conversations", () => {
  it("accepts only project and team conversations with real ids", () => {
    expect(isConversation(projectConversation(ID))).toBe(true);
    expect(isConversation(teamConversation(ID))).toBe(true);
    for (const bad of ["project:x", `admin:${ID}`, `project:${ID}:extra`, "", null, 3]) expect(isConversation(bad)).toBe(false);
  });
  it("validates before calling the database and maps refusals to words", async () => {
    const { db, calls } = fakeDb({ collab_message_send: () => ({ error: { message: "not_allowed" } }) });
    expect((await sendMessage(db, "u", "bad", "hi")).ok).toBe(false);
    expect((await sendMessage(db, "u", projectConversation(ID), "   ")).ok).toBe(false);
    expect((await sendMessage(db, "u", projectConversation(ID), "x".repeat(4001))).ok).toBe(false);
    expect(calls).toHaveLength(0);
    const r = await sendMessage(db, "u", projectConversation(ID), "hello");
    expect(!r.ok && r.error).toMatch(/read this conversation/);
    expect(messageError("rate_limited")).toMatch(/quickly/);
    expect((await listMessages(db, "u", "bad")).ok).toBe(false);
  });
});

describe("notification emails", () => {
  const n = { id: ID, email: "a@b.co", title: "Review requested: Thesis", body: "Please look", link: `/studies/${ID}/review` };
  it("includes the link and where to change preferences", () => {
    const m = notificationEmail(n);
    expect(m.subject).toBe(n.title);
    expect(m.text).toContain(`/studies/${ID}/review`);
    expect(m.text).toMatch(/notifications/);
  });
  it("records exactly what the provider answered", async () => {
    const { db, calls } = fakeDb({ collab_claim_emails: () => ({ data: [n, { ...n, id: "2", email: null }, { ...n, id: "3" }, { ...n, id: "4" }] }) });
    const answers = [{ status: "provider_accepted" as const, id: "re_1" }, { status: "failed" as const, error: "Resend responded 500" }, { status: "not_configured" as const, error: "no key" }];
    const send = vi.fn(async () => answers.shift()!);
    const r = await dispatchNotificationEmails(db, send);
    expect(r).toEqual({ claimed: 4, accepted: 1, failed: 2, notConfigured: 1 });
    expect(send).toHaveBeenCalledTimes(3); // the address-less one is never sent
    const marks = calls.filter((c) => c.fn === "collab_mark_email").map((c) => c.args.p_status);
    expect(marks).toEqual(["provider_accepted", "failed", "failed", "not_configured"]);
  });
  it("does nothing when the database holds everything back", async () => {
    const { db } = fakeDb({ collab_claim_emails: () => ({ data: [] }) });
    const send = vi.fn();
    expect(await dispatchNotificationEmails(db, send as never)).toEqual({ claimed: 0, accepted: 0, failed: 0, notConfigured: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
