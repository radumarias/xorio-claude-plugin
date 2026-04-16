---
description: "Interactive guide — discover xorio workflows, get recommendations, and start flows"
argument-hint: "[workflow-name]"
allowed-tools: Bash(git diff:*), Bash(git log:*), Bash(git status:*), "Bash(git branch --show-current)", Bash(test -f:*)
---

# Guide Command

Interactive onboarding — detect project context, show available workflows, recommend a starting point, and launch chosen workflow.

## Argument Parsing

Parse `$ARGUMENTS`. If a workflow name is provided, set `DIRECT_MODE` to that workflow name and skip Steps 2-3.

Valid workflow names (also accept common aliases):
- `tests` (aliases: `test`, `testing`)
- `polish` (aliases: `cleanup`, `clean`)
- `polish-auto` (aliases: `auto`, `auto-polish`)
- `review` (aliases: `code-review`)
- `build` (aliases: `feature`, `feature-dev`)
- `commit` (aliases: `commit-message`)
- `root-cause` (aliases: `rca`, `debug`, `5-whys`)
- `deps` (aliases: `check-deps`, `dependencies`)

## Step 1: Context Detection (silent — never print raw output)

Run these commands and store the results internally:

```bash
git diff --stat HEAD
git branch --show-current
test -f Cargo.toml && echo "rust"
test -f package.json && echo "typescript"
test -f pyproject.toml && echo "python"
test -f setup.py && echo "python"
```

Extract:
- `CHANGES_COUNT`: number of changed files (0 if clean)
- `BRANCH`: current branch name
- `LANGUAGES`: list of detected languages
- `ON_MAIN`: true if branch is `main` or `master`

## Step 2: Present Overview (skip if DIRECT_MODE)

Print the overview table and a context-based recommendation.

```
## xorio workflows

| # | Workflow | What it does | Command |
|---|----------|-------------|---------|
| 1 | Test | Analyze coverage gaps, detect anti-patterns, generate idiomatic tests | `/xorio:tests` |
| 2 | Polish | 9-step pipeline: simplify → cleanup → review → security audit → validate | `/xorio:polish` |
| 3 | Polish Auto | Autonomous polish loop — runs until clean or max iterations | `/xorio:polish --auto` |
| 4 | Review | Multi-agent review with user decision point — PR review → code review → simplify | `/xorio:review` |
| 5 | Build | Guided feature development — architecture analysis → implementation blueprint | `feature-dev:feature-dev` |
| 6 | Commit | Generate a conventional commit message from current changes (read-only) | `/xorio:commit-message` |
| 7 | Root Cause | 5 Whys analysis — trace a problem to its root cause | `/xorio:root-cause` |
| 8 | Check Deps | Verify required plugins and MCP servers are installed | `/xorio:check-deps` |
```

Then print a **Recommendation** based on these rules (first match wins):

1. `CHANGES_COUNT` > 0 AND NOT `ON_MAIN` → "You have **{CHANGES_COUNT} changed files** on branch `{BRANCH}`. Recommended: **Polish** (2) to prepare for PR, or **Review** (4) to get feedback first."
2. `CHANGES_COUNT` > 0 AND `ON_MAIN` → "You have **{CHANGES_COUNT} changed files** on `main`. Recommended: **Test** (1) to check coverage, or **Polish** (2) before committing."
3. `CHANGES_COUNT` == 0 AND `LANGUAGES` is not empty → "Clean working tree on `{BRANCH}`. Recommended: **Build** (5) to start a feature, or **Test --project** (1) for a full coverage scan."
4. `CHANGES_COUNT` == 0 AND `LANGUAGES` is empty → "No project files detected. Recommended: **Check Deps** (8) to verify your setup, then **Build** (5) to start."

Also show detected languages: "Detected: **{LANGUAGES}**" (or "No language-specific files detected" if empty).

## Step 3: Ask User (skip if DIRECT_MODE)

Ask:

> Pick a number (1-8), type a workflow name, or describe what you need.

Map the response:
- Numbers 1-8 → corresponding workflow
- Workflow names or aliases (from the list above) → corresponding workflow
- Keywords: "test" → tests, "clean"/"polish"/"prepare"/"pr-ready" → polish, "auto" → polish-auto, "review"/"check" → review, "feature"/"build"/"implement" → build, "commit"/"message" → commit, "why"/"root"/"cause"/"debug" → root-cause, "dep"/"install"/"setup" → deps
- If unclear, ask again with clarification

## Step 4: Explain + Start

Based on the selected workflow, print its full explanation, then ask "Start now?" If confirmed, invoke the corresponding workflow.

---

### If workflow = `tests`

**Test Generation**

Analyzes your code for test coverage gaps and anti-patterns, then generates idiomatic tests.

