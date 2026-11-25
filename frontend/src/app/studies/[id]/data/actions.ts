"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireProject } from "@/lib/collab/access";
import { isUuid } from "@/lib/collab/roles";
import { checkRateLimit } from "@/lib/rate-limit";
import { AnalysisError, type AnalysisResult } from "@/lib/datastudio/engine/common";
import { checkMethodAccess } from "@/lib/datastudio/entitlements";
import { runAnalysis } from "@/lib/datastudio/engine/run";
import { parseFile, formatOf, type ImportOptions } from "@/lib/datastudio/parse";
import { applyAll, appendDatasets, mergeDatasets, OperationSchema, type Operation } from "@/lib/datastudio/transform";
import { admin, audit, getVersion, loadVersionData, projectLimits, usage, writeVersion, type Limits, type VersionRow } from "@/lib/datastudio/server";
import { ENGINE_VERSION, DataError, type Dataset } from "@/lib/datastudio/types";

// Every action: (1) authenticates from the session cookie, (2) checks the project role on the server (lib/collab/access.ts, backed by the
// same database function as row level security), (3) validates input, (4) recomputes anything it stores. Errors come back as plain text.

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => {
  if (e instanceof DataError) return { ok: false, error: e.message };
  console.error(JSON.stringify({ evt: "datastudio_error", message: (e as Error)?.message }));
  return { ok: false, error: "Something went wrong. Nothing was changed. Try again." };
};
const path = (studyId: string) => `/studies/${studyId}/data`;

async function writer(studyId: string) {
  if (!isUuid(studyId)) throw new DataError("Invalid project.");
  const a = await requireProject(studyId, "write");
  if (!a.ok) throw new DataError(a.error);
  return a;
}
async function reader(studyId: string) {
  if (!isUuid(studyId)) throw new DataError("Invalid project.");
  const a = await requireProject(studyId, "read");
  if (!a.ok) throw new DataError(a.error);
  return a;
}

// --- Limits and upload ------------------------------------------------------------------------------------------------------------

export async function getLimits(studyId: string): Promise<Result<Limits>> {
  try { await reader(studyId); return { ok: true, data: await projectLimits(studyId) }; } catch (e) { return fail(e); }
}

/** Reserves an upload location. The browser then uploads the file straight to Storage (row level security allows only this folder). */
export async function prepareUpload(studyId: string, filename: string, size: number): Promise<Result<{ path: string }>> {
  try {
    const a = await writer(studyId);
    if (!checkRateLimit(`ds-upload:${a.userId}`, { limit: 20, windowMs: 60_000 }).ok) throw new DataError("Too many uploads in a short time. Wait a minute and try again.");
    formatOf(filename);
    const limits = await projectLimits(studyId);
    if (!(size > 0) || size > limits.max_upload_bytes) throw new DataError(`Files can be up to ${(limits.max_upload_bytes / 1048576).toFixed(0)} MB on this project's plan.`);
    const ext = filename.toLowerCase().split(".").pop();
    return { ok: true, data: { path: `${studyId}/${a.userId}/${crypto.randomUUID()}.${ext}` } };
  } catch (e) { return fail(e); }
}

const ImportOptionsSchema = z.object({
  header: z.boolean().optional(), delimiter: z.enum([",", "\t", ";", "|"]).optional(), encoding: z.enum(["utf-8", "utf-16le", "utf-16be", "windows-1252"]).optional(),
  sheet: z.string().max(100).optional(), missingTokens: z.array(z.string().max(30)).max(50).optional(), dateOrder: z.enum(["dmy", "mdy"]).optional(),
  decimalComma: z.boolean().optional(), skipRows: z.number().int().min(0).max(1000).optional(),
  typeOverrides: z.record(z.string().regex(/^\d+$/), z.enum(["numeric", "string", "date"])).optional(),
}).strict();

