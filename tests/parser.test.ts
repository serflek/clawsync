import { describe, it, expect } from "vitest";
import { parseSession, parseSessionWithRaw } from "../src/core/parser.js";

describe("parseSession", () => {
  it("parses simple session fixture", async () => {
    const session = await parseSession("tests/fixtures/simple-session.jsonl");
    expect(session.sessionId).toBe("test-session-001");
    expect(session.turns.length).toBeGreaterThan(0);
    expect(session.startTime).toBeTruthy();
    expect(session.endTime).toBeTruthy();
  });

  it("extracts turns with correct roles", async () => {
    const session = await parseSession("tests/fixtures/simple-session.jsonl");
    const roles = session.turns.map(t => t.role);
    // Should have both user and assistant turns
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });

  it("extracts tool calls from assistant turns", async () => {
    const session = await parseSession("tests/fixtures/simple-session.jsonl");
    const assistantTurns = session.turns.filter(t => t.role === "assistant");
    const allToolCalls = assistantTurns.flatMap(t => t.toolCalls);
    expect(allToolCalls.length).toBeGreaterThan(0);
    expect(allToolCalls[0].name).toBe("Write");
    expect(allToolCalls[0].id).toBe("tool-001");
  });

  it("extracts tool results from user turns", async () => {
    const session = await parseSession("tests/fixtures/simple-session.jsonl");
    const userTurns = session.turns.filter(t => t.role === "user");
    const allResults = userTurns.flatMap(t => t.toolResults);
    expect(allResults.length).toBeGreaterThan(0);
    expect(allResults[0].success).toBe(true);
  });

  it("extracts text content from assistant turns", async () => {
    const session = await parseSession("tests/fixtures/simple-session.jsonl");
    const assistantTurns = session.turns.filter(t => t.role === "assistant");
    const textTurns = assistantTurns.filter(t => t.textContent.length > 0);
    expect(textTurns.length).toBeGreaterThan(0);
  });

  it("extracts token usage when present", async () => {
    const session = await parseSession("tests/fixtures/simple-session.jsonl");
    const assistantTurns = session.turns.filter(t => t.role === "assistant");
    const withUsage = assistantTurns.filter(t => t.tokenUsage);
    expect(withUsage.length).toBeGreaterThan(0);
    expect(withUsage[0].tokenUsage!.input).toBeGreaterThan(0);
    expect(withUsage[0].tokenUsage!.output).toBeGreaterThan(0);
  });

  it("parses error-recovery session fixture", async () => {
    const session = await parseSession("tests/fixtures/error-recovery-session.jsonl");
    expect(session.sessionId).toBe("test-error-recovery");
    const userTurns = session.turns.filter(t => t.role === "user");
    const errorResults = userTurns.flatMap(t => t.toolResults).filter(r => !r.success);
    expect(errorResults.length).toBeGreaterThan(0);
    expect(errorResults[0].content).toContain("TypeError");
  });

  it("throws on empty file", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const tmp = join(tmpdir(), "clawsync-empty-test.jsonl");
    writeFileSync(tmp, "");
    await expect(parseSession(tmp)).rejects.toThrow(/empty session file/i);
  });

  it("throws when no provider can handle the format", async () => {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const tmp = join(tmpdir(), "clawsync-unknown-format.jsonl");
    writeFileSync(tmp, '{"type":"unknown_format","data":42}\n{"type":"other_thing","data":99}\n');
    await expect(parseSession(tmp)).rejects.toThrow(/no provider/i);
  });

  it("parses real session fixture without crashing", async () => {
    const session = await parseSession("tests/fixtures/real-session-01.jsonl");
    expect(session.sessionId).toBeTruthy();
    expect(Array.isArray(session.turns)).toBe(true);
  });
});

describe("parseSessionWithRaw", () => {
  it("returns raw entries + parsed session + formatVersion", async () => {
    const result = await parseSessionWithRaw("tests/fixtures/simple-session.jsonl");
    expect(result.raw).toBeDefined();
    expect(result.parsed).toBeDefined();
    expect(result.formatVersion).toBeTruthy();
    expect(result.raw.length).toBeGreaterThan(0);
  });

  it("raw entries count matches JSONL lines", async () => {
    const result = await parseSessionWithRaw("tests/fixtures/simple-session.jsonl");
    // simple-session.jsonl has 5 lines
    expect(result.raw.length).toBe(5);
  });
});
