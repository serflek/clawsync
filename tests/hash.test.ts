import { describe, it, expect } from "vitest";
import { sha256, contentHash, similarity } from "../src/utils/hash.js";

describe("sha256", () => {
  it("returns 64-char hex string", () => {
    const result = sha256("hello");
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it("is deterministic", () => {
    expect(sha256("test")).toBe(sha256("test"));
  });

  it("different inputs produce different hashes", () => {
    expect(sha256("foo")).not.toBe(sha256("bar"));
  });

  it("handles empty string", () => {
    const result = sha256("");
    expect(result).toHaveLength(64);
  });
});

describe("contentHash", () => {
  it("returns 32-char hex string", () => {
    const result = contentHash("some learning text");
    expect(result).toHaveLength(32);
  });

  it("is case-insensitive (normalises to lowercase)", () => {
    expect(contentHash("Hello World")).toBe(contentHash("hello world"));
  });

  it("trims whitespace before hashing", () => {
    expect(contentHash("  hello  ")).toBe(contentHash("hello"));
  });

  it("different content produces different hashes", () => {
    expect(contentHash("learning A")).not.toBe(contentHash("learning B"));
  });

  it("identical content always produces same hash", () => {
    expect(contentHash("dedup key")).toBe(contentHash("dedup key"));
  });
});

describe("similarity", () => {
  it("identical strings return 1.0", () => {
    expect(similarity("hello world", "hello world")).toBe(1.0);
  });

  it("completely different strings return < 0.3", () => {
    const s = similarity("abcde", "vwxyz");
    expect(s).toBeLessThan(0.3);
  });

  it("empty strings return 0", () => {
    expect(similarity("", "hello")).toBe(0.0);
    expect(similarity("hello", "")).toBe(0.0);
  });

  it("both empty returns 1.0", () => {
    expect(similarity("", "")).toBe(1.0);
  });

  it("near-duplicates return > 0.7", () => {
    const a = "TypeError: cannot read property of undefined";
    const b = "TypeError: cannot read property of null";
    expect(similarity(a, b)).toBeGreaterThan(0.7);
  });

  it("symmetry: similarity(a, b) == similarity(b, a)", () => {
    const a = "foo bar baz";
    const b = "foo bar qux";
    expect(similarity(a, b)).toBe(similarity(b, a));
  });

  it("operates on first 500 chars (does not crash on long strings)", () => {
    const long = "x".repeat(10000);
    expect(() => similarity(long, long)).not.toThrow();
    expect(similarity(long, long)).toBe(1.0);
  });
});