export async function importDataset(studyId: string, input: { path: string; filename: string; name: string; description?: string; options?: ImportOptions }): Promise<Result<{ datasetId: string; warnings: string[] }>> {
  const t0 = Date.now();
  try {
    const a = await writer(studyId);
    const name = input.name.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!name) throw new DataError("Give the dataset a name.");
    // The upload must be one this user just made for this project.
    if (!input.path.startsWith(`${studyId}/${a.userId}/`) || input.path.includes("..")) throw new DataError("Invalid upload.");
    const opts = ImportOptionsSchema.parse(input.options ?? {}) as ImportOptions;
    const limits = await projectLimits(studyId);
    const db = admin();
    const { data: blob, error } = await db.storage.from("ds-uploads").download(input.path);
    if (error || !blob) throw new DataError("The uploaded file could not be found. Upload it again.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let parsed;
    try {
      parsed = await parseFile(bytes, input.filename, opts, { maxRows: limits.max_rows, maxColumns: limits.max_columns, maxBytes: limits.max_upload_bytes });
    } finally {
      await db.storage.from("ds-uploads").remove([input.path]); // raw uploads are never kept
    }
    const fmt = formatOf(input.filename);
    const { data: ds, error: dsErr } = await db.from("ds_datasets").insert({ study_id: studyId, name, description: (input.description ?? "").slice(0, 2000), source_filename: input.filename.slice(0, 255), source_format: fmt, created_by: a.userId }).select("id").single();
    if (dsErr || !ds) throw new DataError(dsErr?.message.includes("ds_dataset_limit") ? `This project has reached its plan's limit of ${limits.max_datasets_per_project} datasets. Delete one or upgrade.` : "The dataset could not be created.");
    try {
      await writeVersion({ studyId, datasetId: ds.id, userId: a.userId, data: parsed.dataset, parent: null, operations: [], description: `Imported from ${input.filename}`, importReport: { ...parsed.report, warnings: parsed.warnings }, limits });
    } catch (e) {
      await db.from("ds_datasets").delete().eq("id", ds.id);
      throw e;
    }
    await usage(studyId, a.userId, "import", { bytes: bytes.length, duration_ms: Date.now() - t0 });
    await audit(studyId, a.userId, "ds_import", { dataset: ds.id, rows: parsed.report.rows, columns: parsed.report.columns, format: fmt });
    revalidatePath(path(studyId));
    return { ok: true, data: { datasetId: ds.id, warnings: parsed.warnings.map((w) => w.text) } };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: "Invalid import options." };
    return fail(e);
  }
}

/** Creates an empty dataset to type data into. */
export async function createBlankDataset(studyId: string, name: string, columns: { name: string; type: "numeric" | "string" | "date" }[]): Promise<Result<{ datasetId: string }>> {
  try {
    const a = await writer(studyId);
    const limits = await projectLimits(studyId);
    const nm = name.trim().slice(0, 120);
    if (!nm) throw new DataError("Give the dataset a name.");
    if (!columns.length) throw new DataError("Add at least one variable.");
    const d: Dataset = { variables: columns.map((c) => ({ name: c.name, type: c.type, measure: c.type === "string" ? "nominal" : "scale", role: "none" })), columns: columns.map(() => Array(10).fill(null)) };
    const db = admin();
    const { data: ds, error } = await db.from("ds_datasets").insert({ study_id: studyId, name: nm, source_format: "manual", created_by: a.userId }).select("id").single();
    if (error || !ds) throw new DataError(error?.message.includes("ds_dataset_limit") ? `This project has reached its plan's limit of ${limits.max_datasets_per_project} datasets.` : "The dataset could not be created.");
    try { await writeVersion({ studyId, datasetId: ds.id, userId: a.userId, data: d, parent: null, operations: [], description: "Created empty dataset", limits }); }
    catch (e) { await db.from("ds_datasets").delete().eq("id", ds.id); throw e; }
    await audit(studyId, a.userId, "ds_create", { dataset: ds.id });
    revalidatePath(path(studyId));
    return { ok: true, data: { datasetId: ds.id } };
  } catch (e) { return fail(e); }
}

// --- Reading -----------------------------------------------------------------------------------------------------------------------

export type VersionMeta = Pick<VersionRow, "id" | "version_no" | "parent_version_id" | "checksum" | "n_rows" | "n_cols" | "bytes" | "operations" | "change_description" | "created_at" | "created_by" | "engine_version" | "import_report">;

