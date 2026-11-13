"use server";

import { revalidatePath } from "next/cache";
import { requireProject } from "@/lib/collab/access";
import { isUuid } from "@/lib/collab/roles";

type Out = { error?: string; message?: string };

function map(message: string): string {
  if (message.includes("version_locked")) return "This version is locked, so it cannot be restored over.";
  if (message.includes("not_allowed")) return "You have read-only access to this project.";
  return "That did not work. Try again in a moment.";
}

export async function saveProtocolSnapshot(studyId: string, versionId: string, label: string): Promise<Out> {
  const a = await requireProject(studyId, "write");
  if (!a.ok) return { error: a.error };
  if (!isUuid(versionId)) return { error: "Unknown version." };
  const { error } = await a.supabase.rpc("snapshot_protocol", { p_version: versionId, p_label: label });
  if (error) return { error: map(error.message) };
  revalidatePath(`/studies/${studyId}/protocol`);
  return { message: "Snapshot saved." };
}

export async function restoreProtocolSnapshot(studyId: string, snapshotId: string): Promise<Out> {
  const a = await requireProject(studyId, "write");
  if (!a.ok) return { error: a.error };
  if (!isUuid(snapshotId)) return { error: "Unknown snapshot." };
  const { error } = await a.supabase.rpc("restore_protocol_snapshot", { p_snapshot: snapshotId });
  if (error) return { error: map(error.message) };
  revalidatePath(`/studies/${studyId}/protocol`);
  return { message: "Restored. Reload the page if the form still shows older text." };
}
