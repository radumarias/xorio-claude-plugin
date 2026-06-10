---
name: review-loop
description: "Multi-round audit loop: /simplify → parallel finders (/code-review + optional /security-review + /review) → adversarial verify (3 lenses, default-refuted) → apply verified fixes → repeat until N rounds dry or MAX_ROUNDS. Use when the user wants a thorough quality + correctness pass on a branch/diff before pushing or merging. Args: scope (e.g. `origin/main..HEAD`, `since 2026-05-28`, `HEAD~5..HEAD`, `staged`, `unstaged`, `working-tree`, `#PR`), `--push`, `--remote`, `--strict`, `--skip-simplify`, `--with-toolkit`."
---

# /review-loop

A personal audit harness. Wraps `/simplify` + several reviewers + an adversarial-verify panel + a fix-applier into one looped workflow. The goal: catch real issues before push without ratholing on false positives.

## Triggering

- Direct: user types `/review-loop` (with optional args/flags below).
- Inferred: user describes the use case ("review this branch before I push", "do a thorough audit on the last 5 commits", "run the full quality pass on the diff since Thursday"). Offer to invoke the skill; do not run it without confirmation if the diff is large (>50 files) since cost is non-trivial.

## Args

```
/review-loop [scope] [flags...]
```

**Scope** (one of, optional — auto-detected if omitted):
- `origin/main..HEAD` — any `<ref>..<ref>` range
- `HEAD~N..HEAD` — last N commits
- `since YYYY-MM-DD` — commits since absolute date
- `staged` / `unstaged` / `working-tree` — local diff against index/HEAD
- `#NNN` — fetch PR diff via `gh pr diff NNN`

**Flags:**
- `--push` — `git push origin <branch>` after the loop (default: off; leave commits local)
- `--remote` — push branch, then schedule a one-shot remote CCR agent to run the audit in Anthropic's cloud; return the routine link and exit local session
- `--strict` — 4-lens verify with ≥3/4 majority; +1 to MAX_ROUNDS
- `--skip-simplify` — skip the `/simplify` cleanup phase
- `--with-toolkit` — also include `/pr-review-toolkit:review-pr` in the finder panel (heavier; overlaps `/code-review`)
- `--ultra` — force every workflow agent onto the STRONG tier (the most capable Claude model currently available) regardless of session `/effort` setting. Use when you want a heavyweight pass without flipping session state. Costs more.

**Model tiers — resolve at runtime, never hardcode.** This skill refers to model
*tiers*, not model names. STRONG = the most capable Claude model currently
available — identify it from the session environment (the system context names
the current flagship) and the Workflow tool's `model` options; never from this
file. `workflow.js` cannot read the environment itself, so when `--ultra` is
set, resolve STRONG before launching and pass it as
`args.models = { strong: "<resolved alias>" }`. If unresolved, the script
degrades to inheriting the session model. When a newer flagship ships, this
rule adopts it automatically.

## Workflow

Run these in order. Each numbered step is a single shell or tool call unless noted.

### 1. Parse args

Split the user's argument string into `scope_arg` (first token if not a flag) and `flags` (anything starting with `--`).

### 2. Resolve scope

If `scope_arg` is empty:
- `git rev-list --count @{u}..HEAD 2>/dev/null` — if >0, scope is `origin/$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's|.*/||')..HEAD` (use the remote HEAD branch).
- Else if `git diff --quiet HEAD || git diff --cached --quiet` shows changes, scope is `working-tree`.
- Else: nothing to review — report "clean tree, no unpushed commits" and exit.

If `scope_arg` starts with `since `, pass through (workflow handles).
If `scope_arg` is `#NNN`, run `gh pr diff $NNN` to fetch and pass the PR number through.
Otherwise treat `scope_arg` as a git range and validate with `git rev-list --count <range> 2>/dev/null` (must be >0).

Set `scope` (the string passed to reviewers, e.g. `"origin/main..HEAD"`) and `scope_label` (human description, e.g. `"8 commits ahead of origin/main"`).

### 3. Pre-flight sniffs (cheap, one shell call each)

```bash
# Open PR for current branch?
gh pr view --json url 2>/dev/null && has_pr=true || has_pr=false

# Diff text — capture once, reuse for size + security sniff
DIFF=$(git diff $RANGE 2>/dev/null)  # adapt to scope form

# Security surface touched?
echo "$DIFF" | grep -qiE '(auth|jwt|password|token|exec\(|eval\(|sql|sanitize|escape|cors|cookie|session|secret|hmac|crypto|rsa|aes|verify|signature|x509)' \
  && touches_security=true || touches_security=false

# Size bucket
FILES=$(echo "$DIFF" | grep -c '^diff --git')
if [ "$FILES" -le 10 ]; then size=small; max_rounds=2
elif [ "$FILES" -le 50 ]; then size=medium; max_rounds=3
else size=large; max_rounds=5
fi
# +1 round if --strict
```

