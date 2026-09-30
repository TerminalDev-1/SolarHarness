import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SolarHarness } from "solar-harness/dist/harness.js";

/**
 * `npm run demo`: a scripted Solar that makes real file edits in a scratch folder, so the
 * interface (timeline, diffs, Review panel) can be seen and screenshotted with no Codex calls.
 */
/** Demo chats are saved here, never in the real history. */
export function demoChatsDirectory() {
  return mkdtempSync(join(tmpdir(), "solar-demo-chats-"));
}

export function prepareDemoWorkspace(prefix = "solar-demo-") {
  const workspace = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(workspace, "src"));
  writeFileSync(join(workspace, "src", "styles.css"), [
    ":root {",
    "  --brand: #3366ff;",
    "  --text: #222;",
    "}",
    "",
    "body {",
    "  margin: 0;",
    "  font-family: Arial, sans-serif;",
    "  color: var(--text);",
    "}",
    "",
    ".hero {",
    "  padding: 40px;",
    "  background: var(--brand);",
    "}",
    ""
  ].join("\n"));
  writeFileSync(join(workspace, "src", "app.js"), [
    "const button = document.querySelector('#start');",
    "",
    "button.addEventListener('click', () => {",
    "  console.log('clicked');",
    "  alert('Welcome!');",
    "});",
    ""
  ].join("\n"));
  return workspace;
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export function installDemoHarness() {
  installDemoDelegation();
  installDemoMeeting();
  SolarHarness.prototype.converse = async function demoConverse(message, onActivity) {
    const cwd = this.getWorkspace();
    const say = async (line, ms = 450) => { onActivity?.(line); await wait(ms); };
    if (/stress/i.test(message)) return stressTurn(cwd, say);
    if (/plan (?:it|this) first/i.test(message)) {
      // Solar decides to plan before touching anything (switch_mode plan).
      await say("Mode: Plan");
      await say("Plan: drafting the plan at max effort");
      const plan = "1. Add a pricing section to `index.html`\n2. Style it in `src/styles.css`\n3. Check it in the browser";
      return { readyToDelegate: false, reply: plan, plan: { request: message, plan, ultra: false } };
    }
    if (/team/i.test(message)) {
      await say("Thinking: Splitting the work between two agents");
      return { readyToDelegate: true, reply: "This splits cleanly into a layout pass and a copy pass, so I've drafted a two-agent team." };
    }
    await say("Thinking: Reviewing the landing page structure");
    await say("Note: I'll inspect the workspace, then build the page and polish the styles.");
    await say("Running command: Get-ChildItem -Recurse src", 300);
    await say("Command completed: Get-ChildItem -Recurse src");
    await writeFile(join(cwd, "index.html"), [
      "<!doctype html>",
      "<html lang=\"en\">",
      "<head>",
      "  <meta charset=\"utf-8\">",
      "  <title>Aurora</title>",
      "  <link rel=\"stylesheet\" href=\"src/styles.css\">",
      "</head>",
      "<body>",
      "  <section class=\"hero\">",
      "    <h1>Meet Aurora</h1>",
      "    <p>Notes that write themselves.</p>",
      "    <button id=\"start\">Get started</button>",
      "  </section>",
      "  <script src=\"src/app.js\"></script>",
      "</body>",
      "</html>",
      ""
    ].join("\n"));
    await say("File: Created index.html (16 lines)");
    await say("Thinking: Refining the color system and typography");
    await writeFile(join(cwd, "src", "styles.css"), [
      ":root {",
      "  --brand: #ff7a3d;",
      "  --brand-2: #ffd36b;",
      "  --text: #16161d;",
      "}",
      "",
      "body {",
      "  margin: 0;",
      "  font-family: Inter, system-ui, sans-serif;",
      "  color: var(--text);",
      "}",
      "",
      ".hero {",
      "  padding: 96px 40px;",
      "  background: linear-gradient(135deg, var(--brand), var(--brand-2));",
      "  border-radius: 24px;",
      "}",
      ""
    ].join("\n"));
    await say("File: Edited src/styles.css (lines 2-16)");
    await writeFile(join(cwd, "src", "app.js"), [
      "const button = document.querySelector('#start');",
      "",
      "button.addEventListener('click', () => {",
      "  button.textContent = 'Welcome aboard';",
      "  button.disabled = true;",
      "});",
      ""
    ].join("\n"));
    await say("File: Edited src/app.js (lines 4-5)");
    await say("Running command: npx prettier --check index.html src", 700);
    await say("Command completed: npx prettier --check index.html src");
    await say("Browser: open http://127.0.0.1:5173/index.html", 500);
    return {
      readyToDelegate: false,
      reply: [
        "Built the **Aurora** landing page and opened it in the browser.",
        "",
        "- `index.html`: a new hero section with a heading, tagline, and a **Get started** button.",
        "- `src/styles.css`: a warm orange-to-gold gradient, more generous spacing, and rounded corners.",
        "- `src/app.js`: the button now confirms in place instead of showing an `alert()`.",
        "",
        "Prettier reports every file as formatted."
      ].join("\n")
    };
  };
}

