#!/usr/bin/env node
import { Command } from "commander";
import { mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { startSolarUi } from "./ui.js";
import { REASONING_EFFORTS, type ReasoningEffort } from "./types.js";

const program = new Command();

program
  .name("solar-harness")
  .description("Solar Harness Preview — a terminal-native coding agent harness");

program
  .command("chat", { isDefault: true })
  .description("Start the Solar Harness Preview terminal UI")
  .option("--model <model>", "Codex model", "gpt-6-luna")
  .option("--reasoning <effort>", "Default reasoning: light, medium, high, xhigh, or max", "light")
  .action(({ model, reasoning }: { model: string; reasoning: ReasoningEffort }) => {
    if (!REASONING_EFFORTS.includes(reasoning)) {
      throw new Error("--reasoning must be light, medium, high, xhigh, or max.");
    }
    const launchDirectory = resolve(process.cwd());
    const workspace = basename(launchDirectory).toLowerCase() === "test" ? launchDirectory : join(launchDirectory, "test");
    mkdirSync(workspace, { recursive: true });
    startSolarUi({ cwd: workspace, model, reasoning });
  });

program.parseAsync().catch(error => {
  process.stderr.write(`Solar Harness Preview: ${error.message}\n`);
  process.exitCode = 1;
});
