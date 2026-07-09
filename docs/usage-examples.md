# Usage Examples

End-to-end recipes for common development scenarios using the `xorio` plugin. Each
section gives the command(s) to run, the order to run them in, and what to expect.

> [!NOTE]
> **Before you start:** make sure the plugin is loaded (see the
> [README → Installation](../README.md#installation)) and run **`/xorio:check-deps`**
> once — several of these recipes call external plugins (`feature-dev`,
> `pr-review-toolkit`, `ralph-wiggum`, `superpowers`, …).
> Not sure where to start? **`/xorio:guide`** detects your context and recommends a
> workflow interactively.

## Scenario → workflow cheat sheet

| I want to… | Run |
|---|---|
| [Implement a feature](#implement-a-feature) | `feature-dev:feature-dev` → `/xorio:tests` → `/xorio:polish` → `/xorio:commit-message`<br>_Alt (as a team):_ `/xorio:team-forming "<spec>"` → `/xorio:review-pr` |
| [Fix a bug](#fix-a-bug) | (`/xorio:root-cause` if needed →) fix → `/xorio:tests` → `/xorio:polish`<br>_Alt (as a team):_ (`/xorio:root-cause` →) `/xorio:team-forming` → `/xorio:review-pr` |
| [Do a code review](#do-a-code-review) | `/xorio:review` (interactive on local changes)<br>_Alt (deep, auto-fix):_ `/xorio:review-pr working-tree` |
| [Clean up code](#clean-up-code) | `/xorio:cleanup-code [path]` |
| [Run a security check](#run-a-security-check) | ask the **security-auditor** agent · built into `/xorio:polish` |
| [Brainstorm ideas for a feature/improvement](#brainstorm-ideas-for-a-feature-or-improvement) | `/xorio:brainstorm "<topic>"` |
| [Brainstorm how to optimize a flow](#brainstorm-how-to-optimize-a-flow) | `/xorio:brainstorm "<topic>" --lenses optimization --target <path>` |
| [Investigate the cause of a bug](#investigate-the-cause-of-a-bug) | `/xorio:root-cause "<symptom>"` (add `--deep` if gnarly) |
| [Do a major refactor](#do-a-major-refactor) | `/xorio:brainstorm` → `/xorio:team-forming "<spec>"` → `/xorio:review-pr` |
| [Do a global code review](#do-a-global-code-review) | `/xorio:review-pr <range\|#PR>` or `/xorio:review-loop <scope>` |
| [Check for malware](#check-for-malware) | `/xorio:mallware-check` |

> [!TIP]
> **Cost heads-up.** Most recipes are single-pass and cheap. The **multi-agent**
> ones fan out many subagents and can burn ~100–300k+ output tokens:
> `/xorio:review-pr`, `/xorio:review-loop`, `/xorio:brainstorm`,
> `/xorio:team-forming`, `/xorio:mallware-check`, and `/xorio:root-cause --deep`.
> They'll report scope and ask for go-ahead on large diffs — reach for them at
> milestones (pre-merge, pre-release), not on every commit.

---

## Implement a feature

Build a new capability from scratch, with tests and a clean diff ready for PR.

```
feature-dev:feature-dev      # 1. guided build: analyzes the codebase, designs, implements
frontend-design:frontend-design   # (only if the feature has UI — run during the build)
/xorio:tests                 # 2. generate tests for the new code (diff scope)
/xorio:polish                # 3. simplify → clean up → review → security-audit → validate
/xorio:commit-message        # 4. draft a Conventional Commits message (does not commit)
```

1. **Build** with `feature-dev:feature-dev` — it explores existing patterns and
   conventions, proposes an architecture/blueprint, then implements against it. If
   the feature has a UI, bring in `frontend-design:frontend-design` for the visual
   layer.
2. **Test** the new code: `/xorio:tests` (no args = the changed files). It detects
   your language/framework, flags coverage gaps and anti-patterns, lets you pick what
   to cover, then writes idiomatic tests and runs validation.
3. **Polish** before PR: `/xorio:polish` runs the full pre-PR pipeline (simplify →
   cleanup → code review → security audit → standards check → format/lint/test).
4. **Commit message**: `/xorio:commit-message` reads your staged + unstaged diff and
   drafts a `feat: …` message. It never stages or commits — copy the message and
   commit yourself.

> [!TIP]
> Spec the approach first with
> [`/xorio:brainstorm`](#brainstorm-ideas-for-a-feature-or-improvement) when the design
> is open-ended.

**Alternative — build it as a team.** For a larger feature spanning many files or
modules, run it as a coordinated team instead of a single guided build:

```
/xorio:team-forming "<inline spec: outcome + tasks + acceptance criteria>"
/xorio:review-pr origin/main..HEAD
```

`/xorio:team-forming` spawns an architect-led team (plan-review gate + built-in
`code-reviewer` / `qa-tester`); then `/xorio:review-pr` runs the heavyweight looped
audit on the assembled diff. See [Do a major refactor](#do-a-major-refactor) for the
inline-spec shape and a step-by-step of what team-forming does.

---

## Fix a bug

You have a reproducible bug and you know roughly where it is.

```
# (If you DON'T know where the bug lives, start with root-cause — see the next section.)
# ... make the fix ...
/xorio:tests src/path/to/fixed     # add a regression test that would have caught it
/xorio:polish                      # review + validate the fix before PR
/xorio:commit-message              # draft a fix: … message
```

1. If the location is unknown, first
   [investigate the cause](#investigate-the-cause-of-a-bug) — then come back here.
2. Make the fix.
3. **Lock it in with a regression test**: `/xorio:tests <path>` scoped to the file or
   module you changed, so the bug can't silently return.
4. **Polish** the change (`/xorio:polish`) and draft the commit message
   (`/xorio:commit-message`).

**Alternative — fix it as a team.** When the fix is large or cross-cutting (many
modules, coordinated changes), run it as a team instead of solo:

```
/xorio:root-cause "<symptom>"     # if the cause/location is unclear (optional)
/xorio:team-forming "<inline spec: the fix's outcome + tasks + acceptance criteria>"
/xorio:review-pr origin/main..HEAD
```

The team's built-in `qa-tester` covers regression testing (black-box against the
acceptance criteria) and `/xorio:review-pr` audits the final diff. See
[Do a major refactor](#do-a-major-refactor) for the team-forming spec format.

---

## Do a code review

Get feedback on the changes you're working on *right now* (local, uncommitted/unpushed
work), and decide what to fix.

```
/xorio:review        # multi-agent review of local changes — you choose what to fix
```

`/xorio:review` runs a standards check, then a multi-agent PR review, **pauses to show
you all findings and let you pick which to fix**, then does a code-review pass and a
simplification pass. Because it waits for your selection, it can't be auto-looped.

- **Fast inner loop while coding:** the built-in **`/code-review`** reviews the current
  diff in one shot (no fan-out) — ideal between edits.
- **Pre-PR, no decision point:** prefer [`/xorio:polish`](#implement-a-feature), which
  also fixes as it goes.
- **Deep, whole-branch audit:** see [global code review](#do-a-global-code-review).

**Alternative — deep looped audit of your WIP.** Instead of the interactive pick, point
the heavyweight reviewer at your uncommitted changes:

```
/xorio:review-pr working-tree                 # multi-lens, validated, auto-fixes, loops
/xorio:review-pr working-tree --approve-gate  # …but you choose which fixes to apply
```

`/xorio:review-pr` validates every finding (deterministically + adversarially) and
**fixes the valid ones**, looping to convergence — heavier than `/xorio:review`, and it
acts rather than just advises. Add `--approve-gate` to restore the "you pick" decision
point. Full details under [global code review](#do-a-global-code-review).

---

## Clean up code

Refactor a path (or your current changes) for structural quality — remove dead code,
kill duplication, split oversized files, and fix Law-of-Demeter / YAGNI smells — against
your language's coding standards.

```
/xorio:cleanup-code                 # clean up your current changes (defaults to git diff)
/xorio:cleanup-code src/auth        # clean up a specific module/path
/xorio:cleanup-code "src/**/*.ts"   # clean up a glob
```

It detects the language (Rust / TypeScript / Python), loads the matching coding
standards plus the project design principles, then analyzes for: dead code & unused
imports, DRY violations, files over 800 lines, overly complex functions,
Law-of-Demeter violations, and YAGNI over-engineering. It maps symbol relationships
(ast-grep / serena) to consolidate rather than duplicate, **presents a refactoring plan
for your approval**, and only then refactors — incrementally, running format + lint +
test after each group — finishing with a simplification pass and a security pass on the
changed files.

- **Slash-only:** type `/xorio:cleanup-code` — it won't auto-trigger.
- **Already polishing?** Cleanup is **step 3 of [`/xorio:polish`](#implement-a-feature)**,
  so a full pre-PR polish already includes it. Reach for `/xorio:cleanup-code` directly
  when you want *just* the cleanup, scoped to a path.
- **Lighter touch:** the built-in **`/simplify`** applies reuse/simplification fixes to
  the changed code without the full plan-and-gate flow.

---

## Run a security check

Scan code and infrastructure config against common risks (OWASP Top 10).

```
# Targeted — just ask; the security-auditor agent auto-launches:
Audit the auth module for security issues
Check my API endpoints for injection flaws
```

- The **`security-auditor`** agent is read-only — it **reports** vulnerabilities (with
  severity), it does not fix them. Trigger it in plain language as above, or scope it
  to a path/module.
- It's already **built into `/xorio:polish`** (step 5), so a normal pre-PR polish
  includes a security pass on your changed files.
- For a sweep of *all* pending changes on the branch, the built-in **`/security-review`**
  complements this.

---

## Brainstorm ideas for a feature or improvement

You want several vetted options for *how* to build or improve something — not one
off-the-cuff answer.

```
/xorio:brainstorm "ways to add offline support to the notes app"
/xorio:brainstorm "approaches for multi-tenant data isolation" --rounds 3
/xorio:brainstorm "caching strategy for the API" --target src/api --out IDEAS.md
```

Runs a `Map → Ideate → Refute → Debate → Synthesize` multi-agent workflow: it generates
ideas across diverse lenses, **adversarially refutes** each (majority vote,
default-refuted), debates the survivors, and writes a **ranked, vetted report**
(`BRAINSTORM-<slug>-<date>.md` by default).

Useful flags:

| Flag | Effect |
|---|---|
| `--target <path\|glob\|diff>` | Ground the ideation on real code/files |
| `--rounds N` | Ideate→Refute waves before synthesis (default 2 — the depth knob) |
| `--out <file>` | Where to save the report |
| `--cross-model` | Make one adversarial validator a Codex/GPT review (cross-family) |
| `+Nk` | Budget directive (e.g. `+400k`) — runs extra waves until ~spent |

> [!NOTE]
> Watch it live with `/workflows` — it runs in the background and returns the report
> when done. For the all-Fable / max-thinking variant, use `/xorio:brainstorm-mythos`.

---

## Brainstorm how to optimize a flow

Same engine as above, but pointed at a *specific, existing* flow you want to make
faster / cheaper / simpler.

```
/xorio:brainstorm "speed up the checkout flow" --lenses optimization --target src/checkout
```

The key differences from idea-generation:

- **`--lenses optimization`** swaps in optimization-oriented idea lenses.
- **`--target <path>`** grounds the run on the actual code, so suggestions are concrete
  rather than generic.

You get a ranked report of optimization options, each adversarially vetted, with a
"validate-first" section so you know what to measure before committing.

---

## Investigate the cause of a bug

You can see the *behaviour* (wrong output, a failing test, a crash) but you **don't know
where in the code** it originates.

```
/xorio:root-cause "uploads over 5MB silently fail with no error in the UI"
/xorio:root-cause "intermittent 500s on /checkout under load" --deep
```

`/xorio:root-cause` runs an **evidence-grounded 5 Whys**: every "because" must be
*proven* against the system — `git log`/`git blame`/`bisect` for what changed,
grep/read for the code path, and **running the repro** — and each link is cited
(`file:line`, commit SHA, command output). It weighs 2–4 candidate causes instead of
tunnelling on one, and stops at the root cause (it does **not** propose fixes). Findings
are written to `RCA-<date>.md`.

- Add **`--deep`** for gnarly or likely-multi-cause failures: a multi-agent
  investigation that fans out parallel hypothesis lenses (recent-change, code-path,
  config, data, dependency), grounds and adversarially verifies each link, and
  synthesizes a ranked causal tree.
- Then fix it following [Fix a bug](#fix-a-bug).

---

## Do a major refactor

Large, structural change — e.g. swapping a framework or a core library, where the work
spans many files and needs coordination.

```
# 1. (optional) pick the approach
/xorio:brainstorm "migrate from Express to Fastify — strategy & risks" --target src

# 2. run it as a coordinated team (inline task-group spec)
/xorio:team-forming Migrate the web app from Express to Fastify.
  Outcome: all HTTP routes served by Fastify, tests green, no Express deps remain.
  Tasks: (1) add Fastify scaffolding; (2) port middleware to hooks; (3) port routes
         module-by-module; (4) update tests; (5) remove Express.
  Acceptance: `npm test` passes; `grep -r "express" src/` returns nothing; app boots
              and serves /health.

# 3. review the assembled diff before merge
/xorio:review-pr origin/main..HEAD
```

1. **Brainstorm the approach** (optional but recommended for a framework swap): get
   vetted migration strategies and a risk list before committing to one.
2. **`/xorio:team-forming`** composes and spawns an agent team for the work: a MAX-tier
   architect designs the migration and recommends the team, an independent gate vets
   that plan, then the team spawns with built-in verification roles (`code-reviewer` +
   `qa-tester`). Pass a task-group file or an **inline spec** with three required
   fields: **outcome**, **tasks**, **acceptance criteria**.
3. **`/xorio:review-pr`** on the final diff — the team-forming workflow itself
   recommends this as the heavyweight, looped, adversarially-validated review of the
   assembled output.

> [!NOTE]
> `team-forming` is the heaviest workflow here (it spawns and coordinates multiple
> persistent agents). For a trivial mechanical change, skip it and just edit + polish.

---

## Do a global code review

A deep audit of a whole branch, a PR, or recent history — not just the lines you're
currently editing. This *fixes* validated findings (unlike [Do a code
review](#do-a-code-review), which is interactive on local WIP).

```
/xorio:review-pr                      # auto-detect: unpushed commits vs default branch
/xorio:review-pr #123                 # a GitHub PR
/xorio:review-pr origin/main..HEAD    # an explicit git range
/xorio:review-pr working-tree         # uncommitted local changes
```

`/xorio:review-pr` runs a looped, multi-lens review (correctness, security,
performance, error-handling, API/type design, tests, conventions, …), validates every
finding **deterministically** (run the type-checker/test/grep) **and adversarially**
(3 skeptic validators, default-reject), fixes the validated ones with verification, and
**loops until it converges**.

Useful flags: `--comment` (post inline PR comments), `--approve-gate` (you pick which
validated findings to fix), `--cross-model` (add a Codex/GPT validator),
`--max-rounds N`.

**Alternative — `/xorio:review-loop`** is a multi-round audit that wraps `/simplify` +
finders + an adversarial-verify panel + a fix-applier, repeating until rounds come up
dry. It's branch/diff-oriented and gives you push control:

```
/xorio:review-loop origin/main..HEAD
/xorio:review-loop "since 2026-06-20"
/xorio:review-loop HEAD~5..HEAD --strict
/xorio:review-loop staged --push
```

Rule of thumb: **`/xorio:review-pr`** when there's a PR/diff to audit and you want the
full looped validation; **`/xorio:review-loop`** when you want a repeatable pre-push
quality+correctness gate with explicit push/remote control. For the all-Fable variant
of the PR review, use `/xorio:review-pr-mythos`.

---

## Check for malware

Vet untrusted code (a cloned repo, a dependency, a plugin) before you run or trust it.

```
/xorio:mallware-check                        # scan the current directory
/xorio:mallware-check is the postinstall script safe?   # add a question to focus the report
```

Dispatches **three** STRONG-tier agents in parallel, each with maximum thinking, to scan
every file recursively for:

- **malicious code & obfuscation** — dynamic `eval`/`exec`, encoded payloads, reverse
  shells, crypto-miners;
- **network / exfiltration / persistence** — call-home URLs, credential & data theft,
  destructive commands, supply-chain install hooks (`preinstall`/`postinstall`, CI
  secrets);
- **Claude Code plugin threats & prompt injection** — malicious hooks/MCP configs,
  hidden instructions in markdown, zero-width/RTL-override tricks.

It returns a consolidated report with a **SAFE / SUSPICIOUS / DANGEROUS** verdict and a
clear recommendation.

> [!NOTE]
> The command is spelled **`mallware-check`** (double-L) — that's the real command name,
> not a typo.

---

## Putting it together

A typical feature lifecycle chains several of the above:

```
/xorio:brainstorm "<approach>"     # decide how (optional)
feature-dev:feature-dev            # build it
/xorio:tests                       # cover it
/xorio:polish                      # make it PR-ready
/xorio:review-pr                   # deep audit before merge (optional, for big changes)
/xorio:commit-message              # write the commit
```

See the [README](../README.md) for the full command/skill reference, installation, and
dependencies, and [`CLAUDE.md`](../CLAUDE.md) for architecture and how the pipelines
chain internally.
