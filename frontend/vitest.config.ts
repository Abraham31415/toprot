import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["src/**/*.test.ts"],
    // DB tests share one scratch Postgres database; run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
