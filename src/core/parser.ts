import { readJsonlAll } from "../utils/jsonl.js";
import { ClaudeCodeProvider } from "../providers/claude-code.js";
import type { SessionProvider } from "../providers/base.js";
import type { ParsedSession, SessionEntry } from "./types.js";

const providers: SessionProvider[] = [new ClaudeCodeProvider()];

/**
 * Detect JSONL format version from first entries.
 * Returns the format identifier for logging/debugging.
 */
function detectFormatVersion(entries: SessionEntry[]): string {
  const sample = entries.slice(0, 10);
  for (const entry of sample) {
    if (entry.type === "user" || entry.type === "assistant") {
      if (entry.sessionId && entry.version) {
        return `claude-code-v${entry.version}`;
      }
    }
    // Legacy format check (type: "human" / "assistant" at top level)
    if ((entry as Record<string, unknown>).type === "human") {
      return "claude-code-legacy";
    }
  }
  return "unknown";
}

/**
 * Parse a Claude Code JSONL session file into structured data.
 */
export async function parseSession(filePath: string): Promise<ParsedSession> {
  const entries = await readJsonlAll(filePath);

  if (entries.length === 0) {
    throw new Error(`Empty session file: ${filePath}`);
  }

  const formatVersion = detectFormatVersion(entries);

  // Find a provider that can handle this format
  for (const provider of providers) {
    if (provider.canHandle(entries)) {
      const session = provider.parse(entries, filePath);
      return session;
    }
  }

  // If no provider matches, log format version and throw
  throw new Error(
    `No provider can handle session format "${formatVersion}" in ${filePath}`
  );
}

/**
 * Parse a session file and return raw entries + parsed session.
 * Useful for debugging/inspection.
 */
export async function parseSessionWithRaw(filePath: string): Promise<{
  raw: SessionEntry[];
  parsed: ParsedSession;
  formatVersion: string;
}> {
  const raw = await readJsonlAll(filePath);
  if (raw.length === 0) throw new Error(`Empty session file: ${filePath}`);

  const formatVersion = detectFormatVersion(raw);

  for (const provider of providers) {
    if (provider.canHandle(raw)) {
      return { raw, parsed: provider.parse(raw, filePath), formatVersion };
    }
  }

  throw new Error(`No provider for format "${formatVersion}" in ${filePath}`);
}
