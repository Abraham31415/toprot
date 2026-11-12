// Real screenshots of the running product, captured at 2x from a demo account with a fictional study (the signed-in screens) or from
// the public pages (the calculator and the literature search). The name shown in the app was replaced before capture. Sizes are the
// pixel sizes of the files in /public/screenshots, so the images reserve their space and do not shift the page while loading.

export type Shot = { src: string; width: number; height: number; alt: string; address: string; caption: string };

const DEMO = "A demo account with a fictional study.";

export const SHOTS = {
  dashboard: {
    src: "/screenshots/dashboard-hd.webp", width: 1600, height: 927, address: "toprot.vercel.app/dashboard", caption: DEMO,
    alt: "The ToProt dashboard: a study title box, summary counts for projects, protocol completion, saved references and generated documents, and a recent project card with protocol progress.",
  },
  protocol: {
    src: "/screenshots/protocol-hd.webp", width: 1600, height: 1454, address: "toprot.vercel.app/studies/.../protocol", caption: DEMO,
    alt: "The protocol builder: eight protocol sections with completion counts, the study identity form and a protocol quality panel listing which sections still need work.",
  },
  checks: {
    src: "/screenshots/checks-hd.webp", width: 1400, height: 1055, address: "toprot.vercel.app/studies/.../protocol", caption: DEMO,
    alt: "The protocol quality panel: each protocol section marked as not yet complete, with plain-language warnings about missing data handling and an untagged outcome variable.",
  },
  references: {
    src: "/screenshots/references-hd.webp", width: 1600, height: 1329, address: "toprot.vercel.app/studies/.../references", caption: DEMO,
    alt: "The reference manager: buttons to look up by DOI or PubMed ID, type one in, import a file or search the literature, a saved reference with its source, and export buttons for RIS, BibTeX, EndNote XML and CSV.",
  },
  editor: {
    src: "/screenshots/editor-hd.webp", width: 1600, height: 1224, address: "toprot.vercel.app/studies/.../writing", caption: DEMO + " The template adds headings only.",
    alt: "The writing editor: a formatting toolbar, save, history, Word and PDF export buttons, a manuscript with research article headings and an outline panel beside it.",
  },
  calculator: {
    src: "/screenshots/calculator-hd.webp", width: 1460, height: 1450, address: "toprot.vercel.app/calculator", caption: "The free sample size calculator, with its formula, reference and sensitivity table.",
    alt: "The sample size calculator for a single proportion, showing a required sample of 385 before dropout and 427 after, the formula, its reference and a table of required sample sizes by dropout rate and margin of error.",
  },
  literature: {
    src: "/screenshots/literature-hd.webp", width: 1600, height: 954, address: "toprot.vercel.app/literature", caption: "A live search in the Literature Explorer.",
    alt: "The Literature Explorer after a search: search fields, a result count from OpenAlex and records with authors, journal, citation count, DOI and PubMed ID, and buttons to open the original paper.",
  },
} satisfies Record<string, Shot>;
