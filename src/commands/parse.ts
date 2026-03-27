import chalk from "chalk";
import { parseSession } from "../core/parser.js";
import { extractPatterns } from "../core/extractor.js";

/**
 * `clawsync parse <session-file>` — Parse and inspect a session file.
 * Debug/exploration command for understanding what ClawSync extracts.
 */
export async function parseCommand(sessionFile: string): Promise<void> {
  console.log(chalk.blue(`\n🔍 Parsing session: ${sessionFile}\n`));

  const session = await parseSession(sessionFile);

  console.log(chalk.gray("Session ID:"), session.sessionId);
  console.log(chalk.gray("Entrypoint:"), session.entrypoint || "unknown");
  console.log(chalk.gray("Version:   "), session.version || "unknown");
  console.log(chalk.gray("CWD:       "), session.cwd || "unknown");
  console.log(chalk.gray("Start:     "), session.startTime || "unknown");
  console.log(chalk.gray("End:       "), session.endTime || "unknown");
  console.log(chalk.gray("Turns:     "), session.turns.length);
  console.log();

  // Count by role
  const userTurns = session.turns.filter((t) => t.role === "user").length;
  const assistantTurns = session.turns.filter((t) => t.role === "assistant").length;
  const toolCalls = session.turns.reduce(
    (sum, t) => sum + t.toolCalls.length,
    0
  );
  const toolResults = session.turns.reduce(
    (sum, t) => sum + t.toolResults.length,
    0
  );

  console.log(chalk.gray("User turns:      "), userTurns);
  console.log(chalk.gray("Assistant turns:  "), assistantTurns);
  console.log(chalk.gray("Tool calls:      "), toolCalls);
  console.log(chalk.gray("Tool results:    "), toolResults);

  // Token usage
  const totalInput = session.turns.reduce(
    (sum, t) => sum + (t.tokenUsage?.input || 0),
    0
  );
  const totalOutput = session.turns.reduce(
    (sum, t) => sum + (t.tokenUsage?.output || 0),
    0
  );
  if (totalInput > 0 || totalOutput > 0) {
    console.log(
      chalk.gray("Token usage:     "),
      `${totalInput.toLocaleString()} in / ${totalOutput.toLocaleString()} out`
    );
  }

  // Tool call breakdown
  const toolNames = new Map<string, number>();
  for (const turn of session.turns) {
    for (const tc of turn.toolCalls) {
      toolNames.set(tc.name, (toolNames.get(tc.name) || 0) + 1);
    }
  }
  if (toolNames.size > 0) {
    console.log(chalk.gray("\nTool usage:"));
    const sorted = [...toolNames.entries()].sort((a, b) => b[1] - a[1]);
    for (const [name, count] of sorted) {
      console.log(chalk.gray(`  ${name}:`), count);
    }
  }

  // Extract patterns
  console.log(chalk.blue("\n📊 Extracting patterns...\n"));
  const patterns = extractPatterns(session);

  if (patterns.length === 0) {
    console.log(chalk.yellow("No patterns extracted from this session."));
    console.log(
      chalk.gray(
        "This is normal for short sessions or sessions without errors/dead-ends."
      )
    );
    return;
  }

  console.log(chalk.green(`Found ${patterns.length} patterns:\n`));

  for (const pattern of patterns) {
    const icon =
      pattern.type === "error-recovery"
        ? "🔧"
        : pattern.type === "dead-end"
          ? "🚫"
          : pattern.type === "decision"
            ? "🧠"
            : "⚠️";
    const confColor =
      pattern.confidence >= 0.8
        ? chalk.red
        : pattern.confidence >= 0.6
          ? chalk.yellow
          : chalk.gray;

    console.log(
      `${icon} ${chalk.bold(pattern.type)} ${confColor(`[${(pattern.confidence * 100).toFixed(0)}%]`)}`
    );
    console.log(chalk.white(`   ${pattern.summary}`));
    if (pattern.detail) {
      const detailLines = pattern.detail.split("\n").slice(0, 3);
      for (const line of detailLines) {
        console.log(chalk.gray(`   ${line.slice(0, 120)}`));
      }
    }
    console.log();
  }
}
