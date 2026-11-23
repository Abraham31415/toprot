import { beforeEach, describe, expect, it, vi } from "vitest";
import { can, isEmail, isMemberRole, isUuid, ROLE_LABEL } from "../roles";
import { collabErrorCode, collabErrorMessage } from "../errors";
import { acceptInvitationByToken, createInvitation, inviteEmailText, resendInvitation, type DbLike } from "../service";
import { sendEmail } from "@/lib/email/send";
import { resetRateLimits } from "@/lib/rate-limit";
import { safeNext } from "../next-path";

const STUDY = "11111111-1111-4111-8111-111111111111";
const INV = "22222222-2222-4222-8222-222222222222";
const TOKEN = "a".repeat(64);

function fakeDb(handlers: Record<string, (args: Record<string, unknown>) => { data?: unknown; error?: { message: string } }>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return (handlers[fn] ?? (() => ({ data: null })))(args); } } as unknown as DbLike;
  return { db, calls };
}

beforeEach(() => resetRateLimits());

describe("role capabilities", () => {
  it("gives each role only what it should have", () => {
    expect(can("owner", "invite")).toBe(true);
    expect(can("editor", "write")).toBe(true);
    for (const cap of ["invite", "manage_members", "lock_protocol", "delete_project", "review"] as const) expect(can("editor", cap)).toBe(false);
    expect(can("reviewer", "review")).toBe(true);
    expect(can("reviewer", "write")).toBe(false);
    expect(can("viewer", "read")).toBe(true);
    for (const cap of ["comment", "write", "review", "invite"] as const) expect(can("viewer", cap)).toBe(false);
    expect(can(null, "read")).toBe(false);
    expect(can(undefined, "read")).toBe(false);
  });
  it("has no notion of a profile label", () => {
    expect(isMemberRole("supervisor")).toBe(false);
    expect(isMemberRole("student")).toBe(false);
    expect(isMemberRole("owner")).toBe(false);
    expect(isMemberRole("reviewer")).toBe(true);
    expect(ROLE_LABEL.reviewer).toBe("Reviewer");
  });
  it("validates ids and emails", () => {
    expect(isUuid(STUDY)).toBe(true);
    expect(isUuid("nope")).toBe(false);
    expect(isEmail("a@b.co")).toBe(true);
    expect(isEmail("a b@c.d")).toBe(false);
    expect(isEmail("x".repeat(250) + "@b.co")).toBe(false);
  });
});

describe("error messages", () => {
  it("maps database codes to plain language and hides unknown errors", () => {
    expect(collabErrorCode("ERROR: role_not_in_plan")).toBe("role_not_in_plan");
    expect(collabErrorMessage("role_not_in_plan")).toMatch(/Free projects can invite supervisors/);
    expect(collabErrorMessage("connection refused to 10.0.0.1", "Try again")).toBe("Try again");
  });
  it("uses one message for unknown and mismatched invitations", () => {
    expect(collabErrorMessage("invitation_invalid")).not.toMatch(/exist|email address does not/i);
  });
});

describe("safeNext", () => {
  it("accepts only our own invitation and shared paths", () => {
    expect(safeNext(`/invite/${TOKEN}`)).toBe(`/invite/${TOKEN}`);
    expect(safeNext("/shared")).toBe("/shared");
    for (const bad of ["https://evil.test", "//evil.test", "/admin", `/invite/${TOKEN}/../../x`, "/invite/short", undefined, 5]) expect(safeNext(bad)).toBeNull();
  });
});

