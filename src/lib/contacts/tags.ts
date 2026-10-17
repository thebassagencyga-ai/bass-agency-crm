// Contact tags (Phase 17, ADR-033; picked from a list since Phase 20, ADR-036): short labels such
// as "VIP" or "Church". Mirrors the database checks in supabase/migrations/2026102[7|9]…_tag*.sql.

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

/** One tag as typed: spaces collapsed and trimmed, control characters removed. */
export function cleanTag(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Tags ticked on the contact form (Phase 20). Only tags on the agent's list — or already on this
 * contact — are kept, in the list's spelling; repeats are dropped. The database checks the same.
 */
export function pickTags(selected: readonly string[], allowed: readonly string[]): { tags: string[]; error: string | null } {
  const spelling = new Map(allowed.map((t) => [t.toLowerCase(), t]));
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of selected) {
    const key = cleanTag(raw).toLowerCase();
    const tag = spelling.get(key);
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  if (tags.length > MAX_TAGS) return { tags, error: `Choose at most ${MAX_TAGS} tags.` };
  return { tags, error: null };
}

/** A tag name for rename: cleaned, or an error. Empty means "remove". */
export function parseTagName(raw: string): { name: string; error: string | null } {
  const name = cleanTag(raw);
  if (name.includes(",")) return { name, error: "A tag cannot contain a comma." };
  if (name.length > MAX_TAG_LENGTH) return { name, error: `Use at most ${MAX_TAG_LENGTH} characters.` };
  return { name, error: null };
}
