import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

export type WorkspaceCommandInput = { action: "run" | "start" | "serve" | "terminal"; command?: string; port?: number };
export type WorkspaceCommandResult = { command?: string; exitCode?: number | null; stdout?: string; stderr?: string; pid?: number; started?: boolean; url?: string; terminal?: boolean };

const OUTPUT_LIMIT = 32_000;
const TIMEOUT_MS = 120_000;

/** Host commands run in the active workspace; started servers remain alive until reset. */
export class SolarWorkspaceTool {
  private readonly servers = new Set<ChildProcess>();
  private readonly staticServers = new Set<Server>();

  constructor(private cwd: string) {}

  setWorkspace(cwd: string): void { this.cwd = cwd; }

  async execute(input: WorkspaceCommandInput): Promise<WorkspaceCommandResult> {
    if (input?.action === "serve") return this.serve(input.port);
    if (!input || !["run", "start", "terminal"].includes(input.action) || typeof input.command !== "string" || !input.command.trim()) {
      throw new Error("workspace_command requires action run, start, or terminal with a nonempty command, or action serve.");
    }
    if (input.action === "start") return this.start(input.command);
    if (input.action === "terminal") return openTerminal(this.cwd, input.command);
    return runWorkspaceCommand(this.cwd, input);
  }

  async close(): Promise<void> {
    const running = [...this.servers];
    this.servers.clear();
    const staticServers = [...this.staticServers];
    this.staticServers.clear();
    await Promise.all(staticServers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    await Promise.all(running.map(async child => {
      if (!child.pid || child.exitCode !== null) return;
      if (process.platform !== "win32") {
        try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill(); }
        return;
      }
      await new Promise<void>(resolve => {
        const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        killer.on("error", () => { child.kill(); resolve(); });
        killer.on("close", () => resolve());
      });
    }));
  }

  private async start(command: string): Promise<WorkspaceCommandResult> {
    const child = spawnShell(this.cwd, command, ["ignore", "ignore", "ignore"], true);
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    this.servers.add(child);
    child.once("exit", () => this.servers.delete(child));
    child.unref();
    return { command, pid: child.pid, started: true };
  }

  private async serve(port = 0): Promise<WorkspaceCommandResult> {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("serve port must be an integer from 0 to 65535.");
    const root = resolve(this.cwd);
    const server = createServer(async (request, response) => {
      try {
        if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405).end(); return; }
        const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
        const path = resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
        const location = relative(root, path);
        if (location === ".." || location.startsWith(`..${sep}`)) { response.writeHead(403).end(); return; }
        if (!(await stat(path)).isFile()) { response.writeHead(404).end(); return; }
        const mime = ({ ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" } as Record<string, string>)[extname(path).toLowerCase()] ?? "application/octet-stream";
        const body = await readFile(path);
        response.writeHead(200, { "content-type": mime, "content-length": body.length });
        response.end(request.method === "HEAD" ? undefined : body);
      } catch { response.writeHead(404).end(); }
    });
    await new Promise<void>((resolveReady, reject) => {
      server.once("error", reject);
      server.listen(port, "localhost", () => { server.off("error", reject); resolveReady(); });
    });
    this.staticServers.add(server);
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Static server did not report a local port.");
    return { started: true, url: `http://localhost:${address.port}/` };
  }
}

/** Run a bounded workspace command and return its output to Solar. */
export async function runWorkspaceCommand(cwd: string, input: WorkspaceCommandInput): Promise<WorkspaceCommandResult> {
  if (!input || input.action !== "run" || typeof input.command !== "string" || !input.command.trim()) {
    throw new Error("workspace_command requires action run and a nonempty command.");
  }
  if (/\b(?:python(?:3)?\s+-m\s+http\.server|npm\s+run\s+dev|npx\s+(?:vite|next)\s+dev|vite\s+--host|next\s+dev)\b/i.test(input.command)) {
    throw new Error("This starts a long-running server. Use workspace_command with action start instead of run.");
  }
  const child = spawnShell(cwd, input.command, ["ignore", "pipe", "pipe"], false);
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => { stdout = (stdout + chunk.toString()).slice(-OUTPUT_LIMIT); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString()).slice(-OUTPUT_LIMIT); });
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`Workspace command timed out after ${TIMEOUT_MS / 1000} seconds.`)); }, TIMEOUT_MS);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", exitCode => { clearTimeout(timer); resolve({ command: input.command, exitCode, stdout, stderr }); });
  });
}

/**
 * Opens a new, visible terminal window running `command` in the workspace and leaves it open.
 * `run` and `start` (and Codex's own shell) run hidden, and a window launched from a hidden process
 * inherits that: Windows Terminal started directly from there stays invisible. Start-Process
 * asks for a normal window explicitly. The window belongs to the user, so reset never closes it.
 */
export async function openTerminal(cwd: string, command: string): Promise<WorkspaceCommandResult> {
  const launch = terminalLaunch(cwd, command);
  const child = spawn(launch.file, launch.args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  if (exitCode !== 0) throw new Error(`Could not open a terminal window: ${stderr.trim() || `exit code ${exitCode}`}`);
  const pid = Number.parseInt(stdout.trim(), 10);
  return { command, started: true, terminal: true, ...(Number.isInteger(pid) ? { pid } : {}) };
}

/** The launcher for a visible terminal on this platform. Exported for tests. */
export function terminalLaunch(cwd: string, command: string, platform: NodeJS.Platform = process.platform): { file: string; args: string[] } {
  if (platform === "win32") {
    // Start-Process joins its arguments without quoting, so the command travels base64-encoded.
    const encoded = Buffer.from(command, "utf16le").toString("base64");
    const script = `(Start-Process -FilePath powershell.exe -WorkingDirectory '${cwd.replace(/'/g, "''")}' -WindowStyle Normal -PassThru -ArgumentList '-NoExit','-EncodedCommand','${encoded}').Id`;
    return { file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", script] };
  }
  const shellQuote = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`;
  if (platform === "darwin") {
    const inner = `cd ${shellQuote(cwd)} && ${command}`.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return { file: "osascript", args: ["-e", `tell application "Terminal" to do script "${inner}"`, "-e", 'tell application "Terminal" to activate'] };
  }
  return { file: "/bin/sh", args: ["-c", `x-terminal-emulator -e sh -c ${shellQuote(`${command}; exec "\${SHELL:-sh}"`)} >/dev/null 2>&1 &`] };
}

function spawnShell(cwd: string, command: string, stdio: ["ignore", "ignore" | "pipe", "ignore" | "pipe"], detached: boolean): ChildProcess {
  return process.platform === "win32"
    ? spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { cwd, shell: false, stdio, detached: false, windowsHide: true })
    : spawn("/bin/sh", ["-lc", command], { cwd, shell: false, stdio, detached });
}
