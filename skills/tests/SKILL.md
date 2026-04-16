---
name: tests
description: Generate unit and integration tests for local git changes. Analyzes coverage gaps and anti-patterns, then generates idiomatic tests. Use when user says "write tests", "add test coverage", "what tests are missing", or "generate tests for my changes". Supports Rust, TypeScript, Python with framework-specific standards for egui, React, Vue.js, Three.js, Docker, AWS.
disable-model-invocation: true
argument-hint: "[--no-docs]"
metadata:
  author: Radu Marias
  version: 0.1.0
---

# Generate Tests for Local Changes

Generate unit and integration tests for files changed in the current working tree.

## Workflow

### Step 1: Detect Scope and Languages

Run `git diff HEAD` to identify changed files. From the file extensions and project files, detect:

**Languages:**
- `.rs` files or `Cargo.toml` present → **Rust**
- `.ts`/`.tsx` files or `package.json` present → **TypeScript**
- `.py` files or `pyproject.toml`/`setup.py` present → **Python**

**Frameworks** (check dependency files for these strings):
- `Cargo.toml` contains `egui` → **egui**
- `package.json` contains `react` → **React**
- `package.json` contains `vue` → **Vue.js**
- `package.json` contains `three` → **Three.js**
- `package.json` contains `spark` → **SparkJS**
- `Dockerfile` or `docker-compose.yml` exists → **Docker**
- AWS SDK deps, CDK, CloudFormation, or SAM templates → **AWS**

### Step 2: Load Standards

Read ONLY the matching standards files from `references/` (relative to SKILL.md):
- Language: `references/test-standards-{language}.md`
- Framework: `references/test-standards-{framework}.md`

Examples:
- Rust + egui project → read `references/test-standards-rust.md` + `references/test-standards-egui.md`
- TS + React + Three.js → read `references/test-standards-typescript.md` + `references/test-standards-react.md` + `references/test-standards-threejs.md`
- Python + Docker + AWS → read `references/test-standards-python.md` + `references/test-standards-docker.md` + `references/test-standards-aws.md`

### Step 3: Analyze

Launch the `test-analyzer` agent with:
- Scope: "diff" — include the git diff output
- The matching language + framework standards content
- Instruction to analyze only changed files

### Step 4: Documentation Review (unless `--no-docs`)

If `$ARGUMENTS` does NOT contain `--no-docs`, launch the `test-docs-advisor` agent in parallel with the analyzer.

### Step 5: Present Findings

Show the user:
1. Detected languages and frameworks
2. The analyzer's prioritized gap list
3. Documentation suggestions (if advisor was run)

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

## Troubleshooting

### No changed files detected
If `git diff HEAD` returns empty, check if changes are committed. For already-committed changes, use `/xorio:tests --project` or specify a path.

### Language not detected
If no supported language is found, verify that source files have standard extensions (`.rs`, `.ts`, `.tsx`, `.py`) and that dependency files (`Cargo.toml`, `package.json`, `pyproject.toml`) exist in the project root.

### Test validation fails
If generated tests fail validation, the test-generator agent will attempt to fix them. If failures persist after two attempts, report the failing tests with error output and let the user decide how to proceed.
