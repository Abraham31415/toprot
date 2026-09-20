export type ReferenceIdentifierType = "doi" | "pmid" | "manual";

export type StudyReference = {
  id: string;
  study_id: string;
  identifier_type: ReferenceIdentifierType;
  doi: string | null;
  pmid: string | null;
  authors: string[];
  title: string;
  journal: string | null;
  year: number | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  display_order: number;
};

export type ReferenceMetadata = {
  identifier_type: ReferenceIdentifierType;
  doi: string | null;
  pmid: string | null;
  authors: string[];
  title: string;
  journal: string | null;
  year: number | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
};

/** Given "Jane A." -> "JA". Never invents an initial the source didn't provide. */
export function formatInitials(givenName: string): string {
  return givenName
    .split(/\s+/)
    .map((part) => part.replace(/[^a-zA-Z]/g, ""))
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** "Smith JA" -> ["Smith", "JA"]. Best-effort split on the stored "Surname Initials" form. */
function splitAuthorName(name: string): { surname: string; initials: string } {
  const trimmed = name.trim();
  const lastSpace = trimmed.lastIndexOf(" ");
  if (lastSpace === -1) return { surname: trimmed, initials: "" };
  return { surname: trimmed.slice(0, lastSpace), initials: trimmed.slice(lastSpace + 1) };
}

export function formatVancouver(ref: ReferenceMetadata, index: number): string {
  const authors =
    ref.authors.length > 6 ? [...ref.authors.slice(0, 6), "et al."].join(", ") : ref.authors.join(", ");
  const title = ref.title.trim().replace(/\.+$/, "") + ".";
  const journal = ref.journal ? ` ${ref.journal.trim().replace(/\.+$/, "")}.` : "";
  const year = ref.year != null ? ` ${ref.year}` : "";
  const volIssue = ref.volume ? `;${ref.volume}${ref.issue ? `(${ref.issue})` : ""}` : "";
  const pages = ref.pages ? `:${ref.pages}` : "";
  const authorPart = authors ? `${authors}. ` : "";
  const body = `${authorPart}${title}${journal}${year}${volIssue}${pages}`;
  return `${index}. ${body.replace(/\.*$/, ".")}`.trim();
}

export function formatRIS(ref: ReferenceMetadata): string {
  const lines = ["TY  - JOUR"];
  for (const author of ref.authors) {
    const { surname, initials } = splitAuthorName(author);
    lines.push(`AU  - ${surname}${initials ? `, ${initials}` : ""}`);
  }
  lines.push(`TI  - ${ref.title}`);
  if (ref.journal) lines.push(`JO  - ${ref.journal}`);
  if (ref.year != null) lines.push(`PY  - ${ref.year}`);
  if (ref.volume) lines.push(`VL  - ${ref.volume}`);
  if (ref.issue) lines.push(`IS  - ${ref.issue}`);
  if (ref.pages) {
    const [start, end] = ref.pages.split(/[-–]/);
    lines.push(`SP  - ${start.trim()}`);
    if (end) lines.push(`EP  - ${end.trim()}`);
  }
  if (ref.doi) lines.push(`DO  - ${ref.doi}`);
  lines.push("ER  - ");
  return lines.join("\n");
}

export function referencesToRIS(refs: ReferenceMetadata[]): string {
  return refs.map(formatRIS).join("\n\n");
}

function bibtexKey(ref: ReferenceMetadata): string {
  const surname = ref.authors[0] ? splitAuthorName(ref.authors[0]).surname.toLowerCase().replace(/[^a-z]/g, "") : "ref";
  const firstWord = ref.title.trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  return `${surname}${ref.year ?? ""}${firstWord}`;
}

export function formatBibTeX(ref: ReferenceMetadata): string {
  const authors = ref.authors
    .map((a) => {
      const { surname, initials } = splitAuthorName(a);
      return initials ? `${surname}, ${initials}` : surname;
    })
    .join(" and ");
  const fields: [string, string | null][] = [
    ["author", authors || null],
    ["title", ref.title],
    ["journal", ref.journal],
    ["year", ref.year != null ? String(ref.year) : null],
    ["volume", ref.volume],
    ["number", ref.issue],
    ["pages", ref.pages ? ref.pages.replace(/[-–]/, "--") : null],
    ["doi", ref.doi],
  ];
  const body = fields
    .filter(([, v]) => v)
    .map(([k, v]) => `  ${k} = {${v}}`)
    .join(",\n");
  return `@article{${bibtexKey(ref)},\n${body}\n}`;
}

export function referencesToBibTeX(refs: ReferenceMetadata[]): string {
  return refs.map(formatBibTeX).join("\n\n");
}
