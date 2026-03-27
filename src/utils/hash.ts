import { createHash } from "node:crypto";

/** SHA-256 hash of a string, returns hex digest */
export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/** Short content hash for learning dedup (first 16 chars of sha256) */
export function contentHash(text: string): string {
  return sha256(text.toLowerCase().trim()).slice(0, 16);
}

/**
 * Simple normalized Levenshtein similarity between two strings.
 * Returns 0.0 (completely different) to 1.0 (identical).
 * For performance, operates on the first 500 chars max.
 */
export function similarity(a: string, b: string): number {
  const sa = a.toLowerCase().trim().slice(0, 500);
  const sb = b.toLowerCase().trim().slice(0, 500);

  if (sa === sb) return 1.0;
  if (sa.length === 0 || sb.length === 0) return 0.0;

  const maxLen = Math.max(sa.length, sb.length);
  const dist = levenshtein(sa, sb);
  return 1.0 - dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Use single-row optimization for memory efficiency
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}
