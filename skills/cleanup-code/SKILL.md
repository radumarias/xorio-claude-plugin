---
name: cleanup-code
description: Refactor and clean up code with structured review gates. Detects language, applies coding standards (Rust, TypeScript, Python), runs simplification and security audit. Primarily used as a sub-step of the polish workflow. Includes DRY analysis, Law of Demeter checks, and YAGNI violation detection.
disable-model-invocation: true
argument-hint: "[PATH or file glob]"
metadata:
  author: Radu Marias
  version: 0.1.0
---

# Code Cleanup

Perform cleanup-focused analysis and refactoring of the target code.

## Step 1: Detect Language

From `$ARGUMENTS` (target path) or `git diff HEAD`, determine which languages are in scope:

- `.rs` files or `Cargo.toml` → **Rust**
- `.ts`/`.tsx` files or `package.json` → **TypeScript**
- `.py` files or `pyproject.toml`/`setup.py` → **Python**

## Step 2: Load Standards

Read ONLY the matching standards files from `references/` (relative to SKILL.md):
- Rust → `references/standards-rust.md`
- TypeScript → `references/standards-typescript.md`
- Python → `references/standards-python.md`

Also read `${CLAUDE_PLUGIN_ROOT}/rules/planning.md` for design principles.

## Step 3: Cleanup Analysis

Review the target code looking for cleanup opportunities. Think like a PR reviewer focused on code quality.

**Focus areas (all languages):**
- Dead code and unused imports
- Code duplication (DRY violations)
- Files exceeding 800 lines — split them; use `code-simplifier` and `pr-review-toolkit` plugins
- Overly complex functions (candidates for simplification)
- Law of Demeter violations (excessive chaining, inappropriate coupling)
- YAGNI violations (unused abstractions, over-engineering)

**Language-specific focus (from loaded standards):**
- Apply the error handling, naming, and organization rules from the loaded standards file
- Check for deprecated API usage per the standards

## Step 4: Relationship Mapping

Use ast-grep for structural pattern matching first, then serena's symbolic tools (`find_symbol`, `find_referencing_symbols`, `get_symbols_overview`) to understand code relationships before proposing changes. Identify methods that can be consolidated and reused rather than duplicated.

## Step 5: Refactoring Plan

Generate a structured refactoring plan following the design principles from `planning.md`. Prioritize changes by impact and risk. Group related changes for atomic commits.

## Step 6: Review Gate

Present the refactoring plan for approval. Clearly identify any breaking changes or risks.

## Step 7: Implementation (after approval)

Implement the approved changes incrementally. After each logical group of changes, run the language-appropriate validation:

**Rust:**
```
cargo fmt --all
cargo clippy --all-targets --all-features
cargo test
```

**TypeScript:**
```
npx biome check --write .
npx tsc --noEmit
npm test
```

**Python:**
```
ruff check --fix .
ruff format .
mypy .
pytest
```

Verify the codebase compiles and tests pass before moving to the next group.

## Step 8: Code Simplification

Launch the `pr-review-toolkit:code-simplifier` agent on the local changes (git diff). Apply any simplification suggestions that improve readability without changing behavior.

## Step 9: Security Review

Launch the `xorio:security-auditor` agent on the local changes only. Scope it to the files changed in the current working tree (`git diff --name-only HEAD`). Fix any critical or high findings before finishing.

## Tools to Utilize

- `ast-grep` for structural pattern matching (find code patterns, unwrap calls, empty catch blocks)
- `serena` for symbol navigation and relationship discovery (`find_symbol`, `find_referencing_symbols`)
- `pr-review-toolkit:code-simplifier` to identify complexity reduction opportunities
- `xorio:security-auditor` for vulnerability scanning on changed files
- `context7` if library updates or migrations are involved

## Troubleshooting

### Validation fails after refactoring
If compilation or tests break after a refactoring group, revert that group's changes and try a smaller, more targeted refactoring. Do not proceed to the next group until the current one passes validation.

### No language detected
If `$ARGUMENTS` points to files without standard extensions, fall back to `git diff HEAD` to detect languages from the broader changeset.

---

**Target:** $ARGUMENTS
