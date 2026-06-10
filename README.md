# xorio-claude-plugin

> [!WARNING]
> **Under development — do not install or use this plugin yet.** Structure, commands, and skills are still changing and may be broken at any time. Wait for a tagged release.

A Claude Code plugin providing end-to-end development workflows: test generation, code cleanup, polish-before-PR, multi-agent review, security auditing, malware scanning, commit messages, and root-cause analysis.

Supports **Rust**, **TypeScript**, and **Python**, with framework-specific standards for **egui**, **React**, **Vue.js**, **Three.js**, **SparkJS**, **Docker**, and **AWS**.

## Commands

| Command | Purpose |
|---------|---------|
| `/xorio:guide` | Interactive walkthrough — detects context and recommends a workflow |
| `/xorio:tests` | Analyze coverage gaps and generate idiomatic tests |
| `/xorio:polish` | Simplify → clean up → review → security-audit your local changes |
| `/xorio:review` | Multi-agent PR review with code review and simplification passes |
| `/xorio:commit-message` | Generate a Conventional Commits message from staged + unstaged changes (does not commit) |
| `/xorio:mallware-check` | Recursive scan for malware, obfuscation, call-home, prompt injection, plugin threats |
| `/xorio:root-cause` | 5 Whys root-cause analysis for a given problem |
| `/xorio:check-deps` | Verify required external plugins and MCP servers are installed |
| `/xorio:review-pr` | Ultracode multi-agent PR review — multi-lens findings, adversarial validation, verified fixes, looped to convergence |
| `/xorio:review-pr-mythos` | All-Fable variant of `review-pr` — every agent on Fable with max thinking |

## Workflows in Detail

### `/xorio:tests` — generate tests

```
/xorio:tests                    # diff scope (changed files)
/xorio:tests src/auth           # module scope (a path)
/xorio:tests --project          # full-project scan
/xorio:tests --no-docs          # skip doc review (combine with any scope)
```

1. Detect language and frameworks from files in scope
2. Load matching standards (Rust / TS / Python / egui / React / Vue / Three / SparkJS / Docker / AWS)
3. Analyze coverage gaps and anti-patterns in existing tests
4. Optionally review docs for test-infrastructure gaps
5. Ask which gaps to fill
6. Generate tests following project conventions
7. Run validation (`cargo test`, `npm test`, `pytest`, …)

### `/xorio:polish` — prepare changes for PR

```
/xorio:polish                          # interactive
/xorio:polish --auto                   # autonomous via ralph-wiggum loop
/xorio:polish --auto --max-iterations 5
```

Pipeline: `code-simplifier` → `cleanup-code` → `code-reviewer` → `security-auditor` → validation. Auto mode iterates until all checks pass clean (default 3 iterations).

### `/xorio:review` — multi-agent code review

Pipeline: `pr-review-toolkit:review-pr` → `code-review:code-review` → `pr-review-toolkit:code-simplifier`. Presents findings; you choose what to fix. (Cannot be auto-looped — requires user selection.)

### `/xorio:commit-message`

Reads staged + unstaged diff and current branch, drafts a Conventional Commits message (`feat:`, `fix:`, etc.). Never stages or commits — message only.

### `/xorio:mallware-check`

Dispatches three STRONG-tier agents (the most capable Claude model available, resolved at runtime) in parallel to scan the cwd for malicious code, obfuscation, call-home behavior, prompt-injection payloads, and Claude Code plugin threats. Returns a consolidated risk report.

### `/xorio:root-cause "<problem>"`

Runs the 5 Whys technique iteratively, recording findings in `RCA-{date}.md` (or appending to existing `RCA.md`). Stops at root cause without entering solution mode.

## Components

**Skills** (auto-trigger, invoked by commands, or invoked directly as `/xorio:<skill-name>`)
- `tests` — coverage-gap analysis and test generation
- `polish` — full pre-PR pipeline
- `review` — multi-agent review pipeline
- `cleanup-code` — DRY / Law-of-Demeter / YAGNI refactoring (used inside `polish`)
- `brainstorm` — multi-agent ideation fan-out (ideate across lenses → adversarially refute → debate → synthesize a ranked report), mixed model tiers
- `brainstorm-mythos` — all-Fable variant of `brainstorm` (every agent on Fable with max thinking)
- `review-loop` — multi-round audit loop: simplify → parallel finders → adversarial verify → apply verified fixes → repeat until dry
- `generate-tests-coverage` — full-project coverage-gap scan and test generation (uses `skills/tests/references/` standards)
- `generate-tests-module` — targeted test generation for a specific module or path

**Agents**
- `security-auditor` — OWASP Top-10 scanner (read-only, Opus)
- `test-analyzer` — coverage gap mapper (internal to `/xorio:tests`)
- `test-generator` — idiomatic test writer (internal to `/xorio:tests`)
- `test-docs-advisor` — doc review for test infrastructure (internal to `/xorio:tests`)

**Hooks**
- `SessionStart` — injects `rules/planning.md` (SOLID, KISS, DRY, YAGNI, CoC, LoD) and `rules/tools.md` (tool-usage guidance) into every session

## Installation

```bash
git clone git@github.com:radumarias/xorio-claude-plugin.git
claude --plugin-dir /path/to/xorio-claude-plugin
```

Or add to `~/.claude/settings.json` (user-wide) or project `.claude/settings.json`:

```json
{ "plugins": ["/path/to/xorio-claude-plugin"] }
```

After installation, run `/xorio:check-deps` to verify required external plugins and MCP servers.

## External Dependencies

**Required plugins:** `pr-review-toolkit`, `code-review`, `ralph-wiggum`, `security-guidance`
**Required MCP servers:** `context7`, `ast-grep`, `serena`
**Recommended plugins:** `feature-dev`, `frontend-design`, `superpowers`, `commit-commands`, `claude-md-management`
**Recommended MCP servers:** `memory`, `claude-in-chrome`
**For Rust projects:** `rust-analyzer-lsp`

## Validation Commands

Standard per-language commands used by polish / cleanup / test workflows:

- **Rust:** `cargo fmt --all && cargo clippy --all-targets --all-features && cargo test`
- **TypeScript:** `npx biome check --write . && npx tsc --noEmit && npm test`
- **Python:** `ruff check --fix . && ruff format . && mypy . && pytest`

## Extending the Plugin

Edit files directly and restart your Claude Code session — no build step.

- **Add a test standard:** create `skills/tests/references/test-standards-{name}.md` and add detection logic in `skills/tests/SKILL.md` and `commands/tests.md`
- **Add a cleanup standard:** create `skills/cleanup-code/references/standards-{name}.md` and add detection logic in `skills/cleanup-code/SKILL.md`
- **Tune agent behavior:** edit the matching file in `agents/`
- **Add anti-pattern checks:** extend Step 3.5 in `agents/test-analyzer.md`

See `CLAUDE.md` for architecture, design conventions, and component-relationship details.

## License

MIT
