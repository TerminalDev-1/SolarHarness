import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentManager } from "../dist/agent-manager.js";
import { actionStatus, activityDetail, initialActivity } from "../dist/activity.js";
import { SolarBrowser } from "../dist/browser-tool.js";
import { CodexCliProvider, requestedSubAgentCount } from "../dist/codex-provider.js";
import { SolarHarness } from "../dist/harness.js";
import { parseHostToolCall } from "../dist/host-tool-call.js";
import { decodeHostTurn, writeHostTurnSchema } from "../dist/host-turn.js";
import { SOLAR_SYSTEM_PROMPT } from "../dist/system-prompt.js";
import { SolarWebSearchHeadless } from "../dist/web-search-headless.js";
import { SolarWorkspaceTool, runWorkspaceCommand } from "../dist/workspace-tool.js";

test("resetIntoTestWorkspace clears contents but keeps the test directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "solar-harness-reset-"));
  const workspace = join(root, "test");
  try {
    await mkdir(join(workspace, "nested"), { recursive: true });
    await writeFile(join(workspace, "top.txt"), "old session");
    await writeFile(join(workspace, "nested", "child.txt"), "old sub-agent");

    const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: root });
    assert.equal(await harness.resetIntoTestWorkspace(), workspace);
    assert.deepEqual(await readdir(workspace), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the main agent tool can turn auto permissions on and off", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  assert.equal(harness.getAutoPermissions().enabled, false);
  assert.ok(harness.tools.list().some(tool => tool.name === "set-auto-permissions"));

  assert.deepEqual(await harness.tools.call("set-auto-permissions", { enabled: true }), { enabled: true });
  assert.equal(harness.getAutoPermissions().enabled, true);

  assert.deepEqual(await harness.tools.call("set-auto-permissions", { enabled: false }), { enabled: false });
  assert.equal(harness.getAutoPermissions().enabled, false);
  await assert.rejects(harness.tools.call("set-auto-permissions", { enabled: "yes" }), /boolean enabled value/);

  harness.provider.run = async () => ({
    text: 'I’ll enable automatic sub-agent-plan approval.\nSOLAR_TOOL: set-auto-permissions {"enabled":true}\nSOLAR_STATE: DISCOVER',
    sessionId: "main-agent-session"
  });
  harness.provider.resume = async () => ({ text: "Hello.\nSOLAR_STATE: DISCOVER", sessionId: "main-agent-session" });
  const response = await harness.converse("Turn auto permissions on and say hello.");
  assert.equal(harness.getAutoPermissions().enabled, true);
  assert.match(response.reply, /Auto permissions are now on/);
  assert.doesNotMatch(response.reply, /SOLAR_TOOL/);
});

test("standalone auto-permission requests apply immediately without a model response", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  harness.provider.run = async () => { throw new Error("standalone setting should not need a model turn"); };
  for (const [request, enabled] of [
    ["turn on auto permissions", true],
    ["turn off auto permissions", false],
    ["Turn auto permissions on.", true],
    ["Please enable automatic approval.", true],
    ["Can you disable auto-approve?", false],
    ["auto permissions on", true],
    ["auto permissions off", false]
  ]) {
    const response = await harness.converse(request);
    assert.equal(harness.getAutoPermissions().enabled, enabled, request);
    assert.equal(response.readyToDelegate, false, request);
    assert.match(response.reply, new RegExp(`Auto permissions are now ${enabled ? "on" : "off"}`), request);
  }
});

test("a setting inside a larger request still lets Solar complete the task", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  let modelCalls = 0;
  harness.provider.run = async () => {
    modelCalls++;
    return { text: "I handled the task.\nSOLAR_STATE: DISCOVER", sessionId: "mixed-setting-session" };
  };
  const response = await harness.converse("Say hello and turn on auto permissions.");
  assert.equal(modelCalls, 1);
  assert.equal(harness.getAutoPermissions().enabled, true);
  assert.match(response.reply, /I handled the task/);
  assert.match(response.reply, /Auto permissions are now on/);
});

