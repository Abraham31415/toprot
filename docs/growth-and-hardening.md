# Search, guides, security and performance

## Calculator pages (search)

- Every calculator has its own page at `/tools/<slug>` with a descriptive title, meta description, canonical URL, Open Graph tags, `WebApplication` and `BreadcrumbList` structured data, related-calculator links and a sign-up link. Pages are statically generated and need no login.
- The five most searched calculators have fuller landing content (when to use, steps, how to read the result, FAQs with `FAQPage` structured data): `sample-size-calculator`, `chi-square-calculator`, `odds-ratio-calculator`, `diagnostic-accuracy-calculator`, `statistical-power-calculator`. Their text lives in `src/lib/tools/seo.ts`. To add another, add an entry there; the sitemap, links and tests pick it up.
- Two calculators changed address for search: `chi-square-test` is now `chi-square-calculator`, and `diagnostic-test-calculator` is now `diagnostic-accuracy-calculator`. The old addresses redirect permanently (308) from `next.config.ts`, and saved calculations keep working because their internal slug did not change. The mapping is in `src/lib/tools/aliases.ts`.
- `sample-size-calculator` and `statistical-power-calculator` are hub pages: they run one calculator and link to the others.
- `sitemap.xml` lists only public, indexable pages. `robots.txt` blocks the signed-in areas and the guide preview.

## Research guides (resource center)

- Guides live in `src/lib/resources/articles.ts`. All nine are written as **drafts with status `in_review`**. Nothing is published automatically.
- To publish a guide: read it and check every claim and every source against the original, then set `status: "published"`, `reviewedBy` and `reviewedOn` (a date, `YYYY-MM-DD`). A guide appears on the public site, in the sitemap and in search only when it has a published status, a named reviewer, a review date and at least one source. A test enforces this.
- Administrators can read drafts at `/resources/preview/<slug>` (signed in as an administrator). The page is never indexed.
- `/resources` stays out of search results until at least one guide is published.
- The sources in the drafts were written from memory of standard references. **Verify every citation (authors, year, journal, volume, pages) before publishing.**

## Security

- Headers on every route: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'; base-uri 'self'`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security`. The `X-Powered-By` header is off. A full script-source CSP (with nonces) is a larger change and is not done.
- Secrets: the browser only ever receives the public Supabase URL and anon key. The service-role key, payment keys, webhook secrets and AI keys are read on the server only. Row Level Security protects all user data, and the three storage buckets (PDFs, figures, protocol outputs) are private with owner-based policies, size limits and allowed file types.
- Public routes (`/api/literature/*`, `/api/csl/*`, `/api/health`) have a per-IP limit (`src/lib/rate-limit.ts`). It is best-effort and per server instance, backed by edge caching. Per-user limits for AI and payments are in the database. `/api/health` returns only "up or down", never configuration or error text.

## Performance and reliability

- Added database indexes for the foreign-key columns that real queries use: `supabase/migrations/20261118090000_foreign_key_indexes.sql`. Run the check in that file's header against production again after large data growth.
- The PDF library already caps a user at 100 PDFs; its query now also has a hard limit. The references page loads at most 1,000 references per study and says when a study has more. True server-side pagination of references would need the reference manager's browser-side search, grouping and de-duplication to be rewritten, and is not done.
- Public pages are statically generated. Signed-in pages stream a loading placeholder while their data loads (`loading.tsx`).
- The heavy editor, citation and Word-export code loads only on the pages that use it, not on public calculator pages.
- Error handling: `error.tsx`, `global-error.tsx` and `not-found.tsx` give visitors a friendly page with a reference code, never a stack trace. `src/instrumentation.ts` writes every unhandled server error as one structured log line (route pattern, error type, shortened message, the same reference code).
- AI calls run under hard timeouts and cost guards (`src/lib/ai/run.ts`). Text extraction from PDFs runs inside a server action limited to 60 seconds and 20 MB per file. There is no background job queue; if a long-running job is needed later it belongs in a queue or worker, not a serverless request.

## Not done on purpose

- A global rate limiter shared across instances (needs a shared store such as Redis).
- A full CSP with nonces.
- True pagination of the reference list (see above).
- Image optimisation work: the site has no content images beyond a generated social card.
