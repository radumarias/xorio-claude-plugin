# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Claude Code plugin (`xorio`) providing development workflows: test generation, code cleanup, polishing, review, security auditing, and commit message creation. Supports Rust, TypeScript, and Python projects, with framework-specific standards for egui, React, Vue.js, Three.js, SparkJS, Docker, and AWS.

## Plugin Architecture

```
.claude-plugin/plugin.json       ← plugin manifest (name, version, metadata)
.claude-plugin/marketplace.json  ← single-plugin marketplace manifest (repo self-installs via /plugin marketplace add)
agents/                          ← autonomous subagents (launched via Task tool)
commands/                        ← slash commands (/xorio:tests, /xorio:polish, etc.)
hooks/                           ← hooks.json (SessionStart context injection + PreToolUse secret-file guard) + block-secret-file-reads.mjs
rules/                           ← injected context: design principles (planning.md), tool usage guide (tools.md)
skills/                          ← skill workflows (SKILL.md + references/ for standards)
```

The repo doubles as a single-plugin marketplace: `marketplace.json` lets users `/plugin marketplace add radumarias/xorio-claude-plugin` then `/plugin install xorio@xorio`. For local development use `--plugin-dir` instead (see [Installation for Development](#installation-for-development)).

### Component Relationships

The `/xorio:tests` command is the primary workflow entry point. It orchestrates:
1. Language/framework detection from file extensions and dependency files
2. Loading matching standards from `skills/tests/references/test-standards-{lang}.md`
3. Launching `test-analyzer` agent (analysis only, no writes)
4. Optionally launching `test-docs-advisor` agent in parallel (read-only)
5. User selects which gaps to fill
6. Launching `test-generator` agent(s) (one per language, writes tests)

The `/xorio:polish` command chains (`skills/polish/SKILL.md`): `pr-review-toolkit:code-simplifier` → `cleanup-code` skill → `pr-review-toolkit:code-reviewer` → `xorio:security-auditor` → `superpowers:code-reviewer` (standards validation) → language validation → `claude-md-management:revise-claude-md`. Can run autonomously via `--auto` flag (uses `ralph-wiggum:ralph-loop`, default 3 iterations).

The `/xorio:review` command chains (`skills/review/SKILL.md`): `superpowers:code-reviewer` (standards validation) → `pr-review-toolkit:review-pr` → built-in `/code-review max` (Claude Code's built-in command, run at max effort on the local diff) → `pr-review-toolkit:code-simplifier` → `claude-md-management:revise-claude-md`. The `review-pr` step STOPs to let the user choose which findings to fix before any are applied, so this pipeline cannot be automated with ralph-wiggum.

Use `/xorio:guide` for an interactive walkthrough of available workflows with context-aware recommendations.

Use `/xorio:check-deps` to verify all required external plugins and MCP servers are installed.

Standalone commands (not part of larger pipelines):
- `/xorio:commit-message` — generates a git commit message from staged + unstaged changes
- `/xorio:mallware-check` — recursive malware/obfuscation/prompt-injection scan of cwd
- `/xorio:root-cause` — evidence-grounded 5 Whys root cause analysis (grounds each causal link in git/grep/repro evidence; `--deep` adds a multi-agent causal-tree investigation via the Workflow tool)
- `/xorio:review-pr` — ultracode multi-agent PR review (multi-lens findings, adversarial validation, verified fixes, looped to convergence); the opt-in `--fable` flag runs the best-model (STRONG-tier) agents on Fable at max effort — the surgical middle ground between the default (mixed tiers) and `review-pr-mythos` (all-Fable)
- `/xorio:review-pr-mythos` — all-Fable variant of `review-pr` (every agent on Fable with max thinking)

Standalone skills (directly invocable, not orchestrated by a command):
- `brainstorm` / `brainstorm-mythos` — multi-agent ideation fan-out via the Workflow tool; the orchestration script is `workflow.js` next to each SKILL.md, launched via `scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/{name}/workflow.js"`. `brainstorm` mixes model tiers (the opt-in `--fable` flag pins the STRONG tier to Fable at max effort — the best-model agents only, cheaper than all-Fable); `brainstorm-mythos` runs every agent on Fable with max thinking. Both `--fable` flags (here and on `review-pr`) mirror the `team-forming` `--fable` logic: upgrade only the strongest-tier agents to Fable, leaving cheaper tiers untouched.
- `review-loop` — multi-round audit loop (simplify → parallel finders → adversarial verify → fix → repeat until dry), also Workflow-driven with its own `workflow.js`
- `generate-tests-coverage` / `generate-tests-module` — test generation entry points that reuse the `test-analyzer`/`test-generator`/`test-docs-advisor` agents and load standards from `skills/tests/references/`
- `team-forming` — composes and spawns an agent team for one task-group. A MAX-tier architect/planner (latest Opus + ultrathink today) runs first to design the work and recommend the team composition, then stays on as a standing advisor that teammates consult (its design doc is also persisted to `~/.claude/teams-state/` so clarification survives the architect); an independent MAX-tier reviewer then gates the plan (a default-on Adversarial Plan-Review Gate) before the team forms; the cascade then derives any remaining roles, builds disposition-based prompts, and spawns via `TeamCreate`/`Agent`. The verification roles — a `code-reviewer` (static) and a `qa-tester` (behavioural, included when the deliverable is runnable), split so each lens gets full attention — are likewise pinned to MAX. The top tier is defined once in the skill's **Model tiers** table and resolves to the most capable model available (`opus` today), so no edit is needed when a stronger model ships; MAX roles spawn at `effort="max"`, and the opt-in `--fable` flag resolves the top tier to `fable` (instead of `opus`) for the best-model roles (architect, plan-reviewer, code-reviewer, qa-tester). State lives under `~/.claude/teams-state/` (independent of plugin location). Trigger phrases: "form team", "create team", "compose team".

### Agent Design Conventions

- Agents use YAML frontmatter: `name`, `description`, `color`, `model`, `tools`. Auto-discoverable agents include `<example>` tags in their description; internal pipeline agents use a "Do NOT invoke directly" description instead.
- Analysis agents (test-analyzer, test-docs-advisor, security-auditor) are read-only — they never write files
- Generator agents (test-generator) can read, write, edit, and run validation commands
- Agent `model` choices: `opus` for security auditing (security-auditor), `sonnet` for analysis/generation (test-analyzer, test-generator), `haiku` for lighter tasks (test-docs-advisor)

### Skill Design Conventions (per Anthropic's Complete Guide to Building Skills)

Skills follow the progressive disclosure pattern (3 levels):
1. **First level (frontmatter):** Always in Claude's system prompt. Description must include WHAT + WHEN (trigger phrases) + KEY CAPABILITIES. Under 1024 chars, no XML tags.
2. **Second level (SKILL.md body):** Loaded when Claude thinks the skill is relevant. Core workflow instructions.
3. **Third level (references/):** Supporting files loaded only as needed. Standards, templates, detailed docs.

Conventions:
- Every skill is automatically user-invocable as `/xorio:{name}` (commands and skills are unified in Claude Code; no command file is needed to expose a skill). `argument-hint` drives the autocomplete hint. `disable-model-invocation: true` makes a skill slash-only (Claude won't auto-trigger it); on a command/skill name collision the skill takes precedence.
- Each skill lives in `skills/{name}/SKILL.md` with a `references/` subdirectory for supporting docs
- Skills use YAML frontmatter: `name` (kebab-case, must match folder name), `description`, `argument-hint`, `metadata`
- Description formula: `[What it does] + [When to use it with trigger phrases] + [Key capabilities]`
- Language-specific standards go in `references/` (e.g., `skills/tests/references/test-standards-rust.md`)
- Skills detect languages from file extensions and dependency files, then load only matching standards
- Include a `## Troubleshooting` section for common failure modes

### Command Design Conventions

- Commands use YAML frontmatter: `description`, `argument-hint`, `allowed-tools`
- Commands parse `$ARGUMENTS` for flags and paths
- Commands delegate to skills/agents — they are thin orchestration layers
- `${CLAUDE_PLUGIN_ROOT}` references the plugin root directory in file paths

### Hook Design

`hooks.json` registers two hooks:

- `SessionStart` — injects `rules/planning.md` and `rules/tools.md` into every session, establishing design principles (SOLID, KISS, DRY, YAGNI, CoC, LoD) and tool usage guidance.
- `PreToolUse(Bash|Read)` — runs `hooks/block-secret-file-reads.mjs` (invoked as `node ${CLAUDE_PLUGIN_ROOT}/hooks/...`), a deny-only guard for reading secret / private-data files (`.env`, `.secrets`, key/cert files, `id_rsa*`, `credentials`, `.pgpass`, `.netrc`). It covers **both** vectors with one script: the *shell* vector (Bash — inspects `tool_input.command`, with quoted segments stripped so a mere mention isn't tripped) and the *tool* vector (Read — inspects `tool_input.file_path`). It emits a `deny` decision only on a bare protected-file reference; `*.example` templates stay allowed. Stdlib-only Node, no config, never reads file contents.

  On a personal machine the Read vector is normally handled by a declarative `permissions.deny` in `~/.claude/settings.json`, but **a plugin cannot ship permission rules** — a plugin's `settings.json` only honors `agent` / `subagentStatusLine`, and a `permissions` key is silently ignored. Hence the hook covers Read directly so plugin consumers inherit the protection. This script is a (superset) copy of the maintainer's personal `~/.claude/hooks/` guard; both fire harmlessly if a user already runs their own. Caveat: matching is by filename, so a source file named like a secret (e.g. `credentials.ts`) is also denied — consistent with the Bash behavior; narrow `RULES` if needed.

## Development Workflow

To test changes, edit files directly and restart your Claude Code session. No build step required.

### Adding a New Test Standard

1. Create `skills/tests/references/test-standards-{name}.md`
2. Add detection logic in `skills/tests/SKILL.md` (Step 1) and `commands/tests.md` (Step 1)

### Adding a New Cleanup Standard

1. Create `skills/cleanup-code/references/standards-{name}.md`
2. Add detection logic in `skills/cleanup-code/SKILL.md` (Step 1)

### Installation for Development

Load the plugin live from the working tree — nothing is copied into `~/.claude`:

```bash
claude --plugin-dir /path/to/xorio-claude-plugin
```

`--plugin-dir` accepts a single plugin directory (or `.zip`) and may be repeated for multiple plugins. Edits are picked up as follows:

| Component | Reload to apply edits |
|-----------|-----------------------|
| Skills (`SKILL.md`) | immediate (hot-reloaded) |
| Commands, agents | `/reload-plugins` |
| Hooks (`hooks.json`), MCP/LSP config | `/reload-plugins` or session restart |

Do **not** use `/plugin marketplace add <local-path>` for development — installing from a local marketplace caches the plugin under `~/.claude/plugins/`, so source edits are not reflected. That path is for testing distribution only.

## External Dependencies

This plugin depends on other plugins and MCP servers. Run `/xorio:check-deps` to verify.

**Required plugins:** `pr-review-toolkit`, `ralph-wiggum`, `security-guidance`
**Required MCP servers:** `context7`, `ast-grep`, `serena`
**Recommended plugins:** `feature-dev`, `frontend-design`, `superpowers`, `commit-commands`, `claude-md-management`
**Recommended MCP servers:** `memory`, `claude-in-chrome`
**For Rust projects:** `rust-analyzer-lsp` plugin (provides compile-time diagnostics)

For code analysis, prefer `ast-grep` for structural pattern matching first, then `serena` for symbol-level navigation and relationship mapping.

## Validation Commands by Language

These are the standard validation commands used across all workflows (polish, cleanup, test generation):

- **Rust:** `cargo fmt --all && cargo clippy --all-targets --all-features && cargo test`
- **TypeScript:** `npx biome check --write . && npx tsc --noEmit && npm test`
- **Python:** `ruff check --fix . && ruff format . && mypy . && pytest`
