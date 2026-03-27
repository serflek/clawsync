import { describe, it, expect } from "vitest";
import { dedup, prune } from "../src/core/dedup.js";
import type { ExtractedPattern, Learning } from "../src/core/types.js";

function makePattern(overrides: Partial<ExtractedPattern> = {}): ExtractedPattern {
  return {
    type: "decision",
    confidence: 0.7,
    summary: "Decision: use TypeScript for type safety",
    detail: "TypeScript is better than plain JS for large projects",
    context: { turnIndices: [0, 1] },
    timestamp: "2026-01-01T00:00:00.000Z",
    sessionId: "session-001",
    ...overrides,
  };
}

function makeLearning(overrides: Partial<Learning> = {}): Learning {
  return {
    id: "abc123def456abc123def456abc12345",
    type: "decision",
    summary: "Decision: use TypeScript",
    detail: "TypeScript is better for large projects",
    confidence: 0.7,
    frequency: 1,
    firstSeen: "2026-01-01T00:00:00.000Z",
    lastSeen: "2026-01-01T00:00:00.000Z",
    pinned: false,
    sessionIds: ["session-000"],
    ...overrides,
  };
}

describe("dedup", () => {
  it("adds a new pattern as a new learning", () => {
    const result = dedup([], [makePattern()]);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("decision");
    expect(result[0].frequency).toBe(1);
    expect(result[0].id).toHaveLength(32); // 32-char hash
  });

  it("bumps frequency on exact hash match", () => {
    const existing = dedup([], [makePattern()]);
    const result = dedup(existing, [makePattern({ sessionId: "session-002" })]);
    expect(result).toHaveLength(1);
    expect(result[0].frequency).toBe(2);
    expect(result[0].sessionIds).toContain("session-001");
    expect(result[0].sessionIds).toContain("session-002");
  });

  it("does not duplicate session IDs on repeated sync", () => {
    const existing = dedup([], [makePattern()]);
    const result = dedup(existing, [makePattern()]); // same sessionId
    expect(result[0].sessionIds).toHaveLength(1);
  });

  it("merges near-duplicate patterns (similarity >= 0.7) of same type", () => {
    const pattern1 = makePattern({ summary: "Decision: chose TypeScript for type safety across the codebase" });
    const pattern2 = makePattern({
      summary: "Decision: chose TypeScript for type safety across the project",
      sessionId: "session-002",
    });
    const existing = dedup([], [pattern1]);
    const result = dedup(existing, [pattern2]);
    expect(result).toHaveLength(1); // merged
    expect(result[0].frequency).toBe(2);
  });

  it("does NOT merge near-duplicates of different types", () => {
    const pattern1 = makePattern({ type: "decision", summary: "Decision: use TypeScript for the project" });
    const pattern2 = makePattern({ type: "dead-end", summary: "Dead end: TypeScript for the project was wrong" });
    const result = dedup([...dedup([], [pattern1])], [pattern2]);
    expect(result).toHaveLength(2);
  });

  it("updates confidence to the maximum of existing and new", () => {
    const existing = dedup([], [makePattern({ confidence: 0.5 })]);
    const result = dedup(existing, [makePattern({ confidence: 0.9, sessionId: "s2" })]);
    expect(result[0].confidence).toBe(0.9);
  });

  it("keeps learning id as 32-char content hash", () => {
    const result = dedup([], [makePattern()]);
    expect(result[0].id).toHaveLength(32);
    expect(result[0].id).toMatch(/^[0-9a-f]+$/);
  });

  it("handles multiple new patterns in one call", () => {
    const patterns = [
      makePattern({ summary: "Decision: use Redis for caching", sessionId: "s1" }),
      makePattern({ summary: "Decision: use PostgreSQL for storage", sessionId: "s2" }),
      makePattern({ summary: "Dead end: tried in-memory store", type: "dead-end", sessionId: "s3" }),
    ];
    const result = dedup([], patterns);
    expect(result).toHaveLength(3);
  });
});

describe("prune", () => {
  it("returns unchanged if under maxLearnings", () => {
    const learnings = [makeLearning(), makeLearning({ id: "zzz", summary: "Another decision" })];
    const result = prune(learnings, 100, 30);
    expect(result).toHaveLength(2);
  });

  it("prunes old one-off learnings first", () => {
    const now = new Date();
    const old = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000); // 60 days ago

    const stale = makeLearning({
      id: "stale001stale001stale001stale001",
      lastSeen: old.toISOString(),
      frequency: 1,
      confidence: 0.6,
    });
    const fresh = makeLearning({
      id: "fresh001fresh001fresh001fresh001",
      lastSeen: now.toISOString(),
      frequency: 5,
      confidence: 0.8,
    });
    const result = prune([stale, fresh], 1, 30);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("fresh001fresh001fresh001fresh001");
  });

  it("never prunes pinned learnings", () => {
    const now = new Date();
    const old = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const pinned = makeLearning({
      id: "pinned01pinned01pinned01pinned01",
      pinned: true,
      lastSeen: old.toISOString(),
      frequency: 1,
    });
    const unpinned = makeLearning({
      id: "unpinned1unpinned1unpinned1unpin",
      pinned: false,
      lastSeen: old.toISOString(),
      frequency: 1,
    });
    const result = prune([pinned, unpinned], 1, 30);
    expect(result.some(l => l.id === "pinned01pinned01pinned01pinned01")).toBe(true);
  });

  it("never prunes high-confidence (>= 0.9) learnings", () => {
    const now = new Date();
    const old = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    const highConf = makeLearning({
      id: "highconf1highconf1highconf1highco",
      confidence: 0.95,
      lastSeen: old.toISOString(),
    });
    const lowConf = makeLearning({
      id: "lowconf01lowconf01lowconf01lowco",
      confidence: 0.5,
      lastSeen: old.toISOString(),
    });
    const result = prune([highConf, lowConf], 1, 30);
    expect(result.some(l => l.id === "highconf1highconf1highconf1highco")).toBe(true);
  });
});
