import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export type BrowserInput = {
  action: "open" | "snapshot" | "click" | "fill" | "press" | "scroll" | "back" | "forward" | "close";
  url?: string;
  selector?: string;
  value?: string;
  key?: string;
  direction?: "up" | "down";
};

export type BrowserResult = { url: string; title: string; snapshot: string };

/** One isolated, non-persistent Chromium context for the coordinator session. */
export class CoordinatorBrowser {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;

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
    try {
      this.browser = await chromium.launch({ headless: true });
    } catch (error) {
      throw new Error(`Unable to launch Chromium. Run "npx playwright install chromium" first. ${error instanceof Error ? error.message : String(error)}`);
    }
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
