import type {
  SessionEntry,
  ParsedSession,
  ParsedTurn,
  ToolCall,
  ToolResult,
  ContentBlock,
} from "../core/types.js";
import type { SessionProvider } from "./base.js";

const MAX_NESTING_DEPTH = 2;

/**
 * Claude Code session provider.
 *
 * Handles the real JSONL format:
 * - type: "user" | "assistant" | "system" | "progress" | "queue-operation" | "file-history-snapshot" | "last-prompt"
 * - message.content can be string OR ContentBlock[]
 * - assistant messages contain tool_use blocks
 * - user messages contain tool_result blocks
 * - toolUseResult field on user entries carries success/failure
 */
export class ClaudeCodeProvider implements SessionProvider {
  readonly name = "claude-code";

  canHandle(entries: SessionEntry[]): boolean {
    // Look for Claude Code structural markers in first 20 entries
    const sample = entries.slice(0, 20);
    return sample.some(
      (e) =>
        e.sessionId !== undefined ||
        e.entrypoint === "cli" ||
        e.entrypoint === "claude-desktop" ||
        (e.type === "user" && e.version !== undefined)
    );
  }

  parse(entries: SessionEntry[], filePath: string): ParsedSession {
    const conversationEntries = entries.filter(
      (e) => (e.type === "user" || e.type === "assistant") && e.message
    );

    const turns: ParsedTurn[] = [];
    const sessionId =
      conversationEntries[0]?.sessionId ||
      filePath.split("/").pop()?.replace(".jsonl", "") ||
      "unknown";

    for (const entry of conversationEntries) {
      const msg = entry.message!;
      const role = entry.type as "user" | "assistant";

      // Skip meta/system user messages that are just caveats
      if (entry.isMeta && role === "user") continue;

      const textContent = this.extractText(msg.content, 0);
      const toolCalls = this.extractToolCalls(msg.content, 0);
      const toolResults = this.extractToolResults(msg.content, entry, 0);

      const turn: ParsedTurn = {
        role,
        textContent,
        toolCalls,
        toolResults,
        timestamp: entry.timestamp || "",
        model: msg.model,
      };

      if (msg.usage) {
        turn.tokenUsage = {
          input:
            (msg.usage.input_tokens || 0) +
            (msg.usage.cache_creation_input_tokens || 0) +
            (msg.usage.cache_read_input_tokens || 0),
          output: msg.usage.output_tokens || 0,
        };
      }

      turns.push(turn);
    }

    const timestamps = turns
      .map((t) => t.timestamp)
      .filter(Boolean)
      .sort();

    return {
      sessionId,
      turns,
      startTime: timestamps[0] || "",
      endTime: timestamps[timestamps.length - 1] || "",
      entrypoint: conversationEntries[0]?.entrypoint,
      version: conversationEntries[0]?.version,
      cwd: conversationEntries[0]?.cwd,
    };
  }

  private extractText(
    content: string | ContentBlock[] | undefined,
    depth: number
  ): string {
    if (!content) return "";
    if (typeof content === "string") return content;
    if (depth > MAX_NESTING_DEPTH) return "";

    const texts: string[] = [];
    for (const block of content) {
      if (block.type === "text" && block.text) {
        texts.push(block.text);
      } else if (block.type === "thinking" && block.thinking) {
        // Include thinking for decision extraction
        texts.push(block.thinking);
      } else if (block.type === "tool_result" && typeof block.content === "string") {
        texts.push(block.content);
      } else if (block.type === "tool_result" && Array.isArray(block.content)) {
        texts.push(this.extractText(block.content, depth + 1));
      }
    }
    return texts.join("\n");
  }

  private extractToolCalls(
    content: string | ContentBlock[] | undefined,
    depth: number
  ): ToolCall[] {
    if (!content || typeof content === "string") return [];
    if (depth > MAX_NESTING_DEPTH) return [];

    const calls: ToolCall[] = [];
    for (const block of content) {
      if (block.type === "tool_use" && block.id && block.name) {
        calls.push({
          id: block.id,
          name: block.name,
          input: (block.input as Record<string, unknown>) || {},
          timestamp: "",
        });
      }
    }
    return calls;
  }

  private extractToolResults(
    content: string | ContentBlock[] | undefined,
    entry: SessionEntry,
    depth: number
  ): ToolResult[] {
    if (!content || typeof content === "string") return [];
    if (depth > MAX_NESTING_DEPTH) return [];

    const results: ToolResult[] = [];
    for (const block of content) {
      if (block.type === "tool_result" && block.tool_use_id) {
        const resultContent =
          typeof block.content === "string"
            ? block.content
            : Array.isArray(block.content)
              ? this.extractText(block.content, depth + 1)
              : "";

        // Determine success from entry-level toolUseResult or block-level is_error
        const success = block.is_error
          ? false
          : entry.toolUseResult?.success ?? true;

        results.push({
          toolUseId: block.tool_use_id,
          success,
          content: resultContent.slice(0, 2000), // Truncate large tool outputs
          timestamp: entry.timestamp || "",
        });
      }
    }
    return results;
  }
}
