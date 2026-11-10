import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProcessor, getProcessor, renderDocument, type Locales } from "../engine";
import { toCslItem } from "../../refs/convert";

const pub = path.resolve(__dirname, "../../../../public/csl");
const style = (id: string) => readFileSync(path.join(pub, "styles", `${id}.csl`), "utf8");
const LOCALES: Locales = { "en-US": readFileSync(path.join(pub, "locales/locales-en-US.xml"), "utf8") };
const item = (id: string, title: string, family: string, year: number) => toCslItem({ type: "article-journal", title, authors: [{ family, given: "X." }], journal: "J", year }, id);

describe("processor reuse", () => {
  const xml = style("elsevier-vancouver");
  const items = [item("a", "Alpha", "Smith", 2020), item("b", "Beta", "Jones", 2018)];

  it("gives the same result on repeat renders and restarts numbering for each document", () => {
    const p = createProcessor(xml, LOCALES, items);
    const first = renderDocument("One [@a] two [@b].", items, xml, LOCALES, undefined, p);
    const swapped = renderDocument("One [@b] two [@a].", items, xml, LOCALES, undefined, p);
    const again = renderDocument("One [@a] two [@b].", items, xml, LOCALES, undefined, p);
    expect(first.text).toBe("One [1] two [2].");
    expect(swapped.text).toBe("One [1] two [2].");
    expect(swapped.bibliographyText.split("\n")[0]).toContain("Jones");
    expect(again).toEqual(first);
  });
  it("matches a freshly built processor exactly", () => {
    const p = createProcessor(xml, LOCALES, items);
    renderDocument("Warm up [@b; @a] [@a].", items, xml, LOCALES, undefined, p);
    const reused = renderDocument("Real [@a] and [@b].", items, xml, LOCALES, undefined, p);
    const fresh = renderDocument("Real [@a] and [@b].", items, xml, LOCALES);
    expect(reused).toEqual(fresh);
  });
  it("picks up edited references and removed ones without rebuilding", () => {
    const p = createProcessor(xml, LOCALES, items);
    renderDocument("[@a]", items, xml, LOCALES, undefined, p);
    const edited = [item("a", "Alpha EDITED", "Smith", 2020), item("b", "Beta", "Jones", 2018)];
    expect(renderDocument("[@a]", edited, xml, LOCALES, undefined, p).bibliographyText).toContain("Alpha EDITED");
    const removed = renderDocument("[@a]", [item("b", "Beta", "Jones", 2018)], xml, LOCALES, undefined, p);
    expect(removed.missing).toEqual(["a"]);
    expect(removed.bibliographyText).toBe("");
  });
  it("the cache returns one processor per key and swaps references in", () => {
    const a = getProcessor("k1", xml, LOCALES, items);
    const b = getProcessor("k1", xml, LOCALES, [item("z", "Zeta", "Zed", 2001)]);
    expect(b).toBe(a);
    const d = renderDocument("[@z]", [item("z", "Zeta", "Zed", 2001)], xml, LOCALES, undefined, b);
    expect(d.bibliographyText).toContain("Zeta");
    expect(getProcessor("k2", xml, LOCALES, items)).not.toBe(a);
  });
  it("is much faster to reuse than to rebuild for a large style", () => {
    const big = style("apa");
    const t0 = Date.now();
    const p = createProcessor(big, LOCALES, items);
    const build = Date.now() - t0;
    const t1 = Date.now();
    for (let i = 0; i < 10; i++) renderDocument("Text [@a] and [@b].", items, big, LOCALES, undefined, p);
    const ten = Date.now() - t1;
    expect(ten).toBeLessThan(Math.max(build, 300));
  });
});
