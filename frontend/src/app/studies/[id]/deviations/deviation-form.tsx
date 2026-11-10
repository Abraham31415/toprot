"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DEVIATION_CATEGORIES, type DeviationCategory } from "@/lib/protocol/deviations";
import { addDeviation } from "./actions";

export function DeviationForm({ studyId, versionId }: { studyId: string; versionId: string }) {
  const router = useRouter();
  const [category, setCategory] = useState<DeviationCategory>("other");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10));
  const [impact, setImpact] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await addDeviation(studyId, versionId, {
        category,
        description,
        occurred_at: occurredAt,
        impact_assessment: impact,
      });
      if (result.error) {
        setError(result.error);
      } else {
        setDescription("");
        setImpact("");
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-navy/85">Category</span>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as DeviationCategory)}
            className="rounded-lg border border-line bg-white px-3 py-2 text-navy outline-none"
          >
            {DEVIATION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-navy/85">Date occurred</span>
          <input
            type="date"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="rounded-lg border border-line bg-white px-3 py-2 text-navy outline-none"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-navy/85">Description</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="rounded-lg border border-line bg-white px-3 py-2 text-navy outline-none"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium text-navy/85">Impact assessment (optional)</span>
        <textarea
          value={impact}
          onChange={(e) => setImpact(e.target.value)}
          rows={2}
          className="rounded-lg border border-line bg-white px-3 py-2 text-navy outline-none"
        />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className="self-start rounded-lg bg-cobalt px-4 py-2 text-sm font-medium text-white hover:bg-cobalt-dark disabled:opacity-50"
      >
        {pending ? "Logging..." : "Log deviation"}
      </button>
    </div>
  );
}
