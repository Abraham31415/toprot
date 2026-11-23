import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppLoading } from "@/components/app-loading";
import { AnimatedLogo, BrandLogo, LogoLoader, LogoMark, LOGO_CHEVRON_PATH, LOGO_DIAMOND_PATH, LOGO_HANDLE_PATH, LOGO_RING_PATH, LOGO_STROKES } from "@/components/brand";
import { strokesFor } from "../logo-geometry";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
const ALL = [LOGO_RING_PATH, LOGO_HANDLE_PATH, LOGO_CHEVRON_PATH, LOGO_DIAMOND_PATH];
const PARTS = ["ring", "handle", "chevron", "diamond"];

describe("logo geometry", () => {
  it("draws ring, handle, lower layer, upper layer, in that order", () => {
    expect(LOGO_STROKES.map((s) => s.part)).toEqual(PARTS);
    expect(LOGO_STROKES.map((s) => s.d)).toEqual(ALL);
  });
  it.each(ALL.map((d, i) => [PARTS[i], d]))("the %s is one continuous stroke (a single moveto)", (_, d) => {
    expect(count(d, /M/g)).toBe(1);
  });
  it("the handle starts exactly where the ring starts", () => {
    expect(LOGO_HANDLE_PATH.split("L")[0]).toBe(LOGO_RING_PATH.split("A")[0]);
  });
  it("uses heavier strokes at small sizes, with fine pages inside a heavy frame", () => {
    expect(strokesFor(24).pages).toBeGreaterThan(strokesFor(64).pages);
    expect(strokesFor(64).pages).toBeLessThan(strokesFor(64).frame);
  });
});

