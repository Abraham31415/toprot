import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The design system must use tokens only. A raw colour in a component would bypass the palette and break theming.
const DIR = join(__dirname, "..");
const FILES = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f));

describe("design system", () => {
  it("has component files to check", () => expect(FILES.length).toBeGreaterThan(5));
  for (const f of FILES) {
    it(`${f} contains no raw hex colours`, () => {
      expect(readFileSync(join(DIR, f), "utf8")).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });
  }
});
