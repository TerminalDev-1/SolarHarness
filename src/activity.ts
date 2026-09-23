/** Short, truthful status copy for the main agent's current action. */
export function actionStatus(phase: "thinking" | "browsing" | "command", detail: string): string {
  return `${phase === "command" ? "Working" : "Thinking"} — ${detail}`;
}

export function initialActivity(request: string): string {
  if (/\bclose\s+(?:the\s+)?browser\b/i.test(request)) return "closing the browser";
  if (/\byoutube\b/i.test(request)) return "opening YouTube";
  if (/\b(?:search\s+(?:google|bing|the\s+web)|look\s+up|research)\b/i.test(request)) return "searching the web";
  const url = request.match(/https?:\/\/[^\s]+/i)?.[0];
  if (url) {
    try { return `opening ${new URL(url).hostname}`; } catch { /* Use the request below. */ }
  }
  return `working on ${request.replace(/\s+/g, " ").trim().slice(0, 72)}`;
}

export function activityDetail(event: string): string | undefined {
  const headlessSearch = event.match(/^Web search: searching for (.+)$/i);
  if (headlessSearch) return `searching the web for ${headlessSearch[1]}`;
  const sourceRead = event.match(/^Web search: reading (.+)$/i);
  if (sourceRead) return `reading ${sourceRead[1]}`;
  const search = event.match(/^Browser: searching YouTube for (.+)$/i);
  if (search) return `searching YouTube for ${search[1]}`;
  const open = event.match(/^Browser: open (\S+)/i);
  if (open) {
    try {
      const hostname = new URL(open[1]).hostname;
      return `opening ${/(^|\.)youtube\.com$/i.test(hostname) ? "YouTube" : hostname}`;
    } catch { return "opening the browser"; }
  }
  const browserAction = event.match(/^Browser: (.+)$/i);
  if (browserAction) {
    const action = browserAction[1].split(" ")[0];
    return ({ snapshot: "reading the page", screenshot: "capturing the page", click: "clicking in the browser", fill: "entering text in the browser", press: "pressing a key in the browser", scroll: "scrolling the page", back: "going back", forward: "going forward", close: "closing the browser" } as Record<string, string>)[action]
      ?? `${action.replace(/_/g, " ")} in the browser`;
  }
  const command = event.match(/^Running command: (.+)$/i);
  if (command) return `running ${command[1].slice(0, 70)}`;
  if (event.startsWith("Command completed:")) return "checking command output";
  if (event.startsWith("Designing a named sub-agent plan")) return "drafting the sub-agent plan";
  if (event.startsWith("Synthesizing sub-agent reports")) return "reviewing sub-agent reports";
  return undefined;
}