describe("LogoMark (static)", () => {
  const out = html(createElement(LogoMark, { size: 64 }));
  it("renders the four strokes as outline paths only", () => {
    expect(count(out, /<path\b/g)).toBe(4);
    for (const part of PARTS) expect(out).toContain(`toprot-logo-${part}`);
    expect(out).toContain('fill="none"');
    expect(out).not.toMatch(/<(circle|rect|polygon|ellipse|line)\b/);
  });
  it("colours the frame and the pages from theme tokens", () => {
    expect(count(out, /stroke:var\(--toprot-logo-frame\)/g)).toBe(2);
    expect(count(out, /stroke:var\(--toprot-logo-pages\)/g)).toBe(2);
    expect(out).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
  it("has no animation hooks", () => {
    expect(out).not.toMatch(/toprot-logo--(draw|loop)/);
    expect(out).not.toContain("pathLength");
  });
  it("is labelled for assistive tech by default", () => {
    expect(out).toContain('role="img"');
    expect(out).toMatch(/aria-labelledby="toprot-logo-t-/);
    expect(out).toContain(">ToProt</title>");
  });
  it("accepts a custom title", () => {
    expect(html(createElement(LogoMark, { title: "Home" }))).toContain(">Home</title>");
  });
  it("is hidden from assistive tech when decorative", () => {
    const d = html(createElement(LogoMark, { decorative: true }));
    expect(d).toContain('aria-hidden="true"');
    expect(d).not.toContain("<title");
    expect(d).not.toContain('role="img"');
  });
  it("switches colour tokens for dark backgrounds", () => {
    expect(html(createElement(LogoMark, { variant: "dark" }))).toContain("toprot-logo--dark");
    expect(out).not.toContain("toprot-logo--dark");
  });
  it("gives each instance its own title id", () => {
    const two = html(createElement("div", null, createElement(LogoMark), createElement(LogoMark)));
    const ids = [...two.matchAll(/<title id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("AnimatedLogo", () => {
  it("draws once by default, each stroke measured as a unit length", () => {
    const out = html(createElement(AnimatedLogo, { size: 64 }));
    expect(count(out, /<path\b/g)).toBe(4);
    expect(count(out, /pathLength="1"/g)).toBe(4);
    expect(out).toContain("toprot-logo--draw");
    expect(out).toContain('data-motion="draw"');
  });
  it("loops with the draw-hold-fade cycle when once is false", () => {
    const out = html(createElement(AnimatedLogo, { once: false }));
    expect(out).toContain("toprot-logo--loop");
    expect(out).toContain('data-motion="loop"');
  });
  it("shows the finished static logo under reduced motion", () => {
    const out = html(createElement(AnimatedLogo, { reducedMotion: true, once: false }));
    expect(out).not.toMatch(/toprot-logo--(draw|loop)/);
    expect(out).toContain('data-motion="none"');
    expect(count(out, /<path\b/g)).toBe(4);
  });
  it("ends on exactly the static logo", () => {
    const still = html(createElement(AnimatedLogo, { reducedMotion: true, size: 64 }));
    const plain = html(createElement(LogoMark, { size: 64 }));
    const strip = (s: string) => s.replace(/toprot-logo-t-[^"]+/g, "ID");
    expect(strip(still)).toBe(strip(plain));
  });
  it("passes duration and delay as CSS variables", () => {
    const out = html(createElement(AnimatedLogo, { duration: 4, delay: 0.5 }));
    expect(out).toContain("--logo-duration:4s");
    expect(out).toContain("--logo-delay:0.5s");
  });
  it("is labelled, or hidden when decorative", () => {
    expect(html(createElement(AnimatedLogo))).toContain('role="img"');
    expect(html(createElement(AnimatedLogo, { decorative: true }))).toContain('aria-hidden="true"');
  });
});

describe("LogoLoader", () => {
  it("announces a status and keeps the logo itself decorative", () => {
    const out = html(createElement(LogoLoader, { label: "Loading studies" }));
    expect(out).toContain('role="status"');
    expect(out).toContain("Loading studies");
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain("toprot-logo--loop");
  });
  it("can draw once instead of looping, and respects reduced motion", () => {
    expect(html(createElement(LogoLoader, { loop: false }))).toContain("toprot-logo--draw");
    const still = html(createElement(LogoLoader, { reducedMotion: true }));
    expect(still).not.toContain("toprot-logo--loop");
    expect(count(still, /<path\b/g)).toBe(4);
  });
});

describe("static brand files", () => {
  const read = (p: string) => readFileSync(join(__dirname, "../../../..", p), "utf8");
  it.each(["public/brand/toprot-logo.svg", "public/brand/toprot-logo-dark.svg", "src/app/icon.svg"])("%s carries the same four strokes", (f) => {
    const svg = read(f);
    expect(count(svg, /<path\b/g)).toBe(4);
    for (const d of ALL) expect(svg).toContain(d);
  });
  it("animation CSS exists for every stroke and is switched off for reduced motion", () => {
    const css = read("src/app/globals.css");
    for (const p of PARTS) {
      expect(css).toContain(`.toprot-logo--draw .toprot-logo-${p}`);
      expect(css).toContain(`.toprot-logo--loop .toprot-logo-${p}`);
    }
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.toprot-logo--draw path, \.toprot-logo--loop path, \.toprot-logo--loop \.toprot-logo-art \{ animation: none/);
  });
  it("uses no em dashes in the brand components", () => {
    for (const f of ["logo-mark.tsx", "animated-logo.tsx", "logo-loader.tsx"]) {
      expect(read(`src/components/brand/${f}`)).not.toContain("—");
    }
  });
});

describe("BrandLogo (headers)", () => {
  it("draws on a full page load and is decorative beside the product name", () => {
    const out = html(createElement(BrandLogo));
    expect(out).toContain("toprot-logo--draw");
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('width="28"');
  });
});

describe("AppLoading", () => {
  it("shows the looping logo with one announced status", () => {
    const out = html(createElement(AppLoading, { label: "dashboard" }));
    expect(out).toContain("toprot-logo--loop");
    expect(count(out, /role="status"/g)).toBe(1);
    expect(out).toContain("Loading dashboard");
    expect(out).not.toContain("animate-pulse");
  });
});
