# Research guides: editorial workflow

The guides on the Resources page are Markdown files in `frontend/content/guides`, one file per guide. They are reviewed and published like code: a change is a commit, and nothing reaches readers until a person has approved it.

## What readers see

A guide is visible on `/resources`, at `/resources/<slug>`, in the sitemap and in search results only when **both** are true:

1. its front matter says `status: published`, and
2. it passes the publication gate (`publishBlockers` in `frontend/src/lib/resources/guide-core.mjs`): a named reviewer (`reviewedBy`), a review date (`reviewedOn`), a publication date (`publishedOn`), an author, at least three sources, every source marked `verified: true`, no `[VERIFY]` marker left in the text, and at least 800 words.

Status alone is never enough. A draft is a 404 for readers, is not listed anywhere and is never mentioned by title on the public pages. The Resources page is marked `noindex` until at least one guide is published.

## The three statuses

| Status | Meaning |
|---|---|
| `draft` | Written, not yet checked by a person. Every guide starts here, including AI-assisted ones. |
| `in_review` | A person is checking it. Still invisible to readers. |
| `published` | Reviewed and approved. Visible, if it also passes the gate. |

## Writing or changing a guide

1. Copy `docs/guide-template.md` to `frontend/content/guides/<slug>.md`. The file name is the address (lowercase words joined by hyphens).
2. Fill in the front matter and write the body in Markdown (see below).
3. Run `npm run guides -- check <slug>` from `frontend`. It lists structural problems and what still blocks publication.
4. Open the draft as an administrator at `/resources/preview/<slug>`. The banner lists what blocks it. Administrators can also see every guide, its status, source checks and blockers at `/admin/guides`.

### Front matter

```
title: How to ...                 at most 70 characters
description: ...                  90 to 160 characters, used as the meta description
summary: ...                      one or two sentences shown on cards and under the title
category: methodology             methodology, biostatistics, epidemiology, literature-reviews, academic-writing, data-management
status: draft                     draft, in_review or published
author: Name                      shown as the byline; use the ToProt team only for guides written by the team
updatedOn: 2026-11-12             change it whenever the text changes
featured: false                   true shows it in "Featured guides"
keywords: [a, b, c]               used for search and metadata
tools: [sample-size-calculator]   tool slugs shown as "Try it in ToProt"
related: [other-guide-slug]       other guides, by slug
sources:                          see below
```

`reviewedBy`, `reviewedOn` and `publishedOn` are added by the publish command.

### Markdown supported

`##` and `###` headings (the title is the page heading, so do not use `#`), paragraphs, bullet and numbered lists, tables, `**bold**`, `*italic*`, `` `code` ``, links, fenced code, rules, and:

- **Equations:** a block between lines containing only `$$`. Write them in plain text with Unicode (n = Z² × p × (1 − p) / d²). They are shown in a labelled box.
- **Worked examples and notes:** a block quote whose first line is a bold title. Separate paragraphs with a `>` line.
- **Citations:** write `[1]` or `[1,2]`; each number links to that source in the reference list (sources are numbered in the order listed).
- **Links to Toprot:** `/tools/<public-slug>`, `/literature`, `/citations`, `/features#protocol-builder`, `/examples`, `/docs`, `/calculator`. A test fails if a guide links to a page that does not exist.

Raw HTML is not supported and is shown as text. Do not use em dashes.

### Sources and verification

Every source has a `citation`, usually a `doi` (or a `url`), and `verified`:

```
sources:
  - citation: "Author A, Author B. Title. Journal. 2020;10(2):100-110."
    doi: 10.xxxx/xxxxx
    verified: false
    note: What was and was not checked.
```

**Never add a source you have not seen.** `verified: true` means a person has checked the citation against the original (the journal page, PubMed, the DOI record or the book) and that it supports the sentence it is cited for. Until then leave `verified: false` with a note. `npm run guides -- verify-dois` looks each DOI up at Crossref and prints the title, journal and year so you can compare them with the citation; it does not mark anything verified.

Books and web pages have no DOI. Check the edition, publisher and pages, or the page itself, and say so in `note`.

## Publishing

After checking every claim, number, equation and source:

```
npm run guides -- check <slug>
npm run guides -- publish <slug> --reviewer "Full name" [--feature]
```

`publish` refuses, and prints what is missing, unless the gate passes. It then sets `status`, `reviewedBy`, `reviewedOn` and `publishedOn`. Commit the change and deploy; the guide appears on the Resources page, in the sitemap and in search results after the deploy. A calculator page that links to the guide in `lib/tools/seo.ts` shows it once it is published.

To take a guide down: `npm run guides -- unpublish <slug>` (it becomes a draft again), commit and deploy. To change a published guide, edit it, update `updatedOn`, and have the change reviewed.

To rename a guide's address, add the old slug to `RENAMED_GUIDES` in `frontend/src/lib/resources/renamed.ts`; it is redirected permanently.

## Other commands

```
npm run guides -- list
npm run guides -- verify-dois [slug]
```

## Why the guides are drafts today

The first five guides (research protocol, study design, sample size, p-values and confidence intervals, literature review) and four older short drafts were written with AI assistance. All figures in the worked examples were calculated and the DOIs were found at Crossref on 2026-11-12, but no person has yet reviewed the text. Book sources are flagged `verified: false` because they were not checked against a copy. They stay hidden until an editor works through the steps above.
