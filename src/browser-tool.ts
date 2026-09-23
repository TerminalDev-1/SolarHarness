import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export type BrowserInput = {
  action: "open" | "search" | "youtube_search" | "snapshot" | "screenshot" | "move" | "click" | "fill" | "press" | "scroll" | "back" | "forward" | "close";
  url?: string;
  selector?: string;
  element?: string;
  query?: string;
  engine?: "google" | "bing";
  x?: number;
  y?: number;
  value?: string;
  key?: string;
  direction?: "up" | "down";
  fullPage?: boolean;
};

export type BrowserResult = { url: string; title: string; snapshot: string; screenshotPath?: string };

/** One visible, isolated Playwright browser context for the main agent session. */
export class SolarBrowser {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;

  constructor(private workspace: string = process.cwd()) {}

  setWorkspace(workspace: string): void { this.workspace = workspace; }

  get active(): boolean { return Boolean(this.page && !this.page.isClosed()); }

  async execute(input: BrowserInput): Promise<BrowserResult> {
    if (!input || typeof input !== "object") throw new Error("browser requires an action.");
    if (input.action === "close") {
      await this.close();
      return { url: "", title: "Browser closed", snapshot: "The isolated browser session is closed." };
    }
    if (input.action === "open") {
      if (typeof input.url !== "string") throw new Error("open requires a URL.");
      const url = new URL(input.url);
      if (!(["http:", "https:"] as string[]).includes(url.protocol)) throw new Error("Only http and https URLs are supported.");
      const page = await this.getPage();
      await page.goto(url.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await this.dismissSearchConsent(page);
      return this.describe(page);
    }
    if (input.action === "search") {
      const query = input.query?.trim();
      if (!query) throw new Error("browser search requires a nonempty query.");
      if (input.engine && input.engine !== "google" && input.engine !== "bing") throw new Error("browser search engine must be google or bing.");
      const page = await this.getPage();
      const engine = input.engine ?? "google";
      await page.goto(`https://www.${engine}.com/search?q=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await this.dismissSearchConsent(page);
      if (!isSearchResultsPage(page.url(), query)) {
        if (input.engine) throw new Error(`${engine} did not show search results for ${query} at ${page.url()}.`);
        await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await this.dismissSearchConsent(page);
      }
      if (!isSearchResultsPage(page.url(), query)) throw new Error(`No visible search results for ${query} at ${page.url()}.`);
      return this.describe(page);
    }
    if (!this.active || !this.page) throw new Error("Open a page before using the browser.");
    const page = this.page;
    switch (input.action) {
      case "youtube_search": {
        const query = input.value?.trim();
        if (!query) throw new Error("youtube_search requires a search query in value.");
        if (!/(^|\.)youtube\.com$/i.test(new URL(page.url()).hostname)) throw new Error("Open YouTube before searching it.");
        await page.goto(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
        await this.dismissYouTubeConsent(page);
        break;
      }
      case "snapshot": break;
      case "screenshot": {
        const directory = join(this.workspace, ".solarharness", "screenshots");
        await mkdir(directory, { recursive: true });
        const screenshotPath = join(directory, `browser-${Date.now()}-${randomUUID().slice(0, 8)}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: input.fullPage ?? true });
        return { ...await this.describe(page), screenshotPath };
      }
      case "move":
        this.checkPoint(page, input.x, input.y);
        await this.moveCursor(page, input.x!, input.y!);
        break;
      case "click":
        if (input.selector || input.element) {
          const target = input.selector ? page.locator(input.selector) : await this.namedElement(page, input.element!);
          await target.scrollIntoViewIfNeeded({ timeout: 10_000 });
          const bounds = await target.boundingBox();
          if (bounds) await this.moveCursor(page, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
          await target.click({ timeout: 10_000 });
        } else {
          this.checkPoint(page, input.x, input.y);
          await this.moveCursor(page, input.x!, input.y!);
          await page.mouse.click(input.x!, input.y!);
        }
        break;
      case "fill":
        if (!input.selector || typeof input.value !== "string") throw new Error("fill requires a selector and value.");
        await page.locator(input.selector).fill(input.value, { timeout: 10_000 });
        break;
      case "press":
        if (!input.key) throw new Error("press requires a key.");
        await page.bringToFront();
        if (input.selector) await page.locator(input.selector).press(input.key, { timeout: 10_000 });
        else await page.keyboard.press(input.key);
        break;
      case "scroll":
        await page.mouse.wheel(0, input.direction === "up" ? -650 : 650);
        break;
      case "back": await page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 }); break;
      case "forward": await page.goForward({ waitUntil: "domcontentloaded", timeout: 30_000 }); break;
      default: throw new Error(`Unknown browser action: ${String(input.action)}`);
    }
    return this.describe(page);
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;
    await browser?.close();
  }

  private async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    const executablePath = chromium.executablePath();
    const failures: string[] = [];
    if (existsSync(executablePath)) {
      try {
        this.browser = await chromium.launch({ executablePath, headless: false, args: ["--window-size=980,700", "--window-position=80,80"] });
      } catch (error) {
        failures.push(`Playwright Chromium at ${executablePath}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      }
    } else {
      failures.push(`Playwright Chromium is missing at ${executablePath}`);
    }
    if (!this.browser) {
      try {
        this.browser = await chromium.launch({ channel: "msedge", headless: false, args: ["--window-size=980,700", "--window-position=80,80"] });
      } catch (error) {
        failures.push(`Microsoft Edge through Playwright: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      }
    }
    if (!this.browser) throw new Error(`Could not launch a visible Playwright browser. Install Chromium with "playwright install chromium". ${failures.join("; ")}`);
    this.context = await this.browser.newContext({ acceptDownloads: false, viewport: { width: 900, height: 560 } });
    await this.context.addInitScript(() => {
      const showNotice = () => {
        if (!document.body) return;
        if (!document.getElementById("solar-harness-browser-tint")) {
          const tint = document.createElement("div");
          tint.id = "solar-harness-browser-tint";
          tint.setAttribute("aria-hidden", "true");
          Object.assign(tint.style, {
            position: "fixed", inset: "0", zIndex: "2147483646",
            background: "rgba(37, 99, 235, 0.09)",
            boxShadow: "inset 0 0 0 7px rgba(37, 99, 235, 0.75)",
            pointerEvents: "none"
          });
          document.body.appendChild(tint);
        }
        if (document.getElementById("solar-harness-browser-notice")) return;
        const notice = document.createElement("div");
        notice.id = "solar-harness-browser-notice";
        notice.textContent = "Solar Harness is controlling the browser";
        notice.setAttribute("role", "status");
        Object.assign(notice.style, {
          position: "fixed", top: "8px", right: "8px", zIndex: "2147483647",
          background: "#1d4ed8", color: "#fff", padding: "8px 12px",
          border: "2px solid #93c5fd", borderRadius: "8px",
          font: "600 13px system-ui, sans-serif", boxShadow: "0 2px 12px #0008",
          pointerEvents: "none"
        });
        document.body.appendChild(notice);
        const cursor = document.createElement("div");
        cursor.id = "solar-harness-cursor";
        cursor.setAttribute("aria-hidden", "true");
        Object.assign(cursor.style, {
          position: "fixed", left: "0px", top: "0px", display: "none",
          width: "18px", height: "18px", borderRadius: "50%",
          background: "#2563eb", border: "3px solid #fff",
          boxShadow: "0 0 0 3px #1d4ed8, 0 2px 12px #0009",
          transform: "translate(-50%, -50%)", transition: "left 120ms, top 120ms",
          zIndex: "2147483647", pointerEvents: "none"
        });
        document.body.appendChild(cursor);
      };
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showNotice, { once: true });
      else showNotice();
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(10_000);
    return this.page;
  }

  private async describe(page: Page): Promise<BrowserResult> {
    const [title, snapshot] = await Promise.all([
      page.title(),
      page.locator("body").ariaSnapshot({ timeout: 10_000 })
    ]);
    return { url: page.url(), title, snapshot: snapshot.slice(0, 20_000) };
  }

  private checkPoint(page: Page, x: number | undefined, y: number | undefined): void {
    const size = page.viewportSize();
    if (!size || !Number.isFinite(x) || !Number.isFinite(y) || x! < 0 || y! < 0 || x! >= size.width || y! >= size.height) {
      throw new Error("move or coordinate click requires x and y inside the browser viewport.");
    }
  }

  private async moveCursor(page: Page, x: number, y: number): Promise<void> {
    await page.mouse.move(x, y, { steps: 8 });
    await page.evaluate(({ x, y }) => {
      const cursor = document.getElementById("solar-harness-cursor");
      if (cursor) {
        cursor.style.left = `${x}px`;
        cursor.style.top = `${y}px`;
        cursor.style.display = "block";
      }
    }, { x, y });
  }

  private async namedElement(page: Page, name: string) {
    const button = page.getByRole("button", { name, exact: true }).first();
    if (await button.count()) return button;
    const link = page.getByRole("link", { name, exact: true }).first();
    if (await link.count()) return link;
    throw new Error(`No visible button or link named "${name}" was found.`);
  }

  private async dismissSearchConsent(page: Page): Promise<void> {
    const host = new URL(page.url()).hostname;
    if (/(^|\.)(?:google\.com|consent\.google\.com)$/i.test(host)) {
      const reject = page.getByRole("button", { name: /^(?:Reject all|Decline all)$/i }).first();
      if (await reject.isVisible()) {
        await reject.click({ timeout: 8_000 });
        await reject.waitFor({ state: "hidden", timeout: 8_000 });
      }
    }
    if (/(^|\.)bing\.com$/i.test(host)) {
      const reject = page.getByRole("link", { name: /^Reject$/i }).first();
      if (await reject.isVisible()) await reject.click({ timeout: 8_000 });
    }
  }

  private async dismissYouTubeConsent(page: Page): Promise<void> {
    const reject = page.getByRole("button", { name: /^(?:Reject all|Reject the use of cookies|Decline all|No thanks)/i }).first();
    try { await reject.waitFor({ state: "visible", timeout: 2_500 }); }
    catch {
      if (await page.getByText("Before you continue to YouTube").first().isVisible()) {
        throw new Error("YouTube opened a consent dialog that needs your attention.");
      }
      return;
    }
    await reject.click({ timeout: 8_000 });
    await reject.waitFor({ state: "hidden", timeout: 8_000 });
  }
}

function isSearchResultsPage(url: string, query: string): boolean {
  try {
    const page = new URL(url);
    return /(^|\.)(?:google|bing)\.com$/i.test(page.hostname)
      && page.pathname === "/search"
      && page.searchParams.get("q")?.toLowerCase() === query.toLowerCase();
  } catch { return false; }
}
