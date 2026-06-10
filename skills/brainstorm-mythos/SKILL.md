---
name: brainstorm-mythos
description: 'Brainstorm-mythos [topic] [--target P] [--rounds N=2] [--lenses generic|optimization] [--out FILE] [+Nk]. All-Fable multi-agent fan-out (every agent on Fable with ultrathink max thinking): ideate across diverse lenses → adversarially refute → debate → synthesize a ranked report. Use ONLY when the user explicitly says "mythos" or asks for the all-Fable / max-thinking brainstorm variant; for any other brainstorm request use the brainstorm skill instead.'
argument-hint: "<topic> [--target P] [--rounds N] [--lenses generic|optimization] [--out FILE]"
allowed-tools: ["Workflow", "Bash", "Read", "Grep", "Glob", "Write", "Task"]
---

# brainstorm-mythos

Run a structured multi-agent brainstorm on a topic: a `Map → Ideate → Refute →
Debate → Synthesize` Workflow that emits many ideas across diverse lenses,
**adversarially vets** each (default-refuted majority vote), debates the
survivors, and returns a **ranked, vetted report**. Built for two jobs:
**optimizing something specific**, and **getting several ideas to build a few of
them out**.

The orchestration lives in `workflow.js` (next to this file). This skill's job is
to parse the request, ground it lightly, launch the workflow, and present results.

## Model policy — Fable for EVERY agent, max thinking, no exceptions

This skill uses exactly ONE model for every agent it spawns: **Fable** (the
`fable` option of the Workflow tool's `model` param). There is no model
tiering, no model mixing, and no cross-family panel — do not use Sonnet,
Opus, Haiku, Codex, or any other model for any mapper, ideator, validator,
debater, or synthesizer.

- `workflow.js` passes `model: 'fable'` explicitly on every `agent()` call —
  never inherited, never substituted.
- **Thinking explicitly at MAX on every agent**: every agent prompt begins
  with the keyword `ultrathink` on its own line; `ultrathink` IS the maximum
  thinking level. This applies to ALL agents — Map, every Ideate lens, every
  Refute validator, every Debate role, and Synthesize. No agent may run at a
  lower thinking level.
- If the `fable` model option is ever unavailable in the runtime, stop and
  report it — do not silently substitute another model.

## Usage

```
/brainstorm-mythos <topic / question>  [flags]
```

Flags:
- `--target <path|glob|diff>` — code/files/diff to ground on. The Map agent reads it.
- `--rounds N` — Ideate→Refute waves before synthesis (default 2). This is the depth knob.
- `--lenses generic|optimization` — idea-generation lens set (default generic).
- `--out <file>` — report path (default `BRAINSTORM-<slug>-<date>.md` in the cwd).
- A `+Nk` budget directive (e.g. `+400k`) → the workflow runs extra Ideate→Refute waves until ~spent.

If no topic is given, print the usage block above and stop.

## What it does (engine summary)

- **Map** (Fable/ultrathink): grounded model — restated goal, components, hard constraints, success metric, unknowns. Reads `--target` if given.
- **Ideate** (one Fable/ultrathink agent per lens): structured ideas; deduped across rounds.
- **Refute** (3-validator Fable/ultrathink panel per idea, **default-refuted**, survives iff ≥2/3 rate it real):
  validator diversity comes from **distinct adversarial lenses** (feasibility / magnitude / tradeoffs) in fresh isolated contexts, not from model families.
- **Debate**: proponent / skeptic / hybridizer / completeness-critic — all Fable/ultrathink.
- **Synthesize** (Fable/ultrathink): the final ranked markdown report (bottom line → ranked table with verdicts & how-to → promising combinations → rejected & why → validate-first).

Honesty notes: `agent()` has no effort knob — max thinking is conveyed by the
`ultrathink` keyword at the top of every prompt. Idea variety is **deterministic**
(no randomness), so re-runs are resumable. There is **no wall clock** in a
workflow — bound depth with `--rounds`/`+Nk`, not minutes.

## Steps to run

1. **Parse** the `args` string into a `topic` (all non-flag text) and the flags above.

2. **Ground lightly** (don't duplicate Map's job): if `--target` is a glob, expand it
   to a few representative paths with Glob; if it's a git range/`diff`, keep it as-is.
   Pass the resolved string through as `args.target`. Heavy reading happens in Map.

3. **Launch the workflow**:
   ```
   Workflow({
     scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/brainstorm-mythos/workflow.js",  // workflow.js sits next to this SKILL.md
     args: { topic, target, lenses, rounds: N }
   })
   ```
   Tell the user they can watch live with `/workflows`. It runs in the background and
   returns `{ topic, report, stats }` when done.

4. **Persist + present** (when it completes):
   - Compute `<slug>` from the topic (lowercase, non-alphanumerics → `-`, trimmed, ≤50 chars)
     and `<date>` via `date +%Y%m%d`.
   - `Write` the returned `report` markdown to `--out` (or `BRAINSTORM-<slug>-<date>.md`
     in the cwd). Prepend a one-line header with the topic and the `stats` summary.
   - In chat, print: the **Bottom line** + the **Ranked recommendations** table from the
     report, the **stats** line (agent count, refute panel, all-Fable/ultrathink policy),
     and a link to the saved file.

## Cost / when to use

This fans out dozens of agents (≈ lenses + ideas×3 + panel, per round) — all on
Fable at max thinking, so it is the most expensive brainstorm variant. Use it for
real "give me vetted options" / "optimize this" moments — not quick questions. Scale
down with `--rounds 1` and a small idea cap for a cheap pass; scale up with more
`--rounds` or a `+Nk` budget for a deep one.
