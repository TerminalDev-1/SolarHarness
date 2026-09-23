import { chromium, type Browser, type Page } from "playwright";
import { existsSync } from "node:fs";

export type WebSearchHeadlessInput = {
  action?: "search" | "read";
  query?: string;
  url?: string;
  engine?: "google" | "bing";
};

export type WebSearchHit = { title: string; url: string; snippet: string };
export type WebSearchHeadlessResult = {
  action: "search" | "read";
  url: string;
  title: string;
  query?: string;
  engine?: "google" | "bing";
  results?: WebSearchHit[];
  text?: string;
};

/** Short-lived headless research session, separate from Solar's visible browser. */
export class SolarWebSearchHeadless {
  async execute(input: WebSearchHeadlessInput): Promise<WebSearchHeadlessResult> {
    if (!input || typeof input !== "object") throw new Error("web_search_headless requires an input object.");
    const action = input.action ?? "search";
    if (action !== "search" && action !== "read") throw new Error("web_search_headless action must be search or read.");
    const query = input.query?.trim();
    if (action === "search" && !query) throw new Error("web_search_headless search requires query.");
    if (action === "read" && !input.url) throw new Error("web_search_headless read requires url.");
    const readUrl = action === "read" ? new URL(input.url!) : undefined;
    if (readUrl && !(["http:", "https:"] as string[]).includes(readUrl.protocol)) throw new Error("Only http and https URLs are supported.");
    const engine = input.engine ?? "google";
    if (action === "search" && engine !== "google" && engine !== "bing") throw new Error("Search engine must be google or bing.");
    const browser = await launchHeadlessBrowser();
    try {
      const page = await browser.newPage({ acceptDownloads: false });
      if (action === "read") {
        await page.goto(readUrl!.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
        return { action, url: page.url(), title: await page.title(), text: (await page.locator("body").innerText({ timeout: 10_000 })).slice(0, 20_000) };
      }
      await page.goto(searchUrl(engine, query!), { waitUntil: "domcontentloaded", timeout: 30_000 });
      let usedEngine = engine;
      if (engine === "google") {
        await dismissGoogleConsent(page);
        if (new URL(page.url()).pathname.startsWith("/sorry") || /unusual traffic from your computer network/i.test(await page.locator("body").innerText())) {
          usedEngine = "bing";
          await page.goto(searchUrl("bing", query!), { waitUntil: "domcontentloaded", timeout: 30_000 });
        }
      }
      if (usedEngine === "bing") await dismissBingConsent(page);
      let results = await extractResults(page, usedEngine);
      if (!results.length && usedEngine === "google") {
        usedEngine = "bing";
        await page.goto(searchUrl("bing", query!), { waitUntil: "domcontentloaded", timeout: 30_000 });
        await dismissBingConsent(page);
        results = await extractResults(page, "bing");
      }
      if (!results.length) throw new Error(`${usedEngine} returned no readable search results at ${page.url()}.`);
      return { action, query, engine: usedEngine, url: page.url(), title: await page.title(), results };
    } finally {
      await browser.close();
    }
  }
}

async function launchHeadlessBrowser(): Promise<Browser> {
  const executablePath = chromium.executablePath();
  const failures: string[] = [];
  if (existsSync(executablePath)) {
    try { return await chromium.launch({ executablePath, headless: true }); }
    catch (error) { failures.push(`Playwright Chromium: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`); }
  } else failures.push(`Playwright Chromium is missing at ${executablePath}`);
  try { return await chromium.launch({ channel: "msedge", headless: true }); }
  catch (error) { failures.push(`Microsoft Edge: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`); }
  throw new Error(`Could not launch a headless Playwright browser. ${failures.join("; ")}`);
}

function searchUrl(engine: "google" | "bing", query: string): string {
  return `https://www.${engine}.com/search?q=${encodeURIComponent(query)}`;
}

async function dismissGoogleConsent(page: Page): Promise<void> {
  if (!/(^|\.)consent\.google\.com$/i.test(new URL(page.url()).hostname)) return;
  const reject = page.getByRole("button", { name: /^(?:Reject all|Decline all)/i }).first();
  try { await reject.waitFor({ state: "visible", timeout: 5_000 }); }
  catch { throw new Error("Google opened a consent form that needs your attention."); }
  await reject.click({ timeout: 8_000 });
  await page.waitForURL(url => !/(^|\.)consent\.google\.com$/i.test(url.hostname), { timeout: 10_000 });
}

async function dismissBingConsent(page: Page): Promise<void> {
  const reject = page.getByRole("link", { name: /^Reject$/i }).first();
  try { await reject.waitFor({ state: "visible", timeout: 5_000 }); }
  catch { return; }
  await reject.click({ timeout: 8_000 });
  await reject.waitFor({ state: "hidden", timeout: 8_000 });
}

async function extractResults(page: Page, engine: "google" | "bing"): Promise<WebSearchHit[]> {
  const raw = engine === "bing"
    ? await page.locator("li.b_algo").evaluateAll(items => items.slice(0, 10).map(item => ({
        title: item.querySelector("h2")?.textContent?.trim() ?? "",
        url: item.querySelector("h2 a")?.getAttribute("href") ?? "",
        snippet: item.querySelector(".b_caption p")?.textContent?.trim() ?? ""
      })))
    : await page.locator("a:has(h3)").evaluateAll(items => items.slice(0, 10).map(item => ({
        title: item.querySelector("h3")?.textContent?.trim() ?? "",
        url: item.getAttribute("href") ?? "",
        snippet: item.parentElement?.parentElement?.textContent?.trim().slice(0, 500) ?? ""
      })));
  return raw.map(item => ({ ...item, url: resolveSearchUrl(item.url, page.url()) }))
    .filter(item => item.title && /^https?:\/\//.test(item.url));
}

function resolveSearchUrl(href: string, base: string): string {
  try {
    const url = new URL(href, base);
    if (url.hostname === "www.bing.com" && url.pathname === "/ck/a") {
      const encoded = url.searchParams.get("u");
      if (encoded?.startsWith("a1")) {
        const decoded = Buffer.from(encoded.slice(2), "base64url").toString("utf8");
        if (/^https?:\/\//.test(decoded)) {
          const source = new URL(decoded);
          source.searchParams.delete("msockid");
          return source.href;
        }
      }
    }
    return url.href;
  } catch { return ""; }
}
