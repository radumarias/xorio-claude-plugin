---
name: polish
description: Polish local code changes — simplify, clean up, review, and audit before PR. Runs code-simplifier, cleanup-code, code-reviewer, and security-auditor in sequence. Use when user says "polish my changes", "prepare for PR", "clean up before merging", or "make this PR-ready".
metadata:
  author: Radu Marias
  version: 0.1.0
---

# Polish Workflow

Run the full polish pipeline on local changes (unstaged + staged git diff).

## Step 1: Scope Check

Run `git diff --stat HEAD` to identify changed files. If no changes found, report "Nothing to polish" and stop.

## Step 2: Code Simplification

Launch the `pr-review-toolkit:code-simplifier` agent on the local changes (`git diff`).
Present findings. Apply simplification suggestions that improve readability without changing behavior.

## Step 3: Code Cleanup

Invoke the `cleanup-code` skill scoped to local changes only.
This handles: language detection, standards loading, cleanup analysis, refactoring with validation.

## Step 4: Code Review

Launch the `pr-review-toolkit:code-reviewer` agent on the local changes.
Present findings. Fix any issues flagged.

## Step 5: Security Audit

Launch the `xorio:security-auditor` agent scoped to changed files (`git diff --name-only HEAD`).
Fix any critical or high findings before finishing.

## Step 6: Standards Validation

Launch the `superpowers:code-reviewer` agent (via Task tool) to validate all accumulated changes from Steps 2-5 against the project's coding standards and conventions.
Fix any findings.

## Step 7: Final Validation

Run language-appropriate validation on changed files:
- Rust: `cargo fmt --all && cargo clippy --all-targets --all-features && cargo test`
- TypeScript: `npx biome check --write . && npx tsc --noEmit && npm test`
- Python: `ruff check --fix . && ruff format . && mypy . && pytest`

## Step 8: Update CLAUDE.md

Invoke `claude-md-management:revise-claude-md` (via Skill tool) to capture any learnings, patterns, or convention updates discovered during the polish process.

## Step 9: Summary

Report:
- Files polished (count + list)
- Simplifications applied
- Cleanup changes made
- Review issues fixed
- Security findings addressed
- Standards validation status
- Final validation status (pass/fail)
