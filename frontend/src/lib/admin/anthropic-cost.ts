// Optional reconciliation of ToProt's recorded AI cost with the cost Anthropic reports for the same dates.
//
// Uses Anthropic's Cost Report (GET /v1/organizations/cost_report): daily buckets, amounts in cents as decimal strings. It needs an
// Admin API key (ANTHROPIC_ADMIN_API_KEY), which is different from the key used for AI requests and is created in the Anthropic
// Console by an organisation admin. Anthropic marks this endpoint "legacy" in favour of /v1/organizations/analytics/cost; it is
// used here because its shape is documented in full. The key stays on the server and is never put in a message.

export type Reconciliation = { status: "ok"; costUsd: number } | { status: "not_configured" } | { status: "error"; message: string };

type Bucket = { results: { amount: string; currency: string }[] };
type Page = { data: Bucket[]; has_more: boolean; next_page: string | null };

export async function anthropicReconciliation(from: Date, to: Date, fetchImpl: typeof fetch = fetch): Promise<Reconciliation> {
  const key = process.env.ANTHROPIC_ADMIN_API_KEY?.trim();
  if (!key) return { status: "not_configured" };
  let cents = 0;
  let page: string | null = null;
  try {
    for (let i = 0; i < 20; i++) {
      const url = new URL("https://api.anthropic.com/v1/organizations/cost_report");
      url.searchParams.set("starting_at", from.toISOString());
      url.searchParams.set("ending_at", to.toISOString());
      url.searchParams.set("limit", "31");
      if (page) url.searchParams.set("page", page);
      const res = await fetchImpl(url, { headers: { "x-api-key": key, Authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01" }, signal: AbortSignal.timeout(8000), cache: "no-store" });
      if (!res.ok) return { status: "error", message: `Anthropic answered HTTP ${res.status}. Check that the key is an Admin API key.` };
      const body = (await res.json()) as Page;
      for (const b of body.data ?? []) for (const r of b.results ?? []) if (r.currency === "USD") cents += Number(r.amount) || 0;
      if (!body.has_more || !body.next_page) return { status: "ok", costUsd: cents / 100 };
      page = body.next_page;
    }
    return { status: "error", message: "The period is too long to read in one go. Choose a shorter range." };
  } catch (e) {
    return { status: "error", message: e instanceof Error && e.name === "TimeoutError" ? "Anthropic did not answer in time." : "Anthropic could not be reached." };
  }
}
