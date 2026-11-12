/* eslint-disable react/no-children-prop -- the components are created with createElement and children passed as props for server rendering */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/users" }));
import { AdminShell } from "../shell";
import { Bars, Kpi, LineChart, Notice, Pager, RangeFilter, Table } from "../ui";
import { parseRange } from "@/lib/admin/range";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);

describe("admin shell", () => {
  const out = html(createElement(AdminShell, { email: "owner@example.org", role: "owner", openAlerts: 2, mfaWarning: false, children: createElement("p", null, "content") }));
  it("has the sidebar groups and every page in the planned order, with the current page marked", () => {
    for (const g of ["Overview", "People", "Financial", "Analytics", "Management"]) expect(out).toContain(`aria-label="${g}"`);
    for (const label of ["Dashboard", "Users", "Subscriptions", "Teams", "Revenue", "AI Credits", "AI Costs", "Traffic and funnel", "Research Activity", "System Health", "Audit Logs", "Settings"]) expect(out).toContain(label);
    expect(out).toMatch(/aria-current="page"[^>]*>(?:<svg[^>]*>[\s\S]*?<\/svg>)?<span[^>]*>Users/);
    expect(out.indexOf("People")).toBeLessThan(out.indexOf("Revenue"));
    expect(out.indexOf("Revenue")).toBeLessThan(out.indexOf("Traffic and funnel"));
  });
  it("offers a skip link, a collapse control, a menu button for phones, and the open alert count", () => {
    expect(out).toContain('href="#admin-main"');
    expect(out).toContain('aria-label="Collapse sidebar"');
    expect(out).toContain('aria-controls="admin-drawer"');
    expect(out).toContain("2 open alerts");
    expect(out).toContain('id="admin-main"');
  });
  it("warns in the top bar when two-step verification is off", () => {
    expect(html(createElement(AdminShell, { email: "a@b.c", role: "admin", openAlerts: 0, mfaWarning: true, children: null }))).toContain("MFA is off");
    expect(out).not.toContain("MFA is off");
  });
});

describe("tables, charts and filters", () => {
  it("renders real column headers and a caption, and says so when there is nothing to show", () => {
    const t = html(createElement(Table, { caption: "Users", head: ["Name", "Count"], rows: [["Ada", 3]], numeric: [1] }));
    expect(t).toContain("<caption");
    expect(t).toContain('scope="col"');
    expect(t).toContain("tabular-nums");
    expect(html(createElement(Table, { caption: "Users", head: ["Name"], rows: [], empty: "No accounts match." }))).toContain("No accounts match.");
  });
  it("labels a line chart and puts its numbers in a table for people who cannot see the lines", () => {
    const c = html(createElement(LineChart, { title: "Cost by day", labels: ["11-01", "11-02"], series: [{ name: "Cost", values: [1, 3], color: "primary" }] }));
    expect(c).toContain('role="img"');
    expect(c).toContain('aria-label="Cost by day"');
    expect(c).toContain("Show the numbers");
    expect(c).toContain("<table");
    expect(html(createElement(LineChart, { title: "x", labels: [], series: [] }))).toContain("Nothing recorded");
  });
  it("prints the value next to every bar and shows an empty message", () => {
    expect(html(createElement(Bars, { rows: [{ label: "google.com", value: 12 }] }))).toContain("12");
    expect(html(createElement(Bars, { rows: [] }))).toContain("Nothing recorded");
  });
  it("marks an estimate and explains a figure's definition", () => {
    const k = html(createElement(Kpi, { label: "MRR", value: "$10", estimate: true, note: "Active subscriptions at the current price" }));
    expect(k).toContain("Estimate");
    expect(k).toContain("Active subscriptions");
  });
  it("announces a danger notice as an alert", () => {
    expect(html(createElement(Notice, { tone: "danger", title: "Could not load", children: "Try again" }))).toContain('role="alert"');
    expect(html(createElement(Notice, { tone: "info", children: "Note" }))).toContain('role="note"');
  });
  it("pages with previous and next links and disables the ends", () => {
    const first = html(createElement(Pager, { total: 60, page: 1, pageSize: 25, hrefFor: (p: number) => `/x?page=${p}` }));
    expect(first).toContain("Showing 1 to 25 of 60");
    expect(first).toContain('href="/x?page=2"');
    expect(first).toMatch(/aria-disabled="true"[^>]*>Previous/);
    const last = html(createElement(Pager, { total: 60, page: 3, pageSize: 25, hrefFor: (p: number) => `/x?page=${p}` }));
    expect(last).toContain("Showing 51 to 60 of 60");
    expect(last).toMatch(/aria-disabled="true"[^>]*>Next/);
    expect(html(createElement(Pager, { total: 0, page: 1, pageSize: 25, hrefFor: () => "/x" }))).toContain("No results");
  });
  it("offers the preset periods and a custom range, states the timezone, and shows a range error", () => {
    const r = parseRange({ range: "custom", from: "2026-11-09", to: "2026-11-02" }, "Africa/Kampala", new Date("2026-11-12T10:00:00Z"));
    const f = html(createElement(RangeFilter, { range: r, base: "/admin/revenue", keep: { status: "failed" } }));
    for (const label of ["Today", "Last 7 days", "Last 30 days", "Last 90 days"]) expect(f).toContain(label);
    expect(f).toContain('name="range" value="custom"');
    expect(f).toContain('name="status" value="failed"');
    expect(f).toContain("Africa/Kampala");
    expect(f).toContain('role="alert"');
    expect(f).toContain("range=7d");
  });
});
