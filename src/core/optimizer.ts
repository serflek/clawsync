import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import type { Learning, SyncState, Config } from "./types.js";
import { sha256 } from "../utils/hash.js";

const SENTINEL_START = "<!-- clawsync:start -->";
const SENTINEL_END = "<!-- clawsync:end -->";

export interface OptimizeResult {
  written: boolean;
  reason: string;
  learningsCount: number;
  targetPath: string;
}

/**
 * Optimize a CLAUDE.md file with extracted learnings.
 *
 * Rules:
 * - Uses sentinel comments to mark managed section
 * - NEVER overwrites content outside the sentinels
 * - Hash-based manual edit detection
 * - Importance-weighted content generation
 */
export function optimizeClaudeMd(
  targetPath: string,
  learnings: Learning[],
  state: SyncState,
  _config: Config
): OptimizeResult {
  const absPath = resolve(targetPath.replace(/^~/, process.env.HOME || "~"));

  // Read existing file or start fresh
  let existingContent = "";
  if (existsSync(absPath)) {
    existingContent = readFileSync(absPath, "utf-8");
  }

  // Check if sentinels exist
  const hasStart = existingContent.includes(SENTINEL_START);
  const hasEnd = existingContent.includes(SENTINEL_END);

  // Extract current managed section & check for manual edits
  if (hasStart && hasEnd) {
    const startIdx = existingContent.indexOf(SENTINEL_START);
    const endIdx = existingContent.indexOf(SENTINEL_END) + SENTINEL_END.length;
    const currentSection = existingContent.slice(startIdx, endIdx);

    if (state.lastSectionHash) {
      const currentHash = sha256(currentSection);
      if (currentHash !== state.lastSectionHash) {
        return {
          written: false,
          reason:
            "ClawSync section was manually edited since last write. Skipping to preserve your changes. " +
            "Delete the section between the sentinel comments to re-enable auto-updates.",
          learningsCount: learnings.length,
          targetPath: absPath,
        };
      }
    }
  }

  // Generate the new section
  const section = generateSection(learnings);

  // Build the new file content
  let newContent: string;
  if (hasStart && hasEnd) {
    const startIdx = existingContent.indexOf(SENTINEL_START);
    const endIdx = existingContent.indexOf(SENTINEL_END) + SENTINEL_END.length;
    newContent =
      existingContent.slice(0, startIdx) +
      section +
      existingContent.slice(endIdx);
  } else if (existingContent.trim()) {
    newContent = existingContent.trimEnd() + "\n\n" + section + "\n";
  } else {
    newContent = section + "\n";
  }

  // Atomic write: temp file → backup → rename
  // Use pid + random suffix to avoid collisions in concurrent sync writes
  mkdirSync(dirname(absPath), { recursive: true });
  const tmpPath = absPath + `.clawsync-tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
  writeFileSync(tmpPath, newContent, "utf-8");

  if (existsSync(absPath)) {
    const backupPath = absPath + ".clawsync-backup";
    writeFileSync(backupPath, existingContent, "utf-8");
  }

  renameSync(tmpPath, absPath);

  // Update state with new section hash
  state.lastSectionHash = sha256(section);

  return {
    written: true,
    reason: `Updated ${learnings.length} learnings`,
    learningsCount: learnings.length,
    targetPath: absPath,
  };
}

/**
 * Generate the markdown section for CLAUDE.md.
 */
function generateSection(learnings: Learning[]): string {
  if (learnings.length === 0) {
    return [
      SENTINEL_START,
      "## ClawSync Session Learnings",
      "",
      "_No learnings extracted yet. Run `clawsync sync` to analyze your sessions._",
      "",
      SENTINEL_END,
    ].join("\n");
  }

  const now = new Date().toISOString().split("T")[0];
  const lines: string[] = [
    SENTINEL_START,
    "## ClawSync Session Learnings",
    "",
    `_Last updated: ${now} | ${learnings.length} learnings from ${countUniqueSessions(learnings)} sessions_`,
    "",
  ];

  const groups = groupBy(learnings);

  if (groups["error-recovery"]?.length) {
    lines.push("### Error Recovery Patterns", "");
    for (const l of groups["error-recovery"].slice(0, 20)) {
      lines.push(formatLearning(l));
    }
    lines.push("");
  }

  if (groups["dead-end"]?.length) {
    lines.push("### Dead Ends to Avoid", "");
    for (const l of groups["dead-end"].slice(0, 15)) {
      lines.push(formatLearning(l));
    }
    lines.push("");
  }

  if (groups["decision"]?.length) {
    lines.push("### Architecture Decisions", "");
    for (const l of groups["decision"].slice(0, 15)) {
      lines.push(formatLearning(l));
    }
    lines.push("");
  }

  if (groups["recurring-blocker"]?.length) {
    lines.push("### Recurring Blockers", "");
    for (const l of groups["recurring-blocker"].slice(0, 10)) {
      lines.push(formatLearning(l));
    }
    lines.push("");
  }

  lines.push(SENTINEL_END);
  return lines.join("\n");
}

function formatLearning(l: Learning): string {
  const freq = l.frequency > 1 ? ` (seen ${l.frequency}x)` : "";
  const pin = l.pinned ? " 📌" : "";
  const conf = l.confidence >= 0.8 ? "🔴" : l.confidence >= 0.6 ? "🟡" : "⚪";
  return `- ${conf} ${l.summary}${freq}${pin}`;
}

function groupBy(learnings: Learning[]): Record<string, Learning[]> {
  const groups: Record<string, Learning[]> = {};
  const sorted = [...learnings].sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.frequency - a.frequency;
  });
  for (const l of sorted) {
    if (!groups[l.type]) groups[l.type] = [];
    groups[l.type].push(l);
  }
  return groups;
}

function countUniqueSessions(learnings: Learning[]): number {
  const sessions = new Set<string>();
  for (const l of learnings) {
    for (const s of l.sessionIds) sessions.add(s);
  }
  return sessions.size;
}
