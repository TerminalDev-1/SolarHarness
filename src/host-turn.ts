import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const HOST_TOOLS = ["browser", "web_search_headless", "workspace_command", "set-auto-permissions", "adjust-sub-effort-level"] as const;

/** Codex CLI can require a tool request as its final structured response. */
export async function writeHostTurnSchema(cwd: string, requireTool: boolean): Promise<string> {
  const directory = join(cwd, ".solarharness", "schemas");
  await mkdir(directory, { recursive: true });
  const path = join(directory, requireTool ? "host-tool-required.json" : "host-tool-or-answer.json");
  await writeFile(path, JSON.stringify({
    type: "object",
    additionalProperties: false,
    required: ["kind", "tool", "input", "reply"],
    properties: {
      kind: { type: "string", enum: requireTool ? ["tool"] : ["tool", "answer"] },
      tool: { type: "string", enum: requireTool ? [...HOST_TOOLS] : [...HOST_TOOLS, "none"] },
      input: { type: "string" },
      reply: { type: "string" }
    }
  }));
  return path;
}

/** Convert the CLI's enforced JSON envelope to the host tool protocol. */
export function decodeHostTurn(text: string): string {
  let value: unknown;
  try { value = JSON.parse(text); }
  catch { return text; } // Existing model sessions and test providers may use the line protocol.
  if (!value || typeof value !== "object" || !("kind" in value)) return text;
  const turn = value as { kind?: unknown; tool?: unknown; input?: unknown; reply?: unknown };
  if (turn.kind === "answer") {
    if (typeof turn.reply !== "string") throw new Error("Host answer must contain reply text.");
    const reply = turn.reply.replace(/\s*SOLAR_STATE:\s*(?:READY|DISCOVER)\s*$/i, "").trim();
    return `${reply}\nSOLAR_STATE: DISCOVER`;
  }
  if (turn.kind !== "tool" || typeof turn.tool !== "string" || !HOST_TOOLS.includes(turn.tool as typeof HOST_TOOLS[number])) {
    throw new Error("Codex returned an invalid host tool name.");
  }
  if (typeof turn.input !== "string") throw new Error("Host tool input must be a JSON string.");
  let input: unknown;
  try { input = JSON.parse(turn.input); }
  catch { throw new Error(`Codex returned invalid JSON for ${turn.tool}.`); }
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Host tool input must be a JSON object.");
  return `SOLAR_TOOL: ${turn.tool} ${JSON.stringify(input)}`;
}
