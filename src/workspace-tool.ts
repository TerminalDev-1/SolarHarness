import { spawn, type ChildProcess } from "node:child_process";

export type WorkspaceCommandInput = { action: "run" | "start"; command: string };
export type WorkspaceCommandResult = { command: string; exitCode?: number | null; stdout?: string; stderr?: string; pid?: number; started?: boolean };

const OUTPUT_LIMIT = 32_000;
const TIMEOUT_MS = 120_000;

/** Host commands run in the active workspace; started servers remain alive until reset. */
export class SolarWorkspaceTool {
  private readonly servers = new Set<ChildProcess>();

  constructor(private cwd: string) {}

  setWorkspace(cwd: string): void { this.cwd = cwd; }

  async execute(input: WorkspaceCommandInput): Promise<WorkspaceCommandResult> {
    if (!input || (input.action !== "run" && input.action !== "start") || typeof input.command !== "string" || !input.command.trim()) {
      throw new Error("workspace_command requires action run or start and a nonempty command.");
    }
    if (input.action === "start") return this.start(input.command);
    return runWorkspaceCommand(this.cwd, input);
  }

  async close(): Promise<void> {
    const running = [...this.servers];
    this.servers.clear();
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

function spawnShell(cwd: string, command: string, stdio: ["ignore", "ignore" | "pipe", "ignore" | "pipe"], detached: boolean): ChildProcess {
  return process.platform === "win32"
    ? spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { cwd, shell: false, stdio, detached: false, windowsHide: true })
    : spawn("/bin/sh", ["-lc", command], { cwd, shell: false, stdio, detached });
}