export async function loadDataset(studyId: string, datasetId: string, versionId?: string): Promise<Result<{ dataset: Dataset; version: VersionMeta; canWrite: boolean; limits: Limits }>> {
  try {
    const a = await reader(studyId);
    if (!isUuid(datasetId) || (versionId && !isUuid(versionId))) throw new DataError("Invalid dataset.");
    const v = await getVersion(studyId, datasetId, versionId);
    const dataset = await loadVersionData(v);
    const { storage_path: _p, dataset_id: _d, study_id: _s, variables: _v, ...meta } = v; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ok: true, data: { dataset, version: meta as VersionMeta, canWrite: a.canWrite, limits: await projectLimits(studyId) } };
  } catch (e) { return fail(e); }
}

// --- Writing versions ------------------------------------------------------------------------------------------------------------------

export async function saveVersion(studyId: string, datasetId: string, parentVersionId: string, ops: Operation[], description: string): Promise<Result<{ versionId: string; versionNo: number; summaries: string[] }>> {
  const t0 = Date.now();
  try {
    const a = await writer(studyId);
    if (!isUuid(datasetId) || !isUuid(parentVersionId)) throw new DataError("Invalid dataset.");
    if (!Array.isArray(ops) || ops.length === 0) throw new DataError("There are no changes to save.");
    if (ops.length > 500) throw new DataError("Save at most 500 steps at a time.");
    const parsedOps = ops.map((o) => OperationSchema.parse(o));
    const parent = await getVersion(studyId, datasetId, parentVersionId);
    const { data: cur } = await admin().from("ds_datasets").select("current_version_id").eq("id", datasetId).single();
    if (cur?.current_version_id !== parent.id) throw new DataError("A newer version was saved by someone else. Reload to continue from it; your unsaved changes would otherwise overwrite theirs.");
    const base = await loadVersionData(parent);
    const { dataset, summaries } = applyAll(base, parsedOps); // the server recomputes every step; the browser's preview is never trusted
    const limits = await projectLimits(studyId);
    const v = await writeVersion({ studyId, datasetId, userId: a.userId, data: dataset, parent, operations: parsedOps, description: description.trim() || summaries.join(" ").slice(0, 480), limits });
    await usage(studyId, a.userId, "version", { duration_ms: Date.now() - t0 });
    await audit(studyId, a.userId, "ds_version", { dataset: datasetId, version: v.version_no, steps: parsedOps.map((o) => o.op) });
    revalidatePath(path(studyId));
    return { ok: true, data: { versionId: v.id, versionNo: v.version_no, summaries } };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: `Invalid step: ${e.issues[0]?.message ?? "check the inputs"}.` };
    return fail(e);
  }
}

/** Restoring never deletes history: it creates a new version whose content equals an older one. */
export async function restoreVersion(studyId: string, datasetId: string, versionId: string): Promise<Result<{ versionNo: number }>> {
  try {
    const a = await writer(studyId);
    const old = await getVersion(studyId, datasetId, versionId);
    const current = await getVersion(studyId, datasetId);
    if (old.id === current.id) throw new DataError("That is already the current version.");
    const data = await loadVersionData(old);
    const v = await writeVersion({ studyId, datasetId, userId: a.userId, data, parent: current, operations: [], description: `Restored version ${old.version_no}`, limits: await projectLimits(studyId) });
    await audit(studyId, a.userId, "ds_restore", { dataset: datasetId, from: old.version_no, to: v.version_no });
    revalidatePath(path(studyId));
    return { ok: true, data: { versionNo: v.version_no } };
  } catch (e) { return fail(e); }
}

export async function combineDatasets(studyId: string, targetId: string, sourceId: string, how: "append" | "left" | "inner", keys: string[]): Promise<Result<{ versionNo: number; summary: string }>> {
  try {
    const a = await writer(studyId);
    if (targetId === sourceId) throw new DataError("Choose a different dataset to combine with.");
    const tv = await getVersion(studyId, targetId), sv = await getVersion(studyId, sourceId);
    const [td, sd] = await Promise.all([loadVersionData(tv), loadVersionData(sv)]);
    const r = how === "append" ? appendDatasets(td, sd) : mergeDatasets(td, sd, keys, how);
    const { data: src } = await admin().from("ds_datasets").select("name").eq("id", sourceId).single();
    const v = await writeVersion({ studyId, datasetId: targetId, userId: a.userId, data: r.dataset, parent: tv, operations: [], description: `${how === "append" ? "Appended" : "Merged"} "${src?.name ?? "dataset"}" version ${sv.version_no}. ${r.summary}`, limits: await projectLimits(studyId) });
    await audit(studyId, a.userId, "ds_combine", { target: targetId, source: sourceId, sourceVersion: sv.id, how });
    revalidatePath(path(studyId));
    return { ok: true, data: { versionNo: v.version_no, summary: r.summary } };
  } catch (e) { return fail(e); }
}