test("only the user's explicit request enables sub-agent delegation", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  const prompts = [];
  harness.provider.run = async prompt => {
    prompts.push(prompt);
    return { text: "I finished the change.\nSOLAR_STATE: READY", sessionId: "direct-session" };
  };
  harness.provider.resume = async (_sessionId, prompt) => {
    prompts.push(prompt);
    return { text: "I can prepare sub-agents.\nSOLAR_STATE: READY", sessionId: "direct-session" };
  };

  assert.equal((await harness.converse("Fix the parser directly.")).readyToDelegate, false);
  assert.match(prompts[0], /You are Solar, the main agent/);
  assert.match(prompts[0], /Do not ask whether the user wants delegation/);
  assert.match(prompts[0], /Work alone/);
  assert.equal((await harness.converse("Assign 2 agents to review it.")).readyToDelegate, true);
  assert.match(prompts[1], /honoring any requested agent count/);
  assert.equal((await harness.converse("I want 2 agents to review another file.")).readyToDelegate, true);
  assert.equal((await harness.converse("Do not delegate the follow-up.")).readyToDelegate, false);
  assert.equal((await harness.converse("I decide when I want to delegate.")).readyToDelegate, false);
  await harness.tools.call("set-auto-permissions", { enabled: true });
  assert.equal((await harness.converse("Fix another parser bug.")).readyToDelegate, false);
});

test("Solar's policy requires direct work until the user explicitly requests delegation", () => {
  assert.match(SOLAR_SYSTEM_PROMPT, /^You are Solar,/);
  assert.match(SOLAR_SYSTEM_PROMPT, /Work alone by default/);
  assert.match(SOLAR_SYSTEM_PROMPT, /Do not ask whether the user wants delegation or how many agents/);
  assert.match(SOLAR_SYSTEM_PROMPT, /choose the smallest useful number/);
});

test("a control-only main agent turn retries before reporting failure", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  harness.provider.run = async () => ({ text: "SOLAR_STATE: DISCOVER", sessionId: "empty-session" });
  let retries = 0;
  harness.provider.resume = async (_sessionId, prompt) => {
    retries++;
    assert.match(prompt, /no user-facing answer/);
    return { text: "Hello!\nSOLAR_STATE: DISCOVER", sessionId: "empty-session" };
  };
  assert.equal((await harness.converse("Say hello.")).reply, "Hello!");
  assert.equal(retries, 1);
});

test("repeated control-only replies yield an honest visible failure", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  harness.provider.run = async () => ({ text: "SOLAR_STATE: DISCOVER", sessionId: "empty-session" });
  let retries = 0;
  harness.provider.resume = async () => {
    retries++;
    return { text: "SOLAR_STATE: DISCOVER", sessionId: "empty-session" };
  };
  assert.match((await harness.converse("Say hello.")).reply, /couldn't get a complete response/i);
  assert.equal(retries, 2);
});

test("host tool parser accepts JSON with nested values and rejects malformed calls", () => {
  const call = parseHostToolCall('```\nSOLAR_TOOL: workspace_command {\n  "action": "run",\n  "command": "node -e \\\"console.log({a: 1})\\\""\n}\n```');
  assert.equal(call?.name, "workspace_command");
  assert.equal(call?.input.action, "run");
  assert.match(call?.input.command, /console\.log/);
  assert.throws(() => parseHostToolCall('SOLAR_TOOL: workspace_command {"action":'), /Incomplete JSON/);
});

