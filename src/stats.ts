import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type SolarStats = {
  chats: number;
  prompts: number;
  completed: number;
  inputTokens: number;
  outputTokens: number;
  models: Record<string, number>;
  achievements: string[];
};

const milestones: readonly [string, (stats: SolarStats) => boolean][] = [
  ["First prompt!", stats => stats.prompts >= 1],
  ["Getting started · 10 prompts", stats => stats.prompts >= 10],
  ["Solar regular · 50 prompts", stats => stats.prompts >= 50],
  ["First website built!", stats => stats.achievements.includes("First website built!")]
];

export class StatsStore {
  private readonly path: string;
  private data: SolarStats;

  constructor(path = process.env.SOLAR_STATS_PATH || join(homedir(), ".solarharness", "stats.json")) {
    this.path = path;
    try {
      const saved = JSON.parse(readFileSync(path, "utf8")) as Partial<SolarStats>;
      this.data = { ...emptyStats(), ...saved, models: saved.models ?? {}, achievements: saved.achievements ?? [] };
    } catch { this.data = emptyStats(); }
  }

  snapshot(): SolarStats { return structuredClone(this.data); }

  startChat(): void { this.data.chats++; this.save(); }

  recordPrompt(model: string, completed: boolean, websiteBuilt = false): string[] {
    this.data.prompts++;
    if (completed) this.data.completed++;
    this.data.models[model] = (this.data.models[model] ?? 0) + 1;
    const websiteUnlock = websiteBuilt && !this.data.achievements.includes("First website built!") ? ["First website built!"] : [];
    this.data.achievements.push(...websiteUnlock);
    const unlocked = milestones.filter(([name, achieved]) => achieved(this.data) && !this.data.achievements.includes(name)).map(([name]) => name);
    this.data.achievements.push(...unlocked);
    this.save();
    return [...websiteUnlock, ...unlocked];
  }

  recordWebsiteBuilt(): string[] {
    if (this.data.achievements.includes("First website built!")) return [];
    this.data.achievements.push("First website built!");
    this.save();
    return ["First website built!"];
  }

  recordUsage(input: number, output: number): void {
    this.data.inputTokens += input;
    this.data.outputTokens += output;
    this.save();
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.data, null, 2));
  }
}

function emptyStats(): SolarStats {
  return { chats: 0, prompts: 0, completed: 0, inputTokens: 0, outputTokens: 0, models: {}, achievements: [] };
}

export function formatStats(stats: SolarStats): string {
  const favorite = Object.entries(stats.models).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "None yet";
  return `Solar stats\nChats: ${stats.chats} · Prompts: ${stats.prompts} · Completed: ${stats.completed}\nTracked usage: ${stats.inputTokens.toLocaleString()} input + ${stats.outputTokens.toLocaleString()} output tokens\nFavorite model: ${favorite}\nAchievements (${stats.achievements.length}/${milestones.length}): ${milestones.map(([name]) => `${stats.achievements.includes(name) ? "◆" : "◇"} ${name}`).join(" · ")}`;
}
