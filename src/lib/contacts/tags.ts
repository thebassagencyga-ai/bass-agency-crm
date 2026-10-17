// Contact tags (Phase 17, ADR-033): short labels such as "VIP" or "Church". Mirrors the
// database check in supabase/migrations/20261027120000_tags_merge.sql.

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

/** One tag as typed: spaces collapsed and trimmed, control characters removed. */
export function cleanTag(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Comma-separated text → tags. Blank entries are skipped and repeats (ignoring case) dropped.
 * `known` are tags already in use: a tag typed in another case takes the known spelling, so
 * "vip" joins "VIP" instead of starting a second tag.
 */
export function parseTags(input: string, known: readonly string[] = []): { tags: string[]; error: string | null } {
  const spelling = new Map(known.map((t) => [t.toLowerCase(), t]));
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const part of input.split(",")) {
    const tag = cleanTag(part);
    if (tag === "") continue;
    if (tag.length > MAX_TAG_LENGTH) return { tags, error: `"${tag.slice(0, 20)}…" is too long (max ${MAX_TAG_LENGTH} characters per tag).` };
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(spelling.get(key) ?? tag);
  }
  if (tags.length > MAX_TAGS) return { tags, error: `Use at most ${MAX_TAGS} tags.` };
  return { tags, error: null };
}

/** A tag name for rename: cleaned, or an error. Empty means "remove". */
export function parseTagName(raw: string): { name: string; error: string | null } {
  const name = cleanTag(raw);
  if (name.includes(",")) return { name, error: "A tag cannot contain a comma." };
  if (name.length > MAX_TAG_LENGTH) return { name, error: `Use at most ${MAX_TAG_LENGTH} characters.` };
  return { name, error: null };
}
