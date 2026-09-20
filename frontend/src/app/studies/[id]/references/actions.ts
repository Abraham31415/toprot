"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { formatInitials, type ReferenceMetadata } from "@/lib/protocol/references";

export type LookupResult = { found: true; metadata: ReferenceMetadata } | { found: false; error?: string };

function looksLikeDoi(query: string): string | null {
  const cleaned = query.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
  return /^10\.\d{4,9}\/\S+$/.test(cleaned) ? cleaned : null;
}

function looksLikePmid(query: string): string | null {
  const cleaned = query.trim().replace(/^pmid:?\s*/i, "");
  return /^\d{4,9}$/.test(cleaned) ? cleaned : null;
}

type CrossRefAuthor = { given?: string; family?: string };
type CrossRefMessage = {
  title?: string[];
  author?: CrossRefAuthor[];
  "container-title"?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  published?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
};

async function lookupCrossRef(doi: string): Promise<ReferenceMetadata | null> {
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
    headers: { "User-Agent": "ToProt/1.0 (https://toprot.vercel.app)" },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const data: { message?: CrossRefMessage } = await res.json();
  const msg = data.message;
  if (!msg) return null;

  const authors = (msg.author ?? [])
    .map((a) => {
      const surname = a.family ?? "";
      const initials = a.given ? formatInitials(a.given) : "";
      return [surname, initials].filter(Boolean).join(" ");
    })
    .filter((a) => a.trim());

  const dateParts =
    msg["published-print"]?.["date-parts"]?.[0] ??
    msg["published-online"]?.["date-parts"]?.[0] ??
    msg.published?.["date-parts"]?.[0];

  const title = msg.title?.[0];
  if (!title) return null;

  return {
    identifier_type: "doi",
    doi,
    pmid: null,
    authors,
    title,
    journal: msg["container-title"]?.[0] ?? null,
    year: dateParts?.[0] ?? null,
    volume: msg.volume ?? null,
    issue: msg.issue ?? null,
    pages: msg.page ?? null,
  };
}

type PubMedSummaryDoc = {
  error?: string;
  title?: string;
  fulljournalname?: string;
  source?: string;
  pubdate?: string;
  volume?: string;
  issue?: string;
  pages?: string;
  authors?: { name?: string }[];
};

async function pubmedEsummary(pmid: string): Promise<ReferenceMetadata | null> {
  const res = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${encodeURIComponent(pmid)}&retmode=json&tool=toprot`,
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  const data: { result?: Record<string, PubMedSummaryDoc> } = await res.json();
  const doc = data.result?.[pmid];
  if (!doc || doc.error || !doc.title) return null;

  const authors = (doc.authors ?? []).map((a) => a.name).filter((n): n is string => !!n);
  const yearMatch = /\d{4}/.exec(doc.pubdate ?? "");

  return {
    identifier_type: "pmid",
    doi: null,
    pmid,
    authors,
    title: doc.title,
    journal: doc.fulljournalname ?? doc.source ?? null,
    year: yearMatch ? parseInt(yearMatch[0], 10) : null,
    volume: doc.volume || null,
    issue: doc.issue || null,
    pages: doc.pages || null,
  };
}

async function pubmedSearchByTitle(title: string): Promise<string | null> {
  const res = await fetch(
    `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&retmode=json&retmax=1&term=${encodeURIComponent(title)}&tool=toprot`,
    { cache: "no-store" },
  );
  if (!res.ok) return null;
  const data: { esearchresult?: { idlist?: string[] } } = await res.json();
  return data.esearchresult?.idlist?.[0] ?? null;
}

/**
 * Absolute rule: metadata only ever comes from CrossRef or PubMed. If the identifier
 * doesn't resolve to a real record, this returns { found: false } -- never a guessed
 * or model-generated citation.
 */
export async function lookupReference(query: string): Promise<LookupResult> {
  const trimmed = query.trim();
  if (!trimmed) return { found: false, error: "Enter a DOI, PMID, or title." };

  try {
    const doi = looksLikeDoi(trimmed);
    if (doi) {
      const metadata = await lookupCrossRef(doi);
      return metadata ? { found: true, metadata } : { found: false };
    }

    const pmid = looksLikePmid(trimmed);
    if (pmid) {
      const metadata = await pubmedEsummary(pmid);
      return metadata ? { found: true, metadata } : { found: false };
    }

    const foundPmid = await pubmedSearchByTitle(trimmed);
    if (!foundPmid) return { found: false };
    const metadata = await pubmedEsummary(foundPmid);
    return metadata ? { found: true, metadata } : { found: false };
  } catch (err) {
    return { found: false, error: `Lookup failed: ${(err as Error).message}` };
  }
}

export type SaveResult = { error?: string };

export async function addReference(studyId: string, metadata: ReferenceMetadata): Promise<SaveResult> {
  const supabase = await createClient();

  const { count } = await supabase
    .from("study_references")
    .select("id", { count: "exact", head: true })
    .eq("study_id", studyId);

  const { error } = await supabase.from("study_references").insert({
    study_id: studyId,
    identifier_type: metadata.identifier_type,
    doi: metadata.doi,
    pmid: metadata.pmid,
    authors: metadata.authors,
    title: metadata.title,
    journal: metadata.journal,
    year: metadata.year,
    volume: metadata.volume,
    issue: metadata.issue,
    pages: metadata.pages,
    display_order: count ?? 0,
  });

  if (error) return { error: error.message };
  revalidatePath(`/studies/${studyId}/references`);
  return {};
}

export async function deleteReference(studyId: string, referenceId: string): Promise<SaveResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("study_references").delete().eq("id", referenceId);
  if (error) return { error: error.message };
  revalidatePath(`/studies/${studyId}/references`);
  return {};
}