/** Scripted delegation: a two-agent plan, then agents that report progress and finish. */
function installDemoDelegation() {
  SolarHarness.prototype.plan = async function demoPlan(request, _context, onActivity) {
    onActivity?.("Designing a named sub-agent plan at max reasoning");
    await wait(400);
    return {
      summary: "Two agents work in parallel: one on layout, one on copy.",
      tasks: [
        { name: "Nova", title: "Layout pass", instructions: "Tighten the hero spacing and make the grid responsive." },
        { name: "Vega", title: "Copy pass", instructions: "Rewrite the tagline and button text to be clearer." }
      ]
    };
  };
  SolarHarness.prototype.executePlan = async function demoExecutePlan(plan, _request, _context, onProgress, onActivity) {
    const agents = plan.tasks.map((task, index) => ({
      ...task, id: `agent-${index + 1}`, depth: 0, reasoningPinned: false, childIds: [], status: "running",
      reasoning: this.options.reasoning, latestActivity: "Reading index.html", recentActivity: [], injectedContext: []
    }));
    onProgress(agents);
    await wait(700);
    agents[0].latestActivity = "Running command: npx prettier --check src";
    onProgress(agents);
    await wait(700);
    for (const agent of agents) { agent.status = "completed"; agent.latestActivity = "Report ready"; }
    onProgress(agents);
    onActivity?.("Synthesizing sub-agent reports");
    await wait(300);
    return `${plan.tasks.map(task => `**${task.name}** handled the ${task.title.toLowerCase()}.`).join(" ")} Both reports are in.`;
  };
}

/** Scripted /sidebyside: two sessions, three rounds each, reported the way the engine reports them. */
function installDemoMeeting() {
  const ids = { Aurora: "019a4c2e-demo-aurora", Helios: "019a4c2f-demo-helios" };
  const lines = {
    Aurora: ["Created `src/pricing.css` with rounded plan cards and a featured plan on the brand color.", "Helios is right about contrast, so the featured card keeps dark text on the orange end of the gradient.", "Readback: created `src/pricing.css` (plan cards, featured plan). Helios verified contrast; a check in the light theme is still needed."],
    Helios: ["Inspected `src/styles.css`: gold on white would fail contrast in the light theme. The featured card needs dark text.", "Checked `src/pricing.css`: the radius and featured class are in place and nothing else changed.", "Readback: verified Aurora's `src/pricing.css`. Remaining: confirm contrast in the light theme."]
  };
  SolarHarness.prototype.sideBySide = async function demoSideBySide(_task, _onActivity, onMessage, { continue: continuing = false, onSession } = {}) {
    const cwd = this.getWorkspace();
    for (let round = 0; round < 3; round++) {
      for (const name of ["Aurora", "Helios"]) onSession?.(name, round || continuing ? ids[name] : undefined, "running", round ? "Thinking: Weighing the peer's last message" : name === "Aurora" ? "Working on the request" : "Inspecting and verifying");
      // Aurora carries out the request and is the only one who edits.
      if (round === 0 && !continuing) {
        await writeFile(join(cwd, "src", "pricing.css"), ".plan { border-radius: 16px; }\n.plan.featured { background: var(--brand); }\n");
        onSession?.("Aurora", undefined, "running", "File: Created src/pricing.css (2 lines)");
      }
      await wait(350);
      for (const name of ["Aurora", "Helios"]) {
        onMessage?.(name, lines[name][round]);
        onSession?.(name, ids[name], "completed", round === 2 ? "Readback saved" : "Waiting for peer");
      }
    }
    return `Side-by-side meeting complete.

Aurora:
${lines.Aurora[2]}

Helios:
${lines.Helios[2]}`;
  };
}

/**
 * /sidebyside: two panes replace the thread, each with its own session and history; a follow-up resumes both,
 * Tab switches panes, and /sidebyside close returns to chat with a note. Prints `side by side: ... OK` only if all hold.
 */
