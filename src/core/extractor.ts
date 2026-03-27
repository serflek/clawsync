import type { ParsedSession, ParsedTurn, ExtractedPattern } from "./types.js";

// ── Trivial error filter ────────────────────────────────────────────
// Errors matching these patterns are normal dev flow, not worth learning from
const TRIVIAL_ERROR_PATTERNS = [
  /file not found/i,
  /no such file or directory/i,
  /permission denied/i,
  /command not found/i,
  /modulenotfounderror/i,
  /cannot find module/i,
  /enoent/i,
];

// ── Dead-end signal phrases ─────────────────────────────────────────
// Multi-word signals (per eng review: NOT single keywords)
const STRONG_DEAD_END_SIGNALS = [
  "this isn't working",
  "this isnt working",
  "wrong approach",
  "let's try a different",
  "lets try a different",
  "that didn't work",
  "that doesnt work",
  "scrap that",
  "start over",
  "completely wrong",
  "abandon this",
  "going in circles",
  "dead end",
  "this approach is wrong",
  "doesn't work at all",
  "failed again",
  "keep hitting the same",
  "still broken",
];

const WEAK_DEAD_END_SIGNALS = [
  "try something else",
  "different approach",
  "not working",
  "revert",
  "go back to",
  "undo that",
  "never mind that",
];

// ── Decision signal phrases ─────────────────────────────────────────
const DECISION_SIGNALS = [
  "i chose",
  "i decided",
  "the reason i",
  "because this approach",
  "the tradeoff is",
  "better approach is",
  "opted for",
  "going with",
  "instead of",
  "the advantage of",
  "prefer this because",
  "this is better than",
  "architecturally",
  "the design decision",
];

function isTrivialError(errorContent: string): boolean {
  return TRIVIAL_ERROR_PATTERNS.some((p) => p.test(errorContent));
}

function countSignals(text: string, signals: string[]): number {
  const lower = text.toLowerCase();
  return signals.filter((s) => lower.includes(s)).length;
}

/**
 * Extract patterns from a parsed session.
 * All heuristic — no LLM calls.
 */
export function extractPatterns(session: ParsedSession): ExtractedPattern[] {
  const patterns: ExtractedPattern[] = [];

  patterns.push(...extractErrorRecoveries(session));
  patterns.push(...extractDeadEnds(session));
  patterns.push(...extractDecisions(session));

  return patterns;
}

// ── Error → Success Recovery ────────────────────────────────────────

function extractErrorRecoveries(session: ParsedSession): ExtractedPattern[] {
  const patterns: ExtractedPattern[] = [];
  const turns = session.turns;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];

    // Look for failed tool results
    for (const result of turn.toolResults) {
      if (result.success) continue;
      if (isTrivialError(result.content)) continue;

      // Look forward for a successful tool call on the same tool/file within 10 turns
      const errorToolId = result.toolUseId;

      // Find the original tool call to get the tool name and file
      const originalCall = findToolCall(turns, errorToolId, i);
      if (!originalCall) continue;

      const recoveryTurn = findRecovery(
        turns,
        i + 1,
        originalCall.name,
        originalCall.input,
        10
      );

      if (recoveryTurn !== null) {
        const errorSnippet = result.content.slice(0, 200);
        const filePath = extractFilePath(originalCall.input);

        patterns.push({
          type: "error-recovery",
          confidence: 0.7,
          summary: `Error in ${originalCall.name}${filePath ? ` on ${filePath}` : ""} → recovered`,
          detail: `Error: ${errorSnippet}\nRecovered after ${recoveryTurn - i} turns by adjusting the ${originalCall.name} call.`,
          context: {
            turnIndices: [i, recoveryTurn],
            toolNames: [originalCall.name],
            errorMessages: [errorSnippet],
            files: filePath ? [filePath] : [],
          },
          timestamp: turn.timestamp,
          sessionId: session.sessionId,
        });
      }
    }
  }

  return patterns;
}

function findToolCall(
  turns: ParsedTurn[],
  toolUseId: string,
  searchBackFrom: number
): { name: string; input: Record<string, unknown> } | null {
  // Search backwards from the current position
  for (let j = searchBackFrom; j >= Math.max(0, searchBackFrom - 5); j--) {
    for (const call of turns[j].toolCalls) {
      if (call.id === toolUseId) {
        return { name: call.name, input: call.input };
      }
    }
  }
  return null;
}

