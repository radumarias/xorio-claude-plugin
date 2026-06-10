# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A Claude Code plugin (`xorio`) providing development workflows: test generation, code cleanup, polishing, review, security auditing, and commit message creation. Supports Rust, TypeScript, and Python projects, with framework-specific standards for egui, React, Vue.js, Three.js, SparkJS, Docker, and AWS.

## Plugin Architecture

```
.claude-plugin/plugin.json  ← manifest (name, version, metadata)
agents/                     ← autonomous subagents (launched via Task tool)
commands/                   ← slash commands (/xorio:tests, /xorio:polish, etc.)
hooks/hooks.json            ← SessionStart hook that injects rules/planning.md + rules/tools.md
rules/                      ← injected context: design principles (planning.md), tool usage guide (tools.md)
skills/                     ← skill workflows (SKILL.md + references/ for standards)
```

### Component Relationships

The `/xorio:tests` command is the primary workflow entry point. It orchestrates:
1. Language/framework detection from file extensions and dependency files
2. Loading matching standards from `skills/tests/references/test-standards-{lang}.md`
3. Launching `test-analyzer` agent (analysis only, no writes)
4. Optionally launching `test-docs-advisor` agent in parallel (read-only)
5. User selects which gaps to fill
6. Launching `test-generator` agent(s) (one per language, writes tests)

The `/xorio:polish` command chains: `pr-review-toolkit:code-simplifier` → `cleanup-code` skill → `pr-review-toolkit:code-reviewer` → `xorio:security-auditor` → validation. Can run autonomously via `--auto` flag (uses `ralph-wiggum:ralph-loop`).

The `/xorio:review` command chains: `pr-review-toolkit:review-pr` → `code-review:code-review` → `pr-review-toolkit:code-simplifier`. Requires user interaction after step 2 (user chooses which findings to fix), so it cannot be automated with ralph-wiggum.

Use `/xorio:guide` for an interactive walkthrough of available workflows with context-aware recommendations.

Use `/xorio:check-deps` to verify all required external plugins and MCP servers are installed.

Standalone commands (not part of larger pipelines):
- `/xorio:commit-message` — generates a git commit message from staged + unstaged changes
- `/xorio:mallware-check` — recursive malware/obfuscation/prompt-injection scan of cwd
- `/xorio:root-cause` — 5 Whys root cause analysis for a given problem
- `/xorio:review-pr` — ultracode multi-agent PR review (multi-lens findings, adversarial validation, verified fixes, looped to convergence)
- `/xorio:review-pr-mythos` — all-Fable variant of `review-pr` (every agent on Fable with max thinking)

Standalone skills (directly invocable, not orchestrated by a command):
- `brainstorm` / `brainstorm-mythos` — multi-agent ideation fan-out via the Workflow tool; the orchestration script is `workflow.js` next to each SKILL.md, launched via `scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/{name}/workflow.js"`. `brainstorm` mixes model tiers; `brainstorm-mythos` runs every agent on Fable with max thinking.
- `review-loop` — multi-round audit loop (simplify → parallel finders → adversarial verify → fix → repeat until dry), also Workflow-driven with its own `workflow.js`
- `generate-tests-coverage` / `generate-tests-module` — test generation entry points that reuse the `test-analyzer`/`test-generator`/`test-docs-advisor` agents and load standards from `skills/tests/references/`

### Agent Design Conventions

- Agents use YAML frontmatter: `name`, `description`, `color`, `model`, `tools`. Auto-discoverable agents include `<example>` tags in their description; internal pipeline agents use a "Do NOT invoke directly" description instead.
- Analysis agents (test-analyzer, test-docs-advisor, security-auditor) are read-only — they never write files
- Generator agents (test-generator) can read, write, edit, and run validation commands
- Agent `model` choices: `sonnet` for complex analysis/generation, `haiku` for lighter tasks (docs review)

### Skill Design Conventions (per Anthropic's Complete Guide to Building Skills)

Skills follow the progressive disclosure pattern (3 levels):
1. **First level (frontmatter):** Always in Claude's system prompt. Description must include WHAT + WHEN (trigger phrases) + KEY CAPABILITIES. Under 1024 chars, no XML tags.
2. **Second level (SKILL.md body):** Loaded when Claude thinks the skill is relevant. Core workflow instructions.
3. **Third level (references/):** Supporting files loaded only as needed. Standards, templates, detailed docs.

Conventions:
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

`hooks.json` uses a `SessionStart` hook to inject `rules/planning.md` and `rules/tools.md` into every session, establishing design principles (SOLID, KISS, DRY, YAGNI, CoC, LoD) and tool usage guidance.

## Development Workflow

To test changes, edit files directly and restart your Claude Code session. No build step required.

### Adding a New Test Standard

1. Create `skills/tests/references/test-standards-{name}.md`
2. Add detection logic in `skills/tests/SKILL.md` (Step 1) and `commands/tests.md` (Step 1)

### Adding a New Cleanup Standard

1. Create `skills/cleanup-code/references/standards-{name}.md`
2. Add detection logic in `skills/cleanup-code/SKILL.md` (Step 1)

### Installation for Development

```bash
claude --plugin-dir /path/to/xorio-claude-plugin
```

Or add to `~/.claude/settings.json` or project `.claude/settings.json`:
```json
{ "plugins": ["/path/to/xorio-claude-plugin"] }
```

## External Dependencies

This plugin depends on other plugins and MCP servers. Run `/xorio:check-deps` to verify.

**Required plugins:** `pr-review-toolkit`, `code-review`, `ralph-wiggum`, `security-guidance`
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
