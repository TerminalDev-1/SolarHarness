#!/usr/bin/env node
import { Command } from "commander";
import { mkdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { startSolarUi } from "./ui.js";
import type { ProviderChoice } from "./provider-settings.js";
import { REASONING_EFFORTS, type ReasoningEffort } from "./types.js";

const program = new Command();

program
  .name("solar-harness")
  .description("Solar Harness Preview — a terminal-native coding agent harness");

program
  .command("chat", { isDefault: true })
  .description("Start the Solar Harness Preview terminal UI")
  .option("--model <model>", "Model for the selected provider")
  .option("--provider <provider>", "Use codex or gemini")
  .option("--reasoning <effort>", "Default reasoning: light, medium, high, xhigh, or max", "light")
  .action(({ model, reasoning, provider }: { model?: string; reasoning: ReasoningEffort; provider?: ProviderChoice }) => {
    if (!REASONING_EFFORTS.includes(reasoning)) {
      throw new Error("--reasoning must be light, medium, high, xhigh, or max.");
    }
    if (provider && provider !== "codex" && provider !== "gemini") throw new Error("--provider must be codex or gemini.");
    const launchDirectory = resolve(process.cwd());
    const workspace = basename(launchDirectory).toLowerCase() === "test" ? launchDirectory : join(launchDirectory, "test");
    mkdirSync(workspace, { recursive: true });
    startSolarUi({ cwd: workspace, model, reasoning, provider });
  });

program.parseAsync().catch(error => {
  process.stderr.write(`Solar Harness Preview: ${error.message}\n`);
  process.exitCode = 1;
});
