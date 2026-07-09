---
name: review
description: Review local code changes with multi-agent PR review, code review, and simplification. Presents findings for user selection before fixing. Use when user says "review my changes", "check my code", "review before PR", or "code review my work".
metadata:
  author: Radu Marias
  version: 0.1.0
---

# Review Workflow

Run the full review pipeline on local changes (unstaged + staged git diff).

## Step 1: Scope Check

Run `git diff --stat HEAD`. If no changes found, report "Nothing to review" and stop.

## Step 2: Standards Validation

Launch the `superpowers:code-reviewer` agent (via Task tool) to validate local changes against the project's coding standards and conventions.
Fix any findings before proceeding to detailed reviews.

## Step 3: PR Review

Use the Skill tool to invoke `pr-review-toolkit:review-pr` scoped to local changes.

**STOP.** Present all findings to the user. Ask which ones to fix. Wait for their response.
Make a plan from the chosen findings and implement the fixes.

## Step 4: Code Review

Run the built-in `/code-review` at **max** effort on the local diff — invoke the
built-in `code-review` skill (via the Skill tool) with `args: "max"`, i.e. `/code-review max`.
This is Claude Code's built-in command (it reviews the current working diff for
correctness bugs plus reuse/simplification/efficiency cleanups), **not** the
`code-review:code-review` plugin.
Fix all findings.

## Step 5: Code Simplification

Launch the `pr-review-toolkit:code-simplifier` agent (via Task tool) on local changes.
Fix all findings.

## Step 6: Update CLAUDE.md

Invoke `claude-md-management:revise-claude-md` (via Skill tool) to capture any learnings, patterns, or convention updates discovered during the review.

## Step 7: Summary

Report what was reviewed and fixed across all passes.
