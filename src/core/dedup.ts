import type { ExtractedPattern, Learning } from "./types.js";
import { contentHash, similarity } from "../utils/hash.js";

const SIMILARITY_THRESHOLD = 0.7;

/**
 * Deduplicate new patterns against existing learnings.
 * Returns the updated learnings array.
 *
 * Strategy:
 * - Content hash for exact dedup
 * - String similarity for near-duplicate detection
 * - Keep the most recent version of similar learnings
 * - Track frequency (more frequent = more valuable)
 */
export function dedup(
  existing: Learning[],
  newPatterns: ExtractedPattern[]
): Learning[] {
  const learnings = [...existing];

  for (const pattern of newPatterns) {
    const hash = contentHash(pattern.summary + pattern.detail);

    // Check for exact match by hash
    const exactMatch = learnings.find((l) => l.id === hash);
    if (exactMatch) {
      // Bump frequency and update lastSeen
      exactMatch.frequency++;
      exactMatch.lastSeen = pattern.timestamp || new Date().toISOString();
      if (!exactMatch.sessionIds.includes(pattern.sessionId)) {
        exactMatch.sessionIds.push(pattern.sessionId);
      }
      // Update confidence to the higher of the two
      exactMatch.confidence = Math.max(exactMatch.confidence, pattern.confidence);
      continue;
    }

    // Check for near-duplicate by string similarity
    const nearMatch = learnings.find(
      (l) =>
        l.type === pattern.type &&
        similarity(l.summary, pattern.summary) >= SIMILARITY_THRESHOLD
    );

    if (nearMatch) {
      // Keep the more recent version (replace summary/detail)
      const patternTime = pattern.timestamp || "";
      if (patternTime >= (nearMatch.lastSeen || "")) {
        nearMatch.summary = pattern.summary;
        nearMatch.detail = pattern.detail;
      }
      nearMatch.frequency++;
      nearMatch.lastSeen = patternTime || nearMatch.lastSeen;
      nearMatch.confidence = Math.max(nearMatch.confidence, pattern.confidence);
      if (!nearMatch.sessionIds.includes(pattern.sessionId)) {
        nearMatch.sessionIds.push(pattern.sessionId);
      }
      continue;
    }

    // New learning
    learnings.push({
      id: hash,
      type: pattern.type,
      summary: pattern.summary,
      detail: pattern.detail,
      confidence: pattern.confidence,
      frequency: 1,
      firstSeen: pattern.timestamp || new Date().toISOString(),
      lastSeen: pattern.timestamp || new Date().toISOString(),
      pinned: false,
      sessionIds: [pattern.sessionId],
    });
  }

  return learnings;
}

/**
 * Prune learnings by staleness, preserving high-confidence and pinned entries.
 * staleness_score = age_days / confidence — higher = more stale.
 */
export function prune(
  learnings: Learning[],
  maxLearnings: number,
  pruneAfterDays: number
): Learning[] {
  if (learnings.length <= maxLearnings) return learnings;

  const now = Date.now();

  // Partition: pinned + high-confidence (>= 0.9) are protected
  const protected_: Learning[] = [];
  const pruneable: Learning[] = [];

  for (const l of learnings) {
    if (l.pinned || l.confidence >= 0.9) {
      protected_.push(l);
    } else {
      const ageDays =
        (now - new Date(l.lastSeen).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays > pruneAfterDays && l.frequency <= 1) {
        // Old one-off learning — candidate for removal
        pruneable.push(l);
      } else {
        protected_.push(l);
      }
    }
  }

  // If still over limit, sort pruneable by staleness score
  if (protected_.length >= maxLearnings) {
    return protected_.slice(0, maxLearnings);
  }

  const remainingSlots = maxLearnings - protected_.length;
  pruneable.sort((a, b) => {
    const ageA =
      (now - new Date(a.lastSeen).getTime()) / (1000 * 60 * 60 * 24);
    const ageB =
      (now - new Date(b.lastSeen).getTime()) / (1000 * 60 * 60 * 24);
    const scoreA = ageA / Math.max(a.confidence, 0.1);
    const scoreB = ageB / Math.max(b.confidence, 0.1);
    return scoreA - scoreB; // least stale first
  });

  return [...protected_, ...pruneable.slice(0, remainingSlots)];
}
