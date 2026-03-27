import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { SessionEntry } from "../core/types.js";

/**
 * Streaming JSONL reader. Handles:
 * - Malformed lines (skipped with warning)
 * - Empty lines
 * - Large files (streamed, not loaded into memory)
 */
export async function* readJsonl(filePath: string): AsyncGenerator<SessionEntry> {
  const stream = createReadStream(filePath, { encoding: "utf-8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let lineNum = 0;
  for await (const line of rl) {
    lineNum++;
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const obj = JSON.parse(trimmed) as SessionEntry;
      yield obj;
    } catch {
      // Malformed line — partial write during crash, skip it
      if (lineNum <= 3) {
        // Only warn for first few lines; later malformed lines are likely truncation
        process.stderr.write(`[clawsync] Warning: malformed JSON at line ${lineNum} in ${filePath}\n`);
      }
    }
  }
}

/**
 * Collect all entries from a JSONL file into memory.
 * Use readJsonl() for large files; this is for tests/small files.
 */
export async function readJsonlAll(filePath: string): Promise<SessionEntry[]> {
  const entries: SessionEntry[] = [];
  for await (const entry of readJsonl(filePath)) {
    entries.push(entry);
  }
  return entries;
}