test("structured CLI turns require a host tool and parse its result", async () => {
  const root = await mkdtemp(join(tmpdir(), "solar-harness-schema-"));
  try {
    const requiredPath = await writeHostTurnSchema(root, true);
    const required = JSON.parse(await readFile(requiredPath, "utf8"));
    assert.deepEqual(required.properties.kind.enum, ["tool"]);
    assert.match(required.properties.tool.enum.join(" "), /browser/);
    const tool = decodeHostTurn(JSON.stringify({ kind: "tool", tool: "browser", input: '{"action":"open","url":"http://localhost:8000"}', reply: "" }));
    assert.deepEqual(parseHostToolCall(tool)?.input, { action: "open", url: "http://localhost:8000" });
    const answer = decodeHostTurn(JSON.stringify({ kind: "answer", tool: "none", input: "", reply: "Game tested.\nSOLAR_STATE: DISCOVER" }));
    assert.equal(answer, "Game tested.\nSOLAR_STATE: DISCOVER");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("browser turns pass the required output schema to the real CLI boundary", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  harness.browser.execute = async () => ({ url: "https://example.com/", title: "Example", snapshot: '- heading "Example"' });
  harness.provider.run = async (_prompt, _options, args) => {
    assert.ok(args.includes("--output-schema"));
    assert.match(args.at(-1), /host-tool-required\.json$/);
    return { text: JSON.stringify({ kind: "tool", tool: "browser", input: '{"action":"open","url":"https://example.com"}', reply: "" }), sessionId: "structured-session" };
  };
  harness.provider.resume = async (_sessionId, _prompt, _options, args) => {
    assert.ok(args.includes("--output-schema"));
    return { text: JSON.stringify({ kind: "answer", tool: "none", input: "", reply: "I opened Example.\nSOLAR_STATE: DISCOVER" }), sessionId: "structured-session" };
  };
  assert.equal((await harness.converse("Open https://example.com in the browser")).reply, "I opened Example.");
});

test("workspace command returns output and exit code from the active workspace", async () => {
  const root = await mkdtemp(join(tmpdir(), "solar-harness-command-"));
  try {
    const result = await runWorkspaceCommand(root, { action: "run", command: 'node -e "process.stdout.write(process.cwd())"' });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), root);
    await assert.rejects(runWorkspaceCommand(root, { action: "run", command: "" }), /nonempty command/);
    await assert.rejects(runWorkspaceCommand(root, { action: "run", command: "python -m http.server 8000" }), /action start/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("workspace start keeps a local server running for browser testing until reset", async () => {
  const root = await mkdtemp(join(tmpdir(), "solar-harness-server-"));
  const workspace = new SolarWorkspaceTool(root);
  try {
    await writeFile(join(root, "server.cjs"), 'const fs=require("fs");require("http").createServer((_req,res)=>res.end("ready")).listen(0,"127.0.0.1",function(){fs.writeFileSync("port.txt",String(this.address().port))});');
    const started = await workspace.execute({ action: "start", command: "node server.cjs" });
    assert.equal(started.started, true);
    assert.ok(started.pid > 0);
    let port;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { port = Number(await readFile(join(root, "port.txt"), "utf8")); break; }
      catch { await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(port, "server did not start");
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "ready");
  } finally {
    await workspace.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("Solar can inspect a local app, run it, and interact with the visible browser", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  const hostCalls = [];
  harness.tools.register({ name: "workspace_command", description: "mock", execute: async input => {
    hostCalls.push(["workspace_command", input]);
    return { command: input.command, exitCode: 0, stdout: "App listening on http://localhost:3000", stderr: "" };
  } });
  harness.tools.register({ name: "browser", description: "mock", execute: async input => {
    hostCalls.push(["browser", input]);
    return { url: "http://localhost:3000/", title: "Game", snapshot: '- button "Start"' };
  } });
  harness.provider.run = async prompt => {
    assert.match(prompt, /workspace_command/);
    return { text: "SOLAR_STATE: DISCOVER", sessionId: "app-session" };
  };
  const replies = [
    'SOLAR_TOOL: workspace_command {"action":"run","command":"inspect and start app"}',
    'SOLAR_TOOL: browser {"action":"open","url":"http://localhost:3000"}',
    'SOLAR_TOOL: browser {"action":"click","selector":"role=button[name=Start]"}',
    "I opened the game and clicked Start.\nSOLAR_STATE: DISCOVER"
  ];
  harness.provider.resume = async () => ({ text: replies.shift(), sessionId: "app-session" });
  const result = await harness.converse("Test the game in the browser; if none exists, create a simple app to test it.");
  assert.match(result.reply, /clicked Start/);
  assert.deepEqual(hostCalls.map(([name, input]) => [name, input.action]), [
    ["workspace_command", "run"], ["browser", "open"], ["browser", "click"]
  ]);
});

test("Solar does not claim a game was tested without browser interaction", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  harness.browser.execute = async () => ({ url: "http://localhost:3000/", title: "Game", snapshot: '- button "Start"' });
  harness.provider.run = async () => ({ text: 'SOLAR_TOOL: browser {"action":"open","url":"http://localhost:3000"}', sessionId: "incomplete-game" });
  harness.provider.resume = async () => ({ text: "I tested the game successfully.\nSOLAR_STATE: DISCOVER", sessionId: "incomplete-game" });
  const result = await harness.converse("Test the game in the browser.");
  assert.doesNotMatch(result.reply, /tested the game successfully/i);
  assert.match(result.reply, /couldn't get a complete response/i);
});

test("activity text describes browser actions rather than generic thinking", () => {
  assert.equal(initialActivity("Open YouTube and search MrBeast"), "opening YouTube");
  assert.equal(activityDetail("Browser: open https://www.youtube.com"), "opening YouTube");
  assert.equal(activityDetail("Browser: searching YouTube for MrBeast"), "searching YouTube for MrBeast");
  assert.equal(actionStatus("thinking", initialActivity("Open YouTube and search MrBeast")), "Thinking — opening YouTube");
  assert.equal(actionStatus("browsing", activityDetail("Browser: searching YouTube for MrBeast")), "Thinking — searching YouTube for MrBeast");
});

test("the main agent feeds browser results back into the same model session", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  const calls = [];
  harness.browser.execute = async input => {
    calls.push(input);
    return { url: "https://example.com/", title: "Example", snapshot: '- heading "Example"' };
  };
  harness.provider.run = async () => ({
    text: 'SOLAR_TOOL: browser {"action":"open","url":"https://example.com"}',
    sessionId: "browser-session"
  });
  harness.provider.resume = async (sessionId, prompt) => {
    assert.equal(sessionId, "browser-session");
    assert.match(prompt, /heading/);
    return { text: "The page says Example.\nSOLAR_STATE: DISCOVER", sessionId };
  };
  const result = await harness.converse("Open example.com");
  assert.deepEqual(calls, [{ action: "open", url: "https://example.com" }]);
  assert.equal(result.reply, "The page says Example.");
  assert.equal(result.readyToDelegate, false);
  assert.ok(harness.tools.list().some(tool => tool.name === "browser"));
  await assert.rejects(new SolarBrowser().execute({ action: "open", url: "file:///etc/passwd" }), /Only http and https/);
});

test("a YouTube search completes after opening the home page and always replies", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  const actions = [];
  harness.browser.execute = async input => {
    actions.push(input);
    return input.action === "open"
      ? { url: "https://www.youtube.com/", title: "YouTube", snapshot: '- searchbox "Search"' }
      : { url: "https://www.youtube.com/results?search_query=mrbeast", title: "mrbeast - YouTube", snapshot: '- heading "Search results"' };
  };
  harness.provider.run = async () => ({ text: 'SOLAR_TOOL: browser {"action":"open","url":"https://www.youtube.com"}', sessionId: "youtube-session" });
  harness.provider.resume = async () => ({ text: "SOLAR_STATE: DISCOVER", sessionId: "youtube-session" });

  const result = await harness.converse("uh open the browser and go onto Youtube and search mrbeast");
  assert.deepEqual(actions, [
    { action: "open", url: "https://www.youtube.com" },
    { action: "youtube_search", value: "mrbeast" }
  ]);
  assert.match(result.reply, /searched YouTube for "mrbeast"/);
  assert.equal(result.readyToDelegate, false);
});

test("YouTube searches preserve the requested phrase across common word orders", async () => {
  for (const [request, query] of [
    ["Search YouTube for cat videos", "cat videos"],
    ["Search for lo-fi hip hop on YouTube", "lo-fi hip hop"],
    ["Open YouTube and search NASA Artemis", "NASA Artemis"],
    ["On YouTube, search for Mr. Beast", "Mr. Beast"],
    ["Search YouTube for C++ tutorials and open the first result", "C++ tutorials"]
  ]) {
    const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
    const actions = [];
    harness.browser.execute = async input => {
      actions.push(input);
      const value = input.value ?? "";
      return { url: input.action === "open" ? "https://www.youtube.com/" : `https://www.youtube.com/results?search_query=${encodeURIComponent(value)}`, title: "YouTube", snapshot: "Search results" };
    };
    harness.provider.run = async () => ({ text: 'SOLAR_TOOL: browser {"action":"open","url":"https://www.youtube.com"}', sessionId: "search-session" });
    harness.provider.resume = async () => ({ text: "Search complete.\nSOLAR_STATE: DISCOVER", sessionId: "search-session" });
    await harness.converse(request);
    assert.deepEqual(actions.slice(0, 2), [{ action: "open", url: "https://www.youtube.com" }, { action: "youtube_search", value: query }], request);
  }
});

test("ordinary web research uses the headless tool without opening the visible browser", async () => {
  for (const [request, query] of [
    ["Search Google for Galaxy S26 base specifications", "Galaxy S26 base specifications"],
    ["Search for Galaxy S26 base on the web", "Galaxy S26 base"],
    ["Search for Galaxy S26 base", "Galaxy S26 base"],
    ["Look up Galaxy S26 base online", "Galaxy S26 base"],
    ["Does the S26 base exist?", "Does the S26 base exist"]
  ]) {
    const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
    const actions = [];
    harness.browser.execute = async () => { throw new Error("Visible browser should not open for research"); };
    harness.webSearchHeadless.execute = async input => {
      actions.push(input);
      return { action: "search", query: input.query, engine: "bing", url: `https://www.bing.com/search?q=${encodeURIComponent(input.query)}`, title: "Search results", results: [{ title: "Galaxy S26 | Samsung", url: "https://www.samsung.com/galaxy-s26", snippet: "Galaxy S26" }] };
    };
    harness.provider.run = async prompt => {
      assert.match(prompt, /web_search_headless/);
      return { text: `SOLAR_TOOL: web_search_headless ${JSON.stringify({ action: "search", query })}`, sessionId: "research-session" };
    };
    harness.provider.resume = async () => ({ text: "SOLAR_STATE: DISCOVER", sessionId: "research-session" });
    const result = await harness.converse(request);
    assert.deepEqual(actions, [{ action: "search", query }], request);
    assert.match(result.reply, /searched the web/);
    assert.equal(result.readyToDelegate, false);
  }
});

test("a visible browser call is redirected to headless search for ordinary research", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  let visibleCalls = 0;
  let visibleCloses = 0;
  harness.browser.execute = async () => { visibleCalls++; throw new Error("Visible browser launched"); };
  harness.browser.close = async () => { visibleCloses++; };
  harness.webSearchHeadless.execute = async input => ({ action: "search", query: input.query, engine: "bing", url: "https://www.bing.com/search?q=Galaxy%20S26", title: "Search", results: [{ title: "Galaxy S26", url: "https://www.samsung.com/galaxy-s26", snippet: "Phone" }] });
  harness.provider.run = async () => ({ text: 'SOLAR_TOOL: browser {"action":"open","url":"https://www.google.com"}', sessionId: "redirect-session" });
  harness.provider.resume = async () => ({ text: "SOLAR_STATE: DISCOVER", sessionId: "redirect-session" });
  const result = await harness.converse("Search Google for Galaxy S26");
  assert.match(result.reply, /searched the web/);
  assert.equal(visibleCalls, 0);
  assert.equal(visibleCloses, 0);
  assert.ok(harness.tools.list().some(tool => tool.name === "web_search_headless"));
  assert.ok(harness.tools.list().some(tool => tool.name === "browser"));
});

test("headless search validates inputs before launching", async () => {
  const search = new SolarWebSearchHeadless();
  await assert.rejects(search.execute({ action: "search", query: "" }), /requires query/);
  await assert.rejects(search.execute({ action: "read", url: "file:///etc/passwd" }), /Only http and https/);
  await assert.rejects(search.execute({ action: "search", query: "S26", engine: "other" }), /engine must be google or bing/);
});

test("visible browser no longer exposes the retired web_search action", async () => {
  const browser = new SolarBrowser();
  browser.page = { isClosed: () => false };
  await assert.rejects(browser.execute({ action: "web_search", value: "Galaxy S26" }), /Unknown browser action/);
});

test("Solar can open a source after searching and report what it found", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  const actions = [];
  harness.browser.execute = async input => {
    actions.push(input);
    return { url: "https://www.samsung.com/galaxy-s26", title: "Galaxy S26", snapshot: '- heading "Galaxy S26"' };
  };
  harness.webSearchHeadless.execute = async input => {
    actions.push(input);
    return input.action === "read"
      ? { action: "read", url: input.url, title: "Galaxy S26", text: "Samsung lists Galaxy S26." }
      : { action: "search", query: input.query, engine: "bing", url: "https://www.bing.com/search?q=Galaxy%20S26", title: "Search", results: [{ title: "Samsung Galaxy S26", url: "https://www.samsung.com/galaxy-s26", snippet: "Galaxy S26" }] };
  };
  harness.provider.run = async () => ({ text: 'SOLAR_TOOL: web_search_headless {"action":"search","query":"Galaxy S26"}', sessionId: "source-session" });
  let resumes = 0;
  harness.provider.resume = async () => ({
    text: ++resumes === 1 ? 'SOLAR_TOOL: web_search_headless {"action":"read","url":"https://www.samsung.com/galaxy-s26"}'
      : "Yes, Samsung lists the Galaxy S26 at https://www.samsung.com/galaxy-s26.\nSOLAR_STATE: DISCOVER",
    sessionId: "source-session"
  });
  const result = await harness.converse("Search Google for Galaxy S26");
  assert.deepEqual(actions, [{ action: "search", query: "Galaxy S26" }, { action: "read", url: "https://www.samsung.com/galaxy-s26" }]);
  assert.match(result.reply, /Samsung lists the Galaxy S26/);
  assert.equal(result.readyToDelegate, false);
});

test("Solar does not claim web research succeeded when search is blocked", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  harness.webSearchHeadless.execute = async () => { throw new Error("Google verification and Bing unavailable"); };
  harness.provider.run = async () => ({ text: 'SOLAR_TOOL: web_search_headless {"action":"search","query":"Galaxy S26"}', sessionId: "blocked-session" });
  harness.provider.resume = async () => ({ text: "I found the answer.\nSOLAR_STATE: DISCOVER", sessionId: "blocked-session" });
  const result = await harness.converse("Search Google for Galaxy S26");
  assert.match(result.reply, /couldn't complete the headless web search/);
  assert.doesNotMatch(result.reply, /found the answer/);
});

test("a request to search the repository stays in the workspace", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  harness.provider.run = async prompt => {
    assert.match(prompt, /Carry out the user's request yourself/);
    return { text: "I checked the repository.\nSOLAR_STATE: DISCOVER", sessionId: "workspace-session" };
  };
  harness.browser.execute = async () => { throw new Error("Unexpected browser action"); };
  const result = await harness.converse("Search for the parser in the repository.");
  assert.equal(result.reply, "I checked the repository.");
});

test("the browser stays open when the model asks to close it without user consent", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  const actions = [];
  harness.browser.execute = async input => {
    actions.push(input.action);
    return { url: "https://www.youtube.com/results?search_query=mrbeast", title: "YouTube", snapshot: "MrBeast results" };
  };
  harness.provider.run = async () => ({ text: 'SOLAR_TOOL: browser {"action":"open","url":"https://www.youtube.com/results?search_query=mrbeast"}', sessionId: "browser-session" });
  let resumes = 0;
  harness.provider.resume = async () => ({
    text: ++resumes === 1 ? 'SOLAR_TOOL: browser {"action":"close"}' : "The results are open.\nSOLAR_STATE: DISCOVER",
    sessionId: "browser-session"
  });
  const result = await harness.converse("Open YouTube and search MrBeast.");
  assert.deepEqual(actions, ["open", "snapshot"]);
  assert.match(result.reply, /results are open/);
});

test("an explicit user request can close the browser", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  const actions = [];
  harness.browser.execute = async input => {
    actions.push(input.action);
    return { url: "", title: "Browser closed", snapshot: "Browser closed" };
  };
  harness.provider.run = async () => ({ text: 'SOLAR_TOOL: browser {"action":"close"}', sessionId: "browser-session" });
  harness.provider.resume = async () => ({ text: "The browser is closed.\nSOLAR_STATE: DISCOVER", sessionId: "browser-session" });
  const result = await harness.converse("Close the browser.");
  assert.deepEqual(actions, ["close"]);
  assert.match(result.reply, /browser is closed/);
});

