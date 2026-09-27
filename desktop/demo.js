import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SolarHarness } from "../dist/harness.js";

/**
 * `npm run demo`: a scripted Solar that makes real file edits in a scratch folder, so the
 * interface (timeline, diffs, Review panel) can be seen and screenshotted with no Codex calls.
 */
export function prepareDemoWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), "solar-demo-"));
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
  SolarHarness.prototype.converse = async function demoConverse(_message, onActivity) {
    const cwd = this.getWorkspace();
    const say = async (line, ms = 450) => { onActivity?.(line); await wait(ms); };
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

/** Types a request, waits for the scripted turn, and saves screenshots of the key views. */
export async function captureScreenshots(window, directory) {
  mkdirSync(directory, { recursive: true });
  const run = script => window.webContents.executeJavaScript(script);
  const shot = async name => writeFile(join(directory, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  await wait(1200);
  await shot("empty");
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
  await run(`document.getElementById("review-toggle").click()`);
  await wait(900);
  await run(`[...document.querySelectorAll(".review-file")].find(row => row.textContent.includes("styles.css"))?.click()`);
  await wait(500);
  await shot("review");
}
