---
description: Mythos all-Fable multi-agent PR review — every agent on Fable with max thinking; multi-lens review, deterministic + adversarial validation, verified fixes, looped to convergence. Use ONLY when the user explicitly says "mythos" or asks for the all-Fable / max-thinking variant; for any other deep PR review use review-pr instead.
argument-hint: "[#PR | <git-range> | staged|unstaged|working-tree] [--comment] [--approve-gate] [--max-rounds N]"
allowed-tools: ["Bash", "Glob", "Grep", "Read", "Edit", "Write", "Task", "Workflow", "WebFetch", "Skill"]
---

# /review-pr-mythos — Mythos all-Fable looped PR review

Run a thorough, multi-agent review of a pull request (or local diff), validate
every finding both deterministically and adversarially, fix the validated ones
with verification, and loop until convergence.

**Target/flags:** `$ARGUMENTS`

This command is the user's explicit opt-in to multi-agent orchestration: when a
diff is non-trivial, drive it with the **Workflow** tool (dynamic fan-out +
pipeline). Trivial diffs (≤ a few files) may run inline with parallel `Task`
agents. Either way, follow the structure below exactly.

---

## 0. Parse arguments

- **Target** (first non-flag token):
  - `#NNN` or `NNN` → a PR; fetch with `gh pr view NNN` / `gh pr diff NNN`.
  - `<ref>..<ref>` (e.g. `origin/main..HEAD`), `HEAD~N..HEAD` → a git range.
  - `staged` / `unstaged` / `working-tree` → local diff.
  - *Omitted* → auto-detect: if unpushed commits exist, use
    `origin/<defaultbranch>..HEAD`; else if the tree is dirty, use `working-tree`;
    else report "nothing to review" and stop.
- **Flags:**
  - `--comment` → post findings as inline PR comments (PR target only). Default: off.
  - `--approve-gate` → after validation each round, present findings and let me
    pick which to fix before fixing. Default: off (auto-fix all validated).
  - `--max-rounds N` → override the loop cap. Default: size-aware (see §1).

Read project rule files first if present: root `CLAUDE.md`, `.claude/rules/*`.

---

## Model policy — Fable for EVERY agent, max thinking, no exceptions

