---
name: team-forming
description: 'Team-forming <task-group file or inline spec> [--roles r1,r2,...] [--team-slug S] [--no-architect] [--no-review-plan]. Compose and spawn an agent team for one task-group: a MAX-tier architect/planner runs first to design the work and recommend the team composition (then stays on as a standing advisor); an independent reviewer gates the plan before the team forms; then derive the remaining roles, build disposition-based prompts, spawn via TeamCreate/Agent, persist a team registry, return the formation contract. Use when the user says "form team", "create team", "compose team", or asks to spawn a team of agents for a task.'
argument-hint: "<task-group.md|inline spec> [--roles ...] [--team-slug S] [--no-architect] [--no-review-plan]"
allowed-tools: ["Agent", "TeamCreate", "SendMessage", "TaskCreate", "TaskList", "TaskUpdate", "Read", "Write", "Glob", "Grep", "Bash"]
metadata:
  version: 0.1.0
---

# team-forming

Compose and spawn a team for one task-group. Returns the team-slug, member list with agent IDs, formation output contract, and scaling envelope to the caller (the main session, or a coordinating agent when invoked from one).

**Actors (terminology).** Two actors drive everything below:

- **Orchestrator** — whoever runs this skill: the main session, or a coordinating agent that invoked it. It forms the team and, after handoff, acts as the **coordinator** that wakes members at their phase boundaries (via `SendMessage`) and fields escalations. The words *caller*, *main session*, *coordinating agent*, and *coordinator* all refer to this one actor in different moments.
- **tech-lead** — a distinct *in-team* member (when composed) that coordinates task execution within the team's autonomy boundaries. It does NOT own formation or cross-team decisions — those stay with the orchestrator.

**Communication model (mailbox).** Spawning a named agent creates a *persistent teammate* that goes idle and is re-woken by `SendMessage` with its context intact — there is **no synchronous return value**; members reply by `SendMessage` to the lead. An agent idles until a message arrives, acts on it, then idles again. (Verified in-harness: a member re-messaged after going idle replied and correctly recalled its earlier turn.)

**State directory.** All persistent state lives under `~/.claude/teams-state/`:

- `~/.claude/teams-state/<team-slug>.json` — team registry (one file per formed team)
- `~/.claude/teams-state/<team-slug>.log.jsonl` — event log (append-only)
- `~/.claude/teams-state/<team-slug>.design.md` — the architect's design doc (the durable single source of design truth that teammates read for clarification)
- `~/.claude/teams-state/patterns/formation-<type>.jsonl` — formation pattern history (one JSON record per past formation: `{composition, verdict, date, task_group_ref, planned_vs_actual}`)
- `~/.claude/teams-state/patterns/review-<domain>.jsonl` — review pattern history

Create directories on first write. A missing pattern file is not an error — it means "no historical patterns", and the relevant cascade step falls through.

**Spawn-in-two-waves, everything-upfront principle.** Wave 0 spawns the architect/planner alone; it designs the work and composes the rest of the team (see **Phase 0**). Wave 1 then spawns every remaining role in a single batch, before execution unblocks. Each teammate reads its brief, acknowledges, and goes idle; the coordinator wakes each at its phase boundary via `SendMessage`, and any teammate may wake the architect for clarification. These two waves are the ONLY staging — within wave 1, lazy per-phase spawning is still forbidden: it leads to late phases with absent roles and inconsistent briefs. Writing all wave-1 briefs in a single batch forces reconciling role boundaries, downstream expectations, and scope in one pass — lazy spawning produces role drift.

**Planner-first, MAX-pinned pivots.** Two roles are pinned to the MAX tier (the most capable model + an `Ultrathink — use maximum thinking.` prefix — see **Model tiers** below), overriding the **Cost framing** budget guidance: the **architect/planner** and the **verification roles** — both lenses, `code-reviewer` (static) and `qa-tester` (behavioural), whenever present. Rationale: planning decisions shape every downstream brief, and verification is the last line of defense — quality at these points compounds across the whole engagement, so they get maximum reasoning regardless of cost. The architect/planner is additionally spawned in a *first wave*, before the rest of the team, because its output composes the team — and an independent MAX-tier plan-reviewer gates that plan before wave 1 (see the **Adversarial Plan-Review Gate**). Do not down-tier these roles to save cost.

