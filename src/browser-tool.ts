import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

export type BrowserInput = {
  action: "open" | "snapshot" | "screenshot" | "click" | "fill" | "press" | "scroll" | "back" | "forward" | "close";
  url?: string;
  selector?: string;
  value?: string;
  key?: string;
  direction?: "up" | "down";
  fullPage?: boolean;
};

export type BrowserResult = { url: string; title: string; snapshot: string; screenshotPath?: string };

/** One isolated, non-persistent Chromium context for the coordinator session. */
export class CoordinatorBrowser {
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
      return this.describe(page);
    }
    if (!this.active || !this.page) throw new Error("Open a page before using the browser.");
    const page = this.page;
    switch (input.action) {
      case "snapshot": break;
      case "screenshot": {
        const directory = join(this.workspace, ".solarharness", "screenshots");
        await mkdir(directory, { recursive: true });
        const screenshotPath = join(directory, `browser-${Date.now()}-${randomUUID().slice(0, 8)}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: input.fullPage ?? true });
        return { ...await this.describe(page), screenshotPath };
      }
      case "click":
        if (!input.selector) throw new Error("click requires a selector.");
        await page.locator(input.selector).click({ timeout: 10_000 });
        break;
      case "fill":
        if (!input.selector || typeof input.value !== "string") throw new Error("fill requires a selector and value.");
        await page.locator(input.selector).fill(input.value, { timeout: 10_000 });
        break;
      case "press":
        if (!input.key) throw new Error("press requires a key.");
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
    const attempts = [
      { name: "bundled Chromium", options: { headless: true } },
      { name: "Microsoft Edge", options: { headless: true, channel: "msedge" as const } },
      { name: "Google Chrome", options: { headless: true, channel: "chrome" as const } }
    ];
    const failures: string[] = [];
    for (const attempt of attempts) {
      try {
        this.browser = await chromium.launch(attempt.options);
        break;
      } catch (error) {
        failures.push(`${attempt.name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      }
    }
    if (!this.browser) throw new Error(`No Chromium-compatible browser could launch. Run "npx playwright install chromium". ${failures.join("; ")}`);
    this.context = await this.browser.newContext({ acceptDownloads: false });
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
}
