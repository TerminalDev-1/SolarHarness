import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentManager } from "../dist/agent-manager.js";
import { CodexCliProvider } from "../dist/codex-provider.js";
import { SolarHarness } from "../dist/harness.js";
import { recordSession } from "../dist/session-recorder.js";
import { runWorkspaceCommand } from "../dist/workspace-tool.js";

process.env.SOLAR_STATS_PATH = join(tmpdir(), `solar-harness-robustness-stats-${process.pid}.json`);
process.env.SOLAR_HOME = join(tmpdir(), `solar-harness-robustness-home-${process.pid}`);
test.after(async () => { await rm(process.env.SOLAR_STATS_PATH, { force: true }); });

const answer = reply => ({ text: JSON.stringify({ kind: "answer", tool: "none", input: "", reply }), sessionId: "main-session" });

test("a parent cancelled while waiting on its sub-delegates stays cancelled and is not resumed", async () => {
  let resumes = 0;
  let childStarted;
  const childRunning = new Promise(resolve => { childStarted = resolve; });
  const provider = {
    async run(_prompt, options) {
      if (options.role === "sub-agent") {
        return { text: 'SOLAR_SUBDELEGATE: {"tasks":[{"name":"Spark","title":"Child","instructions":"Work","context":""}]}', sessionId: "parent-session" };
      }
      childStarted();
      // Like the real provider, a run ends when its signal aborts.
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    },
    async resume() { resumes++; return { text: "Integrated anyway", sessionId: "parent-session" }; }
  };
  const manager = new AgentManager(provider, { model: "fake", reasoning: "light", cwd: process.cwd() });
  const spawned = manager.spawn({ name: "Forge", title: "Parent", instructions: "Delegate", context: "", reasoning: "light" });
  await childRunning;
  const parent = manager.list().find(record => record.name === "Forge");
  await manager.orchestrate({ action: "cancel", agentId: parent.id });
  await spawned;
  assert.equal(parent.status, "cancelled");
  assert.equal(resumes, 0);
  assert.equal(manager.list().find(record => record.name === "Spark").status, "cancelled");
});

test("the Codex provider does not start a run whose signal is already aborted", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "solar-abort-"));
  const previous = process.env.SOLAR_CODEX_PATH;
  process.env.SOLAR_CODEX_PATH = join(cwd, "missing-codex.exe");
  try {
    const provider = new CodexCliProvider();
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(provider.run("hello", { cwd, model: "fake", reasoning: "light", signal: controller.signal }), /cancelled before it started/);
  } finally {
    if (previous === undefined) delete process.env.SOLAR_CODEX_PATH; else process.env.SOLAR_CODEX_PATH = previous;
    await rm(cwd, { recursive: true, force: true });
  }
});

