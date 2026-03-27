#!/usr/bin/env node

import { Command } from "commander";
import { parseCommand } from "./commands/parse.js";
import { syncCommand } from "./commands/sync.js";
import { statusCommand } from "./commands/status.js";

const program = new Command();

program
  .name("clawsync")
  .description(
    "Your coding agent forgets everything. ClawSync remembers.\n\n" +
    "Parse Claude Code sessions, extract patterns (errors, dead-ends, decisions),\n" +
    "and optimize CLAUDE.md with learned insights."
  )
  .version("0.1.0");

program
  .command("parse <session-file>")
  .description("Parse and inspect a session file (debug/exploration)")
  .action(async (sessionFile: string) => {
    try {
      await parseCommand(sessionFile);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("sync")
  .description("Sync sessions → extract patterns → optimize CLAUDE.md")
  .option("-s, --source <path>", "Source directory with session files")
  .option("-t, --target <path>", "Target CLAUDE.md file path")
  .option("-c, --config <path>", "Config file path")
  .option("--dry-run", "Show what would be done without writing")
  .action(async (options) => {
    try {
      await syncCommand(options);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program
  .command("status")
  .description("Show current sync state and learning statistics")
  .option("-t, --target <path>", "Target CLAUDE.md file path")
  .option("-c, --config <path>", "Config file path")
  .action(async (options) => {
    try {
      await statusCommand(options);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
      process.exit(1);
    }
  });

program.parse();
