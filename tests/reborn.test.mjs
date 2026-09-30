import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import React from "react";
import { renderToString } from "ink";
import { MeetingPanes } from "../dist/meeting-ui.js";
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

test("sidebyside starts two sessions concurrently, acts on the request, and exchanges actual peer messages", async () => {
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
      const name = prompt.includes("You are Aurora") ? "Aurora" : "Helios";
      // Aurora carries out the request and may edit; Helios verifies from a read-only session.
      assert.equal(options.role, name === "Aurora" ? "main-agent" : "planner");
      assert.match(prompt, /request for you to act on/);
      assert.match(prompt, /User's request: Discuss a redesign/);
      assert.doesNotMatch(prompt, /This meeting is read-only/);
      return { text: `${name} opening`, sessionId: name };
    };
    harness.provider.resume = async (id, prompt, options) => {
      calls.push({ id, prompt });
      assert.equal(options.role, id === "Aurora" ? "main-agent" : "planner");
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
    calls.length = 0;
    await harness.sideBySide("Refine the design", undefined, undefined, { continue: true });
    assert.equal(starts, 2, "follow-ups must resume the two existing sessions");
    assert.equal(calls.length, 6);
    assert.deepEqual(new Set(calls.map(call => call.id)), new Set(["Aurora", "Helios"]));
    assert.match(calls[0].prompt, /Refine the design/);
    assert.match(calls[0].prompt, /Helios response 2/);
    await assert.rejects(harness.sideBySide(" "), /Usage/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test("two pane view separates histories and bounds long output to the viewport", () => {
  const panes = ["Aurora", "Helios"].map(speaker => ({ speaker, sessionId: `${speaker}-session`, status: "completed",
    activity: "Readback saved", messages: [`${speaker} history\n` + Array.from({ length: 100 }, (_, index) => `${speaker} line ${index}`).join("\n")], scroll: 0 }));
  const output = renderToString(React.createElement(MeetingPanes, { panes, selected: 0, width: 88, rows: 10 }), { columns: 90 });
  assert.equal(output.split("\n").length, 11);
  assert.match(output, /Aurora.*Helios/);
  assert.match(output, /Aurora-session.*Helios-session/);
  assert.match(output, /Aurora line 99.*Helios line 99/);
  assert.doesNotMatch(output, /line 0\n/);
  panes[0].scroll = 10;
  const scrolled = renderToString(React.createElement(MeetingPanes, { panes, selected: 1, width: 88, rows: 10 }), { columns: 90 });
  assert.match(scrolled, /Helios line 99/);
  assert.doesNotMatch(scrolled, /Aurora line 99/);
});

test("sidebyside UI opens panes, resumes on input, and returns to chat", async () => {
  const { PassThrough } = await import("node:stream");
  const { render } = await import("ink");
  const { SolarApp } = await import("../dist/ui.js");
  const cwd = await mkdtemp(join(tmpdir(), "solar-panes-ui-"));
  const stdout = Object.assign(new PassThrough(), { isTTY: true, rows: 24, columns: 90 });
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  let output = "";
  stdout.on("data", data => { output += data.toString(); });
  const harness = new SolarHarness({ cwd, task: "", model: "fake", reasoning: "light" });
  let starts = 0;
  let resumes = 0;
  harness.provider.run = async prompt => { starts++; const speaker = prompt.includes("You are Aurora") ? "Aurora" : "Helios"; return { text: `${speaker} opening`, sessionId: speaker }; };
  harness.provider.resume = async id => { resumes++; return { text: `${id} follow-up ${resumes}`, sessionId: id }; };
  const app = render(React.createElement(SolarApp, { harness, model: "fake", reasoning: "light", initialSplash: false }), { stdout, stdin, exitOnCtrlC: false, patchConsole: false });
  const pause = () => new Promise(resolve => setTimeout(resolve, 200));
  try {
    await pause();
    stdin.write("/sidebyside Design a menu"); await pause(); stdin.write("\r"); await pause();
    assert.equal(starts, 2);
    assert.equal(resumes, 4);
    assert.match(output, /Session: Aurora.*Session: Helios/);
    assert.match(output, /Send a message to both sessions/);
    output = "";
    stdin.write("Make it simpler"); await pause(); stdin.write("\r"); await pause();
    assert.equal(starts, 2);
    assert.equal(resumes, 10);
    assert.doesNotMatch(output, /\x1b\[2J|\x1b\[3J/, "pane redraws must preserve scrollback");
    stdin.write("/sidebyside close"); await pause(); stdin.write("\r"); await pause();
    assert.match(output, /Returned to Solar chat/);
  } finally { app.unmount(); await rm(cwd, { recursive: true, force: true }); }
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
