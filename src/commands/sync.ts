import chalk from "chalk";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseSession } from "../core/parser.js";
import { extractPatterns } from "../core/extractor.js";
import { dedup, prune } from "../core/dedup.js";
import { optimizeClaudeMd } from "../core/optimizer.js";
import { ConfigSchema, type Config, type SyncState } from "../core/types.js";

const DEFAULT_STATE: SyncState = {
  processedSessions: [],
  learnings: [],
};

/**
 * `clawsync sync --source <path> --target <claude.md>`
 * Main pipeline: discover → parse → extract → dedup → optimize.
 */
export async function syncCommand(options: {
  source?: string;
  target?: string;
  config?: string;
  dryRun?: boolean;
}): Promise<void> {
  // Load config
  const config = loadConfig(options.config);
  const sourcePath = resolve(
    (options.source || config.source.path).replace(/^~/, process.env.HOME || "~")
  );
  const targetPath =
    options.target || config.target.claude_md;

  console.log(chalk.blue("\n🔄 ClawSync — Starting sync\n"));
  console.log(chalk.gray("Source:"), sourcePath);
  console.log(chalk.gray("Target:"), targetPath);
  console.log();

  // Load state
  const statePath = join(
    resolve(targetPath.replace(/^~/, process.env.HOME || "~")).replace(/[^/]+$/, ""),
    ".clawsync-state.json"
  );
  const state = loadState(statePath);

  // Discover session files
  const sessionFiles = discoverSessions(sourcePath);
  const newSessions = sessionFiles.filter(
    (f) => !state.processedSessions.includes(f)
  );

  if (newSessions.length === 0) {
    console.log(chalk.yellow("No new sessions to process."));
    return;
  }

  console.log(
    chalk.gray(
      `Found ${sessionFiles.length} sessions (${newSessions.length} new)`
    )
  );

  // Limit per run
  const toProcess = newSessions.slice(0, config.sync.max_sessions_per_run);
  let totalPatterns = 0;

  for (const sessionFile of toProcess) {
    try {
      const session = await parseSession(sessionFile);
      const patterns = extractPatterns(session);

      // Filter by min confidence
      const significant = patterns.filter(
        (p) => p.confidence >= config.extraction.min_confidence
      );

      if (significant.length > 0) {
        console.log(
          chalk.green(`  ✓ ${session.sessionId.slice(0, 8)}...`),
          chalk.gray(`${significant.length} patterns`)
        );
        state.learnings = dedup(state.learnings, significant);
        totalPatterns += significant.length;
      } else {
        console.log(
          chalk.gray(`  - ${session.sessionId.slice(0, 8)}...`),
          chalk.gray("no significant patterns")
        );
      }

      state.processedSessions.push(sessionFile);
    } catch (err) {
      console.log(
        chalk.red(`  ✗ ${sessionFile.split("/").pop()}`),
        chalk.gray((err as Error).message)
      );
    }
  }

  // Prune learnings
  state.learnings = prune(
    state.learnings,
    config.extraction.max_learnings,
    config.extraction.prune_after_days
  );

  console.log(
    chalk.blue(
      `\n📊 ${totalPatterns} new patterns → ${state.learnings.length} total learnings\n`
    )
  );

  // Optimize CLAUDE.md
  if (options.dryRun) {
    console.log(chalk.yellow("Dry run — not writing to CLAUDE.md"));
    console.log(
      chalk.gray(`Would write ${state.learnings.length} learnings to ${targetPath}`)
    );
  } else {
    const result = optimizeClaudeMd(targetPath, state.learnings, state, config);
    if (result.written) {
      console.log(
        chalk.green(`✅ Updated ${result.targetPath} with ${result.learningsCount} learnings`)
      );
    } else {
      console.log(chalk.yellow(`⚠️  ${result.reason}`));
    }
  }

  // Save state
  state.lastRun = new Date().toISOString();
  writeFileSync(statePath, JSON.stringify(state, null, 2), "utf-8");
  console.log(chalk.gray(`\nState saved to ${statePath}`));
}

// ── Helpers ─────────────────────────────────────────────────────────

function loadConfig(configPath?: string): Config {
  const paths = [
    configPath,
    "./clawsync.yaml",
    "./config/default.yaml",
    join(process.env.HOME || "~", ".config/clawsync/config.yaml"),
  ].filter(Boolean) as string[];

  for (const p of paths) {
    const resolved = resolve(p.replace(/^~/, process.env.HOME || "~"));
    if (existsSync(resolved)) {
      try {
        const raw = readFileSync(resolved, "utf-8");
        const parsed = parseYaml(raw);
        return ConfigSchema.parse(parsed);
      } catch {
        // Invalid config, continue to next
      }
    }
  }

  // Return defaults
  return ConfigSchema.parse({});
}

function loadState(statePath: string): SyncState {
  if (existsSync(statePath)) {
    try {
      return JSON.parse(readFileSync(statePath, "utf-8"));
    } catch {
      return { ...DEFAULT_STATE };
    }
  }
  return { ...DEFAULT_STATE };
}

function discoverSessions(sourcePath: string): string[] {
  const sessions: string[] = [];

  if (!existsSync(sourcePath)) {
    console.log(chalk.yellow(`Source path not found: ${sourcePath}`));
    return sessions;
  }

  // Recursively find .jsonl files
  walkDir(sourcePath, (filePath) => {
    if (filePath.endsWith(".jsonl")) {
      sessions.push(filePath);
    }
  });

  // Sort by modification time (newest first)
  sessions.sort((a, b) => {
    try {
      return statSync(b).mtimeMs - statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });

  return sessions;
}

function walkDir(dir: string, callback: (path: string) => void): void {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules, .git, etc.
        if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
        walkDir(fullPath, callback);
      } else if (entry.isFile()) {
        callback(fullPath);
      }
    }
  } catch {
    // Permission denied or other fs error — skip
  }
}