function findRecovery(
  turns: ParsedTurn[],
  startIdx: number,
  toolName: string,
  originalInput: Record<string, unknown>,
  maxLookahead: number
): number | null {
  const originalFile = extractFilePath(originalInput);

  for (let j = startIdx; j < Math.min(turns.length, startIdx + maxLookahead); j++) {
    // Check for successful tool result on the same tool
    for (const call of turns[j].toolCalls) {
      if (call.name === toolName) {
        const callFile = extractFilePath(call.input);
        // Same file or same tool type
        if (!originalFile || !callFile || originalFile === callFile) {
          // Check if the result was successful
          const resultTurn = turns[j + 1];
          if (resultTurn) {
            for (const result of resultTurn.toolResults) {
              if (result.toolUseId === call.id && result.success) {
                return j;
              }
            }
          }
        }
      }
    }
  }
  return null;
}

function extractFilePath(input: Record<string, unknown>): string | null {
  const candidates = ["file_path", "path", "file", "filename"];
  for (const key of candidates) {
    if (typeof input[key] === "string") {
      return input[key] as string;
    }
  }
  // Extract from command string
  if (typeof input.command === "string") {
    const cmd = input.command as string;
    // Simple heuristic: find file paths in the command
    const match = cmd.match(/(?:^|\s)([\w/.~-]+\.\w{1,10})(?:\s|$)/);
    return match ? match[1] : null;
  }
  return null;
}

// ── Dead-End Detection ──────────────────────────────────────────────

function extractDeadEnds(session: ParsedSession): ExtractedPattern[] {
  const patterns: ExtractedPattern[] = [];
  const turns = session.turns;

  // Sliding window of 5 turns, looking for dead-end signal density
  for (let i = 0; i < turns.length - 2; i++) {
    const windowEnd = Math.min(i + 5, turns.length);
    const window = turns.slice(i, windowEnd);
    const windowText = window.map((t) => t.textContent).join(" ");

    const strongCount = countSignals(windowText, STRONG_DEAD_END_SIGNALS);
    const weakCount = countSignals(windowText, WEAK_DEAD_END_SIGNALS);

    // Require: 1 strong signal OR 2+ weak signals in the window
    if (strongCount >= 1 || weakCount >= 2) {
      const confidence = strongCount >= 1 ? 0.75 : 0.5;
      const matchedSignals = [
        ...STRONG_DEAD_END_SIGNALS.filter((s) =>
          windowText.toLowerCase().includes(s)
        ),
        ...WEAK_DEAD_END_SIGNALS.filter((s) =>
          windowText.toLowerCase().includes(s)
        ),
      ];

      // Extract a summary from the window (look for assistant explanation)
      const assistantTurns = window.filter((t) => t.role === "assistant");
      const summaryText =
        assistantTurns[0]?.textContent.slice(0, 300) ||
        window[0].textContent.slice(0, 300);

      patterns.push({
        type: "dead-end",
        confidence,
        summary: `Dead end detected: ${matchedSignals[0] || "approach abandoned"}`,
        detail: `Signals: ${matchedSignals.join(", ")}\nContext: ${summaryText}`,
        context: {
          turnIndices: Array.from(
            { length: windowEnd - i },
            (_, idx) => i + idx
          ),
        },
        timestamp: window[0].timestamp,
        sessionId: session.sessionId,
      });

      // Skip past this window to avoid duplicate detections
      i = windowEnd - 1;
    }
  }

  return patterns;
}

// ── Decision Extraction ─────────────────────────────────────────────

function extractDecisions(session: ParsedSession): ExtractedPattern[] {
  const patterns: ExtractedPattern[] = [];

  for (let i = 0; i < session.turns.length; i++) {
    const turn = session.turns[i];
    if (turn.role !== "assistant") continue;

    const text = turn.textContent;
    if (!text || text.length < 50) continue; // Too short for a meaningful decision

    const signalCount = countSignals(text, DECISION_SIGNALS);
    if (signalCount === 0) continue;

    // Extract the sentence(s) containing the decision signal
    const sentences = text.split(/[.!?\n]+/).filter((s) => s.trim().length > 20);
    const decisionSentences = sentences.filter((s) =>
      DECISION_SIGNALS.some((sig) => s.toLowerCase().includes(sig))
    );

    if (decisionSentences.length === 0) continue;

    const summary = decisionSentences[0].trim().slice(0, 200);
    const confidence = Math.min(0.5 + signalCount * 0.1, 0.85);

    patterns.push({
      type: "decision",
      confidence,
      summary: `Decision: ${summary}`,
      detail: decisionSentences.map((s) => s.trim()).join("\n"),
      context: {
        turnIndices: [i],
        toolNames: turn.toolCalls.map((tc) => tc.name),
      },
      timestamp: turn.timestamp,
      sessionId: session.sessionId,
    });
  }

  return patterns;
}