test("a failed transcript write still saves the readback and never hides the run's own error", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "solar-recording-failure-"));
  const options = { cwd, model: "fake", reasoning: "light", role: "planner" };
  const breakTranscript = async () => {
    const root = join(cwd, ".solarharness", "sessions");
    for (const folder of await readdir(root)) {
      const log = join(root, folder, "transcript.jsonl");
      await rm(log, { force: true });
      await mkdir(log); // Appending to a directory fails.
    }
  };
  try {
    await assert.rejects(recordSession("failing run", options, async recorded => {
      await breakTranscript();
      recorded.onEvent("Inspected source");
      throw new Error("Backend unavailable");
    }), /Backend unavailable/);
    const root = join(cwd, ".solarharness", "sessions");
    const [folder] = await readdir(root);
    const notes = await readFile(join(root, folder, "session_notes.md"), "utf8");
    assert.match(notes, /## Readback/);
    assert.match(notes, /Status: failed/);
    assert.match(notes, /Inspected source/);

    await rm(join(cwd, ".solarharness"), { recursive: true, force: true });
    await assert.rejects(recordSession("succeeding run", options, async recorded => {
      await breakTranscript();
      recorded.onEvent("Edited file");
      return { text: "Done", sessionId: "s-1" };
    }), error => !/Done/.test(String(error)));
    const [second] = await readdir(root);
    assert.match(await readFile(join(root, second, "session_notes.md"), "utf8"), /Status: completed[\s\S]*Done/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("a code search is not turned into a web search", async () => {
  for (const request of [
    "search for usages of parseHostToolCall",
    "Search for `decodeHostTurn`",
    "look up where harness.ts handles retries",
    "search for TODOs in the source",
    "search for MAX_CONCURRENT_AGENTS"
  ]) {
    const harness = new SolarHarness({ task: "", model: "fake", reasoning: "light", cwd: process.cwd() });
    let searches = 0;
    harness.webSearchHeadless.execute = async () => { searches++; throw new Error("web search should not run"); };
    harness.provider.run = async () => answer("Found it in src/host-tool-call.ts.");
    harness.provider.resume = async () => answer("Found it in src/host-tool-call.ts.");
    const result = await harness.converse(request);
    assert.equal(searches, 0, request);
    assert.match(result.reply, /Found it/, request);
  }
});

test("product names that look like code still get a web search", async () => {
  for (const [request, query] of [
    ["Search for iPhone 17 reviews", "iPhone 17 reviews"],
    ["Search for macOS Sequoia features", "macOS Sequoia features"],
    ["Look up Node.js release dates", "Node.js release dates"],
    ["Search for the definition of serendipity", "the definition of serendipity"]
  ]) {
    const harness = new SolarHarness({ task: "", model: "fake", reasoning: "light", cwd: process.cwd() });
    const actions = [];
    harness.webSearchHeadless.execute = async input => {
      actions.push(input);
      return { action: "search", query: input.query, engine: "bing", url: "https://www.bing.com/search", title: "Search", results: [{ title: "Result", url: "https://example.com", snippet: "Result" }] };
    };
    harness.provider.run = async () => ({ text: `SOLAR_TOOL: web_search_headless ${JSON.stringify({ action: "search", query })}`, sessionId: "web-session" });
    harness.provider.resume = async () => ({ text: "SOLAR_STATE: DISCOVER", sessionId: "web-session" });
    const result = await harness.converse(request);
    assert.deepEqual(actions, [{ action: "search", query }], request);
    assert.match(result.reply, /searched the web/, request);
  }
});

test("a malformed sub-delegate request does not throw away the sub-agent's work", async () => {
  const prompts = [];
  const provider = {
    async run() { return { text: "Built the page.\nSOLAR_SUBDELEGATE: {not json}", sessionId: "agent-session" }; },
    async resume(_id, prompt) { prompts.push(prompt); return { text: "Finished the rest myself.", sessionId: "agent-session" }; }
  };
  const manager = new AgentManager(provider, { model: "fake", reasoning: "light", cwd: process.cwd() });
  const agent = await manager.spawn({ name: "Forge", title: "Task", instructions: "Work", context: "", reasoning: "light" });
  assert.equal(agent.status, "completed");
  assert.equal(agent.report, "Finished the rest myself.");
  assert.match(prompts[0], /not valid JSON/);
});

test("a malformed sub-delegate control line is rejected without failing the parent", async () => {
  const prompts = [];
  const provider = {
    async run(_prompt, options) {
      return options.role === "sub-agent"
        ? { text: 'SOLAR_SUBDELEGATE: {"tasks":[{"name":"Beam","title":"Child","instructions":"Work","context":""}]}', sessionId: "parent-session" }
        : { text: "Child done", sessionId: "child-session" };
    },
    async resume(_id, prompt) {
      prompts.push(prompt);
      return { text: prompts.length === 1 ? "SOLAR_SUBDELEGATE_TOOL: {broken json}" : "Parent integrated the work.", sessionId: "parent-session" };
    }
  };
  const manager = new AgentManager(provider, { model: "fake", reasoning: "light", cwd: process.cwd() });
  const parent = await manager.spawn({ name: "Prism", title: "Parent", instructions: "Delegate", context: "", reasoning: "light" });
  assert.equal(parent.status, "completed");
  assert.equal(parent.report, "Parent integrated the work.");
  assert.match(prompts[1], /Control request rejected: .*not valid JSON/);
});

test("a timed-out workspace command also stops the processes it started", { skip: process.platform !== "win32" && "taskkill tree kill is Windows-only" }, async () => {
  const cwd = await mkdtemp(join(tmpdir(), "solar-timeout-"));
  try {
    const command = "$p = Start-Process powershell.exe -ArgumentList '-NoProfile','-Command','Start-Sleep 60' -PassThru -WindowStyle Hidden; Set-Content -Path child.pid -Value $p.Id; Start-Sleep 60";
    await assert.rejects(runWorkspaceCommand(cwd, { action: "run", command }, 4_000), /timed out after 4 seconds/);
    const pidFile = join(cwd, "child.pid");
    assert.ok(existsSync(pidFile), "the command should have started its child process");
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    assert.throws(() => process.kill(pid, 0), "the child process should have been stopped");
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});
