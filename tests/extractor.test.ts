import { describe, it, expect } from "vitest";
import { extractPatterns } from "../src/core/extractor.js";
import { parseSession } from "../src/core/parser.js";
import type { ParsedSession, ParsedTurn } from "../src/core/types.js";

function makeSession(turns: Partial<ParsedTurn>[]): ParsedSession {
  return {
    sessionId: "test-session",
    startTime: "2026-01-01T00:00:00.000Z",
    endTime: "2026-01-01T01:00:00.000Z",
    turns: turns.map((t, i) => ({
      role: t.role ?? (i % 2 === 0 ? "user" : "assistant"),
      textContent: t.textContent ?? "",
      toolCalls: t.toolCalls ?? [],
      toolResults: t.toolResults ?? [],
      timestamp: t.timestamp ?? `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z`,
    })),
  };
}

describe("extractPatterns — decision extraction", () => {
  it("extracts decision patterns from assistant turns with decision signals", async () => {
    const session = await parseSession("tests/fixtures/simple-session.jsonl");
    const patterns = extractPatterns(session);
    const decisions = patterns.filter(p => p.type === "decision");
    // simple-session has "I decided to use readFileSync" → decision
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions[0].confidence).toBeGreaterThan(0);
    expect(decisions[0].summary).toContain("Decision:");
  });

  it("does not extract decisions from short text", () => {
    const session = makeSession([
      { role: "user", textContent: "help" },
      { role: "assistant", textContent: "OK." },
    ]);
    const patterns = extractPatterns(session);
    expect(patterns.filter(p => p.type === "decision")).toHaveLength(0);
  });

  it("confidence increases with more decision signals", () => {
    const highConfidence = makeSession([
      { role: "user", textContent: "which approach?" },
      {
        role: "assistant",
        textContent: "I decided to use TypeScript because this is better than plain JS. I chose the compiler option because the tradeoff is clear. The design decision here prefers this because of maintainability.",
      },
    ]);
    const lowConfidence = makeSession([
      { role: "user", textContent: "which approach?" },
      {
        role: "assistant",
        textContent: "I chose TypeScript. This is a long enough sentence to qualify as a meaningful decision signal with enough words.",
      },
    ]);
    const highPatterns = extractPatterns(highConfidence).filter(p => p.type === "decision");
    const lowPatterns = extractPatterns(lowConfidence).filter(p => p.type === "decision");
    if (highPatterns.length > 0 && lowPatterns.length > 0) {
      expect(highPatterns[0].confidence).toBeGreaterThanOrEqual(lowPatterns[0].confidence);
    }
  });
});

describe("extractPatterns — dead-end extraction", () => {
  it("extracts dead-end patterns from dead-end session", async () => {
    const session = await parseSession("tests/fixtures/dead-end-session.jsonl");
    const patterns = extractPatterns(session);
    const deadEnds = patterns.filter(p => p.type === "dead-end");
    expect(deadEnds.length).toBeGreaterThan(0);
    expect(deadEnds[0].confidence).toBeGreaterThan(0.5);
  });

  it("strong signal alone triggers dead-end detection", () => {
    const session = makeSession([
      { role: "user", textContent: "try the map approach" },
      { role: "assistant", textContent: "Actually, this approach is wrong. Let's try a different design entirely." },
      { role: "user", textContent: "ok" },
    ]);
    const patterns = extractPatterns(session);
    expect(patterns.filter(p => p.type === "dead-end").length).toBeGreaterThan(0);
  });

  it("two weak signals in a window triggers dead-end detection", () => {
    const session = makeSession([
      { role: "user", textContent: "try this" },
      { role: "assistant", textContent: "not working here, let me try something else with a different approach." },
      { role: "user", textContent: "ok" },
    ]);
    const patterns = extractPatterns(session);
    expect(patterns.filter(p => p.type === "dead-end").length).toBeGreaterThan(0);
  });
});

describe("extractPatterns — error recovery extraction", () => {
  it("extracts error-recovery patterns from error-recovery session", async () => {
    const session = await parseSession("tests/fixtures/error-recovery-session.jsonl");
    const patterns = extractPatterns(session);
    const recoveries = patterns.filter(p => p.type === "error-recovery");
    expect(recoveries.length).toBeGreaterThan(0);
    expect(recoveries[0].confidence).toBeGreaterThan(0);
    expect(recoveries[0].context.errorMessages).toBeDefined();
  });

  it("skips trivial errors (ENOENT, command not found, etc.)", () => {
    const session = makeSession([
      {
        role: "user",
        toolResults: [{
          toolUseId: "t1",
          success: false,
          content: "No such file or directory: /tmp/missing.txt",
          timestamp: "2026-01-01T00:00:00.000Z",
        }],
        textContent: "",
      },
      { role: "assistant", textContent: "let me create it", toolCalls: [{ id: "t2", name: "Write", input: { file_path: "/tmp/missing.txt" }, timestamp: "" }] },
      {
        role: "user",
        toolResults: [{ toolUseId: "t2", success: true, content: "written", timestamp: "" }],
        textContent: "",
      },
    ]);
    const patterns = extractPatterns(session);
    // ENOENT is trivial — should not be extracted
    expect(patterns.filter(p => p.type === "error-recovery")).toHaveLength(0);
  });
});

describe("extractPatterns — real session", () => {
  it("does not crash on real session fixture", async () => {
    const session = await parseSession("tests/fixtures/real-session-01.jsonl");
    expect(() => extractPatterns(session)).not.toThrow();
  });

  it("returns an array (possibly empty) for real session", async () => {
    const session = await parseSession("tests/fixtures/real-session-01.jsonl");
    const patterns = extractPatterns(session);
    expect(Array.isArray(patterns)).toBe(true);
  });
});
