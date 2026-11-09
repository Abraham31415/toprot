import { sampleDataDictionaryCsv } from "@/lib/sample-study";

export const dynamic = "force-static";

export function GET() {
  return new Response(sampleDataDictionaryCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="toprot-sample-data-dictionary.csv"',
    },
  });
}
