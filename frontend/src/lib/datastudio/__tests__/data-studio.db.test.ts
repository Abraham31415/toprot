import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminDb } from "@/lib/admin/__tests__/db-harness";
import { makeHelpers } from "@/lib/collab/__tests__/helpers";

// supabase/migrations/20261126090000_data_studio.sql against a scratch Postgres with every migration applied.
let db: AdminDb;
const h = makeHelpers(() => db);
const SUM = "a".repeat(64);

async function dataset(study: string, user: string, name = "Survey") {
  return (await db.pool.query("insert into public.ds_datasets (study_id, name, created_by, source_format) values ($1, $2, $3, 'csv') returning id", [study, name, user])).rows[0].id as string;
}
async function version(ds: string, study: string, no = 1, parent: string | null = null) {
  return (await db.pool.query(
    `insert into public.ds_versions (dataset_id, study_id, version_no, parent_version_id, storage_path, checksum, n_rows, n_cols, bytes, variables, engine_version)
     values ($1, $2, $3, $4, 'p', $5, 10, 2, 100, '[]', 'test') returning id`, [ds, study, no, parent, SUM])).rows[0].id as string;
}

beforeAll(async () => {
  db = await AdminDb.create();
  // Supabase grants these on storage.objects; the scratch database does not.
  await db.pool.query("grant select, insert, update, delete on storage.objects to authenticated, service_role");
}, 180_000);
afterAll(async () => { await db.close(); });

