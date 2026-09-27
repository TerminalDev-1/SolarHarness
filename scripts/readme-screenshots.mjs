// Renders the real Solar interface in scripted scenes and saves README screenshots to docs/images.
// The model is faked, so no Codex calls are made. Run with: npm run docs:screenshots
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { createRequire } from "node:module";
import { chromium } from "playwright";

const scratch = await mkdtemp(join(tmpdir(), "solar-screens-"));
process.env.SOLAR_HOME = join(scratch, "home");
process.env.SOLAR_STATS_PATH = join(scratch, "stats.json");
process.env.FORCE_COLOR = "3";
// Every achievement already unlocked, so no unlock banners appear in the scenes.
await writeFile(process.env.SOLAR_STATS_PATH, JSON.stringify({ chats: 12, prompts: 60, completed: 58, inputTokens: 0, outputTokens: 0, models: { "gpt-6-luna": 60 },
  achievements: ["First prompt!", "Getting started · 10 prompts", "Solar regular · 50 prompts", "First website built!"] }));

const React = (await import("react")).default;
const { render } = await import("ink");
const { SolarApp } = await import("../dist/ui.js");
const { SolarHarness } = await import("../dist/harness.js");

const COLUMNS = 96;
const ROWS = 34;
const DISPLAY_WORKSPACE = "C:\\Users\\you\\projects\\portfolio";
const output = join(import.meta.dirname, "..", "docs", "images");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const answer = reply => ({ text: JSON.stringify({ kind: "answer", tool: "none", input: "", reply }), sessionId: "demo" });

/** Starts a fresh Solar UI on a fake terminal; `record` collects every byte Ink writes. */
async function startSolar(workspace) {
  const stdout = Object.assign(new PassThrough(), { isTTY: true, rows: ROWS, columns: COLUMNS });
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode() {}, ref() {}, unref() {} });
  let record = "";
  stdout.on("data", data => { record += data.toString(); });
  const harness = new SolarHarness({ task: "", model: "gpt-6-luna", reasoning: "max", cwd: workspace });
  harness.getWorkspace = () => DISPLAY_WORKSPACE;
  const app = render(React.createElement(SolarApp, { harness, model: "gpt-6-luna", reasoning: "max", initialSplash: false }), { stdout, stdin, exitOnCtrlC: false, patchConsole: false });
  await sleep(300);
  return {
    harness,
    output: () => record,
    // Sends the text as one paste; Enter follows separately, as when a person types.
    async type(text, submit = true) {
      stdin.write(text);
      await sleep(120);
      if (submit) stdin.write("\r");
      await sleep(250);
    },
    close: () => app.unmount()
  };
}

/** Streams activity like a real Codex turn, then waits until `release()` returns the reply. */
function scriptedTurn(events, reply) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const run = async (_prompt, options) => {
    for (const event of events) { options.onEvent?.(event); await sleep(120); }
    await gate;
    return answer(reply);
  };
  return { run, release: () => release() };
}

const scenes = [];

// 1. Welcome screen.
{
  const solar = await startSolar(scratch);
  scenes.push(["welcome", solar.output()]);
  // 2. Command menu.
  await solar.type("/", false);
  scenes.push(["commands", solar.output()]);
  solar.close();
}

// 3 and 4. Solar at work, then the finished turn.
{
  const solar = await startSolar(scratch);
  const turn = scriptedTurn([
    "Thinking: Planning the page layout",
    "Note: I'll check what's in the project, then create index.html and styles.css.",
    "Command completed: Get-ChildItem -Force",
    "File: Created index.html (48 lines)",
    "File: Created styles.css (62 lines)",
    "Note: Now I'll validate the markup.",
    "Command completed: npx html-validate index.html",
    "Thinking: Checking the hero section spacing"
  ], [
    "## Landing page ready",
    "",
    "I built a **responsive landing page** for your portfolio:",
    "",
    "- `index.html` has a hero, a projects grid, and a contact section",
    "- `styles.css` uses a dark theme with an orange accent",
    "",
    "The markup passes validation with no errors."
  ].join("\n"));
  solar.harness.provider.run = turn.run;
  solar.harness.provider.resume = turn.run;
  await solar.type("Build a landing page for my portfolio");
  await sleep(1_400);
  scenes.push(["working", solar.output()]);
  turn.release();
  await sleep(700);
  scenes.push(["finished", solar.output()]);
  solar.close();
}

