import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatBytes, inviteToTeam, isTeamInviteRole, teamCan, teamError, teamInviteText } from "../teams";
import { acceptedPath, type DbLike } from "../service";
import { resetRateLimits } from "@/lib/rate-limit";

const TEAM = "11111111-1111-4111-8111-111111111111";
beforeEach(() => resetRateLimits());

function fakeDb(handler: (fn: string) => { data?: unknown; error?: { message: string } }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return { calls, db: { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return handler(fn); } } as unknown as DbLike };
}

describe("team capabilities", () => {
  it("lets only the owner appoint administrators and gives guests nothing", () => {
    expect(teamCan("owner", "appoint_admin")).toBe(true);
    expect(teamCan("administrator", "appoint_admin")).toBe(false);
    expect(teamCan("administrator", "invite")).toBe(true);
    expect(teamCan("member", "invite")).toBe(false);
    expect(teamCan("member", "create_project")).toBe(true);
    for (const cap of ["view_dashboard", "create_project", "invite", "upload_documents", "share_references"] as const) expect(teamCan("guest", cap)).toBe(false);
    expect(teamCan(null, "view_dashboard")).toBe(false);
  });
  it("does not allow inviting an owner", () => {
    expect(isTeamInviteRole("owner")).toBe(false);
    expect(isTeamInviteRole("guest")).toBe(true);
  });
});

describe("messages and formatting", () => {
  it("explains seat and ownership refusals", () => {
    expect(teamError("no_paid_seat")).toMatch(/paid seat/);
    expect(teamError("owns_team_projects")).toMatch(/Transfer/);
    expect(teamError("team_seat_required")).toMatch(/reviewers/);
    expect(teamError("something else", )).not.toMatch(/something else/);
  });
  it("formats sizes", () => {
    expect(formatBytes(500)).toBe("500 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1048576)).toBe("5.0 MB");
  });
  it("says joining a team grants no project access", () => {
    expect(teamInviteText({ inviterName: "A", teamName: "Lab", role: "member", link: "https://x/invite/t", expiresAt: "2030-01-01T00:00:00Z" }).text).toMatch(/does not give you access to any project/);
  });
  it("sends accepted invitations to the right place", () => {
    expect(acceptedPath({ kind: "team", team_id: TEAM })).toBe(`/teams/${TEAM}`);
    expect(acceptedPath({ kind: "project", study_id: TEAM })).toBe(`/studies/${TEAM}/protocol`);
    expect(acceptedPath({})).toBe("/shared");
  });
});

describe("inviteToTeam", () => {
  const actor = { id: "u1", name: "Dr O" };
  it("records provider acceptance only when the provider accepted", async () => {
    const { db, calls } = fakeDb((fn) => fn === "team_invite" ? { data: { invitation_id: TEAM, token: "t".repeat(64), expires_at: new Date().toISOString(), email: "a@b.co", role: "guest" } } : { data: null });
    const ok = await inviteToTeam(db, actor, TEAM, "Lab", "A@B.co", "guest", vi.fn(async () => ({ status: "provider_accepted" as const, id: "re_1" })));
    expect(ok.ok && ok.delivery).toBe("provider_accepted");
    const down = await inviteToTeam(db, actor, TEAM, "Lab", "c@d.co", "guest", vi.fn(async () => ({ status: "not_configured" as const, error: "no key" })));
    expect(down.ok && down.delivery).toBe("not_configured");
    expect(calls.filter((c) => c.fn === "team_set_delivery").map((c) => c.args.p_status)).toEqual(["provider_accepted", "not_configured"]);
  });
  it("validates input and surfaces seat errors", async () => {
    const { db, calls } = fakeDb(() => ({ error: { message: "no_guest_seat" } }));
    expect((await inviteToTeam(db, actor, TEAM, "Lab", "bad", "member")).ok).toBe(false);
    expect((await inviteToTeam(db, actor, TEAM, "Lab", "a@b.co", "owner")).ok).toBe(false);
    expect(calls).toHaveLength(0);
    const r = await inviteToTeam(db, actor, TEAM, "Lab", "a@b.co", "guest");
    expect(!r.ok && r.error).toMatch(/guest seat/);
  });
});
