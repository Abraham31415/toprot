// Server-only Data Studio helpers: limits, version storage and retrieval. Every function here is called after the caller's project role
// has been checked (requireProject). Writes use the service role because the browser may not write these tables or the data bucket.

import { createAdminClient } from "@/lib/supabase/admin";
import { decodeDataset, encodeDataset } from "./codec";
import { TIER_RANK, type Tier } from "./engine/registry";
import type { Operation } from "./transform";
import { ENGINE_VERSION, DataError, nRows, type Dataset } from "./types";

export type Limits = {
  plan: string; max_datasets_per_project: number; max_rows: number; max_columns: number; max_upload_bytes: number;
  max_project_storage_bytes: number; max_versions_per_dataset: number; max_analyses_per_day: number; method_tier: Tier; exports: string[];
};

export type VersionRow = {
  id: string; dataset_id: string; study_id: string; version_no: number; parent_version_id: string | null; storage_path: string; checksum: string;
  n_rows: number; n_cols: number; bytes: number; variables: unknown; operations: Operation[]; change_description: string; engine_version: string;
  created_by: string | null; created_at: string; import_report: unknown;
};

export const admin = () => createAdminClient();

export async function projectLimits(studyId: string): Promise<Limits> {
  const { data, error } = await admin().rpc("ds_project_limits", { p_study: studyId });
  if (error || !data) throw new DataError("Data Studio limits could not be loaded. Try again shortly.");
  return data as Limits;
}

export function tierAllows(limits: Limits, tier: Tier): boolean { return TIER_RANK[limits.method_tier] >= TIER_RANK[tier]; }

// Versions are immutable, so a decoded version can be cached by id safely. Small LRU bounded by cell count.
const cache = new Map<string, { d: Dataset; cells: number }>();
const MAX_CACHED_CELLS = 3_000_000;
function remember(id: string, d: Dataset) {
  const cells = nRows(d) * d.variables.length;
  if (cells > MAX_CACHED_CELLS) return;
  cache.delete(id); cache.set(id, { d, cells });
  let total = [...cache.values()].reduce((s, x) => s + x.cells, 0);
  for (const k of cache.keys()) { if (total <= MAX_CACHED_CELLS) break; total -= cache.get(k)!.cells; cache.delete(k); }
}

export async function getVersion(studyId: string, datasetId: string, versionId?: string | null): Promise<VersionRow> {
  const db = admin();
  const { data: ds } = await db.from("ds_datasets").select("id, current_version_id, deleted_at").eq("id", datasetId).eq("study_id", studyId).maybeSingle();
  if (!ds || ds.deleted_at) throw new DataError("This dataset does not exist or was deleted.");
  const vid = versionId ?? ds.current_version_id;
  if (!vid) throw new DataError("This dataset has no saved version.");
  const { data: v } = await db.from("ds_versions").select("*").eq("id", vid).eq("dataset_id", datasetId).maybeSingle();
  if (!v) throw new DataError("That version does not exist.");
  return v as VersionRow;
}

export async function loadVersionData(v: VersionRow): Promise<Dataset> {
  const hit = cache.get(v.id);
  if (hit) { cache.delete(v.id); cache.set(v.id, hit); return hit.d; }
  const { data, error } = await admin().storage.from("ds-data").download(v.storage_path);
  if (error || !data) throw new DataError("The dataset file could not be read from storage.");
  const d = await decodeDataset(new Uint8Array(await data.arrayBuffer()), v.checksum);
  remember(v.id, d);
  return d;
}

/**
 * The whole version is sent to the browser for the spreadsheet, profile and previews, so a version may hold at most this many cells
 * whatever the plan says (100,000 rows x 30 variables, or 10,000 x 300). Larger studies need server-side paging, which is not built.
 */
export const MAX_CELLS = 3_000_000;

