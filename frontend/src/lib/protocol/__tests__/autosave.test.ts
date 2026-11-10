import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutosaveController, type SaveOutcome } from "../autosave";

type P = { a: string };
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function make(auto = true, save?: (p: P) => Promise<SaveOutcome>) {
  const fn = vi.fn(save ?? (async () => ({ savedAt: 1000 })));
  const c = new AutosaveController<P>({ save: fn, auto, delayMs: 1500 }, { a: "start" });
  return { c, fn };
}

describe("AutosaveController", () => {
  it("does not save an unchanged initial value", async () => {
    const { c, fn } = make();
    c.update({ a: "start" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).not.toHaveBeenCalled();
    expect(c.getState().status).toBe("idle");
  });

  it("marks dirty immediately and saves once after the debounce", async () => {
    const { c, fn } = make();
    c.update({ a: "x" });
    expect(c.getState().status).toBe("dirty");
    await vi.advanceTimersByTimeAsync(1499);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ a: "x" });
    expect(c.getState()).toMatchObject({ status: "saved", savedAt: 1000, error: null });
  });

  it("coalesces rapid edits into one save of the latest value", async () => {
    const { c, fn } = make();
    for (const v of ["a", "ab", "abc"]) {
      c.update({ a: v });
      await vi.advanceTimersByTimeAsync(500);
    }
    await vi.advanceTimersByTimeAsync(2000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith({ a: "abc" });
  });

  it("edits made while a save is in flight are saved afterwards, in order", async () => {
    let release!: () => void;
    const calls: string[] = [];
    const { c } = make(true, (p) => {
      calls.push(p.a);
      return calls.length === 1 ? new Promise((r) => (release = () => r({ savedAt: 1 }))) : Promise.resolve({ savedAt: 2 });
    });
    c.update({ a: "one" });
    await vi.advanceTimersByTimeAsync(1600); // first save now in flight
    c.update({ a: "two" });
    expect(c.getState().status).toBe("saving");
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(c.getState().status).toBe("dirty"); // "two" still unsaved
    await vi.advanceTimersByTimeAsync(1600);
    expect(calls).toEqual(["one", "two"]);
    expect(c.getState().status).toBe("saved");
  });

  it("never runs two saves at once", async () => {
    let active = 0, peak = 0;
    const { c } = make(true, async () => {
      active++; peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 3000));
      active--; return { savedAt: 1 };
    });
    c.update({ a: "1" });
    await vi.advanceTimersByTimeAsync(1600);
    c.update({ a: "2" });
    await vi.advanceTimersByTimeAsync(1600); // debounce fires while first still running
    await vi.advanceTimersByTimeAsync(10000);
    expect(peak).toBe(1);
  });

  it("surfaces an error, does not retry in a loop, and recovers on explicit retry", async () => {
    let fail = true;
    const { c, fn } = make(true, async () => (fail ? { error: "network" } : { savedAt: 5 }));
    c.update({ a: "x" });
    await vi.advanceTimersByTimeAsync(1600);
    expect(c.getState()).toMatchObject({ status: "error", error: "network" });
    c.update({ a: "x" }); // same failing value re-reported by a re-render
    await vi.advanceTimersByTimeAsync(20000);
    expect(fn).toHaveBeenCalledTimes(1); // no hammering
    fail = false;
    await c.flush();
    expect(c.getState()).toMatchObject({ status: "saved", error: null });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("a thrown save is reported as an error instead of crashing", async () => {
    const { c } = make(true, async () => { throw new Error("boom"); });
    c.update({ a: "x" });
    await vi.advanceTimersByTimeAsync(1600);
    expect(c.getState()).toMatchObject({ status: "error", error: "boom" });
  });

  it("a new edit after a failure is tried again automatically", async () => {
    let fail = true;
    const { c, fn } = make(true, async () => (fail ? { error: "x" } : { savedAt: 1 }));
    c.update({ a: "one" });
    await vi.advanceTimersByTimeAsync(1600);
    fail = false;
    c.update({ a: "two" });
    await vi.advanceTimersByTimeAsync(1600);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(c.getState().status).toBe("saved");
  });

  it("manual mode tracks unsaved changes but never saves by itself", async () => {
    const { c, fn } = make(false);
    c.update({ a: "x" });
    await vi.advanceTimersByTimeAsync(60000);
    expect(fn).not.toHaveBeenCalled();
    expect(c.dirty).toBe(true);
    expect(c.getState().status).toBe("dirty");
    await c.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(c.dirty).toBe(false);
  });

  it("dispose saves unsaved changes in auto mode (leaving the section does not lose edits)", async () => {
    const { c, fn } = make(true);
    c.update({ a: "typed just before switching section" });
    c.dispose();
    await settle();
    expect(fn).toHaveBeenCalledWith({ a: "typed just before switching section" });
  });

  it("dispose does not save in manual mode and does not save when nothing changed", async () => {
    const manual = make(false);
    manual.c.update({ a: "x" });
    manual.c.dispose();
    const clean = make(true);
    clean.c.dispose();
    await settle();
    expect(manual.fn).not.toHaveBeenCalled();
    expect(clean.fn).not.toHaveBeenCalled();
  });

  it("read-only (null payload) never saves", async () => {
    const { c, fn } = make();
    c.update(null);
    await vi.advanceTimersByTimeAsync(10000);
    c.dispose();
    expect(fn).not.toHaveBeenCalled();
  });

  it("reverting to the saved value cancels the pending save", async () => {
    const { c, fn } = make();
    c.update({ a: "x" });
    await vi.advanceTimersByTimeAsync(500);
    c.update({ a: "start" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(fn).not.toHaveBeenCalled();
    expect(c.dirty).toBe(false);
  });
});