describe("data studio schema", () => {
  it("lets project members read and nobody else", async () => {
    const o = await h.person("Owner"); const s = await h.project(o.id);
    const r = await h.person("Reviewer"); await h.join(o.id, s, r, "reviewer");
    const stranger = await h.person("Stranger");
    const ds = await dataset(s, o.id); await version(ds, s);
    expect((await h.as(o.id, "select id from public.ds_datasets")).length).toBe(1);
    expect((await h.as(r.id, "select id from public.ds_versions")).length).toBe(1);
    expect((await h.as(stranger.id, "select id from public.ds_datasets")).length).toBe(0);
    expect((await h.as(stranger.id, "select id from public.ds_versions")).length).toBe(0);
  });

  it("refuses every browser write, even by the owner", async () => {
    const o = await h.person("Owner2"); const s = await h.project(o.id);
    await expect(h.asWrite(o.id, "insert into public.ds_datasets (study_id, name) values ($1, 'x')", [s])).rejects.toThrow(/permission denied/);
    const ds = await dataset(s, o.id); const v = await version(ds, s);
    await expect(h.asWrite(o.id, "update public.ds_datasets set name = 'y' where id = $1", [ds])).rejects.toThrow(/permission denied/);
    await expect(h.asWrite(o.id, `insert into public.ds_analyses (study_id, dataset_id, version_id, method, title, config, result, status, engine_version)
      values ($1, $2, $3, 'ttest', 't', '{}', '{"p": 0.001}', 'completed', 'forged')`, [s, ds, v])).rejects.toThrow(/permission denied/);
    await expect(h.asWrite(o.id, "select public.ds_meter_analysis($1, $2, 'x')", [o.id, s])).rejects.toThrow(/permission denied/);
  });

  it("keeps versions immutable and consistent", async () => {
    const o = await h.person("Owner3"); const s = await h.project(o.id); const s2 = await h.project(o.id, "Other");
    const ds = await dataset(s, o.id); const v1 = await version(ds, s);
    await expect(db.pool.query("update public.ds_versions set n_rows = 5 where id = $1", [v1])).rejects.toThrow(/ds_version_immutable/);
    await expect(version(ds, s2, 2)).rejects.toThrow(/ds_version_study_mismatch/);
    const other = await dataset(s, o.id, "Other");
    const w1 = await version(other, s);
    await expect(version(ds, s, 2, w1)).rejects.toThrow(/ds_version_parent_mismatch/);
    await expect(version(ds, s, 1)).rejects.toThrow(/duplicate key/);
    const v2 = await version(ds, s, 2, v1);
    expect(v2).toBeTruthy();
  });

  it("keeps analysis results immutable but allows pinning", async () => {
    const o = await h.person("Owner4"); const s = await h.project(o.id);
    const ds = await dataset(s, o.id); const v = await version(ds, s);
    const a = (await db.pool.query(`insert into public.ds_analyses (study_id, dataset_id, version_id, method, title, config, result, status, engine_version)
      values ($1, $2, $3, 'ttest', 't', '{}', '{"p": 0.2}', 'completed', 'e') returning id`, [s, ds, v])).rows[0].id;
    await db.pool.query("update public.ds_analyses set pinned = true, title = 'renamed' where id = $1", [a]);
    await expect(db.pool.query(`update public.ds_analyses set result = '{"p": 0.001}' where id = $1`, [a])).rejects.toThrow(/ds_analysis_immutable/);
    await expect(db.pool.query(`insert into public.ds_analyses (study_id, dataset_id, version_id, method, title, config, result, status, engine_version)
      values ($1, $2, $3, 'ttest', 't', '{}', '{"p": 0.2}', 'failed', 'e')`, [s, ds, v])).rejects.toThrow(/ds_analyses_failed_has_no_result/);
  });

  it("enforces the plan's dataset limit and reads limits from the project's plan", async () => {
    const o = await h.person("FreeOwner"); const s = await h.project(o.id);
    const lim = await db.rpc("ds_project_limits", { p_study: s });
    expect(lim.plan).toBe("free");
    for (let i = 0; i < lim.max_datasets_per_project; i++) await dataset(s, o.id, `d${i}`);
    await expect(dataset(s, o.id, "one too many")).rejects.toThrow(/ds_dataset_limit/);
    // A soft-deleted dataset frees its slot.
    await db.pool.query("update public.ds_datasets set deleted_at = now() where study_id = $1 and name = 'd0'", [s]);
    await dataset(s, o.id, "replacement");
    const p = await h.person("ProOwner", "pro"); const ps = await h.project(p.id);
    const pl = await db.rpc("ds_project_limits", { p_study: ps });
    expect(pl.plan).toBe("pro");
    expect(pl.max_rows).toBeGreaterThan(lim.max_rows);
  });

  it("meters analyses per person per project per day against the plan limit", async () => {
    const o = await h.person("Meter"); const s = await h.project(o.id);
    await db.pool.query("update public.ds_plan_limits set max_analyses_per_day = 2 where plan_key = 'free'");
    try {
      expect((await db.rpc("ds_meter_analysis", { p_actor: o.id, p_study: s, p_method: "describe" })).ok).toBe(true);
      expect((await db.rpc("ds_meter_analysis", { p_actor: o.id, p_study: s, p_method: "describe", p_failed: true })).ok).toBe(true);
      const third = await db.rpc("ds_meter_analysis", { p_actor: o.id, p_study: s, p_method: "describe" });
      expect(third).toMatchObject({ ok: false, used: 2, limit: 2 });
      const overview = await db.rpc("ds_admin_overview", { p_days: 1 });
      expect(overview.analyses_failed).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(overview)).not.toContain(o.id);
    } finally {
      await db.pool.query("update public.ds_plan_limits set max_analyses_per_day = 60 where plan_key = 'free'");
    }
  });

  it("lets editors upload only into their own folder of a project they can write", async () => {
    const o = await h.person("UpOwner"); const s = await h.project(o.id);
    const viewer = await h.person("UpViewer"); await h.join(o.id, s, viewer, "reviewer");
    await h.asWrite(o.id, "insert into storage.objects (bucket_id, name) values ('ds-uploads', $1)", [`${s}/${o.id}/a.csv`]);
    await expect(h.asWrite(o.id, "insert into storage.objects (bucket_id, name) values ('ds-uploads', $1)", [`${s}/${viewer.id}/a.csv`])).rejects.toThrow(/row-level security/);
    await expect(h.asWrite(viewer.id, "insert into storage.objects (bucket_id, name) values ('ds-uploads', $1)", [`${s}/${viewer.id}/a.csv`])).rejects.toThrow(/row-level security/);
    await expect(h.asWrite(o.id, "insert into storage.objects (bucket_id, name) values ('ds-data', $1)", [`${s}/x.json.gz`])).rejects.toThrow(/row-level security/);
  });
});