test("YouTube search uses the requested query in the browser URL", async () => {
  const browser = new SolarBrowser();
  let url = "https://www.youtube.com/";
  browser.page = {
    isClosed: () => false,
    url: () => url,
    goto: async next => { url = next; },
    title: async () => "YouTube",
    getByRole: () => ({ first: () => ({ waitFor: async () => { throw new Error("No consent dialog"); } }) }),
    getByText: () => ({ first: () => ({ isVisible: async () => false }) }),
    locator: () => ({ ariaSnapshot: async () => "Search results" })
  };
  const result = await browser.execute({ action: "youtube_search", value: "MrBeast official" });
  assert.equal(result.url, "https://www.youtube.com/results?search_query=MrBeast%20official");
  assert.match(result.snapshot, /Search results/);
});

test("YouTube search rejects consent before returning the results", async () => {
  const browser = new SolarBrowser();
  let url = "https://www.youtube.com/";
  let consentVisible = true;
  let rejectionCount = 0;
  browser.page = {
    isClosed: () => false,
    url: () => url,
    goto: async next => { url = next; },
    title: async () => "MrBeast - YouTube",
    getByRole: () => ({ first: () => ({
      waitFor: async ({ state }) => {
        if (state === "visible" && !consentVisible) throw new Error("No dialog");
        if (state === "hidden" && consentVisible) throw new Error("Dialog still visible");
      },
      click: async () => { rejectionCount++; consentVisible = false; }
    }) }),
    locator: () => ({ ariaSnapshot: async () => "MrBeast results" })
  };
  const result = await browser.execute({ action: "youtube_search", value: "MrBeast" });
  assert.equal(rejectionCount, 1);
  assert.match(result.snapshot, /MrBeast results/);
});

