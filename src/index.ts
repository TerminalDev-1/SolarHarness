#!/usr/bin/env node
import { Command } from "commander";
import { SolarHarness } from "./harness.js";
import { startSolarUi } from "./ui.js";
import type { ReasoningEffort } from "./types.js";

const program = new Command();

program
  .name("solar-harness")
  .description("Solar Harness Preview — a terminal-native Codex worker orchestrator");

program
  .command("chat")
  .description("Start the Solar Harness Preview terminal UI")
  .option("--model <model>", "Codex model", "gpt-5.6-luna")
  .option("--reasoning <effort>", "Default worker reasoning: low, medium, or high", "medium")
  .action(({ model, reasoning }: { model: string; reasoning: ReasoningEffort }) => {
    if (!["low", "medium", "high"].includes(reasoning)) {
      throw new Error("--reasoning must be low, medium, or high.");
    }
    const harness = new SolarHarness({ task: "", model, reasoning, cwd: process.cwd() });
    startSolarUi(harness, model, reasoning);
  });

program.parseAsync().catch(error => {
  process.stderr.write(`Solar Harness Preview: ${error.message}\n`);
  process.exitCode = 1;
});