**Explicit-per-role-model mandate.** Every spawn names a pinned model tier (`haiku` / `sonnet` / the top tier via the Agent tool's `model` param — the top tier resolves to the most capable model available, `opus` today; see **Model tiers**) — never omitted, never `inherit`, never an implicit default. An omitted `model` inherits the orchestrator's model and carries no cost intent, which compounds per-teammate cost across a multi-member team. A closed session at ~14B sub-agent tokens across 30 engagements is the cost shape this rule prevents. The spawn batch aborts if any role lacks an assigned model tier.

**Model tiers.** Cost scales with model tier — `haiku` is the cheapest, the top tier the most capable and most expensive:

| Tier | Agent `model` | Use for |
|---|---|---|
| LOW | `haiku` | mechanical or pattern-following roles |
| MEDIUM | `sonnet` | standard execution roles (the default) |
| HIGH | top tier | reasoning-heavy roles (synthesis, adversarial review, design) |
| MAX | top tier + prompt begins with "Ultrathink — use maximum thinking." | the architect/planner, the one-shot plan-reviewer (plan-review gate), and the verification roles — `code-reviewer` and `qa-tester` — (pinned whenever present); otherwise only when explicitly warranted |

**Top-tier model.** The top tier (HIGH and MAX) means *the most capable model the account can actually spawn* at that moment — the orchestrator resolves it to a concrete `model=` value as it spawns each agent. Today that resolves to `model="opus"` (the latest Opus). A newer *nominal* flagship (e.g. `fable`) counts as stronger **only if this account can actually use it**: some flagships are access-gated (e.g. Fable / Mythos), and a spawn against a gated model dies on arrival with "`<model>` is currently unavailable", taking the role (and, for the wave-0 architect, the whole formation) down with it. So prefer the newest flagship **only when it is genuinely accessible** — if it is gated or unavailable, **fall back to the next tier down (`opus`)**. When unsure which model is strongest *and usable*, default to `opus`, and never resolve the top tier to a model this account cannot spawn. The body refers to tiers (HIGH / MAX), never a hardcoded model name, so no edit is needed when the accessible flagship changes. The `Ultrathink — use maximum thinking.` prefix that separates MAX from HIGH is independent of which concrete model backs the tier.

**Cost framing.** With multiple teammates per task-group across a milestone, model tier dominates the bill. Default-`sonnet`, dropping to `haiku` for mechanical or pattern-following roles and rising to the top tier for reasoning-heavy roles, is the right shape unless the task-group's Role Needs table names a specific high-tier-warranting role. Exception: the architect/planner and the verification roles (`code-reviewer`, `qa-tester`) are MAX whenever present (see **Planner-first, MAX-pinned pivots**) — their reasoning quality compounds across the engagement, so they are exempt from the down-tiering above.

**Mid-task upgrade path.** If a lower-tier member (`haiku` / `sonnet`) fails on a task that needs more reasoning, surface the failure to the coordinator (or the main session); the coordinator surfaces it to the user; the user authorises a one-time per-role upgrade to a higher tier (respawn that role with the new `model`). The upgrade is task-group-scoped — it does not generalise to future task-groups.

**Fresh team per task-group.** Each task-group spawns a fresh team — new team-slug, new inboxes, new briefs constructed from the task-group definition + prior task-group handoff. Teammate context does NOT carry across task-group boundaries. Re-using a member from a prior task-group collapses milestone-scale work into one giant engagement, accumulating context that defeats the cost pattern this rule exists to prevent. Before forming the next task-group's team, verify the prior team is gone: `ls ~/.claude/teams/<prior-team-slug>` returns nothing, and mark the prior `~/.claude/teams-state/<prior-team-slug>.json` registry with `"status": "closed"`.

## Inputs

- **task-group spec:** a path to a markdown or JSON file defining the task-group, or an inline spec in the user's prompt
- **role-overrides:** (optional, `--roles`) explicit role specifications
- **team-slug override:** (optional, `--team-slug`)
- **skip architect:** (optional, `--no-architect`) skip the Phase 0 architect/planner and derive roles via the cascade instead. Use only for trivial mechanical task-groups (a single pattern-following role, ≤2 tasks, no architectural concern) — for anything non-trivial the planner pays for itself.
- **skip plan review:** (optional, `--no-review-plan`) skip the **Adversarial Plan-Review Gate**. The gate is default-on whenever the architect ran; this opts out (e.g. when you trust the plan or want to save the extra MAX agent).

## Read Task-Group Definition

Read the task-group file (or parse the inline spec). Expected fields:

- **Verifiable outcome** (`outcome`)
- **Task list** (`tasks`)
- **Acceptance criteria** (`acceptance_criteria`)
- **Role Needs table** (`role_needs` — role, why, model preference)
- **Tags** (from `role_needs` or `outcome` for type matching)
- **`mandatory_reviewer`** (optional boolean — see **Validate Formation Output**)
- **`task_group_ref`** (optional `{roadmap-slug}/{milestone-slug}/{tg-slug}` identifier; if absent, derive a slug from the outcome)

If required fields (outcome, tasks, acceptance criteria) are missing, ask the user for them before proceeding.

## Phase 0: Plan & Compose (Architect/Planner)

The architect/planner runs FIRST, before any other role, and composes the rest of the team. Default-on; skip it only when `--no-architect` is passed or the task-group is trivial (a single mechanical role, ≤2 tasks, no architectural concern) — then go straight to **Derive Roles** and use the cascade.

1. Generate the team slug (`{tg-slug}-t{attempt}`, or `--team-slug` if given) and `TeamCreate(team_name="{team-slug}")`.
2. Spawn the architect/planner as wave 0 — MAX tier, one call: `Agent(team_name="{team-slug}", name="architect", model="opus", prompt="Ultrathink — use maximum thinking.\n{architect/planner disposition block}\n{task-group context}")` (`opus` = the top tier today — the most capable model available; resolve to a stronger model only if one is genuinely accessible — gated flagships like Fable / Mythos fall back to `opus`, see **Model tiers**). Store its agent ID.
3. Await its reply message — the architect is a persistent teammate, so it `SendMessage`s the lead when done (no synchronous return value); the reply carries the path to its design doc (written to `~/.claude/teams-state/{team-slug}.design.md`) + a **Role Needs table** (the recommended team composition — per role: name, why, scope boundary, model preference). That table is the primary input to **Derive Roles** below (it enters the cascade at Step 2). The architect names the verification roles (a `code-reviewer` always; a `qa-tester` whenever the deliverable is runnable) at MAX tier like itself.
4. The architect then goes idle and remains the standing design advisor for the rest of the engagement. The **design doc is the durable source of truth** — teammates read it first; the live architect is the *fallback* for novel questions it doesn't answer (see **Build Team Prompts**). Persisting the doc means clarification still works even if the architect cannot be re-woken.

An independent reviewer then gates this plan at the **Adversarial Plan-Review Gate** before wave 1 spawns (default-on; `--no-review-plan` to skip).

If the architect fails or times out: fall back to the role-derivation cascade (Steps 2–5) and proceed without a standing advisor; record `"architect": "absent"` in the registry.

## Derive Roles

When Phase 0 ran, the architect's Role Needs table IS the composition: it enters the cascade at Step 2 and supersedes Steps 3–5 (Step 1, role-overrides, still wins over it). The full cascade below is the fallback for when the architect was skipped (`--no-architect` / trivial task-group) or failed.

Role derivation cascade — each step is attempted in order. First match wins.

### Step 1: Role-overrides

**Role-overrides provided:** Use them directly.

### Step 2: Role Needs table

**Role Needs table populated:** Use directly.

### Step 3: Tag-matched type + historical patterns

**Role Needs empty or missing required fields:**

1. Match task-group tags to a type key (implementation, research, verification)
2. Read `~/.claude/teams-state/patterns/formation-{tg-type}.jsonl` (skip if the file doesn't exist)
3. Filter to `verdict: pass`, sort by date descending, take last 5
4. Patterns match: use the most recent passing pattern's composition
5. No patterns match: proceed to Step 4

### Step 4: Dynamic derivation

When no historical pattern matches — novel or blended tasks:

1. Analyze task-group dimensions: identify the key concerns, tensions, or specialist capabilities the task requires
2. Derive one specialist identity per dimension — each role gets a disposition scoped to the specific task, explicit scope boundaries, and success criteria
3. The inline role disposition blocks below (developer, tech-lead, code-reviewer, qa-tester, architect, automation, copywriter, maintainer, project-manager, product-owner, scorer) are available as bases for derived roles but are not required — derivation can generate fresh identities via inline prompts
4. If derivation fails or times out: proceed to Step 5

### Step 5: Static defaults (final fallback)

Use these static role defaults for the matched type. No tags match any type: default to `implementation`.

| Type | Default composition |
|---|---|
| implementation | developer + tech-lead + code-reviewer + qa-tester |
| research | developer (research-scoped) + code-reviewer |
| verification | code-reviewer + qa-tester + automation |

**Output:** Array of `{ name, disposition, scope_boundary, model }` objects. Every role carries its disposition block directly (no external skill references).

## Size Team

Determine team size based on task-group analysis. The cascade above produces role types; this step determines how many members per type.

1. Count tasks, assess interdependence depth (dependency chain length), measure acceptance criteria complexity
2. Match against formation-pattern records (`formation-<type>.jsonl`) for empirically validated sizes
3. Apply cost-model constraints (model tier scales cost — size conservatively; prefer `haiku` for roles whose work is mechanical or pattern-following, reserve the top tier for reasoning-heavy roles)
4. Single-role default: 1 member per derived role. Scale a role to multiple members only when task count for that role's scope exceeds what one member can handle.

**Output:** Final role array with member count per role.

## Validate Formation Output

Check the derived team against the **formation output contract** before proceeding:

1. **Role uniqueness:** Every member has a distinct identity with no overlapping scope boundaries. If overlap detected, merge or re-derive.
2. **Communication topology:** The role set defines who reports to whom, who reviews whose work, and who has final say. If no topology emerges from the roles, inject a coordinator role.
3. **Verification coverage:** At least one verification role is present — a `code-reviewer` for any code-touching deliverable, plus a `qa-tester` whenever the deliverable is runnable / has empirical ACs. If the `mandatory_reviewer` field on the task-group is `true` for the matched type and no verification role exists: ask the user (AskUserQuestion when running in the main session; return `needs_input` text when running as a subagent) — *"Task-group type requires adversarial verification but none derived. Add code-reviewer / qa-tester?"* Options: `Add both` / `Add code-reviewer only` / `Skip`. If confirmed: derive or inject the chosen role(s).
4. **Scaling envelope:** Compute and attach to output — `min_members` (current count), `max_members` (current + headroom based on task count), `cost_ceiling` (the concrete cap on the cost driver: max number of MAX-tier members the team may hold, since MAX dominates the bill — an integer). Runtime scaling may add cheaper members up to `max_members` but must never push MAX-tier headcount past `cost_ceiling`. The envelope enables bounded runtime scaling via Tier 2 escalation by the coordinator.

Validation failure on any check: re-derive (Step 4) if the failure is a role gap or scope overlap (structural — the derived role set is incomplete or conflicting); fall back to Step 5 if re-derivation has already been attempted once or if the failure is a topology absence that the derived roles cannot resolve (i.e., no additional role type could add a coordinator without duplicating an existing one). Do not proceed with a team that fails the contract. When the architect ran, route a structural failure to it for a composition revision (via `SendMessage`) instead of re-deriving through the cascade.

## Adversarial Plan-Review Gate

A bad plan propagates into every wave-1 brief, so the plan is gated by an INDEPENDENT reviewer before the team forms — the adversarial counterpart to the **Validate Formation Output** mechanical checks. Default-on whenever the architect ran; skipped when `--no-review-plan` is set or the architect was skipped (`--no-architect` / trivial task-group — no architect, no plan to gate).

**Spawn** one plan-reviewer — MAX tier, one-shot (it does NOT persist), independent on both axes: it is NOT the architect (self-review shares the author's blind spots) and NOT the wave-1 `code-reviewer` (which must stay independent to review the implementation later). Inline the **plan-reviewer** disposition block from [`references/role-dispositions.md`](references/role-dispositions.md) — a fixed, non-derivable block dedicated to this gate (it reviews a design doc by hand and does NOT run `/code-review`, unlike the wave-1 `code-reviewer`) — prefixed with the MAX-tier `Ultrathink — use maximum thinking.` and pointed at the plan artifact:

`Agent(team_name="{team-slug}", name="plan-reviewer", model="opus", prompt="Ultrathink — use maximum thinking.\n{plan-reviewer disposition block}\n{design doc + sized composition + task-group context}")` (`opus` = the top tier today — the most capable model available; resolve to a stronger model only if one is genuinely accessible — gated flagships like Fable / Mythos fall back to `opus`, see **Model tiers**)

**Loop (bounded — at most 2 REVISE rounds):**

1. PASS → proceed to **Build Team Prompts**.
2. REVISE → `SendMessage` the findings to the architect (still alive from Phase 0). It issues a versioned design/composition revision (per its disposition), then re-run **Size Team** + **Validate Formation Output** and re-spawn the plan-reviewer on the revised plan.
3. Still REVISE after 2 rounds → escalate, do not silently proceed: AskUserQuestion in the main session — *"Plan-reviewer's findings unresolved after 2 rounds. How to proceed?"*, options `Proceed with current plan` / `Revise manually` / `Abort formation`; return `needs_input` with the outstanding findings when running as a subagent.

Log each gate outcome (verdict, round count, findings summary) as a JSON line to `~/.claude/teams-state/{team-slug}.log.jsonl`. The plan-reviewer is one-shot — it is NOT added to the registry's member list.

## Build Team Prompts

For each role, build the spawn prompt by inlining the role's disposition block plus the task-group context. The disposition blocks below carry only constraints that override model-default behavior; common-sense competence is not restated.

```
prompt = "{role-disposition-block}
**Verifiable outcome:** {from task-group}
**Assigned tasks:** {role tasks}
**Acceptance criteria:** {from task-group}
**Team Context:** Communication: SendMessage to teammates. Report to tech-lead.
  Task list: shared TaskList + TaskUpdate.
  Teammates: {role names + roles}
  Clarification: read the design doc at `~/.claude/teams-state/{team-slug}.design.md` FIRST; if your design-intent, scope-boundary, or interface question isn't answered there, SendMessage the architect/planner ({architect name}) — the standing design authority, available the whole engagement.
{Domain Context — code-reviewer / qa-tester only; omit for all other roles (see Derive Domain Context for the Verification Roles)}
{Role Context — code-reviewer / qa-tester only; omit for all other roles (see Derive Domain Context for the Verification Roles)}
Workspace: {session primary working directory}"
```

For MAX-tier roles, prefix the prompt with: `Ultrathink — use maximum thinking.`

### Role disposition blocks

The 11 reusable disposition blocks — **developer, tech-lead, code-reviewer, qa-tester, architect/planner, automation, copywriter, maintainer, project-manager, product-owner, scorer** — live in [`references/role-dispositions.md`](references/role-dispositions.md), loaded only here at prompt-build time (progressive disclosure). Read `${CLAUDE_PLUGIN_ROOT}/skills/team-forming/references/role-dispositions.md`, take the block matching each derived role, and inline it into the prompt template above — substituting `{team-slug}`, `{architect name}`, and the like. The same file also carries one FIXED, non-derivable block — **plan-reviewer** — which the **Adversarial Plan-Review Gate** spawns directly (not through role derivation); it has its own dedicated block rather than borrowing the `code-reviewer`'s.

For dynamically derived roles (Step 4) with no matching block, write the disposition inline the same way (default `sonnet`; HIGH tier when it calls for multi-step synthesis or adversarial reasoning).

### Derive Domain Context for the Verification Roles

When building a `code-reviewer` or `qa-tester` prompt (apply to both):

1. Extract domain signals: task-group tags, verifiable outcome, acceptance criteria, roadmap goal, milestone objective, project CLAUDE.md conventions
2. Build domain-context string — one line naming the domain and 3-5 expertise areas. Example: `"Authentication expertise: credential storage, session management, OWASP top 10, input validation"`
3. Enrich with historical patterns: read `~/.claude/teams-state/patterns/review-{domain}.jsonl` — filter to 5 most recent, extract criteria that caught defects and domain constraints. File missing or no patterns found: proceed with steps 1-2 only.
4. Insert into the prompt template's verification-role sections: Domain Context = expertise string + findings, Role Context = `"Domain-informed verifier: check artifacts against domain constraints. Flag domain-specific gaps beyond acceptance criteria."`

## Spawn Team (Wave 1)

The team and the architect/planner already exist from **Phase 0** (when it ran); this step spawns the remaining roles in one batch.

1. If Phase 0 was skipped (`--no-architect` / trivial task-group): generate the team slug (`{tg-slug}-t{attempt}`, e.g. `auth-impl-t1`, unless `--team-slug` was given) and `TeamCreate(team_name="{team-slug}")` now.
2. For each remaining role: `Agent(team_name="{team-slug}", name="{role-name}", model="{haiku|sonnet|opus}", prompt="{prompt from Build Team Prompts}")` — spawn the whole batch in one message so members run concurrently. The `code-reviewer` and `qa-tester` roles are MAX tier, so their prompts take the `Ultrathink — use maximum thinking.` prefix.
3. Store each agent ID from the spawn response keyed by role name (the architect's ID is already stored from Phase 0).
4. **Brief-acknowledgement handshake:** confirm each member has acknowledged its brief (an initial `ready`/`ack`) before declaring the team formed. If a member has not acknowledged, re-send its brief once via `SendMessage`; if it still does not, escalate (AskUserQuestion in the main session / `needs_input` as a subagent) rather than proceeding with a silently-absent role.

## Register Team

Write `~/.claude/teams-state/{team-slug}.json`. The architect/planner is recorded as a `persistent_advisor` member so the coordinator keeps it alive for clarifications and does not treat the engagement as done when its wave-0 plan returns:

```json
{
  "team_slug": "...",
  "task_group_ref": "...",
  "status": "active",
  "created": "<ISO date>",
  "design_doc": "~/.claude/teams-state/{team-slug}.design.md",
  "members": [
    {"name": "architect", "model": "opus", "agent_id": "...", "persistent_advisor": true, "disposition_summary": "planner (wave 0) + standing design authority"},
    {"name": "...", "model": "...", "agent_id": "...", "disposition_summary": "..."}
  ],
  "contract": {"role_uniqueness": true, "topology": "...", "verification_coverage": true},
  "scaling_envelope": {"min_members": N, "max_members": N, "cost_ceiling": M}
}
```

## Return

Return to the caller (main session or coordinating agent):

- team-slug
- member list with agent IDs
- design-doc path (`~/.claude/teams-state/{team-slug}.design.md`) when the architect ran
- formation output contract (role uniqueness, topology, verification coverage)
- scaling envelope (min_members, max_members, cost_ceiling)

## After the Engagement — PR-level Review

The `code-reviewer` member is the *in-engagement* gate: it reviews each deliverable against its ACs while the team works. It is NOT a substitute for a final review of the team's assembled output. Once the engagement produces a cohesive diff/PR, the orchestrator (or the user) should run **`/xorio:review-pr`** on it — the heavyweight, looped, multi-lens + adversarially-validated PR review that also applies verified fixes.

This is a layer *above* this skill — **do NOT invoke `/xorio:review-pr` from inside a member.** It spawns its own agent fleet (and may drive the **Workflow** tool, which is one-level-only), it *fixes* code (breaking the member's report-don't-fix independence), and it is PR/diff-scoped (`gh`, BASE/HEAD SHAs) rather than task-group-scoped. Nesting it breaks the member's independence, tool boundary, and cost control. Per-task-group `code-reviewer` in the loop; `/xorio:review-pr` on the final diff.

## Formation Failure & Abort

Formation can fail or be aborted at several points — the architect fails and the fallback cascade still cannot produce a contract-valid team; the **Adversarial Plan-Review Gate** escalates to "Abort formation"; the brief-acknowledgement handshake can't reach a member; or the user aborts. On any of these, do NOT leave a half-formed team behind:

1. **Tear down spawned agents.** Send each spawned member (the architect, plus any wave-1 roles) a `shutdown_request`. Teardown is *cooperative* — a member that doesn't approve its own shutdown stays idle until session end (harmless and zero-cost, but not force-terminated); note any that don't confirm rather than assuming a clean kill.
2. **Clear the registry.** If `~/.claude/teams-state/{team-slug}.json` was already written, mark it `"status": "aborted"`; if it was not yet written, do not write it. Either way the slug must not be left as `"status": "active"` — a stale active registry blocks the slug-uniqueness check on the next attempt.
3. **Log it.** Append an abort record (reason, phase reached, gate findings if any) to `~/.claude/teams-state/{team-slug}.log.jsonl`.
4. **Return a clear failure** to the caller — the reason, the phase it failed at, and what was attempted — instead of a partial team. Never hand back a team that did not pass the formation output contract.

## Incremental Formation (Runtime Scaling)

When invoked for runtime scaling (Tier 2 escalation outcome from the coordinator):

1. Receive: existing team-slug, scaling request (role type or capability gap), current team composition
2. Derive the new member role, scoped to the capability gap. Use one of the disposition blocks above if one matches, otherwise build an inline prompt.
3. Validate against the scaling envelope in the registry file — reject if max_members or cost_ceiling would be exceeded
4. Build prompt (include the architect-consult line if the architect is still active), spawn agent with `Agent(team_name=..., name=..., model=...)`, update the registry file's member list
5. Return updated formation output contract (versioned) and updated member list
6. Record the scaling event by appending to `~/.claude/teams-state/patterns/formation-<type>.jsonl` with the planned-vs-actual delta

This is not a full re-formation — it is incremental composition within the existing team context.

## Constraints

- Team slug must be unique within the session (and not collide with an existing `~/.claude/teams-state/<slug>.json` with `"status": "active"`)
- Formation output contract must pass validation before team handoff
- Scaling envelope bounds runtime additions

## Done When

- Architect/planner spawned first and confirmed as standing advisor (unless `--no-architect` / trivial task-group)
- Plan cleared the **Adversarial Plan-Review Gate** (or the gate was skipped via `--no-review-plan` / no architect, or its escalation was resolved by the user)
- All members spawned and acknowledged their briefs (the handshake in **Spawn Team**), or an unacknowledged member was escalated
- Team registered at `~/.claude/teams-state/{team-slug}.json`
- Formation output contract validated
- Team slug, member list, contract, and scaling envelope returned to caller

## Troubleshooting

- **Architect times out or returns no usable plan.** Fall back to the role-derivation cascade (Steps 2–5), proceed without a standing advisor, and record `"architect": "absent"` in the registry. With no architect there is no design doc — teammates rely on the task-group definition directly.
- **The plan-review gate never converges (>2 REVISE rounds).** Stop looping and escalate to the user (`Proceed with current plan` / `Revise manually` / `Abort formation`). Do not silently spawn wave 1 on a contested plan.
- **Slug collision** (`{team-slug}.json` already exists with `"status": "active"`). Either another formation is live, or a prior one was never closed/aborted. Bump the attempt suffix (`-t2`, `-t3`, …), or — if the prior team is genuinely gone — mark its registry `"status": "closed"`/`"aborted"` first (see **Fresh team per task-group** and **Formation Failure & Abort**).
- **A teammate never acknowledges its brief.** Re-send the brief once via `SendMessage`; if still silent, escalate rather than proceeding with an absent role (see the handshake in **Spawn Team**).
- **The architect can't be re-woken for clarification.** Teammates fall back to the design doc at `~/.claude/teams-state/{team-slug}.design.md`, which is the durable source of truth; live consultation is a convenience, not a hard dependency.
- **`model="opus"` is rejected by the spawn.** The harness's top-tier alias may differ — resolve the top tier to whatever concrete most-capable alias the Agent tool accepts (see **Top-tier model**); never silently omit `model` (that violates the **Explicit-per-role-model mandate**).
- **A spawned MAX/HIGH agent reports "`<model>` is currently unavailable" (e.g. Fable / Mythos is access-gated).** The top tier was resolved to a *nominal* flagship this account cannot actually spawn, so that agent is dead on arrival — and if it's the wave-0 architect, formation stalls at Phase 0. You **cannot fix this from inside the agent**: its model is fixed at spawn, so telling it to "use opus" can't re-host it, and while it sits on the unavailable model it can't act at all. Fix at the **orchestrator** — re-resolve the top tier to the most capable *accessible* model (`opus`) and **re-spawn** the affected role(s), or tear down and re-run formation (see **Formation Failure & Abort**). To prevent it, treat any `… is currently unavailable` spawn error as a signal to retry that role one tier down (`opus`) and record the downgrade (see **Top-tier model**).
- **`--no-architect` used on a non-trivial task-group.** You lose the plan, the plan-review gate, and the standing advisor; derivation falls to the cascade. Reserve it for genuinely trivial mechanical work.
- **`TeamCreate` unavailable / `team_name` ignored.** Some harnesses use a single implicit team (`team_name` deprecated and ignored, `TeamCreate` a no-op). The skill still works: spawn each member with the `name` param to make it addressable, use the team-slug only for state-file names, and reach members by name via `SendMessage`. (Confirmed in-harness — a named member spawned, idled, and was re-woken with no explicit `TeamCreate`.)
