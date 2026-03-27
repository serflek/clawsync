import { describe, it, expect, afterAll } from "vitest";
import { readJsonl, readJsonlAll } from "../src/utils/jsonl.js";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TMP = join(tmpdir(), "clawsync-tests-jsonl");

function setup() {
  mkdirSync(TMP, { recursive: true });
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

describe("readJsonlAll", () => {
  setup();

  it("reads valid JSONL file", async () => {
    const file = join(TMP, "valid.jsonl");
    writeFileSync(file, '{"type":"user","sessionId":"s1"}\n{"type":"assistant","sessionId":"s2"}\n');
    const entries = await readJsonlAll(file);
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe("user");
    expect(entries[1].type).toBe("assistant");
  });

  it("skips empty lines", async () => {
    const file = join(TMP, "empty-lines.jsonl");
    writeFileSync(file, '{"type":"user"}\n\n\n{"type":"assistant"}\n');
    const entries = await readJsonlAll(file);
    expect(entries).toHaveLength(2);
  });

  it("skips malformed JSON lines without crashing", async () => {
    const file = join(TMP, "malformed.jsonl");
    writeFileSync(file, '{"type":"user"}\nNOT_JSON\n{"type":"assistant"}\n');
    const entries = await readJsonlAll(file);
    expect(entries).toHaveLength(2);
  });

  it("returns empty array for file with no valid entries", async () => {
    const file = join(TMP, "all-malformed.jsonl");
    writeFileSync(file, 'NOT_JSON\nALSO_NOT_JSON\n');
    const entries = await readJsonlAll(file);
    expect(entries).toHaveLength(0);
  });

  it("parses real session fixture file", async () => {
    const entries = await readJsonlAll("tests/fixtures/real-session-01.jsonl");
    expect(entries.length).toBeGreaterThan(0);
    // Should contain at least one typed entry
    const typed = entries.filter(e => e.type);
    expect(typed.length).toBeGreaterThan(0);
  });
});

describe("readJsonl (streaming)", () => {
  it("is an async generator", async () => {
    const file = join(TMP, "streaming.jsonl");
    writeFileSync(file, '{"type":"user"}\n{"type":"assistant"}\n');
    const gen = readJsonl(file);
    const results = [];
    for await (const entry of gen) {
      results.push(entry);
    }
    expect(results).toHaveLength(2);
  });

  afterAll(() => teardown());
});
