# Available Tools & Integrations

Tools, MCP servers, and plugins available in Claude Code sessions.

## Documentation Lookup

**context7** (MCP plugin) — Library documentation for any language/framework.
Tools prefixed `mcp__plugin_context7_context7__*`. Use ToolSearch to load on demand. See MCP server docs for usage details.

Use for:
- Checking current API signatures before implementation
- Verifying deprecated vs. recommended approaches
- Finding usage examples for unfamiliar dependencies
- Comparing API changes between versions

Always consult context7 when working with external dependencies to ensure you're using current, non-deprecated APIs.

## Code Search & Analysis

**ast-grep** (MCP server) — Structural code search using AST patterns.
Tools prefixed `mcp__ast-grep__*`. Use ToolSearch to load on demand.

Unlike text-based Grep, ast-grep understands code structure. It matches on the abstract syntax tree, so it ignores formatting, comments, and irrelevant whitespace differences.

**Key tools:**
- `find_code` — Search for code matching an AST pattern. Use for simple single-node matches (e.g., `console.log($ARG)`, `class $NAME`, `fn $NAME($$$ARGS)`). Meta-variables (`$NAME`) match any single AST node; `$$$` matches multiple nodes.
- `find_code_by_rule` — Search using a YAML rule. More powerful than patterns — supports relational rules like `inside`, `has`, `follows`, `precedes` with `stopBy: end` for full traversal. Use for complex queries like "find all `unwrap()` calls inside async functions".
- `dump_syntax_tree` — Inspect the concrete syntax tree of a code snippet. Use this to debug patterns that aren't matching — it shows exact node kinds and structure.

**When to use ast-grep over Grep:**
- Finding specific function call patterns regardless of formatting (e.g., all `.unwrap()` calls)
- Searching for structural patterns like "if blocks without else", "empty catch blocks"
- Matching code with variable names you don't know (using `$VAR` meta-variables)
- Refactoring analysis — finding all instances of a pattern to replace

**When to use Grep instead:**
- Simple text/keyword searches (e.g., "TODO", "FIXME", import names)
- Searching non-code files (config, markdown, logs)
- Searching for string literals or comments specifically

**Pattern tips:**
- `$NAME` matches a single AST node (identifier, expression, etc.)
- `$$$ARGS` matches zero or more nodes (useful for argument lists)
- Patterns must be syntactically valid code in the target language
- Use `dump_syntax_tree` when a pattern doesn't match to understand the actual AST structure

**serena** (MCP plugin) — Semantic code analysis via language server. Use for symbol navigation and relationship mapping when ast-grep patterns aren't sufficient.
Tools prefixed `mcp__plugin_serena_serena__*`. Use ToolSearch to load on demand. See MCP server docs for usage details.

Prefer ast-grep for structural pattern matching first. Use serena when you need:
- Symbol overview of a file or module (`get_symbols_overview`)
- Finding a symbol by name across the codebase (`find_symbol`)
- Finding all references to a symbol (`find_referencing_symbols`)
- Reading or replacing symbol bodies (`replace_symbol_body`, `insert_after_symbol`)
- Renaming symbols across the codebase (`rename_symbol`)

## Cross-Session Knowledge

**memory** (MCP server) — Knowledge graph for persistent cross-session context.
Tools prefixed `mcp__memory__*`. Use ToolSearch to load on demand. See MCP server docs for usage details.

Use for:
- Storing project patterns, architecture decisions, and debugging insights across sessions
- Recording relationships between components, modules, and concepts
- Building up institutional knowledge about the codebase over time

## Language Server Plugins

**rust-analyzer-lsp** — Provides compile-time diagnostics (errors and warnings) on `.rs` files transparently. Must be installed for Rust projects; `/xorio:check-deps` will verify. No explicit invocation needed — diagnostics surface automatically when editing Rust code.

Other LSP plugins (TypeScript, Python, Go, etc.) are available in the plugin marketplace and work the same way: transparent diagnostics without explicit invocation.

