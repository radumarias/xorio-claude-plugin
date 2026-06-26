---
description: "Identify the root cause of a problem using an evidence-grounded 5 Whys. `--deep` fans out parallel hypothesis branches with deterministic grounding and adversarial verification (multi-agent)."
argument-hint: "<problem description> [--deep]"
allowed-tools: ["Bash", "Glob", "Grep", "Read", "Write", "Task", "Workflow"]
---

# Root Cause Analysis

Identify the most plausible root cause of the given problem — grounded in evidence, not speculation.

## Problem

```
$ARGUMENTS
```

## Mode select

Parse `$ARGUMENTS` for the `--deep` flag (strip it from the problem text):

- **absent → Light mode** (default): a single evidence-grounded 5 Whys pass. Fast, cheap, interactive-friendly. Best for a well-scoped problem.
- **present → Deep mode**: a multi-agent causal-tree investigation via the **Workflow** tool. Use for gnarly, ambiguous, or likely-multi-cause failures. Costs more — `--deep` is the explicit opt-in to multi-agent orchestration.

---

## Light mode (default) — evidence-grounded 5 Whys

Apply the "5 Whys" — "five" is a guideline; iterate more or fewer times until you reach a root cause or detect a cycle. Two rules separate a real RCA from a guess:

1. **Ground every link before accepting it.** Each "because" is a claim — prove it against the system, don't assert it:
   - *what changed / when* → `git log` / `git blame` / (if it narrows it) `git bisect`
   - *the code behaves as claimed* → grep/read the path; better, **run** the repro or the failing test
   - cite the evidence inline (`file:line`, commit SHA, command + output). A link you can't ground is a *hypothesis*, not a cause — label it so.
2. **Don't tunnel.** At the first "why", list 2–4 candidate causes, not one; pursue the best-evidenced. Before concluding, name at least one *alternative* branch and state what evidence rules it out. Convergence from two angles beats a single chain.

State the problem, then iterate: answer → ground → "why?" → … Keep a running record (see **Output**). Stop at the root cause (or a detected cycle), then conclude.

---

## Deep mode (`--deep`) — parallel, verified causal tree

Drive this with the **Workflow** tool (dynamic fan-out → pipeline); a simple case may run inline with parallel `Task` agents instead. Resolve model **tiers** at runtime — never hardcode model names: **STRONG** = the most capable model available (from the session environment), **MID** = one tier below (cheaper, mechanical/structured work), **LIGHT** = the cheapest (trivial gates). If the ranking is unclear, omit the model and inherit the session model.

**Phase 1 — Triage (1 × MID).** Pin the failure precisely: exact symptom, reproduction, and observable evidence (error text, failing test, log line, bad output). If it doesn't reproduce, record the assumptions you're proceeding on. This brief is passed to every later agent.

**Phase 2 — Hypothesis fan-out (parallel; one agent per lens, mixed tiers).** Each agent independently builds a candidate causal chain *for its lens only*, with evidence per link:

- **recent-change** — `git log`/`blame`/`bisect`: what changed around when the failure appeared
- **code-path** — trace the actual execution path to the failure point
- **config / environment** — env vars, flags, versions, build/runtime config
- **data / input** — edge cases: empty/null, boundaries, encoding, ordering, concurrency
- **dependency** — upstream / library / version skew

Skip a lens that clearly doesn't apply; add one the problem suggests.

**Phase 3 — Ground + refute each link (pipeline).** For every link in every chain: (a) run a deterministic check (git / grep / run the test) and trust the tool over the claim; (b) spawn a skeptic that tries to **refute** the link — "could the effect occur *without* this cause?" — default-reject when unproven. Drop any link that fails either check.

**Phase 4 — Synthesize (1 × STRONG).** Merge the surviving chains into a ranked **causal tree**: links where multiple lenses *converge* are the likely root cause(s); independent survivors are contributing causes. Output the tree plus the root cause(s), each with its grounded evidence.

---

## Output (both modes)

- Maintain a record by appending to an RCA file in the project root — `RCA-{date}.md`, or an existing `RCA.md`.
- Conclude with the root cause(s) and **citations / references**: `file:line`, commit SHAs, commands run, and test results — not just prose.
- **Do NOT enter solution mode.** Stop at the diagnosis; proposing fixes is out of scope for this command.
