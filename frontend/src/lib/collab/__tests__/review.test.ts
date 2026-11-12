import { describe, expect, it } from "vitest";
import { addComment, decide, getOverview, isSection, reviewError, sectionLabel, submitForReview, REVIEW_DISCLAIMER, STATUS_LABEL } from "../review";
import type { DbLike } from "../service";

const STUDY = "11111111-1111-4111-8111-111111111111";
const THREAD = "33333333-3333-4333-8333-333333333333";

function fakeDb(result: { data?: unknown; error?: { message: string } } = { data: null }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  return { db: { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return result; } } as unknown as DbLike, calls };
}

describe("review helpers", () => {
  it("says plainly that this is not ethics approval", () => {
    expect(REVIEW_DISCLAIMER).toMatch(/not ethics committee approval/);
    expect(REVIEW_DISCLAIMER).toMatch(/internal/i);
  });
  it("names every workflow stage in order", () => {
    expect(Object.values(STATUS_LABEL)).toEqual(["Draft", "Submitted", "Under review", "Changes requested", "Resubmitted", "Approved"]);
  });
  it("validates comment sections and labels them", () => {
    expect(isSection("general")).toBe(true);
    expect(isSection("protocol:research_question")).toBe(true);
    expect(isSection(`manuscript:${STUDY}`)).toBe(true);
    for (const bad of ["protocol:Bad", "protocol:", "x", "manuscript:abc", 3, null]) expect(isSection(bad)).toBe(false);
    expect(sectionLabel("protocol:research_question")).toBe("Research question");
    expect(sectionLabel(`manuscript:${STUDY}`, [{ id: STUDY, title: "Thesis" }])).toBe("Thesis");
  });
  it("turns database codes into advice and hides unknown errors", () => {
    expect(reviewError("review_in_progress")).toMatch(/part-way/);
    expect(reviewError("confirmation_required")).toMatch(/Confirm/);
    expect(reviewError("weird internal failure at 10.1.1.1", )).not.toMatch(/10\.1\.1\.1/);
  });
});

describe("review wrappers", () => {
  it("sends the confirmation flag only when it is exactly true", async () => {
    const a = fakeDb();
    await decide(a.db, "u", STUDY, "approved", { confirm: true, statement: "ok" });
    expect(a.calls[0].args).toMatchObject({ p_confirm: true, p_statement: "ok" });
    const b = fakeDb();
    await decide(b.db, "u", STUDY, "approved", { confirm: "yes" as unknown as boolean });
    expect(b.calls[0].args.p_confirm).toBe(false);
  });
  it("rejects unknown decisions and bad ids before calling the database", async () => {
    const { db, calls } = fakeDb();
    expect((await decide(db, "u", STUDY, "reopened" as never)).ok).toBe(false);
    expect((await decide(db, "u", "nope", "approved")).ok).toBe(false);
    expect((await submitForReview(db, "u", "nope", null)).ok).toBe(false);
    expect((await addComment(db, "u", STUDY, "bad section", "hi", null)).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it("passes comments through and surfaces database refusals in words", async () => {
    const { db, calls } = fakeDb();
    expect((await addComment(db, "u", STUDY, "general", "Looks good", THREAD)).ok).toBe(true);
    expect(calls[0]).toMatchObject({ fn: "collab_comment_add", args: { p_thread: THREAD } });
    const denied = fakeDb({ error: { message: "not_allowed" } });
    const r = await submitForReview(denied.db, "u", STUDY, "note");
    expect(!r.ok && r.error).toMatch(/permission/);
    const ov = await getOverview(fakeDb({ error: { message: "forbidden" } }).db, "u", STUDY);
    expect(ov.ok).toBe(false);
  });
});
