# Solar Harness agent architecture

## Roles

- Solar is the main coordinator. It owns conversation continuity, clarification,
  planning, delegation approval, worker orchestration, and report synthesis.
- Sub-agents are implementation workers. They inspect the workspace, edit files,
  run commands, validate changes, and report results to Solar.

## Non-negotiable boundary

Never let the main coordinator do the actual work. The main coordinator must
delegate implementation to sub-agents; only sub-agents perform implementation.
The coordinator remains read-only and must not edit files, run implementation
commands, or bypass delegation approval.

## Runtime behavior

- The coordinator retains one Codex session across turns and worker synthesis.
- Solar creates and runs inside the project `test` workspace by default.
- `/new` asks for confirmation with No selected by default. Only selecting Yes
  and pressing Enter discards the coordinator session and transcript, creates
  the test workspace if needed, clears prior worker records, and activates it for
  the fresh session.
- Up to eight sub-agents may run concurrently.
- `spawn_sub_agent` launches an implementation worker.
- `orchestrate` lists, cancels, resumes, or supplies context to workers.
- `adjust-sub-effort-level` changes one existing sub-agent's next-exchange effort
  to Light, Medium, High, XHigh, or Max.
- All proposed worker tasks require user approval before launch.

## Model defaults

The default is GPT-5.6 Luna with Light reasoning. Light is translated to the
Codex CLI's `low` reasoning setting.
