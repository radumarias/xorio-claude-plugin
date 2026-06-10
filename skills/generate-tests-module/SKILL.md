---
name: generate-tests-module
description: Generate unit and integration tests for a specific module, directory, or file. Analyzes existing code and creates idiomatic tests.
disable-model-invocation: true
argument-hint: "<path>"
---

# Generate Tests for a Module

Generate unit and integration tests for a specific file, directory, or module.

## Workflow

### Step 1: Validate Target

Verify that `$ARGUMENTS` specifies a valid path. If no path is provided, ask the user for one.

Check the path exists (file or directory). If it's a directory, it will be scanned recursively for source files.

### Step 2: Detect Languages and Frameworks

From the target files, detect:

**Languages:**
- `.rs` files or `Cargo.toml` in parent hierarchy → **Rust**
- `.ts`/`.tsx` files or `package.json` in parent hierarchy → **TypeScript**
- `.py` files or `pyproject.toml`/`setup.py` in parent hierarchy → **Python**

**Frameworks** (check dependency files for these strings):
- `Cargo.toml` contains `egui` → **egui** (only if target files import/use egui)
- `package.json` contains `react` → **React** (only if target files import react)
- `package.json` contains `vue` → **Vue.js** (only if target files import vue)
- `package.json` contains `three` → **Three.js** (only if target files import three)
- `package.json` contains `spark` → **SparkJS** (only if target files import spark)
- `Dockerfile` or `docker-compose.yml` in target path → **Docker**
- AWS SDK imports in target files → **AWS**

### Step 3: Load Standards

Read ONLY the matching standards files:
- Language: `${CLAUDE_PLUGIN_ROOT}/skills/tests/references/test-standards-{language}.md`
- Framework: `${CLAUDE_PLUGIN_ROOT}/skills/tests/references/test-standards-{framework}.md`

Only load framework standards if the target files actually use that framework.

### Step 4: Analyze

Launch the `test-analyzer` agent with:
- Scope: "module" — include the target path
- The matching language + framework standards content
- Instruction to analyze only the specified module

### Step 5: Present Gap Analysis

Show the user the prioritized gap list ranked by risk:
- Critical gaps first
- Include existing test coverage summary
- Note any test infrastructure found (helpers, fixtures)

Ask which gaps to generate tests for.

### Step 6: Generate Tests

Launch the `test-generator` agent with:
- The user's selected gaps
- The matching language + framework standards content
- The key file paths from the analyzer
- The target module path for context

### Step 7: Validate and Report

Run ONLY the language-specific validation commands:
- **Rust:** `cargo test -p <crate>`, `cargo clippy --all-targets`, `cargo fmt --check`
- **TypeScript:** `npm test`, `npx tsc --noEmit`
- **Python:** `pytest <test_file>`, `mypy`, `ruff`
- **Docker:** `hadolint`, `docker build`

Report:
- Tests generated (file paths and test names)
- Validation results
- Any issues encountered
