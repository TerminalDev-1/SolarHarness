export type HostToolCall = { name: string; input: unknown; raw: string };

/** Read a JSON tool request from model text, including indented or fenced output. */
export function parseHostToolCall(text: string): HostToolCall | undefined {
  const marker = /^[ \t]*SOLAR_TOOL:\s*([\w-]+)[ \t]*/gm;
  const match = marker.exec(text);
  if (!match) return undefined;
  const start = marker.lastIndex;
  if (text[start] !== "{") throw new Error(`Invalid ${match[1]} tool request: expected a JSON object.`);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) {
      const raw = text.slice(match.index, index + 1);
      let input: unknown;
      try { input = JSON.parse(text.slice(start, index + 1)); }
      catch { throw new Error(`Invalid JSON for ${match[1]} tool request.`); }
      if (input === null || Array.isArray(input) || typeof input !== "object") throw new Error("Tool input must be a JSON object.");
      return { name: match[1], input, raw };
    }
  }
  throw new Error(`Incomplete JSON for ${match[1]} tool request.`);
}
