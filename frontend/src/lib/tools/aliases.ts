// Public URLs for calculators. Internal slugs are stored with saved calculations, so they never change; where a more
// search-friendly address is wanted, the internal slug is mapped to a public one and the old address redirects (see
// next.config.ts). Kept free of imports so the registry and the SEO content can both use it.

export const SLUG_ALIASES: Record<string, string> = {
  "chi-square-test": "chi-square-calculator",
  "diagnostic-test-calculator": "diagnostic-accuracy-calculator",
};

/** The address the world sees for an internal calculator slug. */
export const publicSlugFor = (internal: string): string => SLUG_ALIASES[internal] ?? internal;

/** The internal slug behind a public one (only the aliased ones differ). */
export const internalSlugFor = (publicSlug: string): string => Object.entries(SLUG_ALIASES).find(([, p]) => p === publicSlug)?.[0] ?? publicSlug;
