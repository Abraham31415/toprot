import { describe, expect, it } from "vitest";
import { decodeDataset, encodeDataset } from "../codec";
import { evaluate, parseExpr } from "../expr";
import { parseFile } from "../parse";
import { parseDate } from "../parse/infer";
import { detectDelimiter, parseDelimited } from "../parse/text";
import { profileDataset } from "../profile";
import { apply, applyAll, appendDatasets, mergeDatasets, parseRecodeRules } from "../transform";
import { csvCell, toCsv } from "../export";
import type { Dataset } from "../types";

const enc = (s: string) => new TextEncoder().encode(s);
const ds = (cols: Record<string, (number | string | null)[]>, types: Record<string, "numeric" | "string" | "date"> = {}): Dataset => ({
  variables: Object.keys(cols).map((name) => ({ name, type: types[name] ?? (cols[name].every((c) => c === null || typeof c === "number") ? "numeric" : "string"), measure: "scale" as const, role: "none" as const })).map((v) => ({ ...v, measure: v.type === "string" ? "nominal" as const : "scale" as const })),
  columns: Object.values(cols),
});

describe("delimited text", () => {
  it("handles quotes, embedded delimiters, newlines and CRLF", () => {
    const r = parseDelimited('a,b\r\n"x, y","he said ""hi"""\n"multi\nline",2\n', ",");
    expect(r.rows).toEqual([["a", "b"], ["x, y", 'he said "hi"'], ["multi\nline", "2"]]);
    expect(r.malformedQuotes).toBe(false);
  });
  it("detects semicolon and tab delimiters", () => {
    expect(detectDelimiter("a;b;c\n1;2;3\n4;5;6\n")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2\n")).toBe("\t");
    expect(detectDelimiter("name,notes\nAnn,\"x; y; z\"\nBo,\"p; q\"\n")).toBe(",");
  });
});

describe("import", () => {
  it("infers types, missing tokens, ids, dates and reports suspicious codes", async () => {
    const csv = "ID,Age,Sex,Visit date,Score\n1,34,M,2024-01-05,12.5\n2,NA,F,2024-02-11,-99\n3,51,F,,14\n4,29,M,2024-03-01,13\n";
    const r = await parseFile(enc(csv), "s.csv");
    const byName = Object.fromEntries(r.dataset.variables.map((v) => [v.name, v]));
    expect(byName.ID.role).toBe("id");
    expect(byName.Age.type).toBe("numeric");
    expect(byName.Sex.type).toBe("string");
    expect(byName.Visit_date.type).toBe("date");
    expect(byName.Visit_date.label).toBe("Visit date");
    expect(r.dataset.columns[1][1]).toBeNull();
    expect(r.warnings.some((w) => w.text.includes("-99"))).toBe(true);
  });
  it("makes duplicate names unique and reads Windows-1252", async () => {
    const bytes = new Uint8Array([...enc("x,x,caf"), 0xe9, ...enc("\n1,2,3\n")]);
    const r = await parseFile(bytes, "d.csv");
    expect(r.dataset.variables.map((v) => v.name)).toEqual(["x", "x_2", "cafe"]);
    expect(r.report.encoding).toBe("windows-1252");
    expect(r.dataset.variables[2].label).toBe("café");
  });
  it("enforces limits and rejects binaries and unsupported formats with guidance", async () => {
    await expect(parseFile(enc("a\n1\n2\n3\n"), "a.csv", {}, { maxRows: 2, maxColumns: 10, maxBytes: 1000 })).rejects.toThrow(/more than 2 rows/);
    await expect(parseFile(new Uint8Array([0x50, 0x4b, 3, 4, 0, 0]), "a.csv")).rejects.toThrow(/binary/);
    await expect(parseFile(enc("x"), "a.sav")).rejects.toThrow(/SPSS/);
    await expect(parseFile(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), "a.xlsx")).rejects.toThrow(/xls/);
    await expect(parseFile(enc(""), "a.csv")).rejects.toThrow(/empty/);
  });
  it("reads JSON records and column objects", async () => {
    const a = await parseFile(enc('[{"a":1,"b":"x"},{"a":2,"c":true}]'), "r.json");
    expect(a.dataset.variables.map((v) => v.name)).toEqual(["a", "b", "c"]);
    expect(a.dataset.columns[2]).toEqual([null, 1]);
    const b = await parseFile(enc('{"a":[1,2,3],"b":["p","q",null]}'), "c.json");
    expect(b.report.rows).toBe(3);
  });
  it("parses day/month dates and rejects impossible ones", () => {
    expect(parseDate("05/01/2024", "dmy")).toBe("2024-01-05");
    expect(parseDate("05/01/2024", "mdy")).toBe("2024-05-01");
    expect(parseDate("31/02/2024")).toBeNull();
  });
});