// 5. Vision: an image mentioned in the message is attached and viewed.
{
  await mkdir(join(scratch, "screenshots"), { recursive: true });
  await writeFile(join(scratch, "screenshots", "home.png"), "png");
  const solar = await startSolar(scratch);
  const turn = scriptedTurn([
    "Thinking: Comparing the header and the grid",
    "Note: The navigation bar overlaps the hero heading on narrow screens. I'll fix the header height.",
    "File: Edited styles.css (lines 14-19)"
  ], [
    "The **navigation bar overlapped the hero heading** because the header had a fixed height of `64px` while the links wrapped onto two lines.",
    "",
    "I changed the header to grow with its content, so the heading now starts below it."
  ].join("\n"));
  solar.harness.provider.run = turn.run;
  solar.harness.provider.resume = turn.run;
  turn.release();
  await solar.type("What's wrong with the layout in @screenshots/home.png?");
  await sleep(900);
  scenes.push(["vision", solar.output()]);
  solar.close();
}

// 6. /plan waits for approval before changing anything.
{
  const solar = await startSolar(scratch);
  solar.harness.provider.run = async () => ({ text: [
    "## Goal",
    "Add a dark mode toggle that remembers the visitor's choice.",
    "",
    "## Steps",
    "1. `index.html`: add a toggle button to the header.",
    "2. `styles.css`: move colors into variables with a dark set.",
    "3. `theme.js`: switch the theme and save it in `localStorage`.",
    "",
    "## Verify",
    "- Open the page, toggle, reload, and check the choice persists."
  ].join("\n"), sessionId: "plan" });
  await solar.type("/plan", false);
  await solar.type(" add a dark mode toggle");
  await sleep(600);
  scenes.push(["plan", solar.output()]);
  solar.close();
}

// 7. /ultra: Max effort with Fast mode and the faster rainbow.
{
  const solar = await startSolar(scratch);
  const turn = scriptedTurn([
    "Thinking: Mapping the contact form's validation",
    "Note: I'll read the form code, then rewrite the validation so errors show next to each field.",
    "Command completed: Get-Content contact.js",
    "File: Edited contact.js (lines 8-41)"
  ], "Done.");
  solar.harness.provider.run = turn.run;
  solar.harness.provider.resume = turn.run;
  await solar.type("/ultra", false);
  await solar.type(" refactor the contact form validation");
  await sleep(1_300);
  scenes.push(["ultra", solar.output()]);
  turn.release();
  await sleep(200);
  solar.close();
}

// Replay each scene's terminal output in xterm.js and screenshot the screen.
const require = createRequire(import.meta.url);
const xtermDirectory = join(require.resolve("@xterm/xterm/package.json"), "..");
const executablePath = chromium.executablePath();
const browser = existsSync(executablePath)
  ? await chromium.launch({ executablePath })
  : await chromium.launch({ channel: "msedge" });
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 1200, height: 900 } });
  for (const [name, data] of scenes) {
    await page.setContent(`<!doctype html><html><body style="margin:0;background:#0c0c0c;display:inline-block;padding:18px"><div id="terminal"></div></body></html>`);
    await page.addStyleTag({ path: join(xtermDirectory, "css", "xterm.css") });
    await page.addScriptTag({ path: join(xtermDirectory, "lib", "xterm.js") });
    await page.evaluate(({ data, columns, rows }) => new Promise(resolve => {
      const terminal = new window.Terminal({
        // A real TTY turns "\n" into "\r\n"; Ink relies on that.
        cols: columns, rows, fontSize: 15, lineHeight: 1.1, convertEol: true,
        fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace",
        theme: { background: "#0c0c0c", foreground: "#cccccc" }, cursorStyle: "bar", cursorInactiveStyle: "none"
      });
      terminal.open(document.getElementById("terminal"));
      terminal.write(data.replace(/\x1b\[\?25[hl]/g, ""), () => setTimeout(resolve, 150));
    }), { data, columns: COLUMNS, rows: ROWS });
    await page.locator("body").screenshot({ path: join(output, `${name}.png`) });
    console.log(`Saved docs/images/${name}.png`);
  }
} finally {
  await browser.close();
  await rm(scratch, { recursive: true, force: true });
}
process.exit(0);
