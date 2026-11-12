// Project roles and what each may do. This is the TypeScript mirror of the database rules (public.study_role and the row level
// security policies). The database is the authority; this file exists so server code and screens ask the same question the same way.
// A profile label (student, lecturer, supervisor) never appears here: only the project role does.

export type ProjectRole = "owner" | "editor" | "reviewer" | "viewer";
export type MemberRole = Exclude<ProjectRole, "owner">;

export type Capability = "read" | "comment" | "write" | "review" | "invite" | "manage_members" | "lock_protocol" | "delete_project";

const CAPS: Record<ProjectRole, readonly Capability[]> = {
  owner: ["read", "comment", "write", "review", "invite", "manage_members", "lock_protocol", "delete_project"],
  editor: ["read", "comment", "write"],
  reviewer: ["read", "comment", "review"],
  viewer: ["read"],
};

export function can(role: ProjectRole | null | undefined, capability: Capability): boolean {
  return !!role && CAPS[role].includes(capability);
}

export const MEMBER_ROLES: readonly MemberRole[] = ["reviewer", "editor", "viewer"] as const;

export const ROLE_LABEL: Record<ProjectRole, string> = { owner: "Owner", editor: "Editor", reviewer: "Reviewer", viewer: "Viewer" };

export const ROLE_SUMMARY: Record<ProjectRole, string> = {
  owner: "Full control of the project, its people and its settings.",
  editor: "Can read and edit the protocol, references, manuscripts and files. Cannot lock a protocol, invite or remove people, or delete the project.",
  reviewer: "Can read the project, comment and review. Cannot change the project's content.",
  viewer: "Can read the project. Cannot change or comment on it.",
};

// Descriptive titles shown next to a person. They never change permissions.
export const TITLE_LABELS = ["supervisor", "co_investigator", "collaborator", "advisor", "statistician"] as const;
export type TitleLabel = (typeof TITLE_LABELS)[number];
export const TITLE_TEXT: Record<TitleLabel, string> = {
  supervisor: "Supervisor", co_investigator: "Co-investigator", collaborator: "Collaborator", advisor: "Advisor", statistician: "Statistician",
};

export function isMemberRole(v: unknown): v is MemberRole { return typeof v === "string" && (MEMBER_ROLES as readonly string[]).includes(v); }
export function isTitleLabel(v: unknown): v is TitleLabel { return typeof v === "string" && (TITLE_LABELS as readonly string[]).includes(v); }
export function isEmail(v: unknown): v is string { return typeof v === "string" && v.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v); }
export function isUuid(v: unknown): v is string { return typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v); }