export async function renameDataset(studyId: string, datasetId: string, name: string, description: string): Promise<Result<null>> {
  try {
    await writer(studyId);
    const nm = name.trim().slice(0, 120);
    if (!nm) throw new DataError("Give the dataset a name.");
    await admin().from("ds_datasets").update({ name: nm, description: description.slice(0, 2000), updated_at: new Date().toISOString() }).eq("id", datasetId).eq("study_id", studyId);
    revalidatePath(path(studyId));
    return { ok: true, data: null };
  } catch (e) { return fail(e); }
}

/** Only the project owner may delete a dataset. It is hidden at once; its files are removed so storage is freed. */
export async function deleteDataset(studyId: string, datasetId: string, confirmName: string): Promise<Result<null>> {
  try {
    if (!isUuid(studyId)) throw new DataError("Invalid project.");
    const a = await requireProject(studyId, "delete_project");
    if (!a.ok) throw new DataError("Only the project owner can delete a dataset.");
    const db = admin();
    const { data: ds } = await db.from("ds_datasets").select("id, name").eq("id", datasetId).eq("study_id", studyId).is("deleted_at", null).maybeSingle();
    if (!ds) throw new DataError("Dataset not found.");
    if (confirmName.trim() !== ds.name) throw new DataError("Type the dataset's name exactly to confirm.");
    const { data: versions } = await db.from("ds_versions").select("storage_path").eq("dataset_id", datasetId);
    await db.from("ds_datasets").update({ deleted_at: new Date().toISOString(), deleted_by: a.userId }).eq("id", datasetId);
    await db.from("ds_analyses").delete().eq("dataset_id", datasetId);
    await db.from("ds_charts").delete().eq("dataset_id", datasetId);
    const paths = (versions ?? []).map((v) => v.storage_path as string);
    for (let i = 0; i < paths.length; i += 100) await db.storage.from("ds-data").remove(paths.slice(i, i + 100));
    await audit(studyId, a.userId, "ds_delete", { dataset: datasetId, name: ds.name, versions: paths.length });
    revalidatePath(path(studyId));
    return { ok: true, data: null };
  } catch (e) { return fail(e); }
}

// --- Analyses --------------------------------------------------------------------------------------------------------------------------

export type SavedAnalysis = { id: string; method: string; title: string; config: Record<string, unknown>; result: AnalysisResult | null; status: string; error: string | null; version_id: string; created_at: string; pinned: boolean; duration_ms: number; engine_version: string };

export async function runAnalysisAction(studyId: string, datasetId: string, versionId: string, method: string, params: Record<string, unknown>): Promise<Result<SavedAnalysis>> {
  try {
    const a = await writer(studyId);
    const limits = await projectLimits(studyId);
    // Statistical entitlements: the same check the browser uses to show locks (lib/datastudio/entitlements.ts).
    const access = checkMethodAccess(limits, method);
    if (!access.ok) throw new DataError(access.error);
    if (!checkRateLimit(`ds-run:${a.userId}`, { limit: 30, windowMs: 60_000 }).ok) throw new DataError("Too many analyses in a short time. Wait a minute.");
    const v = await getVersion(studyId, datasetId, versionId);
    const d = await loadVersionData(v);
    const t0 = Date.now();
    let result: AnalysisResult | null = null, cleanParams: Record<string, unknown> = params, errorText: string | null = null;
    try {
      const r = runAnalysis(method, params, d);
      result = r.result; cleanParams = r.params;
    } catch (e) {
      if (!(e instanceof DataError)) throw e;
      errorText = e.message;
    }
    const ms = Date.now() - t0;
    const meter = await admin().rpc("ds_meter_analysis", { p_actor: a.userId, p_study: studyId, p_method: method, p_duration_ms: ms, p_failed: !result });
    const m = meter.data as { ok: boolean; limit: number } | null;
    if (!m?.ok) throw new DataError(`You have run ${m?.limit ?? "the maximum number of"} analyses in this project today, the limit on its plan. The limit resets at midnight UTC.`);
    if (!result) return { ok: false, error: errorText! };
    const { data: row, error } = await admin().from("ds_analyses").insert({
      study_id: studyId, dataset_id: datasetId, version_id: v.id, method, title: result.title.slice(0, 200), config: cleanParams, result, status: "completed",
      engine_version: ENGINE_VERSION, duration_ms: ms, created_by: a.userId,
    }).select("id, method, title, config, result, status, error, version_id, created_at, pinned, duration_ms, engine_version").single();
    if (error || !row) throw new DataError("The result could not be saved.");
    revalidatePath(path(studyId));
    return { ok: true, data: row as SavedAnalysis };
  } catch (e) {
    if (e instanceof AnalysisError) return { ok: false, error: e.message };
    return fail(e);
  }
}

