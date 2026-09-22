import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentManager } from "../dist/agent-manager.js";
import { CoordinatorBrowser } from "../dist/browser-tool.js";
import { SolarHarness } from "../dist/harness.js";

test("resetIntoTestWorkspace clears contents but keeps the test directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "solar-harness-reset-"));
  const workspace = join(root, "test");
  try {
    await mkdir(join(workspace, "nested"), { recursive: true });
    await writeFile(join(workspace, "top.txt"), "old session");
    await writeFile(join(workspace, "nested", "child.txt"), "old worker");

    const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: root });
    assert.equal(await harness.resetIntoTestWorkspace(), workspace);
    assert.deepEqual(await readdir(workspace), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the coordinator tool can turn auto permissions on and off", async () => {
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "light", cwd: process.cwd() });
  assert.equal(harness.getAutoPermissions().enabled, false);
  assert.ok(harness.tools.list().some(tool => tool.name === "set-auto-permissions"));

  assert.deepEqual(await harness.tools.call("set-auto-permissions", { enabled: true }), { enabled: true });
  assert.equal(harness.getAutoPermissions().enabled, true);

  assert.deepEqual(await harness.tools.call("set-auto-permissions", { enabled: false }), { enabled: false });
  assert.equal(harness.getAutoPermissions().enabled, false);
  await assert.rejects(harness.tools.call("set-auto-permissions", { enabled: "yes" }), /boolean enabled value/);

  harness.provider.run = async () => ({
    text: 'I’ll enable automatic worker-plan approval.\nSOLAR_TOOL: set-auto-permissions {"enabled":true}\nSOLAR_STATE: DISCOVER',
    sessionId: "coordinator-session"
  });
  const response = await harness.converse("Turn auto permissions on.");
  assert.equal(harness.getAutoPermissions().enabled, true);
  assert.match(response.reply, /Auto permissions are now on/);
  assert.doesNotMatch(response.reply, /SOLAR_TOOL/);
});

test("the coordinator feeds browser results back into the same model session", async () => {
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
  await assert.rejects(new CoordinatorBrowser().execute({ action: "open", url: "file:///etc/passwd" }), /Only http and https/);
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
  const result = await harness.converse("Open the browser, navigate to https://example.com, take a screenshot, and turn auto permissions on.");
  assert.deepEqual(actions, ["open", "screenshot"]);
  assert.equal(harness.getAutoPermissions().enabled, true);
  assert.match(result.reply, /Screenshot saved/);
});

test("named workers can create Light-pinned named sub-workers", async () => {
  const provider = {
    async run(_prompt, options) {
      if (options.role === "worker") {
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
  assert.equal(parent.status, "completed");
  assert.match(parent.report, /integrated/);

  manager.setReasoning("Pixel", "high");
  assert.equal(child.reasoning, "high");
  assert.equal(child.reasoningPinned, false);
});

test("a worker cannot raise its own sub-worker above Light", async () => {
  const provider = {
    async run(_prompt, options) {
      if (options.role === "worker") {
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
  assert.throws(() => manager.setReasoning(child.id, "light", "unrelated-worker"), /only their own direct sub-workers/i);
});
