/**
 * The engine marks Solar's browser with a "Solar Harness is controlling the browser" notice, a blue
 * tint, and a cursor, and leaves the window open after a turn so you can look at the result. Between
 * turns Solar isn't controlling anything, so the desktop app hides those marks, including on pages
 * you open yourself afterwards, and shows them again when Solar's next turn starts.
 *
 * `browser` is the engine's SolarBrowser; its Playwright context is a private field, read here only.
 */
const STYLE_ID = "solar-desktop-released";
const HIDE_MARKS = "#solar-harness-browser-notice, #solar-harness-browser-tint, #solar-harness-cursor { display: none !important; }";
const released = new WeakMap();

export async function releaseBrowser(browser) {
  const context = browser?.context;
  if (!context) return;
  if (!released.has(context)) {
    // Pages loaded while released get the marks hidden too; Solar's next turn clears the flag.
    const hideIfReleased = page => page.on("domcontentloaded", () => { if (released.get(context)) void setMarks(page, false); });
    context.pages().forEach(hideIfReleased);
    context.on("page", hideIfReleased);
  }
  released.set(context, true);
  await Promise.all(context.pages().map(page => setMarks(page, false)));
}

export async function claimBrowser(browser) {
  const context = browser?.context;
  if (!context || !released.get(context)) return;
  released.set(context, false);
  await Promise.all(context.pages().map(page => setMarks(page, true)));
}

async function setMarks(page, visible) {
  try {
    await page.evaluate(({ id, css, visible }) => {
      const style = document.getElementById(id);
      if (visible) { style?.remove(); return; }
      if (style) return;
      const element = document.createElement("style");
      element.id = id;
      element.textContent = css;
      document.documentElement.append(element);
    }, { id: STYLE_ID, css: HIDE_MARKS, visible });
  } catch { /* The page closed or is mid-navigation; its next load is handled above. */ }
}
