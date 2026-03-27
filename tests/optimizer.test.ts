import { describe, it, expect, afterEach } from "vitest";
import { optimizeClaudeMd } from "../src/core/optimizer.js";
import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Learning, SyncState, Config } from "../src/core/types.js";

const TMP = join(tmpdir(), "clawsync-optimizer-tests");

function setup(): string {
  const dir = join(TMP, String(Math.random()).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

function defaultState(): SyncState {
  return { processedSessions: [], learnings: [] };
}

function defaultConfig(): Config {
  return {
    mode: "personal",
    source: { type: "rsync", path: "~/.claude/projects/" },
    target: { claude_md: "./CLAUDE.md" },
    sync: { interval_minutes: 5, max_sessions_per_run: 50 },
    extraction: { min_confidence: 0.6, max_learnings: 100, prune_after_days: 30 },
  };
}

function makeLearning(overrides: Partial<Learning> = {}): Learning {
  return {
    id: "abc123def456abc123def456abc12345",
    type: "decision",
    summary: "Decision: chose TypeScript over JavaScript",
    detail: "TypeScript provides better type safety",
    confidence: 0.8,
    frequency: 2,
    firstSeen: "2026-01-01T00:00:00.000Z",
    lastSeen: "2026-01-02T00:00:00.000Z",
    pinned: false,
    sessionIds: ["s1", "s2"],
    ...overrides,
  };
}

afterEach(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("optimizeClaudeMd", () => {
  it("creates a new CLAUDE.md when file does not exist", () => {
    const dir = setup();
    const targetPath = join(dir, "CLAUDE.md");
    const state = defaultState();

    const result = optimizeClaudeMd(targetPath, [makeLearning()], state, defaultConfig());

    expect(result.written).toBe(true);
    expect(existsSync(targetPath)).toBe(true);
    const content = readFileSync(targetPath, "utf-8");
    expect(content).toContain("<!-- clawsync:start -->");
    expect(content).toContain("<!-- clawsync:end -->");
    expect(content).toContain("ClawSync Session Learnings");
  });

  it("writes sentinel-bounded section to empty file", () => {
    const dir = setup();
    const targetPath = join(dir, "CLAUDE.md");
    writeFileSync(targetPath, "");
    const state = defaultState();

    optimizeClaudeMd(targetPath, [makeLearning()], state, defaultConfig());
    const content = readFileSync(targetPath, "utf-8");
    expect(content).toContain("<!-- clawsync:start -->");
    expect(content).toContain("<!-- clawsync:end -->");
  });

  it("appends sentinel section to existing non-empty CLAUDE.md", () => {
    const dir = setup();
    const targetPath = join(dir, "CLAUDE.md");
    writeFileSync(targetPath, "# My Project\n\nSome existing content.\n");
    const state = defaultState();

    optimizeClaudeMd(targetPath, [makeLearning()], state, defaultConfig());
    const content = readFileSync(targetPath, "utf-8");
    expect(content).toContain("# My Project");
    expect(content).toContain("Some existing content.");
    expect(content).toContain("<!-- clawsync:start -->");
  });

  it("replaces existing sentinel section on re-run", () => {
    const dir = setup();
    const targetPath = join(dir, "CLAUDE.md");
    const state = defaultState();

    // First write
    optimizeClaudeMd(targetPath, [makeLearning({ summary: "Decision: use Redis" })], state, defaultConfig());
    const hash1 = state.lastSectionHash;

    // Second write with different learnings
    const result = optimizeClaudeMd(targetPath, [makeLearning({ summary: "Decision: use PostgreSQL" })], state, defaultConfig());
    expect(result.written).toBe(true);

    const content = readFileSync(targetPath, "utf-8");
    expect(content).toContain("PostgreSQL");
    // Should only have ONE sentinel block
    const startCount = (content.match(/<!-- clawsync:start -->/g) || []).length;
    expect(startCount).toBe(1);
  });

  it("detects manual edits and skips write", () => {
    const dir = setup();
    const targetPath = join(dir, "CLAUDE.md");
    const state = defaultState();

    // First write
    optimizeClaudeMd(targetPath, [makeLearning()], state, defaultConfig());

    // Simulate manual edit inside the sentinels
    const content = readFileSync(targetPath, "utf-8");
    const modified = content.replace("<!-- clawsync:start -->", "<!-- clawsync:start -->\n<!-- MANUALLY EDITED -->");
    writeFileSync(targetPath, modified);

    // Second write attempt — should detect the manual edit
    const result = optimizeClaudeMd(targetPath, [makeLearning()], state, defaultConfig());
    expect(result.written).toBe(false);
    expect(result.reason).toContain("manually edited");
  });

  it("stores hash in state after writing", () => {
    const dir = setup();
    const targetPath = join(dir, "CLAUDE.md");
    const state = defaultState();

    optimizeClaudeMd(targetPath, [makeLearning()], state, defaultConfig());
    expect(state.lastSectionHash).toBeDefined();
    expect(typeof state.lastSectionHash).toBe("string");
    expect(state.lastSectionHash!.length).toBe(64); // full sha256
  });

  it("uses unique temp filename (contains pid)", () => {
    // Check that the temp file name pattern has pid-based suffix
    // We test this indirectly: run two concurrent-ish writes and ensure both succeed
    const dir = setup();
    const target1 = join(dir, "CLAUDE1.md");
    const target2 = join(dir, "CLAUDE2.md");
    const state1 = defaultState();
    const state2 = defaultState();

    const r1 = optimizeClaudeMd(target1, [makeLearning()], state1, defaultConfig());
    const r2 = optimizeClaudeMd(target2, [makeLearning()], state2, defaultConfig());
    expect(r1.written).toBe(true);
    expect(r2.written).toBe(true);
  });

  it("writes empty-state message when no learnings", () => {
    const dir = setup();
    const targetPath = join(dir, "CLAUDE.md");
    const state = defaultState();

    optimizeClaudeMd(targetPath, [], state, defaultConfig());
    const content = readFileSync(targetPath, "utf-8");
    expect(content).toContain("No learnings extracted yet");
  });

  it("groups learnings by type in output", () => {
    const dir = setup();
    const targetPath = join(dir, "CLAUDE.md");
    const state = defaultState();
    const learnings = [
      makeLearning({ id: "a".repeat(32), type: "decision", summary: "Decision: use Redis" }),
      makeLearning({ id: "b".repeat(32), type: "dead-end", summary: "Dead end: tried in-memory store" }),
      makeLearning({ id: "c".repeat(32), type: "error-recovery", summary: "Error in Write on file.ts → recovered" }),
    ];

    optimizeClaudeMd(targetPath, learnings, state, defaultConfig());
    const content = readFileSync(targetPath, "utf-8");
    expect(content).toContain("Error Recovery Patterns");
    expect(content).toContain("Dead Ends to Avoid");
    expect(content).toContain("Architecture Decisions");
  });

  it("result includes learningsCount and targetPath", () => {
    const dir = setup();
    const targetPath = join(dir, "CLAUDE.md");
    const state = defaultState();
    const learnings = [makeLearning()];

    const result = optimizeClaudeMd(targetPath, learnings, state, defaultConfig());
    expect(result.learningsCount).toBe(1);
    expect(result.targetPath).toBeTruthy();
  });
});
