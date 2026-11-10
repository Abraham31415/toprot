"""Build src/lib/csl/style-index.json from the official CSL style index.

Source: https://www.zotero.org/styles-files/styles.json (the Zotero Style Repository, which lists the styles in
https://github.com/citation-style-language/styles). Run occasionally to refresh the list of styles that users can search.
Usage: python scripts/build_csl_index.py
"""
import json, re, sys, urllib.request, datetime

URL = "https://www.zotero.org/styles-files/styles.json"
OUT = "src/lib/csl/style-index.json"

with urllib.request.urlopen(URL, timeout=60) as r:
    data = json.load(r)

def fmt(x):
    cats = x.get("categories") or {}
    f = cats.get("format") if isinstance(cats, dict) else None
    return f if f in ("author-date", "numeric", "label", "note", "author") else ""

rows = []
for x in data:
    if not re.fullmatch(r"[a-z0-9-]{1,120}", x.get("name", "")):
        continue
    rows.append([x["name"], x.get("title", x["name"]), 1 if x.get("dependent") else 0, fmt(x)])
rows.sort(key=lambda r: r[1].lower())
json.dump({"generated": datetime.date.today().isoformat(), "source": URL, "count": len(rows), "styles": rows}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print("styles:", len(rows), "independent:", sum(1 for r in rows if not r[2]))
