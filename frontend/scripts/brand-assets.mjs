// Regenerates the static brand files from the source paths in src/components/brand/logo-geometry.ts.
//   node scripts/brand-assets.mjs
// Writes: public/brand/toprot-logo.svg, public/brand/toprot-logo-dark.svg, src/app/icon.svg,
//         src/app/apple-icon.png (180px) and src/app/favicon.ico (16, 32 and 48px PNGs in one ICO).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const geo = readFileSync(join(root, "src/components/brand/logo-geometry.ts"), "utf8");
const P = (name) => geo.match(new RegExp(`LOGO_${name}_PATH =\\s*"([^"]+)"`))[1];
const [RING, HANDLE, CHEVRON, DIAMOND] = ["RING", "HANDLE", "CHEVRON", "DIAMOND"].map(P);
const NAVY = "#142c50", TEAL = "#0bae9b", FRAME_DK = "#dbe4f5", TEAL_DK = "#2fd3bd", PAPER = "#f8fafc";
// Navy frame (ring + handle) and teal pages (two layers). `fc`/`pc` are colours or class hooks.
const art = (frame, pages, fc, pc) =>
  `<g stroke-linecap="round" stroke-linejoin="round"><g ${fc} stroke-width="${frame}"><path d="${RING}"/><path d="${HANDLE}"/></g>` +
  `<g ${pc} stroke-width="${pages}"><path d="${CHEVRON}"/><path d="${DIAMOND}"/></g></g>`;

const mark = (frameColour, pagesColour) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="none" role="img" aria-labelledby="t"><title id="t">ToProt</title>` +
  `${art(4.6, 2.1, `stroke="${frameColour}"`, `stroke="${pagesColour}"`)}</svg>\n`;

const light = mark(NAVY, TEAL);
const dark = mark(FRAME_DK, TEAL_DK);
// Favicon: heavier lines for small sizes, and it follows the browser's dark tab strip.
const favicon =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="none"><style>.f{stroke:${NAVY}}.p{stroke:${TEAL}}@media (prefers-color-scheme:dark){.f{stroke:${FRAME_DK}}.p{stroke:${TEAL_DK}}}</style>` +
  `${art(5.2, 3.2, 'class="f"', 'class="p"')}</svg>\n`;

writeFileSync(join(root, "public/brand/toprot-logo.svg"), light);
writeFileSync(join(root, "public/brand/toprot-logo-dark.svg"), dark);
writeFileSync(join(root, "src/app/icon.svg"), favicon);

const raster = (size, pad, bg) => {
  const inner = Math.round(size * (1 - 2 * pad));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : ""}<svg x="${pad * size}" y="${pad * size}" width="${inner}" height="${inner}" viewBox="0 0 64 64" fill="none">${size <= 32 ? art(5.2, 3.2, `stroke="${NAVY}"`, `stroke="${TEAL}"`) : art(4.6, 2.1, `stroke="${NAVY}"`, `stroke="${TEAL}"`)}</svg></svg>`;
  return sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer();
};

writeFileSync(join(root, "src/app/apple-icon.png"), await raster(180, 0.17, PAPER));

// ICO container with PNG payloads (supported by every current browser).
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => raster(s, 0.02, null)));
const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e.writeUInt8(s, 0); e.writeUInt8(s, 1); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(pngs[i].length, 8); e.writeUInt32LE(offset, 12);
  offset += pngs[i].length;
  return e;
});
writeFileSync(join(root, "src/app/favicon.ico"), Buffer.concat([head, ...entries, ...pngs]));
console.log("brand assets written");
