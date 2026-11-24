// Test helper: builds a minimal but valid .xlsx (deflate-compressed zip) so the reader is tested against real zip structure.

type Cell = string | number | boolean | { date: number } | null;

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(b: Uint8Array) { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function deflateRaw(b: Uint8Array) { return new Uint8Array(await new Response(new Blob([b as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()); }
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const col = (j: number) => String.fromCharCode(65 + j);

export async function buildXlsx(rows: Cell[][]): Promise<Uint8Array> {
  const strings: string[] = [];
  const si = (s: string) => { let i = strings.indexOf(s); if (i < 0) { strings.push(s); i = strings.length - 1; } return i; };
  const sheetRows = rows.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => {
    const ref = `${col(j)}${i + 1}`;
    if (c === null) return "";
    if (typeof c === "string") return `<c r="${ref}" t="s"><v>${si(c)}</v></c>`;
    if (typeof c === "boolean") return `<c r="${ref}" t="b"><v>${c ? 1 : 0}</v></c>`;
    if (typeof c === "number") return `<c r="${ref}"><v>${c}</v></c>`;
    return `<c r="${ref}" s="1"><v>${c.date}</v></c>`;
  }).join("")}</row>`).join("");
  const files: Record<string, string> = {
    "[Content_Types].xml": '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "xl/workbook.xml": '<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/styles.xml": '<?xml version="1.0"?><styleSheet><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    "xl/worksheets/sheet1.xml": `<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  files["xl/sharedStrings.xml"] = `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`;
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text), comp = await deflateRaw(raw), nm = enc.encode(name), crc = crc32(raw);
    const lh = new Uint8Array(30 + nm.length); const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, 8, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, comp.length, true); lv.setUint32(22, raw.length, true); lv.setUint16(26, nm.length, true); lh.set(nm, 30);
    const ch = new Uint8Array(46 + nm.length); const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, 8, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, comp.length, true); cv.setUint32(24, raw.length, true); cv.setUint16(28, nm.length, true); cv.setUint32(42, offset, true); ch.set(nm, 46);
    locals.push(lh, comp); centrals.push(ch);
    offset += lh.length + comp.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, centrals.length, true); ev.setUint16(10, centrals.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, offset, true);
  const all = [...locals, ...centrals, eocd];
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}
