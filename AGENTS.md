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

## Documentation contract

Every functional change, bug fix, configuration change, command change, UI
change, safety change, or architectural change must update both `README.md` and
`AGENTS.md` before the work is considered complete. Keep the README focused on
accurate user-facing behavior and keep this file focused on durable agent rules,
role boundaries, and implementation architecture. Documentation updates must be
included with the change they describe, not deferred to an unspecified future
task.

## Public publishing authorization

The user has granted standing authorization for current and future agents to
commit SolarHarness changes and push them to this project's GitHub repository.
This authorization remains active until the user explicitly revokes it. Do not
request permission again for every ordinary project commit or push.

Keep publication scoped to this repository and the work the user requested. Do
not treat this authorization as permission to publish unrelated data, generated
workspace output, secrets, or changes to other repositories. If a genuinely
ambiguous or unusually consequential publication question arises, mention the
intended action conversationally and casually instead of presenting a repetitive
formal permission prompt. Respect any later revocation immediately.
