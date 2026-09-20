# SolarHarness

> **Preview:** SolarHarness is under active development. Its interfaces, behavior,
> and safety boundaries may change before a stable release.

**Born in public:** SolarHarness was started and first published on 20 September 2026.

SolarHarness is a terminal-native agent capable of separate delegation. Solar acts
as a read-only coordinator: it clarifies the requested outcome, creates a parallel
worker plan, and waits for approval. Accepted tasks run through isolated,
workspace-write Codex workers, while rejected tasks never launch.

## Features

- Natural-language coordination without a manual delegation command
- Reviewable worker plans with per-task accept or reject controls
- Up to three independently scoped workers
- Read-only coordinator and workspace-write worker separation
- Live worker activity, elapsed time, and synthesized completion reports
- Terminal UI built with Ink and React
- Isolated `test` workspace for delegation and file-access experiments

## Requirements

- Node.js 20 or newer
- An authenticated `codex` executable available on `PATH`

## Install and run

```powershell
npm install
npm run build
npm run start -- chat
```

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

## Architecture

SolarHarness invokes `codex exec --json` and consumes its JSONL event stream. The
coordinator runs read-only with Codex's nested multi-agent tools disabled. Only
workers created by the harness receive workspace-write access. This prevents the
coordinator from bypassing the plan-approval boundary.

Runtime tools are registered through `ToolRegistry`. `spawn_sub_agent` creates a
worker, while `orchestrate` inspects, cancels, updates, or resumes one. Solar watches
those workers and synthesizes their reports without performing implementation work
itself.

## Preview status

SolarHarness is not a stable release yet. Use it in disposable or version-controlled
workspaces, review proposed worker tasks carefully, and inspect changes before
committing them.
