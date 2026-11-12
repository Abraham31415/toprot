import { beforeEach, describe, expect, it, vi } from "vitest";

// The access guard is tested with a stand-in for the sign-in service and the admin table, so every way in is exercised without a network.
const world = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  role: null as string | null,
  aal: "aal1" as string | null,
  rpcError: null as { message: string; code?: string } | null,
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${to};307;`, to }); },
  notFound: () => { throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }); },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: world.user } }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: world.aal } }) },
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: world.role ? { role: world.role } : null }) }) }) }),
    rpc: async (fn: string, args: Record<string, unknown>) => { world.rpcCalls.push({ fn, args }); return world.rpcError ? { data: null, error: world.rpcError } : { data: { ok: true }, error: null }; },
  }),
}));

import { AdminActionError, adminRpc, getAdminSession, mfaRequired, requestIp, requireAdmin, requireAdminWrite, runAdminAction } from "../auth";

const thrown = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (e) { return e as { digest?: string; to?: string; message: string }; } return null; };

beforeEach(() => {
  world.user = { id: "u1", email: "owner@example.org" }; world.role = "admin"; world.aal = "aal2"; world.rpcError = null; world.rpcCalls = [];
  vi.unstubAllEnvs();
});

describe("who may open the admin console", () => {
  it("sends a signed-out visitor to the login page", async () => {
    world.user = null;
    expect((await thrown(requireAdmin))?.to).toBe("/login");
  });
  it("gives a signed-in account that is not an administrator a 404, not a redirect or a message", async () => {
    world.role = null;
    expect((await thrown(requireAdmin))?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect((await thrown(getAdminSession))?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });
  it("makes an administrator without a verified second step verify first", async () => {
    world.aal = "aal1";
    expect((await thrown(requireAdmin))?.to).toBe("/admin/security");
    world.aal = null;
    expect((await thrown(requireAdmin))?.to).toBe("/admin/security");
  });
  it("lets a verified administrator in, and exposes their role", async () => {
    const s = await requireAdmin();
    expect(s).toMatchObject({ userId: "u1", email: "owner@example.org", role: "admin", aal: "aal2", mfaRequired: true });
  });
  it("skips the second step only when it is switched off on the server", async () => {
    vi.stubEnv("ADMIN_MFA_REQUIRED", "false");
    world.aal = "aal1";
    expect(mfaRequired()).toBe(false);
    expect((await requireAdmin()).userId).toBe("u1");
    vi.stubEnv("ADMIN_MFA_REQUIRED", "");
    expect(mfaRequired()).toBe(true);
    vi.stubEnv("ADMIN_MFA_REQUIRED", "no");
    expect(mfaRequired()).toBe(true); // only the exact word false turns it off
  });
  it("lets the security page load without the second step, but still needs an administrator", async () => {
    world.aal = "aal1";
    expect((await getAdminSession()).aal).toBe("aal1");
    world.role = null;
    expect((await thrown(getAdminSession))?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });
  it("refuses changes from a read-only administrator before the database is asked", async () => {
    world.role = "viewer";
    await expect(requireAdminWrite()).rejects.toBeInstanceOf(AdminActionError);
    expect((await requireAdmin()).role).toBe("viewer");
    world.role = "owner";
    expect((await requireAdminWrite()).role).toBe("owner");
  });
});

describe("running an admin action", () => {
  it("passes the administrator's id to the database on every call", async () => {
    const s = await requireAdmin();
    await adminRpc(s, "admin_overview", { p_tz: "UTC" });
    expect(world.rpcCalls[0]).toEqual({ fn: "admin_overview", args: { p_actor: "u1", p_tz: "UTC" } });
  });
  it("turns a database refusal into a plain message", async () => {
    const s = await requireAdmin();
    world.rpcError = { message: "reason_required" };
    await expect(adminRpc(s, "admin_set_suspension", {})).rejects.toThrow(/reason/i);
    world.rpcError = { message: "not_admin" };
    await expect(adminRpc(s, "admin_set_suspension", {})).rejects.toThrow(/not an administrator/);
  });
  it("returns a form-friendly result, hides unexpected failures, and lets redirects and 404s through", async () => {
    expect(await runAdminAction(async () => "Done")).toEqual({ ok: true, message: "Done" });
    expect(await runAdminAction(async () => { throw new AdminActionError("Nope"); })).toEqual({ ok: false, error: "Nope" });
    const r = await runAdminAction(async () => { throw new Error("relation secret_table does not exist"); });
    expect(r).toEqual({ ok: false, error: "The change could not be made. Nothing was changed." });
    world.user = null;
    await expect(runAdminAction(async () => { await requireAdmin(); return "x"; })).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_REDIRECT") });
    world.user = { id: "u1", email: "a" }; world.role = null;
    await expect(runAdminAction(async () => { await requireAdmin(); return "x"; })).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  });
  it("reads the caller's address from the first forwarded entry", async () => {
    expect(await requestIp()).toBe("198.51.100.7");
  });
});
