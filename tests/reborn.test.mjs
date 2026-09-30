import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SolarHarness } from "../dist/harness.js";
import { recordSession } from "../dist/session-recorder.js";

test("recordings preserve resumed exchanges and mandatory failure readbacks", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "solar-recording-"));
  const options = { cwd, model: "fake", reasoning: "light", role: "planner" };
  try {
    await recordSession("opening", options, async recorded => {
      recorded.onEvent("Inspected source");
      return { text: "Propose a fix", sessionId: "peer-1" };
    });
    await assert.rejects(recordSession("follow-up", options, async () => { throw new Error("Backend unavailable"); }, "peer-1"), /Backend unavailable/);
    const root = join(cwd, ".solarharness", "sessions");
    const folders = await readdir(root);
    assert.equal(folders.length, 1);
    const notes = await readFile(join(root, folders[0], "session_notes.md"), "utf8");
    assert.match(notes, /Inspected source/);
    assert.match(notes, /Propose a fix/);
    assert.match(notes, /Status: failed/);
    assert.match(notes, /Backend unavailable/);
    const events = (await readFile(join(root, folders[0], "transcript.jsonl"), "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(events.map(event => event.type), ["start", "activity", "finish", "start", "finish"]);
    assert.equal(events[3].prompt, "follow-up");
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("sidebyside starts two sessions concurrently and exchanges actual peer messages", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "solar-meeting-"));
  try {
    const harness = new SolarHarness({ cwd, task: "", model: "fake", reasoning: "light" });
    let starts = 0;
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    const calls = [];
    harness.provider.run = async (prompt, options) => {
      starts++;
      if (starts === 2) release();
      await barrier;
      assert.equal(options.role, "planner");
      const name = prompt.includes("You are Aurora") ? "Aurora" : "Helios";
      return { text: `${name} opening`, sessionId: name };
    };
    harness.provider.resume = async (id, prompt, options) => {
      calls.push({ id, prompt });
      assert.equal(options.role, "planner");
      return { text: `${id} response ${calls.filter(call => call.id === id).length}`, sessionId: id };
    };
    const messages = [];
    const result = await harness.sideBySide("Discuss a redesign", undefined, (speaker, text) => messages.push({ speaker, text }));
    assert.equal(starts, 2);
    assert.equal(calls.length, 4);
    assert.match(calls.find(call => call.id === "Aurora").prompt, /Helios opening/);
    assert.match(calls.find(call => call.id === "Helios").prompt, /Aurora opening/);
    assert.match(calls[2].prompt, /Helios response 1/);
    assert.match(calls[3].prompt, /Aurora response 1/);
    assert.match(calls[2].prompt, /session readback/);
    assert.equal(messages.length, 6);
    assert.match(result, /meeting complete/);
    await assert.rejects(harness.sideBySide(" "), /Usage/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("sidebyside stops without inventing a peer response after a failed launch", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "solar-meeting-failure-"));
  try {
    const harness = new SolarHarness({ cwd, task: "", model: "fake", reasoning: "light" });
    harness.provider.run = async prompt => {
      if (prompt.includes("You are Aurora")) throw new Error("Launch failed");
      return { text: "Helios opening", sessionId: "Helios" };
    };
    harness.provider.resume = async () => assert.fail("Must not resume after failure");
    await assert.rejects(harness.sideBySide("Topic"), /Launch failed/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
