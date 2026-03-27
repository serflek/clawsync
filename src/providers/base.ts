import type { SessionEntry, ParsedSession } from "../core/types.js";

/**
 * Provider interface for parsing session files from different platforms.
 * MVP: only Claude Code. Future: Codex, Hermes, Cursor.
 */
export interface SessionProvider {
  /** Provider identifier */
  readonly name: string;

  /** Check if this provider can handle the given file */
  canHandle(entries: SessionEntry[]): boolean;

  /** Parse raw JSONL entries into a structured ParsedSession */
  parse(entries: SessionEntry[], filePath: string): ParsedSession;
}