This skill uses exactly ONE model for every agent it spawns: **Fable** (the
`fable` option of the Agent/Workflow tools' `model` param). There is no model
tiering and no cross-family panel — do not use Sonnet, Opus, Haiku, Codex, or
any other model for any agent, gate, validator, fixer, or critic.

- **Always pass `model: "fable"` explicitly** on every `agent()` call in
  Workflow scripts and every Agent tool call — do not rely on inheritance.
- **Thinking explicitly at MAX on every agent**: thinking level is MAX — not
  default, not inherited. Set it explicitly on every agent by beginning every
  agent prompt with the keyword `ultrathink` on its own line; `ultrathink` IS
  the maximum thinking level. This applies to ALL agents — gates, summaries,
  lenses, grounding checks, validators, fixers, and critics alike. No agent
  may run at a lower thinking level.
- If the `fable` model option is ever unavailable in the runtime, stop and
  report it — do not silently substitute another model.

---

## 1. Pre-flight (cheap, once)

1. **Gate** (Fable agent): is the PR closed, a draft, trivial/automated, or already
   reviewed by me (`gh pr view <PR> --comments`)? If so, stop and report why.
   (Still review Claude-authored PRs.)
2. **Summary** (Fable agent): fetch PR title, description, diff, and BASE/HEAD
   SHAs. Return a change summary, the author's **intent**, and the PR's **stated
   requirements**. This is passed to every later agent.
3. **Conventions**: collect path-scoped `CLAUDE.md` files (root + every dir touched
   by the diff).
4. **Sniff the diff** (one shell pass) to decide which lenses apply:
   - security surface? `grep -iE '(auth|jwt|password|token|exec\(|eval\(|sql|sanitize|escape|cors|cookie|session|secret|hmac|crypto|rsa|aes|verify|signature|deserialize|pickle|x509)'`
   - tests changed? types/APIs added? comments/docs changed? error handling changed?
5. **Size → MAX_ROUNDS** (unless `--max-rounds` given): ≤10 files → 2; ≤50 → 3;
   else → 4. Hard cap 4 regardless.

> **Context discipline (superpowers):** every agent gets PRECISELY CRAFTED context
> — the diff + its lens + PR intent/requirements + relevant CLAUDE.md + BASE/HEAD
> SHA. Never your session history.

**Orchestrator-held state across rounds (plain logic, NOT an LLM — keeps dedup
bias-free):**
- `SEEN` — keyed by `file+line+claim`
- `REJECTED` — discarded findings + the refute reason
- `REGRESSION` — confirmed findings (file+line+claim+fix) for re-run guarding

Report the pre-flight result (target, file count, applicable lenses, MAX_ROUNDS,
flag behavior) before launching. If the diff is large (>50 files) and I haven't
already confirmed, ask for go-ahead — this burns ~100–300k output tokens.

---

## 2. Round (repeat ≤ MAX_ROUNDS; stop early on a round with 0 valid findings)

### 2a. Review — parallel fan-out

Launch one independent agent per **applicable** lens, each in a fresh isolated
context. Every lens runs on Fable with max thinking:

- **Spec compliance** — does the change actually do what the PR says?
  Nothing missing, nothing extra / over-built (YAGNI grep for usage).
- **Correctness / logic bugs**
- **Security & trust boundaries** — *only if security surface touched.*
  Attack surface: authz/tenant isolation, data loss/corruption, rollback &
  idempotency, races/ordering, empty-state/null/timeout, version/schema skew,
  observability gaps, injection/SSRF/deserialization/secret handling.
- **Performance & resource handling**
- **Error handling / silent failures** — *if error paths changed.*
- **API & type design / invariants** — *if types/APIs added.*
- **Tests & coverage gaps**
- **Comment/doc accuracy vs code** — *if docs changed.*
- **Convention / CLAUDE.md compliance** — quote the exact rule broken.
- **Readability / maintainability**

Each finding returns: `file, line, severity (Critical|Important|Minor),
description, why-flagged, suggested fix, confidence 0–1`.

**HIGH-SIGNAL BAR — defend it from the diff or don't flag it.** Do NOT flag:
pre-existing issues; looks-like-a-bug-but-is-correct; pedantic nitpicks a senior
engineer wouldn't raise; pure style; linter-catchable trivia; anything needing
out-of-diff context you can't see. False positives erode trust.

### 2b. Dedup — orchestrator logic only (no LLM)

Merge findings across lenses; drop any whose `file+line+claim` is already in
`SEEN` or `REJECTED`; add survivors to `SEEN`.

### 2c. Deterministic grounding first (eval principle: cheap objective scorers before LLM judges)

For each surviving finding, run a mechanical check **when one exists**, and trust
the tool over any model vote:
- compile/type errors, undefined refs, bad imports → run the type-checker / build
- "test should fail" / coverage gap → run that specific test
- lint-rule / formatting claims → run the linter on that file
- "symbol doesn't exist" / grep-able facts → grep the tree

A finding the tool **confirms** is auto-valid (skip the LLM vote — evidence beats
opinion). A finding the tool **refutes** → `REJECTED`. Only findings with **no**
deterministic check (logic, design, security reasoning, readability) proceed to 2d.

### 2d. Adversarial validation — rubric-based LLM-as-judge

For each remaining finding, spawn **3 validators**, each fresh isolated context,
all three on Fable with max thinking.

> **Stance:** "BREAK confidence in this finding, don't confirm it. Default to
> reject when uncertain. No credit for good intent or partial reasoning. A
> happy-path-only failure is still real; one that needs an unreachable path is
> not. Stay grounded — defensible from the real code only; invent no files, paths,
> or behavior; keep confidence honest."

**Validator panel — diversify the lenses, not the model.** All three validators
run on Fable; independence comes from fresh isolated contexts plus **distinct
refute lenses** (e.g. V1 attacks reachability, V2 attacks factual grounding
against the real code, V3 attacks impact/fix-safety) so they fail differently,
not redundantly.

**Independence (mandatory):**
- each validator gets ONLY the finding + relevant code; it is NOT told which lens
  raised it, nor the other validators' verdicts;
- validators run concurrently and never see each other's verdicts;
- give them **distinct refute lenses** so they fail differently, not redundantly.

**Rubric** — each validator scores 0–1 on:
(a) reachability — path reachable / reproduces?
(b) correctness — claim accurate against real code?
(c) impact — Critical/Important, or noise?
(d) fix-safety — would the proposed fix be correct and non-regressive?

A validator **accepts** iff mean ≥ 0.6 **and** reachability > 0. A finding is
**VALID** iff ≥ 2 of 3 accept. Discarded → `REJECTED` (with reason).

### 2e. Fix — with discipline (superpowers: receiving-code-review)

Apply fixes for validated findings. Do NOT blindly apply:
- one finding at a time;
- if a fix would break behavior, cause a regression, or add unused surface
  (YAGNI), **push back** — record "valid but not fixed: <reason>" instead of
  forcing a bad change;
- **commit per area**;
- **serialize** fixers on overlapping files; only parallelize fixers whose file
  sets are disjoint.

Add each applied fix to `REGRESSION`.

### 2f. Verification gate — the Iron Law (superpowers: verification-before-completion)

After the round's fixes: **run the project's tests / build / lint, read the
output, confirm green.** Do NOT trust any fixer's self-report — independently
check the VCS diff to confirm the change is real and matches intent. If
verification fails, the round is **not done**: fix or revert until green before
looping. Never claim "clean"/"done" without fresh evidence in hand.

### 2g. Loop

Re-review the updated code. Stop at MAX_ROUNDS **or** the first round that yields
0 valid findings after validation.

---

## 3. Final

- **Completeness critic** (one Fable agent): what was missed — a file unreviewed,
  a lens not run, a claim unverified? Surface gaps; don't silently truncate.
- **Conflict & systematic-error spot-check:** did parallel fixers touch the same
  code inconsistently? Spot-check fixer changes for systematic mistakes. Run the
  **full** test suite once more; report the actual result with evidence.
- **Summary**, per round: raw → deduped → deterministically grounded → validated
  (vote counts + which refute lens) → fixed/deferred, grouped by severity, ending
  in a **ship / no-ship assessment**.
- List suppressed/`REJECTED` findings + their refute reasons (first few) so I can
  spot-check the filter.
- State outcomes **with evidence** (test output) — no performative "done", no
  gratitude filler. Just the facts and the assessment.

**If `--comment`** (PR target): post **one** inline comment per validated issue via
the GitHub inline-comment tool, with a committable suggestion block **only** when
the suggestion fully fixes the issue. Reply to existing inline review threads
**in-thread**, not as top-level PR comments. Never post duplicates.

**Otherwise:** don't push or post anything. Print `git log @{u}..HEAD --oneline`
so I can see the fix commits queued locally; remind me to push when ready.

---

## Notes

- Excluded as false positives (never flag): pre-existing issues; correct code that
  merely looks wrong; nitpicks; linter-catchable trivia; general "needs more tests"
  unless CLAUDE.md requires it; issues explicitly silenced in code.
- Use `gh` for all GitHub interaction, not web fetch.
- Cost scales with diff size × rounds × validators. Use plain `/code-review` for
  the fast inner loop while coding; reach for `/review-pr-mythos` for the
  pre-merge audit.