describe("xlsx reader", () => {
  it("reads a minimal workbook with shared strings, numbers, booleans and dates", async () => {
    const { buildXlsx } = await import("./make-xlsx");
    const bytes = await buildXlsx([["name", "age", "dob", "ok"], ["Ann", 34, { date: 45292 }, true], ["Bo & Co", 29.5, { date: 45000 }, false]]);
    const r = await parseFile(bytes, "w.xlsx");
    expect(r.dataset.variables.map((v) => v.type)).toEqual(["string", "numeric", "date", "numeric"]);
    expect(r.dataset.columns[0]).toEqual(["Ann", "Bo & Co"]);
    expect(r.dataset.columns[2]).toEqual(["2024-01-01", "2023-03-15"]);
    expect(r.dataset.columns[3]).toEqual([1, 0]);
  });
});

describe("codec", () => {
  it("round-trips and gives the same checksum for the same data, and detects tampering", async () => {
    const d = ds({ a: [1, 2, null], b: ["x", null, "z"] });
    const e1 = await encodeDataset(d), e2 = await encodeDataset(JSON.parse(JSON.stringify(d)));
    expect(e1.checksum).toBe(e2.checksum);
    expect(await decodeDataset(e1.gz, e1.checksum)).toEqual(d);
    const other = await encodeDataset(ds({ a: [1, 2, 3], b: ["x", null, "z"] }));
    await expect(decodeDataset(other.gz, e1.checksum)).rejects.toThrow(/checksum/);
  });
  it("rejects invalid datasets", async () => {
    await expect(encodeDataset({ variables: [{ name: "1bad", type: "numeric", measure: "scale" }], columns: [[1]] })).rejects.toThrow(/not a valid variable name/);
    await expect(encodeDataset({ variables: [{ name: "a", type: "numeric", measure: "scale" }], columns: [["x"]] })).rejects.toThrow(/numeric but contains/);
  });
});

describe("expressions", () => {
  const row = (r: Record<string, number | string | null>) => (n: string) => { if (!(n in r)) throw new Error(n); return r[n]; };
  it("respects precedence, missing propagation and functions", () => {
    expect(evaluate(parseExpr("1 + 2 * 3 ^ 2"), row({}))).toBe(19);
    expect(evaluate(parseExpr("-2 ^ 2"), row({}))).toBe(-4);
    expect(evaluate(parseExpr("weight / (height/100)^2"), row({ weight: 81, height: 180 }))).toBeCloseTo(25, 10);
    expect(evaluate(parseExpr("age + 1"), row({ age: null }))).toBeNull();
    expect(evaluate(parseExpr("ifelse(age >= 18 and sex == \"F\", 1, 0)"), row({ age: 20, sex: "F" }))).toBe(1);
    expect(evaluate(parseExpr("x > 1 or y > 1"), row({ x: null, y: 2 }))).toBe(1);
    expect(evaluate(parseExpr("rowmean(a, b, c)"), row({ a: 1, b: null, c: 3 }))).toBe(2);
    expect(evaluate(parseExpr("age_years(dob, \"2024-06-01\")"), row({ dob: "2000-06-02" }))).toBe(23);
    expect(evaluate(parseExpr("1/0"), row({}))).toBeNull();
  });
  it("refuses anything that is not part of the language", () => {
    expect(() => parseExpr("constructor.constructor('x')()")).toThrow();
    expect(() => parseExpr("process.exit(1)")).toThrow(/Unknown function/);
    expect(() => parseExpr("a +")).toThrow();
    expect(() => parseExpr("(".repeat(200) + "1" + ")".repeat(200))).toThrow(/nested/);
  });
});

