import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { solarDirectory } from "./solar-dir.js";
import type { CodexRunOptions, CodexRunResult } from "./types.js";

const sessionDirectories = new Map<string, string>();

/** Record each exchange before returning it, including failed and cancelled turns. */
export async function recordSession(
  prompt: string, options: CodexRunOptions,
  execute: (options: CodexRunOptions) => Promise<CodexRunResult>, sessionId?: string
): Promise<CodexRunResult> {
  const recordingId = randomUUID();
  const key = (id: string) => `${options.cwd}\0${id}`;
  const directory = sessionId && sessionDirectories.get(key(sessionId))
    || await solarDirectory(options.cwd, `sessions/${recordingId}`);
  const log = join(directory, "transcript.jsonl");
  const notes = join(directory, "session_notes.md");
  const started = new Date().toISOString();
  await appendFile(log, JSON.stringify({ type: "start", started, sessionId, role: options.role, model: options.model, prompt }) + "\n");
  // A notes file exists even if the process is interrupted before it can reply.
  await appendFile(notes, `# Session notes\n\nStarted: ${started}\nRole: ${options.role ?? "main-agent"}\nModel: ${options.model}\nSession: ${sessionId ?? "new"}\nStatus: recording (awaiting readback)\n\nRecording: transcript.jsonl\n\n`);
  const events: string[] = [];
  let pendingWrites = Promise.resolve();
  let recordingError: unknown;
  let result: CodexRunResult | undefined;
  let failure: unknown;
  try {
    result = await execute({ ...options, onEvent: event => {
      events.push(event);
      pendingWrites = pendingWrites.then(() => appendFile(log, JSON.stringify({ type: "activity", time: new Date().toISOString(), event }) + "\n"))
        .catch(error => { recordingError = error; });
      options.onEvent?.(event);
    } });
    if (result.sessionId) sessionDirectories.set(key(result.sessionId), directory);
    return result;
  } catch (error) { failure = error; throw error; }
  finally {
    await pendingWrites;
    // The finish entry and readback are always attempted, even after a failed activity write. A recording
    // failure is raised only when the run itself succeeded, so it never hides the run's own error.
    const status = failure ? (options.signal?.aborted ? "cancelled" : "failed") : "completed";
    const error = failure instanceof Error ? failure.message : failure ? String(failure) : undefined;
    try {
      await appendFile(log, JSON.stringify({ type: "finish", finished: new Date().toISOString(), sessionId: result?.sessionId ?? sessionId, status, events, reply: result?.text, error }) + "\n")
        .catch(writeError => { recordingError ??= writeError; });
      await appendFile(notes, `## Readback\n\nStatus: ${status}\nSession: ${result?.sessionId ?? sessionId ?? "unavailable"}\n\n${events.length ? "### Recorded activity\n\n" + events.map(event => `- ${event}`).join("\n") + "\n\n" : ""}### Agent report\n\n${readback(result?.text) ?? error ?? "No report returned."}\n\n`);
    } catch (writeError) { recordingError ??= writeError; }
    if (recordingError && !failure) throw recordingError;
  }
}

function readback(text?: string): string | undefined {
  if (!text) return undefined;
  try {
    const turn = JSON.parse(text);
    if (turn.kind === "answer" && typeof turn.reply === "string") return turn.reply;
    if (turn.kind === "tool") return `Requested host tool: ${turn.tool}\n\nInput: ${turn.input}\n\nOutcome is recorded in the next exchange.`;
  } catch { /* Ordinary agent reports are already readable. */ }
  return text;
}