test("an explicit click request continues past the first page snapshot", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  const actions = [];
  harness.browser.execute = async input => {
    actions.push(input.action);
    return input.action === "open"
      ? { url: "https://example.com/", title: "Example Domain", snapshot: '- link "Learn more"' }
      : { url: "https://www.iana.org/help/example-domains", title: "Example Domains", snapshot: '- heading "Example Domains"' };
  };
  harness.provider.run = async () => ({ text: 'SOLAR_TOOL: browser {"action":"open","url":"https://example.com"}', sessionId: "browser-session" });
  let resumes = 0;
  harness.provider.resume = async () => {
    resumes++;
    return {
      text: resumes === 1 ? "I need to click the link.\nSOLAR_STATE: DISCOVER"
        : resumes === 2 ? 'SOLAR_TOOL: browser {"action":"click","selector":"role=link[name=\\"Learn more\\"]"}'
          : "The title is Example Domains.\nSOLAR_STATE: DISCOVER",
      sessionId: "browser-session"
    };
  };
  const result = await harness.converse("Browse https://example.com and click Learn more.");
  assert.deepEqual(actions, ["open", "click"]);
  assert.match(result.reply, /Example Domains/);
});

test("a browser screenshot request completes and still applies auto permissions", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  const actions = [];
  harness.browser.execute = async input => {
    actions.push(input.action);
    return { url: "https://example.com/", title: "Example Domain", snapshot: "Example Domain", screenshotPath: input.action === "screenshot" ? "C:\\capture.png" : undefined };
  };
  harness.provider.run = async () => ({ text: 'SOLAR_TOOL: browser {"action":"open","url":"https://example.com"}', sessionId: "browser-session" });
  let resumes = 0;
  harness.provider.resume = async () => ({
    text: ++resumes === 1 ? "The page is open.\nSOLAR_STATE: DISCOVER"
      : resumes === 2 ? 'SOLAR_TOOL: browser {"action":"screenshot","fullPage":true}'
        : "Screenshot saved to C:\\capture.png.\nSOLAR_STATE: DISCOVER",
    sessionId: "browser-session"
  });
  const result = await harness.converse("Open the browser, navigate to https://example.com, take a screenshot, assign 8 agents, and turn auto permissions on.");
  assert.deepEqual(actions, ["open", "screenshot"]);
  assert.equal(harness.getAutoPermissions().enabled, true);
  assert.match(result.reply, /Screenshot saved/);
  assert.equal(result.readyToDelegate, true);
});

