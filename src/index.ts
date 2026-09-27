#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { startSolarUi } from "./ui.js";
import { REASONING_EFFORTS, type ReasoningEffort } from "./types.js";
import { loadDefaultEffort } from "./settings.js";
import { SOLAR_VERSION } from "./version.js";

const program = new Command();

program
  .name("solar")
  .description("Solar Harness — a terminal-native coding agent harness")
  .version(SOLAR_VERSION);

program
  .command("chat", { isDefault: true })
  .description("Start the Solar Harness terminal UI")
  .option("--model <model>", "Codex model", "gpt-6-luna")
  .option("--reasoning <effort>", "Reasoning for this session: light, medium, high, xhigh, or max (default: the saved /default-effort, initially max)")
  .action(({ model, reasoning = loadDefaultEffort() }: { model: string; reasoning?: ReasoningEffort }) => {
    if (!REASONING_EFFORTS.includes(reasoning)) {
      throw new Error("--reasoning must be light, medium, high, xhigh, or max.");
    }
    startSolarUi({ cwd: resolve(process.cwd()), model, reasoning });
  });

program.parseAsync().catch(error => {
  process.stderr.write(`Solar Harness: ${error.message}\n`);
  process.exitCode = 1;
});