async function checkSideBySide(run, shot) {
  const command = async text => { await run(`(() => { const input = document.getElementById("input"); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event("input")); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`); };
  const panes = () => run(`[...document.querySelectorAll("#meeting-panes .pane")].map(pane => [pane.querySelector(".pane-name").textContent, pane.querySelector(".pane-status").textContent, pane.querySelector(".pane-session").textContent, pane.querySelectorAll(".pane-message").length].join("|")).join(";")`);
  const results = {};
  await command("/sidebyside How should the pricing page use the sun palette?");
  await wait(450);
  await shot("meeting-working");
  results.working = await run(`[document.querySelector("#meeting-panes .pane").dataset.status, document.querySelector("#meeting-panes .avatar.working") !== null, document.querySelectorAll("#meeting-panes .pane-body .pane-live").length].join()`);
  // In a meeting the composer frame keeps its normal thickness.
  results.frame = await run(`getComputedStyle(document.getElementById("composer")).paddingTop`);
  await wait(1400);
  await shot("meeting");
  results.first = await panes();
  results.edit = await run(`[...document.querySelectorAll("#side-changes .side-file")].some(row => row.textContent.includes("pricing.css"))`);
  results.roles = await run(`[...document.querySelectorAll("#meeting-panes .pane-role")].map(node => node.textContent).join()`);
  results.view = await run(`[document.getElementById("thread").hidden, document.getElementById("meeting-tag").hidden, document.getElementById("attach").hidden, document.getElementById("modes").hidden, document.getElementById("meeting-note").hidden].join()`);
  await run(`document.getElementById("input").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))`);
  results.selected = await run(`[...document.querySelectorAll("#meeting-panes .pane")].findIndex(pane => pane.classList.contains("selected"))`);
  await command("Which color should the highlighted card use?");
  await wait(1700);
  results.followUp = await panes();
  results.layout = await run(`(() => { const box = document.getElementById("composer").getBoundingClientRect(); const body = document.querySelector(".pane-body").getBoundingClientRect(); return box.bottom <= innerHeight && body.bottom <= box.top && document.documentElement.scrollHeight <= innerHeight; })()`);
  await command("/sidebyside close");
  await wait(400);
  await shot("meeting-closed");
  results.closed = await run(`[document.getElementById("meeting").hidden, document.getElementById("thread").hidden, [...document.querySelectorAll(".note-title")].at(-1)?.textContent, [...document.querySelectorAll(".turn.note")].at(-1)?.textContent.includes("Open recordings")].join()`);
  const done = "Completed|Session: 019a4c2";
  const ok = results.working === "running,true,2" && results.frame === "1.5px" && results.view === "true,false,true,true,false" && results.selected === 1 && results.layout && results.edit
    && results.roles === "Does the work · edits,Checks · read-only"
    && results.first === `Aurora|${done}e-demo-aurora|4;Helios|${done}f-demo-helios|4`
    && results.followUp === `Aurora|${done}e-demo-aurora|8;Helios|${done}f-demo-helios|8`
    && results.closed === "true,false,Side-by-side,true";
  console.log(`side by side: ${JSON.stringify(results)} ${ok ? "OK" : "WRONG"}`);
}

/** A turn with many large files, for checking the layout holds up under big diffs. */
async function stressTurn(cwd, say) {
  await say("Note: I'll generate a large batch of files.", 100);
  mkdirSync(join(cwd, "generated"), { recursive: true });
  for (let file = 0; file < 60; file++) {
    const lines = Array.from({ length: 400 }, (_, line) => `export const value${line} = "${"x".repeat(line % 90)}"; // file ${file}`);
    await writeFile(join(cwd, "generated", `module-${file}.js`), `${lines.join("\n")}\n`);
    await say(`File: Created generated/module-${file}.js (400 lines)`, 10);
  }
  return { readyToDelegate: false, reply: "Generated 60 modules of 400 lines each." };
}

/**
 * The CLI features: the / menu, local commands, the pet, Ultraplan and Ultrareview pins, and a delegated
 * team (review card, accept/reject, live team panel). Prints `cli parity: ... OK` only if each shows up.
 */
