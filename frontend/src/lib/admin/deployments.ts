// Recent deployments from the Vercel API. Optional: it needs VERCEL_API_TOKEN and VERCEL_PROJECT_ID (and VERCEL_TEAM_ID for a team
// project). Without them the system page says so and shows nothing. The token stays on the server.

export type Deployment = { id: string; url: string | null; state: string; target: string | null; created: number; commit: string | null; message: string | null };
export type DeploymentsResult = { status: "ok"; items: Deployment[] } | { status: "not_configured" } | { status: "error"; message: string };

export async function recentDeployments(fetchImpl: typeof fetch = fetch): Promise<DeploymentsResult> {
  const token = process.env.VERCEL_API_TOKEN?.trim();
  const project = process.env.VERCEL_PROJECT_ID?.trim();
  if (!token || !project) return { status: "not_configured" };
  try {
    const url = new URL("https://api.vercel.com/v6/deployments");
    url.searchParams.set("projectId", project);
    url.searchParams.set("limit", "8");
    if (process.env.VERCEL_TEAM_ID?.trim()) url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID.trim());
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!res.ok) return { status: "error", message: `Vercel answered HTTP ${res.status}. Check the token, project id and team id.` };
    const body = (await res.json()) as { deployments?: { uid: string; url?: string; state?: string; readyState?: string; target?: string | null; created: number; meta?: { githubCommitSha?: string; githubCommitMessage?: string } }[] };
    return {
      status: "ok",
      items: (body.deployments ?? []).map((d) => ({
        id: d.uid, url: d.url ?? null, state: d.state ?? d.readyState ?? "unknown", target: d.target ?? null, created: d.created,
        commit: d.meta?.githubCommitSha?.slice(0, 7) ?? null, message: d.meta?.githubCommitMessage?.split("\n")[0]?.slice(0, 100) ?? null,
      })),
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error && e.name === "TimeoutError" ? "Vercel did not answer in time." : "Vercel could not be reached." };
  }
}
