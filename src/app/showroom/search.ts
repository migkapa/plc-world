/**
 * Forgiving search matching for the showroom and reference lists: case-, space-, hyphen-, dot-, slash- and
 * underscore-insensitive, so "24V" finds "24 V DC", "photo eye" finds "photo-eye" and "5069 ob16" finds "5069-OB16".
 */
export function normalizeSearch(s: string): string {
  return s.toLowerCase().replace(/[\s\-._/·–—]+/g, '');
}

/** True when every whitespace-separated word of `query` occurs (normalised) somewhere in `haystack`. */
export function matchesQuery(haystack: string, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  const hay = normalizeSearch(haystack);
  if (hay.includes(normalizeSearch(q))) return true;
  const words = q.split(/\s+/).map(normalizeSearch).filter(Boolean);
  return words.length > 1 && words.every((w) => hay.includes(w));
}
