// Framework-free autosave state machine. A thin React hook (use-section-save.ts) subscribes
// to it. Kept separate so the timing and failure behaviour can be unit tested.

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "error";

export interface AutosaveState {
  status: AutosaveStatus;
  error: string | null;
  savedAt: number | null;
}

export interface SaveOutcome {
  error?: string;
  savedAt?: number;
}

export interface AutosaveOptions<T> {
  /** Persist the payload. Must not throw for expected failures; return { error } instead. */
  save: (payload: T) => Promise<SaveOutcome>;
  /** When false, changes are tracked (dirty) but only saved on an explicit save()/flush(). */
  auto: boolean;
  delayMs?: number;
}

const keyOf = (v: unknown) => JSON.stringify(v);

export class AutosaveController<T> {
  private state: AutosaveState = { status: "idle", error: null, savedAt: null };
  private listeners = new Set<() => void>();
  private latest: T | null = null;
  private latestKey: string | null = null;
  private savedKey: string | null;
  private failedKey: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;

  constructor(
    private readonly opts: AutosaveOptions<T>,
    initial: T | null,
  ) {
    this.savedKey = initial === null ? null : keyOf(initial);
  }

  // Arrow members so they can be handed straight to useSyncExternalStore.
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getState = () => this.state;

  private set(patch: Partial<AutosaveState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule() {
    this.clearTimer();
    this.timer = setTimeout(() => void this.flush(), this.opts.delayMs ?? 1500);
  }

  /** Report the current form value. Call whenever it may have changed; unchanged values are ignored. */
  update(payload: T | null) {
    this.latest = payload;
    this.latestKey = payload === null ? null : keyOf(payload);
    if (payload === null) {
      this.clearTimer();
      return;
    }
    if (this.latestKey === this.savedKey) {
      this.clearTimer();
      if (this.state.status === "dirty") this.set({ status: this.state.savedAt ? "saved" : "idle" });
      return;
    }
    if (this.state.status !== "saving") this.set({ status: "dirty", error: null });
    // Do not hammer the server re-trying a payload that just failed; the user can retry explicitly.
    if (this.opts.auto && this.latestKey !== this.failedKey) this.schedule();
  }

  get dirty() {
    return this.latestKey !== null && this.latestKey !== this.savedKey;
  }

  /** Save the latest value now (also used by the manual button and retry). */
  async flush(): Promise<void> {
    this.clearTimer();
    if (this.latest === null || !this.dirty) return;
    if (this.inFlight) {
      if (this.opts.auto) this.schedule();
      return;
    }
    const payload = this.latest;
    const key = this.latestKey!;
    this.inFlight = true;
    this.set({ status: "saving", error: null });
    let result: SaveOutcome;
    try {
      result = await this.opts.save(payload);
    } catch (e) {
      result = { error: e instanceof Error ? e.message : "Could not save" };
    }
    this.inFlight = false;
    if (result.error) {
      this.failedKey = key;
      this.set({ status: "error", error: result.error });
      return;
    }
    this.savedKey = key;
    this.failedKey = null;
    this.set({ status: this.dirty ? "dirty" : "saved", error: null, savedAt: result.savedAt ?? Date.now() });
    // The user kept typing while this save ran.
    if (this.dirty && this.opts.auto) this.schedule();
  }

  /** On unmount: stop timers and make a best-effort save of anything unsaved (auto mode only). */
  dispose() {
    this.clearTimer();
    if (this.opts.auto && this.dirty && !this.inFlight && this.latest !== null) {
      void this.opts.save(this.latest).catch(() => {});
    }
  }
}
