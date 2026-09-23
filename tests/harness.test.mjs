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
import { SOLAR_SYSTEM_PROMPT } from "../dist/system-prompt.js";

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
  const response = await harness.converse("Turn auto permissions on.");
  assert.equal(harness.getAutoPermissions().enabled, true);
  assert.match(response.reply, /Auto permissions are now on/);
  assert.doesNotMatch(response.reply, /SOLAR_TOOL/);
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

test("a control-only main agent turn still returns a visible reply", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  harness.provider.run = async () => ({ text: "SOLAR_STATE: DISCOVER", sessionId: "empty-session" });
  const result = await harness.converse("Say hello.");
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
    getByText: () => ({ first: () => ({ waitFor: async () => { throw new Error("No consent dialog"); } }) }),
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
    getByText: () => ({ first: () => ({
      waitFor: async ({ state }) => {
        if (state === "visible" && !consentVisible) throw new Error("No dialog");
        if (state === "hidden" && consentVisible) throw new Error("Dialog still visible");
      }
    }) }),
    locator: selector => selector === "body"
      ? { ariaSnapshot: async () => "MrBeast results" }
      : { first: () => ({ count: async () => 1, evaluate: async () => { rejectionCount++; consentVisible = false; } }) }
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
