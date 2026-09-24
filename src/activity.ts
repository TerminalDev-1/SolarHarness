/** Short, truthful status copy for the main agent's current action. */
export function actionStatus(phase: "thinking" | "browsing" | "command", detail: string): string {
  return detail.charAt(0).toUpperCase() + detail.slice(1);
}

export function initialActivity(request: string): string {
  if (/\bclose\s+(?:the\s+)?browser\b/i.test(request)) return "closing the browser";
  if (/\byoutube\b/i.test(request)) return "opening YouTube";
  if (/\b(?:search\s+(?:google|bing|the\s+web)|look\s+up|research)\b/i.test(request)) return "searching the web";
  const url = request.match(/https?:\/\/[^\s]+/i)?.[0];
  if (url) {
    try { return `opening ${new URL(url).hostname}`; } catch { /* Use the request below. */ }
  }
  const file = mentionedFile(request);
  if (file) return `working on ${file}`;
  return "working on your request";
}

function mentionedFile(value: string): string | undefined {
  const match = value.match(/(?:^|[\s"'`(])(?:[\w.-]+[\\/])*([\w.-]+\.(?:html?|css|jsx?|tsx?|json|md|py|rs|go|java|vue|svelte|ya?ml))(?:$|[\s"'`),:;!?])/i);
  return match?.[1];
}

export function activityDetail(event: string): string | undefined {
  const headlessSearch = event.match(/^Web search: searching for (.+)$/i);
  if (headlessSearch) return `searching the web for ${headlessSearch[1]}`;
  const sourceRead = event.match(/^Web search: reading (.+)$/i);
  if (sourceRead) return `reading ${sourceRead[1]}`;
  const search = event.match(/^Browser: searching YouTube for (.+)$/i);
  if (search) return `searching YouTube for ${search[1]}`;
  const visibleSearch = event.match(/^Browser: search (.+)$/i);
  if (visibleSearch) return `searching in the browser for ${visibleSearch[1]}`;
  const open = event.match(/^Browser: open (\S+)/i);
  if (open) {
    try {
      const hostname = new URL(open[1]).hostname;
      return `opening ${/(^|\.)youtube\.com$/i.test(hostname) ? "YouTube" : hostname}`;
    } catch { return "opening the browser"; }
  }
  const move = event.match(/^Browser: move (\d+),(\d+)/i);
  if (move) return `moving Solar's cursor to ${move[1]}, ${move[2]}`;
  const press = event.match(/^Browser: press (.+)$/i);
  if (press) return `pressing ${press[1]} in the browser`;
  const browserAction = event.match(/^Browser: (.+)$/i);
  if (browserAction) {
    const action = browserAction[1].split(" ")[0];
    return ({ snapshot: "reading the page", screenshot: "capturing the page", click: "clicking in the browser", fill: "entering text in the browser", scroll: "scrolling the page", back: "going back", forward: "going forward", close: "closing the browser" } as Record<string, string>)[action]
      ?? `${action.replace(/_/g, " ")} in the browser`;
  }
  const command = event.match(/^Running command: (.+)$/i);
  if (command) {
    const file = mentionedFile(command[1]);
    return file ? `working on ${file}` : "running a command";
  }
  if (event.startsWith("Command completed:")) return "checking command output";
  if (event.startsWith("Designing a named sub-agent plan")) return "drafting the sub-agent plan";
  if (event.startsWith("Synthesizing sub-agent reports")) return "reviewing sub-agent reports";
  return undefined;
}
