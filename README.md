# ClawSync

> Your coding agent forgets everything. ClawSync remembers.

ClawSync analyzes your Claude Code session files, extracts reusable patterns (error recoveries, dead ends, architecture decisions), deduplicates them, and writes a managed section to your `CLAUDE.md` — so every future session starts with the hard-won knowledge from your past work.

---

## What It Does

1. **Parse** — reads Claude Code `.jsonl` session files from `~/.claude/projects/`
2. **Extract** — heuristically identifies:
   - 🔴 **Error-recovery patterns**: where a tool call failed and the agent recovered
   - 🔴 **Dead ends**: approaches that were abandoned mid-session
   - 🟡 **Architecture decisions**: reasoning captured in assistant messages
3. **Dedup** — exact hash + similarity matching eliminates near-duplicates; tracks frequency across sessions
4. **Optimize** — writes a sentinel-bounded section to `CLAUDE.md`, preserving everything outside the sentinels

---

## Install

```bash
npm install -g clawsync
```

Or run without installing:

```bash
npx clawsync sync
```

Build from source:

```bash
git clone https://github.com/serflek/clawsync
cd clawsync
npm install
npm run build
node dist/index.js --help
```

---

## Usage

### `clawsync sync`

Run the full pipeline: discover sessions → extract patterns → update `CLAUDE.md`.

```bash
clawsync sync
clawsync sync --source ~/.claude/projects/ --target ./CLAUDE.md
clawsync sync --dry-run    # Preview without writing
clawsync sync --config ./clawsync.yaml
```

Options:
| Flag | Description | Default |
|---|---|---|
| `--source <path>` | Root directory containing `.jsonl` session files | `~/.claude/projects/` |
| `--target <path>` | `CLAUDE.md` file to update | `./CLAUDE.md` |
| `--config <path>` | Config file path | `./clawsync.yaml` |
| `--dry-run` | Print what would be written, don't write | `false` |

### `clawsync parse <file>`

Parse a single `.jsonl` session file and print what ClawSync sees.

```bash
clawsync parse ~/.claude/projects/my-project/abc123.jsonl
clawsync parse --json abc123.jsonl   # JSON output
```

### `clawsync status`

Show the current sync state: processed sessions count, learning count, last run time.

```bash
clawsync status
```

---

## Configuration

ClawSync looks for config in this order:
1. Path passed via `--config`
2. `./clawsync.yaml`
3. `./config/default.yaml`
4. `~/.config/clawsync/config.yaml`

If no config is found, defaults are used.

**`clawsync.yaml` example:**

```yaml
mode: personal  # personal | team | fleet

source:
  type: rsync   # rsync | watch | git
  path: ~/.claude/projects/

target:
  claude_md: ./CLAUDE.md

sync:
  interval_minutes: 5
  max_sessions_per_run: 50

extraction:
  min_confidence: 0.6     # Only keep patterns above this threshold
  max_learnings: 100      # Cap stored learnings (prunes oldest/lowest-confidence)
  prune_after_days: 30    # Auto-remove stale one-off learnings older than N days
```

---

## How It Works

### Session Parsing

ClawSync reads Claude Code `.jsonl` files line by line. Each line is a structured event:
- `type: "user"` / `type: "assistant"` — conversation turns
- `type: "file-history-snapshot"` / `type: "queue-operation"` — metadata (skipped)

The `ClaudeCodeProvider` extracts:
- **Tool calls** from `tool_use` blocks in assistant messages
- **Tool results** (success/failure) from `tool_result` blocks in user messages
- **Text content** from `text` and `thinking` blocks

### Pattern Extraction

All heuristic, zero LLM calls:

- **Error recoveries**: looks for failed tool results (non-trivial errors), then scans forward up to 10 turns for a successful call on the same tool/file
- **Dead ends**: sliding 5-turn window looking for signal density (1 strong signal OR 2+ weak signals)
- **Decisions**: scans assistant text for decision signal phrases, extracts surrounding sentences

### Deduplication

Two-pass:
1. **Exact hash** — SHA-256 of normalized `summary + detail` (first 32 chars). Exact matches bump frequency.
2. **Similarity** — Levenshtein similarity ≥ 0.7 on same-type learnings. Near-duplicates are merged, keeping the more recent version.

### CLAUDE.md Integration

The managed section is bounded by sentinel comments:

```markdown
<!-- clawsync:start -->
## ClawSync Session Learnings
...
<!-- clawsync:end -->
```

ClawSync **never touches content outside the sentinels**. If you manually edit inside the sentinels, ClawSync detects the hash mismatch and skips the write until you delete the sentinels.

Writes are atomic: `tmp → backup → rename`.

---

## License

Business Source License 1.1 (BSL 1.1)

ClawSync is source-available. You may use it freely for personal and internal organizational use. You may **not** offer it as a hosted/managed service or incorporate it as a primary component in a commercial product sold to third parties.

See [LICENSE](./LICENSE) for full terms.

For commercial licensing: autosoul@serflek.com

---

## Development

```bash
npm run dev       # Run with tsx (no build step)
npm test          # Run tests with vitest
npm run lint      # TypeScript type check
npm run build     # Compile to dist/
```

Tests live in `tests/`. Fixtures are in `tests/fixtures/`.