## Browser Automation

**claude-in-chrome** (MCP server) — Browser testing and debugging for web projects.
Tools prefixed `mcp__claude-in-chrome__*`. Use ToolSearch to load on demand. See MCP server docs for usage details.

Use for:
- Visual testing and interaction with web UIs
- Reading page content, console logs, and network requests
- Automating browser-based workflows and form interactions
- Taking screenshots and recording GIFs of interactions

## Code Review & Quality

**pr-review-toolkit** — Specialized review agents invoked via the Task tool with these `subagent_type` values:
- `pr-review-toolkit:code-reviewer` — Review code for bugs, style, and adherence to project conventions
- `pr-review-toolkit:code-simplifier` — Identify and reduce unnecessary complexity
- `pr-review-toolkit:comment-analyzer` — Check comments for accuracy and maintainability
- `pr-review-toolkit:pr-test-analyzer` — Review test coverage quality and completeness
- `pr-review-toolkit:silent-failure-hunter` — Find silent failures and inadequate error handling
- `pr-review-toolkit:type-design-analyzer` — Analyze type design for encapsulation and invariants

Also available as a skill: `pr-review-toolkit:review-pr` — runs a comprehensive PR review using multiple agents.

**superpowers:code-reviewer** — Validates changes against the original plan and project coding standards. Invoke via Task tool with `subagent_type: superpowers:code-reviewer`. Use after a major implementation step is complete to ensure adherence to the plan and conventions.

**code-review** (built-in) — Claude Code's built-in `/code-review` reviews the current working diff for correctness bugs plus reuse/simplification/efficiency cleanups. Takes an effort level (`/code-review max` for the broadest coverage); `--fix` applies findings to the working tree, `--comment` posts them as inline PR comments. `/xorio:review` runs it at max effort. (Distinct from the deprecated external `code-review:code-review` plugin, which is no longer a dependency.)

**feature-dev** — Invoke via skill `feature-dev:feature-dev` for guided feature development with codebase analysis.

**security-guidance** — Runs automatically as hooks on file edits. Also used alongside `xorio:security-auditor` for explicit security reviews in polish/review workflows.

## Git & Project Management

**commit-commands** — Git workflow skills:
- `commit-commands:commit` — Create a git commit with proper message formatting
- `commit-commands:commit-push-pr` — Commit, push, and open a PR in one flow
- `commit-commands:clean_gone` — Clean up local branches deleted on remote

Relationship with `xorio:commit-message`: xorio generates the commit message content, commit-commands executes the git operations.

**claude-md-management** — Project documentation maintenance:
- `claude-md-management:revise-claude-md` — Update CLAUDE.md with learnings from the current session
- `claude-md-management:claude-md-improver` — Audit and improve CLAUDE.md quality

Invoked at the end of review/polish workflows to capture convention updates and architectural learnings.

## Workflows

### Build Phase (manual)

User drives these interactive steps — do not automate:
1. `feature-dev:feature-dev` — guided feature development with codebase analysis
2. `frontend-design:frontend-design` — if the feature has a UI component

### Polish — `/xorio:polish`

Runs `pr-review-toolkit:code-simplifier`, `cleanup-code` skill, `pr-review-toolkit:code-reviewer`, `xorio:security-auditor`, `superpowers:code-reviewer`, language validation, and `claude-md-management:revise-claude-md`. Single pass, fully automated.

For iterative polishing, wrap in Ralph Wiggum:
```
/ralph-wiggum:ralph-loop Run the xorio:polish skill workflow on local changes. Fix all findings. --completion-promise 'All polish checks pass clean' --max-iterations 3
```

### Review — `/xorio:review`

Runs `pr-review-toolkit:review-pr` (with user-guided fix selection), built-in `/code-review max`, `pr-review-toolkit:code-simplifier`, `superpowers:code-reviewer`, and `claude-md-management:revise-claude-md`. **Not suitable for Ralph** — requires user interaction after the first step to choose which findings to fix.