async function checkCliParity(run, shot) {
  const type = text => run(`(() => { const input = document.getElementById("input"); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event("input")); })()`);
  const enter = () => run(`document.getElementById("input").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  const results = {};
  await type("/");
  await wait(200);
  results.slashMenu = await run(`document.querySelectorAll("#slash-menu .slash-item").length`);
  await shot("slash");
  await type("/sta");
  await wait(100);
  results.filtered = await run(`[...document.querySelectorAll("#slash-menu .slash-command")].map(node => node.textContent).join()`);
  await enter();
  await wait(400);
  await type("/pets fox");
  await enter();
  await wait(600);
  results.notes = await run(`[...document.querySelectorAll(".note-title")].map(node => node.textContent).join()`);
  results.pet = await run(`!document.getElementById("pet").hidden && document.getElementById("pet").textContent.includes("^")`);
  // Three tabs; Ultraplan and Ultrareview live in the / menu.
  results.tabs = await run(`[...document.querySelectorAll("#modes button")].map(node => node.textContent).join()`);
  await type("/ultra");
  await wait(100);
  results.ultraCommands = await run(`[...document.querySelectorAll("#slash-menu .slash-command")].map(node => node.textContent).join()`);
  await type("");
  await run(`document.querySelector('[data-mode="ultra"]').click()`);
  await run(`document.querySelector('[data-mode="ultra"]').dispatchEvent(new PointerEvent("pointerenter"))`);
  await wait(600);
  results.tip = await run(`document.getElementById("tip").hidden ? "" : document.querySelector("#tip strong").textContent + "," + document.querySelector("#tip .tip-badge").textContent`);
  await shot("mode-tip");
  await run(`document.querySelector('[data-mode="ultra"]').dispatchEvent(new PointerEvent("pointerleave"))`);
  // Pickers have cards too; a pinned one explains the pin, and clicking it opens no menu.
  const pillTip = async id => {
    await run(`document.getElementById("${id}").dispatchEvent(new PointerEvent("pointerenter"))`);
    await wait(500);
    const text = await run(`document.getElementById("tip").hidden ? "" : [document.querySelector("#tip strong").textContent, document.querySelector("#tip .tip-badge").textContent, document.querySelector("#tip .tip-meta").textContent].join("|")`);
    await run(`document.getElementById("${id}").dispatchEvent(new PointerEvent("pointerleave"))`);
    return text;
  };
  results.effortTip = await pillTip("effort-button");
  await shot("pill-tip");
  await run(`document.getElementById("effort-button").click()`);
  await wait(200);
  results.lockedMenu = await run(`document.getElementById("menu").hidden`);
  await run(`document.querySelector('[data-mode="chat"]').click()`);
  results.speedTip = await pillTip("speed-button");
  results.modelTip = await pillTip("model-button");
  // Solar switches itself into Plan: the timeline says so and the plan waits for approval.
  await type("Add pricing, but plan it first");
  await enter();
  await wait(1600);
  results.selfPlan = await run(`[document.querySelector(".turn.solar:last-of-type .step.mode .step-label")?.textContent, document.querySelector(".turn.solar:last-of-type .plan-head > span:not(.icon)")?.textContent, Boolean(document.querySelector(".turn.solar:last-of-type .plan-actions .primary-button"))].join()`);
  await shot("self-plan");
  await run(`document.querySelector('[data-mode="chat"]').click()`);
  await type("Build the page with a team");
  await enter();
  await wait(2200);
  results.delegation = await run(`document.querySelectorAll(".delegation-card .task-row").length`);
  await shot("delegation");
  await run(`document.querySelectorAll(".delegation-card input")[1].click()`);
  await wait(100);
  results.runLabel = await run(`document.querySelector(".delegation-card .primary-button").textContent`);
  await run(`document.querySelector(".delegation-card .primary-button").click()`);
  await wait(900);
  await shot("team");
  await wait(1600);
  results.team = await run(`[...document.querySelectorAll(".team .agent")].map(node => node.className).join()`);
  results.teamReply = await run(`document.querySelector(".turn.solar:last-of-type .solar-body")?.textContent.includes("Nova") ?? false`);
  await type("/pets off");
  await enter();
  await wait(300);
  const ok = results.slashMenu === 22 && results.filtered === "/stats" && results.notes === "Delegate,Stats,Pets" && results.pet
    && results.tabs === "Chat,Plan,Ultra" && results.ultraCommands === "/ultra,/ultraplan,/ultrareview"
    && results.tip === "Ultra,Can edit files" && results.delegation === 2 && results.lockedMenu
    && results.selfPlan === "Switched to Plan,Proposed plan,true"
    && results.effortTip.startsWith("Reasoning effort|Max|Locked: Ultra pins Max effort") && results.speedTip.startsWith("Speed|Standard|Applies") && results.modelTip.startsWith("Model|GPT-6 Luna|") && results.runLabel === "Run 1 sub-agent" && results.team === "agent completed" && results.teamReply;
  console.log(`cli parity: ${JSON.stringify(results)} ${ok ? "OK" : "WRONG"}`);
}

/**
 * Chat history and workspaces: the chat is saved and listed under its folder, a new chat starts empty, the saved
 * chat reopens with its turns and diffs, and a second folder starts its own chat. Prints `history: ... OK` if all hold.
 */
async function checkHistory(run, shot) {
  const results = {};
  await wait(600);
  results.listed = await run(`[document.querySelectorAll(".side-workspace").length, document.querySelectorAll(".side-workspace.current .side-chat").length, document.querySelector(".side-chat.current .side-chat-title")?.textContent].join("|")`);
  const turnsBefore = await run(`document.querySelectorAll(".turn.solar").length`);
  await run(`document.getElementById("new-chat").click()`);
  await wait(500);
  results.fresh = await run(`[Boolean(document.querySelector(".hero")), document.querySelectorAll(".turn").length, document.getElementById("chat-title").textContent].join()`);
  await run(`document.querySelector(".side-workspace.current .side-chat-open").click()`);
  await wait(900);
  results.reopened = await run(`[document.querySelectorAll(".turn.solar").length === ${turnsBefore}, Boolean(document.querySelector(".files-summary .review-button")), document.getElementById("chat-title").textContent, Boolean(document.querySelector(".side-chat.current"))].join()`);
  await run(`document.getElementById("thread").scrollTop = 0`);
  await wait(200);
  await shot("history");
  // The replayed response still opens its own diffs.
  await run(`document.querySelector(".files-summary .review-button").click()`);
  await wait(700);
  results.replayReview = await run(`[document.getElementById("review-title-text").textContent, document.querySelectorAll(".review-file").length > 0].join()`);
  await run(`document.getElementById("review-close").click()`);
  await run(`[...document.querySelectorAll(".side-workspace")].find(group => !group.classList.contains("current")).querySelector(".side-workspace-open").click()`);
  await wait(600);
  results.switched = await run(`[Boolean(document.querySelector(".hero")), document.querySelector(".side-workspace.current .side-workspace-name").textContent.startsWith("solar-demo-second-"), document.getElementById("chat-sub").textContent.includes("solar-demo-second-")].join()`);
  await shot("workspaces");
  const ok = /^2\|1\|Build a landing page/.test(results.listed) && results.fresh === "true,0,New chat"
    && results.reopened === "true,true,Build a landing page for Aurora and make the button nicer,true"
    && results.replayReview === "This response,true" && results.switched === "true,true,true";
  console.log(`history: ${JSON.stringify(results)} ${ok ? "OK" : "WRONG"}`);
}

/** Types a request, waits for the scripted turn, and saves screenshots of the key views. */
export async function captureScreenshots(window, directory) {
  mkdirSync(directory, { recursive: true });
  const results0 = {};
  const run = script => window.webContents.executeJavaScript(script);
  const shot = async name => writeFile(join(directory, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  await wait(1200);
  await shot("empty");
  // /delegate before any request: a hint, not a failed turn.
  await run(`(() => { const input = document.getElementById("input"); input.value = "/delegate"; input.dispatchEvent(new Event("input")); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`);
  await wait(300);
  const earlyDelegate = await run(`[document.querySelector(".note-title")?.textContent, document.querySelectorAll(".error-card, .turn.user").length].join()`);
  console.log(`early delegate: ${earlyDelegate} ${earlyDelegate === "Delegate,0" ? "OK" : "WRONG"}`);
  // Speed is a picker; Ultra must show and lock Max effort with Fast speed, then chat restores the real settings.
  await run(`document.getElementById("speed-button").click()`);
  await wait(300);
  await shot("speed");
  await run(`[...document.querySelectorAll(".menu-item")].find(item => item.textContent.includes("Standard"))?.click()`);
  await wait(300);
  await run(`document.querySelector('[data-mode="ultra"]').click()`);
  await wait(300);
  await shot("ultra");
  const pills = () => run(`["effort-label", "speed-label", "effort-button", "speed-button"].map(id => { const node = document.getElementById(id); return node.tagName === "BUTTON" ? node.getAttribute("aria-disabled") === "true" : node.textContent; }).map(value => value === undefined ? "" : value)`);
  const ultra = await pills();
  await run(`document.querySelector('[data-mode="chat"]').click()`);
  await wait(200);
  const chat = await pills();
  const pinned = ultra.join() === "Max,Fast,true,true" && chat[1] === "Standard" && chat[2] === false && chat[3] === false;
  console.log(`ultra pins: ${JSON.stringify({ ultra, chat })} ${pinned ? "OK" : "WRONG"}`);
  await run(`(() => { const input = document.getElementById("input"); input.value = "Build a landing page for Aurora and make the button nicer"; input.dispatchEvent(new Event("input")); document.getElementById("send").click(); })()`);
  await wait(2400);
  await shot("working");
  await wait(4000);
  await shot("finished");
  await run(`document.querySelector(".files-summary .file-card-head")?.click()`);
  await wait(400);
  await run(`document.getElementById("thread").scrollTop = 1e6`);
  await wait(300);
  await shot("diff");
  results0.reviewButton = await run(`Boolean(document.querySelector(".files-summary .review-button")) && !document.getElementById("review-toggle")`);
  await run(`document.querySelector(".files-summary .review-button").click()`);
  await wait(900);
  results0.reviewScope = await run(`[document.getElementById("review-title-text").textContent, document.querySelectorAll(".review-file").length].join()`);
  console.log(`review button: ${JSON.stringify(results0)} ${results0.reviewButton && results0.reviewScope === "This response,3" ? "OK" : "WRONG"}`);
  await run(`[...document.querySelectorAll(".review-file")].find(row => row.textContent.includes("styles.css"))?.click()`);
  await wait(500);
  await shot("review");
  // With the Review panel open the composer is narrow; its controls must still fit on one row.
  const narrow = await run(`(() => { const bar = document.querySelector(".composer-bar"); const box = document.getElementById("composer").getBoundingClientRect(); const right = document.getElementById("send").getBoundingClientRect().right; return { barScroll: bar.scrollWidth, barWidth: bar.clientWidth, sendRight: Math.round(right), composerRight: Math.round(box.right), tabs: getComputedStyle(document.getElementById("modes")).display }; })()`);
  console.log(`narrow composer: ${JSON.stringify(narrow)} ${narrow.barScroll <= narrow.barWidth && narrow.sendRight <= narrow.composerRight && narrow.tabs !== "none" ? "OK" : "OVERFLOWS"}`);
  await run(`document.getElementById("review-close").click()`);
  await checkCliParity(run, shot);
  await checkSideBySide(run, shot);
  await run(`(() => { const input = document.getElementById("input"); input.value = "stress test with huge diffs"; input.dispatchEvent(new Event("input")); document.getElementById("send").click(); })()`);
  await wait(6000);
  await shot("stress");
  // The composer must stay fully inside the window however much the thread holds.
  const layout = await run(`(() => { const box = document.getElementById("composer").getBoundingClientRect(); return { composerBottom: Math.round(box.bottom), windowHeight: innerHeight, pageHeight: document.documentElement.scrollHeight }; })()`);
  console.log(`stress layout: ${JSON.stringify(layout)} ${layout.composerBottom <= layout.windowHeight && layout.pageHeight <= layout.windowHeight ? "OK" : "COMPOSER OFF SCREEN"}`);
  // Light theme: the sidebar toggle switches it; views are saved as light-*.png, then /theme dark switches back.
  await run(`document.getElementById("theme-toggle").click()`);
  await wait(500);
  await run(`document.querySelector(".files-summary")?.scrollIntoView({ block: "center" })`);
  await wait(300);
  await shot("light");
  await run(`document.querySelector('[data-mode="ultra"]').click()`);
  await run(`document.querySelector('[data-mode="ultra"]').dispatchEvent(new PointerEvent("pointerenter"))`);
  await wait(600);
  await shot("light-ultra");
  await run(`document.querySelector('[data-mode="ultra"]').dispatchEvent(new PointerEvent("pointerleave"))`);
  await run(`document.querySelector('[data-mode="chat"]').click()`);
  await run(`[...document.querySelectorAll(".files-summary .review-button")].at(-1).click()`);
  await wait(900);
  await shot("light-review");
  const light = await run(`[document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor].join()`);
  await run(`document.getElementById("review-close").click()`);
  await run(`(() => { const input = document.getElementById("input"); input.value = "/theme dark"; input.dispatchEvent(new Event("input")); input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`);
  await wait(500);
  const dark = await run(`[document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor].join()`);
  console.log(`themes: ${JSON.stringify({ light, dark })} ${light === "light,rgb(247, 246, 243)" && dark === "dark,rgb(11, 11, 16)" ? "OK" : "WRONG"}`);
  await checkHistory(run, shot);
}
