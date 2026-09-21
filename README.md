# SolarHarness

> **Preview:** SolarHarness is under active development. Its interfaces, behavior,
> and safety boundaries may change before a stable release.

**First committed:** 20 September 2026.

SolarHarness is a terminal-native multi-agent coding workspace. You describe an
outcome to Solar, its read-only coordinator; Solar clarifies the request, proposes
a reviewable delegation plan, and launches only the worker tasks you approve.
Implementation is performed by workspace-write Codex sub-agents, never by the
coordinator itself.

## What it can do

- Turn a natural-language request into an implementation-ready worker plan.
- Run as many as eight independently scoped Codex sub-agents concurrently.
- Create multiple directories and their contents in parallel inside `test`. For
  example, eight approved workers can create `test/agent-1` through
  `test/agent-8` during the same run.
- Let every worker create nested directories and files recursively, run relevant
  commands, validate its own assignment, and return a concise report.
- Keep the coordinator read-only while workers receive workspace-write access.
- Present every proposed worker separately so tasks can be accepted or rejected
  before anything launches.
- Retain coordinator context across user turns, planning, worker execution, and
  final report synthesis.
- Start a genuinely clean session with `/new`, including clearing old worker
  records so stale task context cannot leak into the new session.
- Change Solar's default reasoning effort at runtime from Light through Max.
- Adjust a particular worker's next-exchange effort through a command or a
  natural-language request to Solar.
- Display live worker state, elapsed time, recent activity, and a Claude Code-like
  pulse and shimmer while work is running.
- Switch the whole terminal between dark and light palettes—not only the input
  box—and always display the active workspace.
- Find the native Codex executable installed with the Codex desktop app even when
  its versioned directory is missing from the terminal's `PATH`.

## Workspace and parallel directories

SolarHarness creates and uses the project's `test` directory by default. Its
absolute path appears in the header, and a compact workspace label appears in the
footer. Workers may create separate top-level or nested directories there during
the same delegation run.

For example, a request such as:

```text
Create eight independent agent directories. In each directory, create five test
files and verify their contents.
```

can be split into eight concurrent worker assignments. Each worker can own a
different directory, allowing directory trees to be created at once instead of
sequentially.

Workers are separate Codex sessions but share the same `test` workspace. Give
parallel workers non-overlapping directory or file ownership when possible. Solar
includes shared context in each assignment, and the final response synthesizes
only the workers launched for the current approved plan.

## Requirements

- Node.js 20 or newer.
- An authenticated Codex CLI or Codex desktop installation.

SolarHarness first honors `SOLAR_CODEX_PATH`, then checks `PATH`, the Windows Codex
desktop installation, and the standard global npm installation. If discovery
fails, the displayed error explains how to configure the executable explicitly.

## Install and run

```powershell
npm install
npm run dev
```

`chat` is the default command, so `npm run dev` opens the interface directly.
For a compiled production run:

```powershell
npm run build
npm run start -- chat
```

GPT-5.6 Luna with Light reasoning is the default. These can be overridden at
launch:

```powershell
npm run dev -- chat --model gpt-5.6-luna --reasoning max
```

## Delegation workflow

1. Describe the outcome naturally.
2. Solar keeps talking with you in the same coordinator session and asks a
   question only when a missing answer would materially affect the work.
3. Once the request is actionable, Solar proposes up to eight independent tasks.
4. Review the plan before launch:

   - `Up` / `Down` selects a task.
   - `Space` toggles the selected task between accepted and rejected.
   - `A` accepts every proposed task.
   - `Enter` launches the accepted tasks concurrently.
   - `Esc` rejects the plan without launching workers.

5. Solar displays worker activity and synthesizes the reports when the current
   batch finishes.

## Commands

| Command | Behavior |
| --- | --- |
| `/help` | Shows available interaction controls. |
| `/new` | Opens a safe confirmation for a fresh coordinator session. **No** is selected by default. Only selecting **Yes** and pressing Enter resets context, clears prior workers, and creates or activates `test`. |
| `/effort` | Opens the effort selector: Light, Medium, High, XHigh, or Max. |
| `/effort <level>` | Changes Solar's effort and the default for newly launched workers immediately. |
| `/theme light` | Applies a terminal-wide light foreground and background palette. |
| `/theme dark` | Restores the dark terminal palette. |
| `/agents` | Shows whether workers are currently assigned. |
| `/agent <id> reasoning <level>` | Changes a particular worker's next-exchange effort. |
| `/agent <id> context <message>` | Sends additional context to a worker; a completed worker resumes its existing session. |
| `/delegate` | Manually asks Solar to prepare a plan from the current brief. Natural actionable requests delegate automatically. |
| `/quit` or `/exit` | Closes SolarHarness. |

Solar also has the registered `adjust-sub-effort-level` coordinator tool. This
means you can say something like “set worker-abc123 to max effort” instead of
typing the explicit `/agent` form. The harness validates the worker ID and effort
before applying the adjustment.

## Session and workspace safety

- The coordinator runs through Codex's read-only sandbox and cannot implement the
  request, modify files, or bypass plan approval.
- Approved workers run with workspace-write access rooted in the visible `test`
  workspace.
- Rejected tasks never launch.
- `/new` defaults to **No**, so an accidental Enter does not discard context.
- Confirming `/new` aborts active workers, clears their records, resets the
  coordinator transcript and Codex session ID, recursively creates `test` when
  necessary, and starts the next turn there.
- Generated `.solarharness` schemas and `test/agent-*` experiment output are
  excluded from source control.

## Architecture

SolarHarness invokes `codex exec --json` and consumes its JSONL event stream. The
main coordinator session is stored and resumed between conversational turns and
after worker synthesis. Planning uses a constrained JSON schema, and a plan may
contain one to eight independent tasks.

The runtime `ToolRegistry` exposes three main capabilities:

- `spawn_sub_agent` creates an implementation worker.
- `orchestrate` lists, cancels, supplies context to, or resumes a worker.
- `adjust-sub-effort-level` changes one existing worker's next-exchange effort.

Each worker receives its own Codex session and assignment while sharing the test
workspace with its peers. Solar polls their activity, collects only the current
batch's reports, and resumes the persistent coordinator session to produce the
user-facing result.

The architectural rule is deliberately strict: **Solar delegates; sub-agents do
the actual work.** See [`AGENTS.md`](./AGENTS.md) for the role boundary and runtime
contract.

## Preview status

SolarHarness is not stable yet. Use it in disposable or version-controlled
workspaces, review delegation plans carefully, give parallel workers clear file or
directory ownership, and inspect changes before committing them.
