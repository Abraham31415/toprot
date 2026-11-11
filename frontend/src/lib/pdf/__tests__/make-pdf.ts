// Builds small but valid PDFs for tests: Helvetica text on A4 pages, optional document info, optional garbage.
export function makePdf(pages: string[][], info: Record<string, string> = {}): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objs: string[] = [];
  const add = (body: string) => { objs.push(body); return objs.length; };
  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // pages placeholder (object 2)
  const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const kids: number[] = [];
  for (const lines of pages) {
    let y = 780;
    const stream = ["BT", "/F1 11 Tf", "14 TL", `72 ${y} Td`, ...lines.map((l) => `(${esc(l)}) Tj T*`), "ET"].join("\n");
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
    y -= 0;
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  const infoEntries = Object.entries(info);
  const infoObj = infoEntries.length ? add(`<< ${infoEntries.map(([k, v]) => `/${k} (${esc(v)})`).join(" ")} >>`) : 0;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((b, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R${infoObj ? ` /Info ${infoObj} 0 R` : ""} >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
