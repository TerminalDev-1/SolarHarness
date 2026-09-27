/** Codex CLI models offered in the /model picker. Both support every effort level and Fast mode. */
export const SOLAR_MODELS = [
  { id: "gpt-6-luna", name: "GPT-6 Luna", detail: "Fast and affordable model for easier tasks" },
  { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", detail: "Older fast and efficient model" }
] as const;

export function modelName(id: string): string {
  return SOLAR_MODELS.find(model => model.id === id)?.name ?? id;
}
