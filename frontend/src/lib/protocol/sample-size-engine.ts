"use server";

import type { SampleSizeInput, SampleSizeResult } from "./sample-size";

export type SampleSizeCalcResult = { error?: string; result?: SampleSizeResult };

/**
 * The single entry point that talks to the document service's sample size
 * engine. Both the protocol-embedded calculator (section-sample-size.tsx,
 * which additionally persists the result to the protocol version) and the
 * standalone /calculator route call this -- neither re-implements the math.
 */
export async function runSampleSizeCalculation(input: SampleSizeInput): Promise<SampleSizeCalcResult> {
  const serviceUrl = process.env.NEXT_PUBLIC_DOC_SERVICE_URL;
  if (!serviceUrl) return { error: "Document service URL is not configured." };

  let response: Response;
  try {
    response = await fetch(`${serviceUrl}/sample-size/calculate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    });
  } catch (err) {
    return { error: `Could not reach the document service: ${(err as Error).message}` };
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    return {
      error: body?.detail ? JSON.stringify(body.detail) : `Calculation failed (HTTP ${response.status})`,
    };
  }

  const result: SampleSizeResult = await response.json();
  return { result };
}