1. Detect languages and frameworks from your project files
2. Load language-specific test standards (Rust, TypeScript, or Python)
3. Launch the test-analyzer agent to identify coverage gaps and anti-patterns
4. Optionally launch the test-docs-advisor to review testing documentation
5. Present the prioritized gap list — you choose which gaps to fill
6. Launch the test-generator agent to write tests for selected gaps
7. Run validation (format + lint + test) to confirm everything passes

**Scope options:** no args = diff only, `PATH` = specific module, `--project` = full scan, `--no-docs` = skip doc review.

Ask: **Start now?** (also ask which scope if not in direct mode)

If confirmed, invoke the `xorio:tests` skill via the Skill tool (pass any scope arguments the user specified).

---

### If workflow = `polish`

**Polish Pipeline**

A 9-step pipeline that gets your changes PR-ready:

1. Scope check — identify changed files from git diff
2. Code simplification — reduce complexity, improve readability
3. Code cleanup — apply language-specific standards and conventions
4. Code review — catch bugs, logic errors, and quality issues
5. Security audit — scan for vulnerabilities in changed files
6. Standards validation — verify against project coding conventions
7. Final validation — run format + lint + test for your language
8. Update CLAUDE.md — capture any learnings from the process
9. Summary — report everything that was changed and fixed

Ask: **Start now?**

If confirmed, invoke the `xorio:polish` skill via the Skill tool.

---

### If workflow = `polish-auto`

**Autonomous Polish Loop**

Runs the polish pipeline repeatedly until all checks pass clean, or reaches the iteration limit.

1. Starts a ralph-wiggum loop with the polish workflow
2. Each iteration runs the full 9-step pipeline
3. Fixes found in one pass may reveal issues caught in the next
4. Stops when clean or after N iterations (default: 3)

Ask: **How many iterations?** (default: 3)

Then ask: **Start now?**

If confirmed, invoke `ralph-wiggum:ralph-loop` via the Skill tool with prompt:
`Run the xorio:polish skill workflow on local changes. Fix all findings. --completion-promise 'All polish checks pass clean' --max-iterations N`

---

### If workflow = `review`

**Code Review Pipeline**

Multi-agent review with a decision point — you control what gets fixed:

1. Scope check — identify changed files from git diff
2. Standards validation — verify against project coding conventions, fix any issues
3. PR review — comprehensive multi-agent review of all changes
4. **Decision point** — you see all findings and choose which ones to fix
5. Code review — detailed code review pass, fixes all findings
6. Code simplification — reduce complexity in reviewed code
7. Update CLAUDE.md — capture any learnings from the review

Unlike Polish, this workflow pauses at step 4 for your input. Cannot be automated.

Ask: **Start now?**

If confirmed, invoke the `xorio:review` skill via the Skill tool.

---

### If workflow = `build`

**Feature Development**

Guided feature development — understands your codebase before writing code:

1. Describe the feature you want to build
2. Codebase analysis — explores architecture, patterns, and conventions
3. Architecture design — creates an implementation blueprint with specific files
4. Implementation — builds the feature following the blueprint
5. Validation — runs format + lint + test

Ask: **What feature do you want to build?** (capture the description)

Then ask: **Start now?**

If confirmed, invoke the `feature-dev:feature-dev` skill via the Skill tool with the user's feature description.

---

### If workflow = `commit`

**Commit Message Generator**

Generates a conventional commit message from your current changes (read-only — does not stage or commit):

1. Reads git status, diff, and recent commit history
2. Analyzes the nature of changes (feat, fix, refactor, etc.)
3. Drafts a concise commit message following conventional commits format
4. Presents the message for you to use

Ask: **Start now?**

If confirmed, invoke the `xorio:commit-message` command by running it as `/xorio:commit-message`.

---

### If workflow = `root-cause`

**Root Cause Analysis (5 Whys)**

Traces a problem to its root cause using the 5 Whys technique:

1. State the problem clearly
2. Ask "Why did this happen?" and identify the answer
3. For each answer, ask "Why?" again
4. Continue until reaching the root cause (typically 3-7 iterations)
5. Document findings in an RCA file in the project root

Ask: **What problem are you investigating?** (capture the description)

Then ask: **Start now?**

If confirmed, invoke the `xorio:root-cause` skill via the Skill tool with the problem description.

---

### If workflow = `deps`

**Dependency Check**

Verifies that all required external plugins and MCP servers are installed:

1. Checks for required plugins: pr-review-toolkit, code-review, ralph-wiggum, security-guidance
2. Checks for recommended plugins: feature-dev, frontend-design, superpowers, commit-commands, claude-md-management
3. Checks for required MCP servers: context7, ast-grep, serena
4. Checks for recommended MCP servers: memory, claude-in-chrome
5. Reports status table and provides install instructions for anything missing

Ask: **Start now?**

If confirmed, run the `/xorio:check-deps` command.
