import chalk from "chalk";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { parse as parseYaml } from "yaml";
import { ConfigSchema, type SyncState } from "../core/types.js";

/**
 * `clawsync status` — Show current sync state.
 */
export async function statusCommand(options: {
  target?: string;
  config?: string;
}): Promise<void> {
  console.log(chalk.blue("\n📋 ClawSync Status\n"));

  // Load config to find target path
  let targetPath = options.target || "./CLAUDE.md";
  const configPaths = [
    options.config,
    "./clawsync.yaml",
    "./config/default.yaml",
  ].filter(Boolean) as string[];

  for (const p of configPaths) {
    const resolved = resolve(p.replace(/^~/, process.env.HOME || "~"));
    if (existsSync(resolved)) {
      try {
        const raw = readFileSync(resolved, "utf-8");
        const parsed = parseYaml(raw);
        const config = ConfigSchema.parse(parsed);
        targetPath = options.target || config.target.claude_md;
        console.log(chalk.gray("Config:"), resolved);
        break;
      } catch {
        // Continue
      }
    }
  }

  const absTarget = resolve(
    targetPath.replace(/^~/, process.env.HOME || "~")
  );

  // Find state file
  const statePath = join(dirname(absTarget), ".clawsync-state.json");

  if (!existsSync(statePath)) {
    console.log(chalk.yellow("No sync state found. Run `clawsync sync` first."));
    return;
  }

  const state: SyncState = JSON.parse(readFileSync(statePath, "utf-8"));

  console.log(chalk.gray("Target:           "), absTarget);
  console.log(chalk.gray("State file:       "), statePath);
  console.log(chalk.gray("Last run:         "), state.lastRun || "never");
  console.log(
    chalk.gray("Sessions processed:"),
    state.processedSessions.length
  );
  console.log(chalk.gray("Total learnings:  "), state.learnings.length);

  if (state.learnings.length > 0) {
    console.log();

    // Breakdown by type
    const byType = new Map<string, number>();
    for (const l of state.learnings) {
      byType.set(l.type, (byType.get(l.type) || 0) + 1);
    }
    console.log(chalk.gray("By type:"));
    for (const [type, count] of byType) {
      const icon =
        type === "error-recovery"
          ? "🔧"
          : type === "dead-end"
            ? "🚫"
            : type === "decision"
              ? "🧠"
              : "⚠️";
      console.log(`  ${icon} ${type}: ${count}`);
    }

    // Confidence distribution
    const highConf = state.learnings.filter((l) => l.confidence >= 0.8).length;
    const medConf = state.learnings.filter(
      (l) => l.confidence >= 0.6 && l.confidence < 0.8
    ).length;
    const lowConf = state.learnings.filter((l) => l.confidence < 0.6).length;

    console.log(chalk.gray("\nConfidence:"));
    console.log(`  🔴 High (≥0.8): ${highConf}`);
    console.log(`  🟡 Medium (0.6-0.8): ${medConf}`);
    console.log(`  ⚪ Low (<0.6): ${lowConf}`);

    // Most frequent
    const frequent = [...state.learnings]
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5);
    if (frequent.some((l) => l.frequency > 1)) {
      console.log(chalk.gray("\nMost frequent:"));
      for (const l of frequent) {
        if (l.frequency > 1) {
          console.log(chalk.gray(`  ${l.frequency}x`), l.summary.slice(0, 80));
        }
      }
    }

    // Pinned
    const pinned = state.learnings.filter((l) => l.pinned);
    if (pinned.length > 0) {
      console.log(chalk.gray(`\n📌 Pinned: ${pinned.length}`));
    }
  }

  // Check CLAUDE.md status
  console.log();
  if (existsSync(absTarget)) {
    const content = readFileSync(absTarget, "utf-8");
    const hasSection =
      content.includes("<!-- clawsync:start -->") &&
      content.includes("<!-- clawsync:end -->");
    console.log(
      chalk.gray("CLAUDE.md:"),
      hasSection
        ? chalk.green("✓ ClawSync section present")
        : chalk.yellow("⚠ No ClawSync section yet")
    );
  } else {
    console.log(chalk.gray("CLAUDE.md:"), chalk.yellow("File not found"));
  }

  console.log();
}