test("an explicit agent count constrains the sub-agent plan", async () => {
  const root = await mkdtemp(join(tmpdir(), "solar-plan-count-"));
  try {
    assert.equal(requestedSubAgentCount("assign 8 agents to this task"), 8);
    assert.equal(requestedSubAgentCount("I want 2 agents to review this"), 2);
    assert.equal(requestedSubAgentCount("Delegate to 3 sub-agents"), 3);
    const provider = new CodexCliProvider();
    const tasks = Array.from({ length: 8 }, (_, index) => ({ name: `Agent${index + 1}`, title: `Task ${index + 1}`, instructions: "Work", context: "" }));
    provider.run = async () => ({ text: JSON.stringify({ summary: "Eight sub-agents", tasks }) });
    const plan = await provider.createPlan("Assign 8 agents to this task", "", { model: "gpt-6-luna", reasoning: "light", cwd: root, role: "main-agent" });
    const schema = JSON.parse(await readFile(join(root, ".solarharness", "schemas", "delegation-plan.json"), "utf8"));
    assert.equal(plan.tasks.length, 8);
    assert.equal(schema.properties.tasks.minItems, 8);
    assert.equal(schema.properties.tasks.maxItems, 8);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("named sub-agents can create Light-pinned named sub-delegates", async () => {
  const roles = [];
  const provider = {
    async run(_prompt, options) {
      roles.push(options.role);
      if (options.role === "sub-agent") {
        return {
          text: 'SOLAR_SUBDELEGATE: {"tasks":[{"name":"Pixel","title":"Child task","instructions":"Do child work","context":""}]}',
          sessionId: "parent-session"
        };
      }
      return { text: "Child complete", sessionId: "child-session" };
    },
    async resume() {
      return { text: "Parent integrated the child report", sessionId: "parent-session" };
    }
  };
  const manager = new AgentManager(provider, { model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });

  const parent = await manager.spawn({ name: "Forge", title: "Parent task", instructions: "Delegate", context: "", reasoning: "medium" });
  const child = manager.list().find(record => record.parentId === parent.id);

  assert.ok(child);
  assert.equal(child.name, "Pixel");
  assert.equal(child.reasoning, "light");
  assert.equal(child.reasoningPinned, true);
  assert.deepEqual(roles, ["sub-agent", "sub-delegate"]);
  assert.equal(parent.status, "completed");
  assert.match(parent.report, /integrated/);

  manager.setReasoning("Pixel", "high");
  assert.equal(child.reasoning, "high");
  assert.equal(child.reasoningPinned, false);
  await assert.rejects(manager.spawn({ name: "Third", title: "Too deep", instructions: "Stop", context: "", reasoning: "light", parentId: child.id }), /Sub-delegates cannot create another delegation level/);
});

test("a sub-agent cannot raise its own sub-delegate above Light", async () => {
  const provider = {
    async run(_prompt, options) {
      if (options.role === "sub-agent") {
        return {
          text: 'SOLAR_SUBDELEGATE: {"tasks":[{"name":"Beam","title":"Child task","instructions":"Do child work","context":""}]}',
          sessionId: "parent-session"
        };
      }
      return { text: "Child complete", sessionId: "child-session" };
    },
    async resume() { return { text: "Integrated", sessionId: "parent-session" }; }
  };
  const manager = new AgentManager(provider, { model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  const parent = await manager.spawn({ name: "Prism", title: "Parent task", instructions: "Delegate", context: "", reasoning: "light" });
  const child = manager.list().find(record => record.parentId === parent.id);
  assert.ok(child);

  assert.throws(() => manager.setReasoning(child.id, "medium", parent.id), /Only Solar can authorize/);
  assert.equal(child.reasoning, "light");

  await manager.orchestrate({ action: "inject_context", agentId: child.id, context: "Run one more validation." }, parent.id);
  assert.equal(child.status, "completed");
  assert.throws(() => manager.setReasoning(child.id, "light", "unrelated-sub-agent"), /only their own direct sub-delegates/i);
});
