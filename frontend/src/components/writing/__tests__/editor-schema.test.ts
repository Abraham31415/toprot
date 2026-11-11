// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { buildExtensions } from "../extensions";
import { validateDoc, countWords, type Doc } from "@/lib/writing/doc";
import { TEMPLATES, buildTemplateDoc } from "@/lib/writing/templates";

// The real editor schema (StarterKit, tables, citation, figure) must only ever produce documents the server accepts.

const MS = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", IMG = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REF = "11111111-1111-4111-8111-111111111111";

function make(content?: unknown) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: buildExtensions(""), content: content as never });
}

describe("editor schema matches the stored document model", () => {
  it("loads every template and returns a document the server accepts", () => {
    for (const t of TEMPLATES) {
      const e = make(buildTemplateDoc(t.id));
      expect(() => validateDoc(e.getJSON(), MS), t.id).not.toThrow();
      e.destroy();
    }
  });

  it("round-trips formatting, lists, tables, a citation and a figure through the editor", () => {
    const e = make();
    e.commands.setContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Methods" }] },
        { type: "paragraph", content: [
          { type: "text", text: "Bold", marks: [{ type: "bold" }] }, { type: "text", text: " " },
          { type: "text", text: "sup", marks: [{ type: "superscript" }] }, { type: "text", text: " " },
          { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://example.org" } }] },
          { type: "citation", attrs: { items: [{ id: REF, locator: "12" }] } },
        ] },
        { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] }] },
        { type: "figure", attrs: { path: `${USER}/${MS}/${IMG}.png`, alt: "a", caption: "A figure", width: 10, height: 10 } },
      ],
    });
    e.chain().focus("end").insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    const json = e.getJSON() as Doc;
    const clean = validateDoc(json, MS);
    expect(JSON.stringify(clean).includes('"citation"')).toBe(true);
    expect(JSON.stringify(clean).includes('"tableHeader"')).toBe(true);
    expect(JSON.stringify(clean).includes('"figure"')).toBe(true);
    expect(countWords(clean)).toBeGreaterThan(3);
    e.destroy();
  });

  it("produces valid documents for typical editing commands", () => {
    const e = make();
    e.chain().focus().insertContent("Hello world").selectAll().toggleBold().toggleItalic().toggleUnderline().toggleStrike().toggleSubscript().run();
    e.chain().focus().setHeading({ level: 3 }).run();
    e.chain().focus("end").insertContent([{ type: "paragraph", content: [{ type: "text", text: "quote" }] }]).toggleBlockquote().run();
    e.chain().focus("end").toggleBulletList().insertContent("item").run();
    e.chain().focus("end").setHorizontalRule().run();
    e.chain().focus("end").toggleCodeBlock().insertContent("x = 1").run();
    expect(() => validateDoc(e.getJSON(), MS)).not.toThrow();
    e.destroy();
  });

  it("has no hard-break or unknown-node surprises from pasted HTML", () => {
    const e = make();
    e.commands.setContent("<h1>Title</h1><p>Line one<br>line two <em>em</em> <script>alert(1)</script></p><ul><li>a</li></ul><table><tr><th>H</th></tr><tr><td>c</td></tr></table><img src=x onerror=alert(1)>");
    const json = e.getJSON() as Doc;
    expect(() => validateDoc(json, MS)).not.toThrow();
    expect(JSON.stringify(json)).not.toMatch(/script|onerror/);
    e.destroy();
  });

  it("can undo and redo", () => {
    const e = make();
    e.chain().focus().insertContent("first").run();
    e.commands.undo();
    expect(countWords(e.getJSON() as Doc)).toBe(0);
    e.commands.redo();
    expect(countWords(e.getJSON() as Doc)).toBe(1);
    e.destroy();
  });
});
