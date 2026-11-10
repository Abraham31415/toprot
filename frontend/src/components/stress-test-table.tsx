"use client";

import type { SampleSizeResult } from "@/lib/protocol/sample-size";

export function StressTestTable({ stressTest }: { stressTest: SampleSizeResult["stress_test"] }) {
  const { effect_label, dropout_label, rows, columns, grid } = stressTest;
  const baseColIndex = Math.floor(columns.length / 2);

  return (
    <div>
      <p className="mb-2 text-sm font-medium text-navy/85">
        Required N by {dropout_label.toLowerCase()} (rows) and {effect_label.toLowerCase()} (columns)
      </p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border border-line p-2 text-left text-navy/65">
                {dropout_label} \ {effect_label}
              </th>
              {columns.map((col, i) => (
                <th
                  key={i}
                  className={`border border-line p-2 text-right font-medium ${
                    i === baseColIndex
                      ? "bg-navy/5 text-navy"
                      : "text-navy/65"
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
                <td className="border border-line p-2 font-medium text-navy/85">
                  {row.label}
                </td>
                {grid[r].map((n, c) => (
                  <td
                    key={c}
                    className={`border border-line p-2 text-right tabular-nums ${
                      c === baseColIndex
                        ? "bg-paper font-semibold text-navy"
                        : "text-navy/85"
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