describe("transformations", () => {
  const d = ds({ id: [1, 2, 3, 4, 4], age: [20, 35, null, 80, 80], sex: ["m", "F", " f", "M", "M"] });
  it("computes, recodes, imputes, filters and reports what changed", () => {
    const c = apply(d, { op: "compute", name: "age10", expr: "age / 10" }).dataset;
    expect(c.columns[3]).toEqual([2, 3.5, null, 8, 8]);
    const r = apply(d, { op: "recode", source: "age", target: "agegrp", rules: [{ from: { lo: null, hi: 39.999 }, to: 1 }, { from: { lo: 40, hi: null }, to: 2 }], otherwise: "missing", valueLabels: { "1": "<40", "2": "40+" } }).dataset;
    expect(r.columns[2]).toEqual([1, 1, null, 2, 2]);
    expect(r.variables[2].measure).toBe("ordinal");
    const i = apply(d, { op: "impute", name: "age", method: "median", flag: true });
    expect(i.dataset.columns[1][2]).toBe(57.5);
    expect(i.dataset.variables.some((v) => v.name === "age_imputed")).toBe(true);
    const f = apply(d, { op: "filter_rows", expr: "age > 30" });
    expect(f.dataset.columns[0]).toEqual([2, 4, 4]);
    expect(f.summary).toMatch(/Kept 3 of 5/);
    const dup = apply(d, { op: "drop_duplicates" });
    expect(dup.dataset.columns[0]).toEqual([1, 2, 3, 4]);
    const t = apply(d, { op: "text_clean", name: "sex", trim: true, case: "lower" });
    expect(t.dataset.columns[2]).toEqual(["m", "f", "f", "m", "m"]);
  });
  it("never mutates the input and flags (not deletes) outliers", () => {
    const before = JSON.stringify(d);
    apply(d, { op: "delete_rows", rows: [0] });
    const o = apply(d, { op: "flag_outliers", name: "age", target: "age_out", method: "z", k: 1 });
    expect(JSON.stringify(d)).toBe(before);
    expect(o.dataset.columns[0].length).toBe(5);
  });
  it("reshapes long to wide and back", () => {
    const long = ds({ pid: [1, 1, 2, 2], t: [1, 2, 1, 2], y: [5, 6, 7, 8] });
    const wide = apply(long, { op: "long_to_wide", id: "pid", time: "t", values: ["y"], sep: "_" }).dataset;
    expect(wide.variables.map((v) => v.name)).toEqual(["pid", "y_1", "y_2"]);
    expect(wide.columns[2]).toEqual([6, 8]);
    const back = apply(wide, { op: "wide_to_long", id: "pid", stubs: ["y"], timeName: "t", sep: "_" }).dataset;
    expect(back.columns[2]).toEqual([5, 6, 7, 8]);
  });
  it("merges and appends with explicit checks", () => {
    const a = ds({ id: [1, 2, 3], x: [1, 2, 3] }), b = ds({ id: [1, 3], z: [10, 30] });
    expect(mergeDatasets(a, b, ["id"], "left").dataset.columns[2]).toEqual([10, null, 30]);
    expect(mergeDatasets(a, b, ["id"], "inner").dataset.columns[0]).toEqual([1, 3]);
    expect(() => mergeDatasets(a, ds({ id: [1, 1], z: [1, 2] }), ["id"], "left")).toThrow(/not unique/);
    expect(appendDatasets(a, b).dataset.columns.length).toBe(3);
  });
  it("parses recode rules", () => {
    expect(parseRecodeRules('1 = 0\n"male" = M\n18 to 39 = 1\n40 to = 2\nto 17 = 0\nmissing = 9')).toEqual([
      { from: 1, to: 0 }, { from: "male", to: "M" }, { from: { lo: 18, hi: 39 }, to: 1 }, { from: { lo: 40, hi: null }, to: 2 }, { from: { lo: null, hi: 17 }, to: 0 }, { from: null, to: 9 },
    ]);
    expect(() => parseRecodeRules("nonsense")).toThrow(/should look like/);
  });
  it("replays a log and names the failing step", () => {
    expect(() => applyAll(d, [{ op: "rename", from: "age", to: "years" }, { op: "compute", name: "z", expr: "age * 2" }])).toThrow(/Step 2/);
  });
});

describe("profiling", () => {
  it("summarises quality issues without changing data", () => {
    const d = ds({ id: [1, 2, 2], v: [1, 1, 1], s: ["Yes", "yes ", null], e: [null, null, null] });
    d.variables[0].role = "id";
    const p = profileDataset(d);
    expect(p.rows).toBe(3);
    expect(p.variables.find((v) => v.name === "id")!.issues.some((i) => i.text.includes("duplicate identifier"))).toBe(true);
    expect(p.variables.find((v) => v.name === "v")!.issues.some((i) => i.text.includes("constant"))).toBe(true);
    expect(p.variables.find((v) => v.name === "s")!.issues.some((i) => i.text.includes("Inconsistent"))).toBe(true);
    expect(p.variables.find((v) => v.name === "e")!.issues.some((i) => i.text.includes("All values are missing"))).toBe(true);
  });
});

describe("export safety", () => {
  it("neutralises spreadsheet formula injection and quotes CSV correctly", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe("\"'=HYPERLINK(\"\"x\"\")\"");
    expect(csvCell("+1")).toBe("+1");
    expect(csvCell("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(csvCell("-5")).toBe("-5");
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell("a,b")).toBe("\"a,b\"");
    expect(toCsv(["a", "b"], [[1, "@x"]])).toBe("a,b\r\n1,'@x\r\n");
  });
});
