# SolarHarness

> **Preview:** SolarHarness is under active development. Its interfaces, behavior,
> and safety boundaries may change before a stable release.

**First committed:** 20 September 2026.

SolarHarness is a terminal-native agent capable of separate delegation. Solar acts
as a read-only coordinator: it clarifies the requested outcome, creates a parallel
worker plan, and waits for approval. Accepted tasks run through isolated,
workspace-write Codex workers, while rejected tasks never launch.

## Features

- Natural-language coordination without a manual delegation command
- Reviewable worker plans with per-task accept or reject controls
- Up to eight independently scoped workers
- Read-only coordinator and workspace-write worker separation
- Live worker activity, elapsed time, and synthesized completion reports
- Terminal UI built with Ink and React
- Persistent coordinator context across chat turns and worker reports
- GPT-5.6 Luna with Light reasoning by default
- Runtime effort selection from Light through Max with `/effort`
- Fresh coordinator sessions with `/new`
- Dark and light terminal themes
- Isolated `test` workspace for delegation and file-access experiments

## Requirements

- Node.js 20 or newer
- An authenticated `codex` executable available on `PATH`

## Install and run

```powershell
npm install
npm run dev
```

`chat` is the default command, so `npm run dev` opens the terminal interface
directly. The explicit production form remains `npm run start -- chat`.

Solar creates and uses the project's `test` directory as its workspace by
default. The active absolute workspace path is always visible in the interface.

For an isolated workspace test:

```powershell
cd test
node ..\dist\index.js chat
```

Describe the outcome naturally. When Solar has enough context, it presents a worker
plan for review:

- `Up` / `Down` selects a proposed task
- `Space` toggles that task between accepted and rejected
- `Enter` launches accepted tasks
- `Esc` rejects the entire plan

Use `/effort` to choose Light, Medium, High, XHigh, or Max with the arrow keys, or
set it directly (for example, `/effort max`). The selected level applies to Solar
and newly launched workers. Existing workers can be changed independently with
`/agent <id> reasoning <level>`. Light is the default.

Use `/new` when you want the next message to start a fresh coordinator session
without any prior conversational context. It opens a confirmation with **No**
selected by default; the reset occurs only after selecting **Yes** and pressing
Enter. The test workspace is created if necessary, and prior worker records are
cleared so stale task context cannot leak into the fresh session.
Use `/theme light` or `/theme dark` to switch the terminal palette.

## Architecture

SolarHarness invokes `codex exec --json` and consumes its JSONL event stream. The
coordinator runs read-only with Codex's nested multi-agent tools disabled. Only
workers created by the harness receive workspace-write access. This prevents the
coordinator from bypassing the plan-approval boundary.

Runtime tools are registered through `ToolRegistry`. `spawn_sub_agent` creates a
worker, while `orchestrate` inspects, cancels, updates, or resumes one. The
`adjust-sub-effort-level` tool lets Solar apply a naturally requested effort change
to a named existing worker. Solar watches workers and synthesizes their reports;
it must never perform implementation work itself.

## Preview status

SolarHarness is not a stable release yet. Use it in disposable or version-controlled
workspaces, review proposed worker tasks carefully, and inspect changes before
committing them.
