"use client";

import type { SampleSizeResult } from "@/lib/protocol/sample-size";

export function StressTestTable({ stressTest }: { stressTest: SampleSizeResult["stress_test"] }) {
  const { effect_label, dropout_label, rows, columns, grid } = stressTest;
  const baseColIndex = Math.floor(columns.length / 2);

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        Required N by {dropout_label.toLowerCase()} (rows) and {effect_label.toLowerCase()} (columns)
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-zinc-200 p-2 text-left text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                {dropout_label} \ {effect_label}
              </th>
              {columns.map((col, i) => (
                <th
                  key={i}
                  className={`border border-zinc-200 p-2 text-right font-medium dark:border-zinc-800 ${
                    i === baseColIndex
                      ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
                      : "text-zinc-500 dark:text-zinc-400"
                  }`}
                >
                  {col.value}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                <td className="border border-zinc-200 p-2 font-medium text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">
                  {row.label}
                </td>
                {grid[r].map((n, c) => (
                  <td
                    key={c}
                    className={`border border-zinc-200 p-2 text-right tabular-nums dark:border-zinc-800 ${
                      c === baseColIndex
                        ? "bg-zinc-50 font-semibold text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
                        : "text-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {n}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
