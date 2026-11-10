// Styles shipped with the site. Each was downloaded from the official CSL repository
// (https://github.com/citation-style-language/styles) and checked to load and format a test reference.
// Styles are licensed CC BY-SA 3.0 by their authors; see public/csl/LICENSE.txt.
export const BUNDLED_STYLES: { id: string; label: string }[] = [
  { id: "apa", label: "APA (7th edition)" },
  { id: "harvard-cite-them-right", label: "Harvard (Cite Them Right)" },
  { id: "elsevier-vancouver", label: "Vancouver (Elsevier)" },
  { id: "american-medical-association", label: "AMA" },
  { id: "ieee", label: "IEEE" },
  { id: "chicago-author-date", label: "Chicago (author-date)" },
  { id: "modern-language-association", label: "MLA (9th edition)" },
  { id: "nature", label: "Nature" },
  { id: "the-lancet", label: "The Lancet" },
  { id: "bmj", label: "BMJ" },
  { id: "plos", label: "PLOS" },
];

export const BUNDLED_LOCALES = ["en-US", "en-GB"];
export const isBundledStyle = (id: string) => BUNDLED_STYLES.some((s) => s.id === id);

/** A CSL style id is lower-case letters, digits and hyphens only. Anything else is rejected before any request is made. */
export const isStyleId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id) && id.length <= 120;
export const isLocaleId = (id: unknown): id is string => typeof id === "string" && /^[a-z]{2,3}-[A-Z]{2}$/.test(id);
