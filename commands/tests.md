---
description: "Generate tests — analyzes gaps, detects anti-patterns, generates idiomatic tests"
argument-hint: "[PATH] [--project] [--no-docs]"
---

# Test Command

Generate tests for code in scope. Detects language, analyzes coverage gaps and anti-patterns, then generates idiomatic tests.

## Argument Parsing

Parse `$ARGUMENTS` to determine scope and options:

- **No arguments** → **diff scope**: run `git diff HEAD` to find changed files
- **`--project`** → **project scope**: analyze the entire project for coverage gaps
- **A file or directory path** (anything that isn't a flag) → **module scope**: analyze that path
- **`--no-docs`** → skip the documentation review step (can combine with any scope)

Examples:
- `/xorio:tests` → diff scope
- `/xorio:tests src/auth` → module scope on `src/auth`
- `/xorio:tests --project` → full project scan
- `/xorio:tests src/auth --no-docs` → module scope, skip doc review
- `/xorio:tests --project --no-docs` → full project, skip doc review

## Workflow

### Step 1: Detect Languages

Based on the files in scope, detect languages and frameworks:

**Languages:**
- `.rs` files or `Cargo.toml` present → **Rust**
- `.ts`/`.tsx` files or `package.json` present → **TypeScript**
- `.py` files or `pyproject.toml`/`setup.py` present → **Python**

**Frameworks** (check dependency files):
- `Cargo.toml` contains `egui` → **egui**
- `package.json` contains `react` → **React**
- `package.json` contains `vue` → **Vue.js**
- `package.json` contains `three` → **Three.js**
- `package.json` contains `spark` → **SparkJS**
- `Dockerfile` or `docker-compose.yml` exists → **Docker**
- AWS SDK deps, CDK, CloudFormation, or SAM templates → **AWS**

### Step 2: Load Standards

Read ONLY the matching standards files from the plugin's skill references directory:
- Language: `${CLAUDE_PLUGIN_ROOT}/skills/tests/references/test-standards-{language}.md`
- Framework: `${CLAUDE_PLUGIN_ROOT}/skills/tests/references/test-standards-{framework}.md`

### Step 3: Analyze

Launch the `test-analyzer` agent with:
- **Diff scope**: include the `git diff HEAD` output
- **Module scope**: the path provided by the user
- **Project scope**: instruction to scan the full project
- The matching language + framework standards content

### Step 4: Documentation Review (unless `--no-docs`)

If `--no-docs` was NOT passed, launch the `test-docs-advisor` agent in parallel with the analyzer.

### Step 5: Present Findings

Show the user:
1. Detected scope, languages, and frameworks
2. The analyzer's prioritized gap list
3. Anti-patterns found in existing tests
4. Documentation suggestions (if advisor was run)

Ask the user which gaps they want tests generated for.

### Step 6: Generate Tests

Launch the `test-generator` agent with:
- The user's selected gaps
- The matching language + framework standards content
- The key file paths from the analyzer
- Instruction to follow existing project conventions

If multiple languages are involved, launch one `test-generator` per language for parallel execution.

### Step 7: Report Results

Show:
- Tests generated (file paths and test names)
- Validation results (pass/fail per language)
- Any issues encountered
