"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { loadStyle, type LoadedStyle } from "@/lib/csl/client";
import { BUNDLED_STYLES } from "@/lib/csl/styles";

const field = "w-full min-w-0 rounded-md border border-navy/25 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-cobalt focus:ring-2 focus:ring-cobalt/20";

/** Remembers the last style chosen in this browser. */
const KEY = "toprot-csl-style";

export function useStyle(initial = "apa") {
  const [styleId, setStyleId] = useState(initial);
  const [style, setStyle] = useState<LoadedStyle | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try { const s = localStorage.getItem(KEY); if (s && /^[a-z0-9-]+$/.test(s)) setStyleId(s); } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    let live = true;
    setBusy(true); setError(null);
    loadStyle(styleId)
      .then((s) => { if (live) { setStyle(s); try { localStorage.setItem(KEY, styleId); } catch { /* ignore */ } } })
      .catch((e: Error) => { if (live) setError(e.message); })
      .finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [styleId]);

  return { styleId, setStyleId, style, busy, error, setError };
}

export function StylePicker({ styleId, setStyleId, style, busy, error, idPrefix = "cs" }: { styleId: string; setStyleId: (id: string) => void; style: LoadedStyle | null; busy: boolean; error: string | null; idPrefix?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; title: string; dependent: boolean }[]>([]);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/csl/styles?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => r.json()).then((d) => setHits(d.styles ?? [])).catch(() => {});
    }, 250);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);

  const bundled = BUNDLED_STYLES.some((s) => s.id === styleId);
  return (
    <div>
      <label htmlFor={`${idPrefix}-style`} className="block text-sm font-semibold text-navy">Citation style</label>
      <select id={`${idPrefix}-style`} className={`${field} mt-2`} value={bundled ? styleId : "__other"} onChange={(e) => e.target.value !== "__other" && setStyleId(e.target.value)}>
        {BUNDLED_STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        {!bundled && <option value="__other">{style?.title ?? styleId}</option>}
      </select>
      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-navy/45" aria-hidden="true" />
        <label htmlFor={`${idPrefix}-search`} className="sr-only">Search all official CSL styles</label>
        <input id={`${idPrefix}-search`} className={`${field} pl-9`} placeholder="Search all official CSL styles, e.g. a journal name" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {hits.length > 0 && (
        <ul className="mt-2 max-h-52 overflow-auto rounded-md border border-line text-sm">
          {hits.map((h) => (
            <li key={h.id}><button type="button" className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-soft" onClick={() => { setStyleId(h.id); setQ(""); setHits([]); }}><span>{h.title}</span>{h.dependent && <span className="shrink-0 text-xs text-navy/50">journal style</span>}</button></li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-navy/60">
        {busy ? "Preparing style..." : style ? `Using: ${style.title}${style.parent ? ` (formatted by its parent style, ${style.parent})` : ""}.` : ""} Styles come from the official Citation Style Language repository.
      </p>
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