/** Checks a dataset against the project's plan limits before it is stored. */
export async function checkSize(studyId: string, d: Dataset, limits: Limits, extraBytes: number): Promise<void> {
  if (nRows(d) * d.variables.length > MAX_CELLS) throw new DataError(`The dataset has ${(nRows(d) * d.variables.length).toLocaleString("en-GB")} cells; Data Studio handles up to ${MAX_CELLS.toLocaleString("en-GB")} (rows × variables) per dataset. Keep only the variables you need, or split the data.`);
  if (nRows(d) > limits.max_rows) throw new DataError(`The result has ${nRows(d).toLocaleString("en-GB")} rows; this project's plan allows ${limits.max_rows.toLocaleString("en-GB")}.`);
  if (d.variables.length > limits.max_columns) throw new DataError(`The result has ${d.variables.length} variables; this project's plan allows ${limits.max_columns}.`);
  const { data } = await admin().rpc("ds_project_bytes", { p_study: studyId });
  const used = Number(data ?? 0);
  if (used + extraBytes > limits.max_project_storage_bytes) throw new DataError(`This project's Data Studio storage is full (${(used / 1048576).toFixed(1)} of ${(limits.max_project_storage_bytes / 1048576).toFixed(0)} MB). Delete old datasets or upgrade the plan.`);
}

/** Encodes and stores a new immutable version, then makes it current. Returns the new version row. */
export async function writeVersion(opts: {
  studyId: string; datasetId: string; userId: string; data: Dataset; parent: VersionRow | null; operations: Operation[];
  description: string; importReport?: unknown; limits: Limits;
}): Promise<VersionRow> {
  const db = admin();
  const { gz, checksum } = await encodeDataset(opts.data);
  await checkSize(opts.studyId, opts.data, opts.limits, gz.length);
  const { count } = await db.from("ds_versions").select("id", { count: "exact", head: true }).eq("dataset_id", opts.datasetId);
  if ((count ?? 0) >= opts.limits.max_versions_per_dataset) throw new DataError(`This dataset has reached the plan's limit of ${opts.limits.max_versions_per_dataset} versions. Save a cleaned copy as a new dataset, or upgrade.`);
  const versionNo = (opts.parent?.version_no ?? 0) + 1;
  const id = crypto.randomUUID();
  const path = `${opts.studyId}/${opts.datasetId}/${id}.json.gz`;
  const up = await db.storage.from("ds-data").upload(path, gz, { contentType: "application/gzip", upsert: false });
  if (up.error) throw new DataError("The dataset could not be saved to storage. Nothing was changed.");
  const { data: row, error } = await db.from("ds_versions").insert({
    id, dataset_id: opts.datasetId, study_id: opts.studyId, version_no: versionNo, parent_version_id: opts.parent?.id ?? null, storage_path: path, checksum,
    n_rows: nRows(opts.data), n_cols: opts.data.variables.length, bytes: gz.length, variables: opts.data.variables, operations: opts.operations,
    change_description: opts.description.slice(0, 500), import_report: opts.importReport ?? null, engine_version: ENGINE_VERSION, created_by: opts.userId,
  }).select("*").single();
  if (error || !row) {
    await db.storage.from("ds-data").remove([path]);
    throw new DataError(error?.message.includes("duplicate key") ? "Someone else saved a new version at the same moment. Reload and try again." : "The version could not be recorded. Nothing was changed.");
  }
  // Compare-and-set: only move "current" forward from the parent we started from, so concurrent editors cannot overwrite each other.
  let q = db.from("ds_datasets").update({ current_version_id: id, updated_at: new Date().toISOString() }).eq("id", opts.datasetId);
  q = opts.parent ? q.eq("current_version_id", opts.parent.id) : q.is("current_version_id", null);
  const { data: moved } = await q.select("id");
  if (!moved?.length) throw new DataError("Someone else saved a newer version while you were working. Your changes were kept as a separate version; reload to see both in the history.");
  remember(id, opts.data);
  return row as VersionRow;
}

export async function audit(studyId: string, userId: string, action: string, meta: Record<string, unknown>) {
  await admin().rpc("collab_log", { p_study: studyId, p_actor: userId, p_action: action, p_target: null, p_meta: meta }).then(() => undefined, () => undefined);
}

export async function usage(studyId: string, userId: string, kind: "import" | "version" | "export", extra: { bytes?: number; method?: string; duration_ms?: number } = {}) {
  await admin().from("ds_usage").insert({ study_id: studyId, user_id: userId, kind, bytes: extra.bytes ?? 0, method: extra.method ?? null, duration_ms: extra.duration_ms ?? 0 }).then(() => undefined, () => undefined);
}
