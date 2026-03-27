import { z } from "zod";

// ── Session JSONL Types (Claude Code format) ────────────────────────

/** A content block inside a message (text, tool_use, tool_result, thinking) */
export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;        // tool_use id
  name?: string;      // tool name
  input?: Record<string, unknown>;
  tool_use_id?: string;  // tool_result reference
  content?: string | ContentBlock[];
  is_error?: boolean;
}

/** A message inside a JSONL entry */
export interface SessionMessage {
  role: "user" | "assistant";
  model?: string;
  content: string | ContentBlock[];
  id?: string;
  type?: string;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/** A single line in the JSONL session file */
export interface SessionEntry {
  type: string;  // "user" | "assistant" | "system" | "progress" | "queue-operation" | "file-history-snapshot" | "last-prompt"
  message?: SessionMessage;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  sessionId?: string;
  version?: string;
  cwd?: string;
  entrypoint?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  userType?: string;
  gitBranch?: string;
  toolUseResult?: {
    success: boolean;
    commandName?: string;
    allowedTools?: string[];
  };
  requestId?: string;
  promptId?: string;
  // queue-operation fields
  operation?: string;
  content?: string;
  // file-history-snapshot fields
  snapshot?: Record<string, unknown>;
  messageId?: string;
  isSnapshotUpdate?: boolean;
}

// ── Parsed Domain Types ─────────────────────────────────────────────

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  timestamp: string;
}

export interface ToolResult {
  toolUseId: string;
  success: boolean;
  content: string;
  timestamp: string;
}

export interface ParsedTurn {
  role: "user" | "assistant";
  textContent: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  timestamp: string;
  model?: string;
  tokenUsage?: {
    input: number;
    output: number;
  };
}

export interface ParsedSession {
  sessionId: string;
  turns: ParsedTurn[];
  startTime: string;
  endTime: string;
  entrypoint?: string;
  version?: string;
  cwd?: string;
}

// ── Extracted Patterns ──────────────────────────────────────────────

export type PatternType = "error-recovery" | "dead-end" | "decision" | "recurring-blocker";

export interface ExtractedPattern {
  type: PatternType;
  confidence: number;  // 0.0 – 1.0
  summary: string;
  detail: string;
  context: {
    turnIndices: number[];
    toolNames?: string[];
    errorMessages?: string[];
    files?: string[];
  };
  timestamp: string;
  sessionId: string;
}

// ── Learning (deduplicated, stored) ─────────────────────────────────

export interface Learning {
  id: string;            // content hash
  type: PatternType;
  summary: string;
  detail: string;
  confidence: number;
  frequency: number;     // how many sessions produced this
  firstSeen: string;
  lastSeen: string;
  pinned: boolean;
  sessionIds: string[];
}

// ── Config ──────────────────────────────────────────────────────────

export const ConfigSchema = z.object({
  mode: z.enum(["personal", "team", "fleet"]).default("personal"),
  source: z.object({
    type: z.enum(["rsync", "watch", "git"]).default("rsync"),
    path: z.string().default("~/.claude/projects/"),
  }).default({}),
  target: z.object({
    claude_md: z.string().default("./CLAUDE.md"),
  }).default({}),
  sync: z.object({
    interval_minutes: z.number().default(5),
    max_sessions_per_run: z.number().default(50),
  }).default({}),
  extraction: z.object({
    min_confidence: z.number().default(0.6),
    max_learnings: z.number().default(100),
    prune_after_days: z.number().default(30),
  }).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

// ── State (persisted between runs) ──────────────────────────────────

export interface SyncState {
  lastRun?: string;
  processedSessions: string[];
  lastSectionHash?: string;
  learnings: Learning[];
}
