"use client";

import { useEffect, useState } from "react";

type CheckResult = { ok: boolean; detail: unknown };
type HealthResponse = { supabase: CheckResult; docService: CheckResult };

export function ConnectionStatus() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then(setHealth)
      .catch((err) => setError(err.message));
  }, []);

  if (error) {
    return <p className="text-red-600">Failed to load status: {error}</p>;
  }

  if (!health) {
    return <p className="text-zinc-500">Checking connections...</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <StatusRow label="Supabase" result={health.supabase} />
      <StatusRow label="Document service" result={health.docService} />
    </div>
  );
}

function StatusRow({ label, result }: { label: string; result: CheckResult }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <span
        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
          result.ok ? "bg-green-500" : "bg-red-500"
        }`}
      />
      <div>
        <p className="font-medium text-zinc-900 dark:text-zinc-100">{label}</p>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {typeof result.detail === "string" ? result.detail : JSON.stringify(result.detail)}
        </p>
      </div>
    </div>
  );
}