Report the sniff results to the user before launching: scope, file count, security flag, PR flag, planned finders, `MAX_ROUNDS`, `--push`/`--remote` behaviour. If the user hasn't already confirmed and the diff is large or this is a `--remote` run, ask for go-ahead.

### 4. Branch out by flag

**If `--remote`:**
1. `git status --porcelain` — if dirty, prompt user to commit first or abort.
2. `git push origin HEAD` — push the current branch.
3. Invoke the `schedule` skill with a one-shot `run_once_at` (now + 2 min). The remote agent's prompt should clone the branch, run the same audit (in CCR, this means a plain `/review-loop <scope>` invocation, NOT `--remote` — avoid recursion), and post findings as PR comments via `gh pr comment` if a PR exists, falling back to Slack DM otherwise.
4. Return the routine URL to the user and stop. Local session is free.

**Else (local run):** continue to step 5.

### 5. Launch the workflow

Call the `Workflow` tool with:

```
Workflow({
  scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/review-loop/workflow.js",  // workflow.js sits next to this SKILL.md
  args: {
    scope,                  // e.g. "origin/main..HEAD"
    scope_label,            // e.g. "8 commits ahead of origin/main"
    has_pr,                 // boolean from gh pr view
    touches_security,       // boolean from regex sniff
    with_toolkit,           // from --with-toolkit flag
    skip_simplify,          // from --skip-simplify flag
    strict,                 // from --strict flag
    ultra,                  // from --ultra flag (force every agent onto the STRONG tier)
    models,                 // only when ultra: { strong: "<alias resolved per the Model-tiers block>" }
    max_rounds,             // small=2, medium=3, large=5 (+1 if strict)
    dry_target: 2,
    commit_per_area: true,
  }
})
```

The workflow handles simplify → loop (parallel finders → dedup → adversarial verify → fix) → completeness critic. It returns a structured report.

### 6. Post-workflow

Print a concise summary to the user:
- Scope, finders used, rounds run, stop reason (converged vs MAX_ROUNDS)
- Per-round: raw → fresh → verified → fixed
- Suppressed-as-false-positive count (for spot-checking) — include the first 3 with their refute reasons
- Completeness-critic gaps (if any) — surface them; ask user whether to address

**If `--push`:** show `git log @{u}..HEAD --oneline` (the unpushed commits the workflow created), confirm with user, then `git push origin HEAD`. Surface the push output.

**Else:** print `git log @{u}..HEAD --oneline` so the user can see what's queued locally; remind them to push when ready.

## Defaults and rationale

| Decision | Default | Why |
|---|---|---|
| Finder panel | `/code-review` always; `/security-review` if security-touched; `/review` if PR exists | Avoid finder overlap (`/code-review` and `/pr-review-toolkit:review-pr` cover similar ground); gate security review on actual surface change |
| `/pr-review-toolkit:review-pr` | off, opt-in via `--with-toolkit` | High overlap with `/code-review`, heavier (5+ sub-agents), keep as escape hatch when you want comment/test/type-design coverage specifically |
| Push | opt-in via `--push` | Leave the safety net on; never auto-push fix commits without explicit ask |
| Verify panel | 3 lenses, ≥2 not-refuted, default-refuted | Cuts false positives ~50-90% based on observed runs; default-refuted errs toward fewer code changes |
| MAX_ROUNDS | scope-aware (2/3/5) | Small diffs converge in 1-2 rounds; large diffs need more, but past 5 you're getting reviewer disagreement, not real findings |
| Commit per area | on | Keeps rollback story clean; user can drop individual fix commits if they disagree |
| Completeness critic | on | One extra agent, consistently surfaces 1-2 misses (uncovered files, unrun angles) |

## What this skill is NOT

- Not a replacement for `/code-review` on a single commit while you're writing — that's one-shot and fast; use that for the inner loop. `/review-loop` is for the pre-push / pre-merge audit.
- Not a substitute for human review on security-critical changes — adversarial verify catches a lot, but it's a filter, not an oracle.
- Not free — a medium diff over 3 rounds is roughly 100-300k output tokens. Don't run it on every commit. Use the cheaper `/code-review` for that.

## Notes for invocation

- The Workflow tool requires explicit opt-in (see its description). When triggered from this skill, that opt-in is implicit — the skill's invocation IS the user's opt-in. Don't ask again before launching the workflow.
- The workflow runs in the background; surface progress and final report when the task notification arrives.
- If the workflow fails partway, the commits already made are preserved (loop fixes are committed per area). Re-running `/review-loop` resumes from there — the `seen` set is per-run, not persisted.