export async function listAnalyses(studyId: string, datasetId: string): Promise<Result<SavedAnalysis[]>> {
  try {
    const a = await reader(studyId);
    const { data } = await a.supabase.from("ds_analyses").select("id, method, title, config, result, status, error, version_id, created_at, pinned, duration_ms, engine_version").eq("dataset_id", datasetId).order("created_at", { ascending: false }).limit(100);
    return { ok: true, data: (data ?? []) as SavedAnalysis[] };
  } catch (e) { return fail(e); }
}

export async function updateAnalysis(studyId: string, analysisId: string, patch: { pinned?: boolean; title?: string }): Promise<Result<null>> {
  try {
    await writer(studyId);
    const upd: Record<string, unknown> = {};
    if (typeof patch.pinned === "boolean") upd.pinned = patch.pinned;
    if (typeof patch.title === "string" && patch.title.trim()) upd.title = patch.title.trim().slice(0, 200);
    await admin().from("ds_analyses").update(upd).eq("id", analysisId).eq("study_id", studyId);
    return { ok: true, data: null };
  } catch (e) { return fail(e); }
}

export async function deleteAnalysis(studyId: string, analysisId: string): Promise<Result<null>> {
  try {
    const a = await requireProject(studyId, "delete_project");
    if (!a.ok) throw new DataError("Only the project owner can delete saved results.");
    await admin().from("ds_analyses").delete().eq("id", analysisId).eq("study_id", studyId);
    await audit(studyId, a.userId, "ds_delete_analysis", { analysis: analysisId });
    return { ok: true, data: null };
  } catch (e) { return fail(e); }
}

// --- Charts and exports --------------------------------------------------------------------------------------------------------------

export async function saveChart(studyId: string, datasetId: string, versionId: string, chartType: string, title: string, spec: unknown): Promise<Result<{ id: string }>> {
  try {
    const a = await writer(studyId);
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(chartType)) throw new DataError("Invalid chart.");
    const json = JSON.stringify(spec);
    if (json.length > 40_000) throw new DataError("The chart settings are too large to save.");
    await getVersion(studyId, datasetId, versionId);
    const { data, error } = await admin().from("ds_charts").insert({ study_id: studyId, dataset_id: datasetId, version_id: versionId, chart_type: chartType, title: title.trim().slice(0, 200) || "Chart", spec: JSON.parse(json), created_by: a.userId }).select("id").single();
    if (error || !data) throw new DataError("The chart could not be saved.");
    return { ok: true, data: { id: data.id } };
  } catch (e) { return fail(e); }
}

/** Checks that the plan includes an export format and records it (exports are metered and audited, but contain no research data). */
export async function authorizeExport(studyId: string, format: "csv" | "svg" | "png" | "python", what: string): Promise<Result<null>> {
  try {
    const a = await reader(studyId);
    const limits = await projectLimits(studyId);
    if (!limits.exports.includes(format)) throw new DataError(`${format.toUpperCase()} export is not included in this project's plan (${limits.plan}).`);
    await usage(studyId, a.userId, "export", { method: `${format}:${what}`.slice(0, 60) });
    await audit(studyId, a.userId, "ds_export", { format, what: what.slice(0, 100) });
    return { ok: true, data: null };
  } catch (e) { return fail(e); }
}