describe("createInvitation", () => {
  const actor = { id: "u1", name: "Dr Owner" };
  const input = { studyId: STUDY, projectTitle: "My study", email: " Sup@Uni.EDU ", role: "reviewer", label: "supervisor" };
  const made = () => ({ data: { invitation_id: INV, token: TOKEN, expires_at: new Date(Date.now() + 864e5).toISOString() } });

  it("normalises the email, emails the link and records that the provider accepted it", async () => {
    const { db, calls } = fakeDb({ collab_invite: made });
    const send = vi.fn(async () => ({ status: "provider_accepted" as const, id: "re_1" }));
    const r = await createInvitation(db, actor, input, { send });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.delivery).toBe("provider_accepted");
    expect(calls[0].args).toMatchObject({ p_actor: "u1", p_study: STUDY, p_email: "sup@uni.edu", p_role: "reviewer", p_label: "supervisor" });
    const mail = send.mock.calls[0] as unknown as [{ to: string; text: string }];
    expect(mail[0].to).toBe("sup@uni.edu");
    expect(mail[0].text).toContain(`/invite/${TOKEN}`);
    expect(calls.find((c) => c.fn === "collab_set_delivery")?.args).toMatchObject({ p_status: "provider_accepted", p_message_id: "re_1" });
  });

  it("never claims an email was sent when the provider is not configured or fails", async () => {
    for (const result of [{ status: "not_configured" as const, error: "RESEND_API_KEY is not set" }, { status: "failed" as const, error: "Resend responded 500" }]) {
      const { db, calls } = fakeDb({ collab_invite: made });
      const r = await createInvitation(db, actor, input, { send: async () => result });
      expect(r.ok && r.delivery).toBe(result.status);
      expect(r.ok && r.link).toContain(TOKEN); // the owner can still share the link by hand
      expect(calls.find((c) => c.fn === "collab_set_delivery")?.args).toMatchObject({ p_status: result.status, p_message_id: null });
    }
  });

  it("refuses bad input before touching the database, and surfaces plan errors in words", async () => {
    const { db, calls } = fakeDb({ collab_invite: () => ({ error: { message: "role_not_in_plan" } }) });
    expect((await createInvitation(db, actor, { ...input, email: "nope" })).ok).toBe(false);
    expect((await createInvitation(db, actor, { ...input, role: "supervisor" })).ok).toBe(false);
    expect((await createInvitation(db, actor, { ...input, studyId: "x" })).ok).toBe(false);
    expect(calls).toHaveLength(0);
    const r = await createInvitation(db, actor, { ...input, role: "editor" });
    expect(!r.ok && r.error).toMatch(/Pro/);
  });

  it("rate limits one account's invitation attempts per hour", async () => {
    const { db } = fakeDb({ collab_invite: () => ({ error: { message: "already_invited" } }) });
    let last;
    for (let i = 0; i < 31; i++) last = await createInvitation(db, actor, input);
    expect(last && !last.ok && last.error).toMatch(/Too many/);
  });

  it("does not leak the token into the stored delivery record", async () => {
    const { db, calls } = fakeDb({ collab_invite: made });
    await createInvitation(db, actor, input, { send: async () => ({ status: "failed", error: "boom" }) });
    expect(JSON.stringify(calls.find((c) => c.fn === "collab_set_delivery"))).not.toContain(TOKEN);
  });
});

describe("resend and accept", () => {
  it("resend issues a fresh link through the database and emails it", async () => {
    const { db } = fakeDb({ collab_resend: () => ({ data: { invitation_id: INV, token: "b".repeat(64), expires_at: new Date().toISOString(), email: "a@b.co", role: "reviewer" } }) });
    const r = await resendInvitation(db, { id: "u1", name: "O" }, INV, "T", { send: async () => ({ status: "provider_accepted", id: null }) });
    expect(r.ok && r.link).toContain("b".repeat(64));
  });
  it("rejects malformed tokens without calling the database", async () => {
    const { db, calls } = fakeDb({});
    const r = await acceptInvitationByToken(db, "u1", "short");
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it("email text names the role and the expiry and works only for the invited address", () => {
    const m = inviteEmailText({ inviterName: "Dr O", projectTitle: "P", role: "reviewer", link: "https://x/invite/t", expiresAt: "2030-01-15T00:00:00Z" });
    expect(m.text).toMatch(/as a reviewer/);
    expect(m.text).toMatch(/15 January 2030/);
    expect(m.text).toMatch(/only for this email address/);
  });
});

describe("sendEmail", () => {
  it("reports not_configured without a key or sender, never pretending", async () => {
    expect((await sendEmail({ to: "a@b.co", subject: "s", text: "t" }, { env: {} })).status).toBe("not_configured");
    expect((await sendEmail({ to: "a@b.co", subject: "s", text: "t" }, { env: { RESEND_API_KEY: "k" } })).status).toBe("not_configured");
  });
  it("reports provider_accepted only on a 2xx and failed otherwise", async () => {
    const env = { RESEND_API_KEY: "k", COLLAB_FROM_EMAIL: "ToProt <no-reply@x.test>" };
    const ok = await sendEmail({ to: "a@b.co", subject: "s", text: "t" }, { env, fetch: (async () => new Response(JSON.stringify({ id: "re_9" }), { status: 200 })) as typeof fetch });
    expect(ok).toEqual({ status: "provider_accepted", id: "re_9" });
    const bad = await sendEmail({ to: "a@b.co", subject: "s", text: "t" }, { env, fetch: (async () => new Response("no", { status: 422 })) as typeof fetch });
    expect(bad.status).toBe("failed");
    const down = await sendEmail({ to: "a@b.co", subject: "s", text: "t" }, { env, fetch: (async () => { throw new Error("offline"); }) as typeof fetch });
    expect(down.status).toBe("failed");
  });
});
