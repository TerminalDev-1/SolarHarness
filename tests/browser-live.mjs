import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SolarBrowser } from "../dist/browser-tool.js";

const html = `<!doctype html><html><head><title>Solar input probe</title></head>
<body style="height:520px"><button id="start">Start game</button>
<p id="state">Idle</p><p id="keys">Keys: 0</p><p id="moves">Moves: 0</p><p id="clicks">Clicks: 0</p>
<script>
let keys=0,moves=0,clicks=0;
document.querySelector('#start').onclick=()=>document.querySelector('#state').textContent='Running';
document.addEventListener('keydown',event=>{if(event.key==='ArrowRight')document.querySelector('#keys').textContent='Keys: '+(++keys)});
document.addEventListener('mousemove',()=>document.querySelector('#moves').textContent='Moves: '+(++moves));
document.addEventListener('click',event=>{if(event.target.id!=='start')document.querySelector('#clicks').textContent='Clicks: '+(++clicks)});
</script></body></html>`;

const root = await mkdtemp(join(tmpdir(), "solar-browser-live-"));
const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const browser = new SolarBrowser(root);
try {
  const opened = await browser.execute({ action: "open", url: `http://127.0.0.1:${address.port}/` });
  assert.match(opened.snapshot, /Start game/);
  const started = await browser.execute({ action: "click", selector: "#start" });
  assert.match(started.snapshot, /Running/);
  const pressed = await browser.execute({ action: "press", key: "ArrowRight" });
  assert.match(pressed.snapshot, /Keys: 1/);
  const moved = await browser.execute({ action: "move", x: 300, y: 200 });
  assert.match(moved.snapshot, /Moves: [1-9]/);
  const clicked = await browser.execute({ action: "click", x: 300, y: 200 });
  assert.match(clicked.snapshot, /Clicks: 1/);
  const cursor = browser.page.locator("#solar-harness-cursor");
  assert.equal(await cursor.evaluate(element => element.style.display), "block");
  assert.equal(await cursor.evaluate(element => element.style.left), "300px");
  assert.equal(browser.active, true);
  const screenshot = await browser.execute({ action: "screenshot" });
  console.log(JSON.stringify({ start: true, press: true, move: true, click: true, browserActive: browser.active, screenshotPath: screenshot.screenshotPath }));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  // Screenshot is retained for visual review of the cursor and control tint.
  if (process.env.SOLAR_KEEP_BROWSER_SCREENSHOT !== "1") await rm(root, { recursive: true, force: true });
}
