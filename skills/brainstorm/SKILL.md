---
name: brainstorm
description: 'Brainstorm [topic] [--target P] [--rounds N=2] [--mid-pct P=20] [--lenses generic|optimization] [--cross-model] [--out FILE] [+Nk]. Multi-agent fan-out: ideate across diverse lenses (mixed STRONG/MID model tiers, mixed effort) → adversarially refute → debate → synthesize a ranked report. Use when the user asks to "brainstorm", "give me several ideas/options for X", "ways to optimize/speed up X", or "explore approaches to X". This is the DEFAULT brainstorm variant — prefer it unless the user explicitly says "mythos" or asks for the all-Fable variant (then use brainstorm-mythos).'
argument-hint: "<topic> [--target P] [--rounds N] [--mid-pct P] [--lenses generic|optimization] [--cross-model] [--out FILE]"
allowed-tools: ["Workflow", "Bash", "Read", "Grep", "Glob", "Write", "Task"]
---

# brainstorm

Run a structured multi-agent brainstorm on a topic: a `Map → Ideate → Refute →
Debate → Synthesize` Workflow that emits many ideas across diverse lenses,
**adversarially vets** each (default-refuted majority vote), debates the
survivors, and returns a **ranked, vetted report**. Built for two jobs:
**optimizing something specific**, and **getting several ideas to build a few of
them out**.

The orchestration lives in `workflow.js` (next to this file). This skill's job is
to parse the request, ground it lightly, launch the workflow, and present results.

## Model tiers — resolve at runtime, never hardcode

This skill refers to model *tiers*, not model names. Resolve them once at run
start from the runtime environment — never from this file:

- **STRONG** — the most capable Claude model currently available. Identify it
  from the session environment (the system context names the current flagship)
  and the Agent/Workflow tool's `model` options. Use the flagship for STRONG
  even if the session runs on a cheaper model; when the session model already
  IS the flagship, omit the `model` param and inherit it.
- **MID** — one tier below STRONG: capable and cheaper; mechanical/structured
  work (extraction, summarizing, convention checks).
- **LIGHT** — the smallest/cheapest available tier: trivial gates, yes/no checks.

`workflow.js` cannot read the environment itself — resolve the tiers BEFORE
launching and pass them as `args.models = { strong, mid, light }` (concrete
aliases from the Workflow tool's `model` options). If a tier is omitted, the
script degrades safely: those agents inherit the session model. Model names
must never be written into this skill or `workflow.js`; when a newer flagship
ships, this rule adopts it automatically.

## Usage

```
/brainstorm <topic / question>  [flags]
```

Flags:
- `--target <path|glob|diff>` — code/files/diff to ground on. The Map agent reads it.
- `--rounds N` — Ideate→Refute waves before synthesis (default 2). This is the depth knob.
- `--mid-pct P` — % of Ideate/Debate agents on the MID tier, rest STRONG (default 20; your 10–30%). `--sonnet-pct` is accepted as a legacy alias.
- `--lenses generic|optimization` — idea-generation lens set (default generic).
- `--cross-model` — make the 3rd adversarial validator a **Codex/GPT** review (cross-family). Default off.
- `--out <file>` — report path (default `BRAINSTORM-<slug>-<date>.md` in the cwd).
- A `+Nk` budget directive (e.g. `+400k`) → the workflow runs extra Ideate→Refute waves until ~spent.

If no topic is given, print the usage block above and stop.

## What it does (engine summary)

- **Map** (STRONG/max): grounded model — restated goal, components, hard constraints, success metric, unknowns. Reads `--target` if given.
- **Ideate** (one agent per lens, **randomized** tier+effort): structured ideas; deduped across rounds.
- **Refute** (tiered 3-validator panel per idea, **default-refuted**, survives iff ≥2/3 rate it real):
  - default panel `STRONG / STRONG / MID`; with `--cross-model` → `STRONG / MID / Codex/GPT`.
- **Debate**: proponent / skeptic / hybridizer / completeness-critic.
- **Synthesize** (STRONG/max): the final ranked markdown report (bottom line → ranked table with verdicts & how-to → promising combinations → rejected & why → validate-first).

Honesty notes: **effort tiers (`high/xhigh/ultracode/max`) are conveyed via prompt
intensity**, not a model knob — `agent()` only takes a real `model`. Variety is
**deterministic** (seeded), so re-runs are resumable. There is **no wall clock** in a
workflow — bound depth with `--rounds`/`+Nk`, not minutes.

## Steps to run

1. **Parse** the `args` string into a `topic` (all non-flag text) and the flags above.

2. **Cross-model probe** (only if `--cross-model`): check Codex readiness once —
   `command -v codex && codex --version`. If present, set `cross_model: true`. If not,
   set `cross_model: false` and remember to note in the summary that it fell back to the
   same-family tiered panel. (Per-agent runtime fallback also handles auth failures.)

3. **Ground lightly** (don't duplicate Map's job): if `--target` is a glob, expand it
   to a few representative paths with Glob; if it's a git range/`diff`, keep it as-is.
   Pass the resolved string through as `args.target`. Heavy reading happens in Map.

4. **Launch the workflow** (resolve the model tiers per the block above first):
   ```
   Workflow({
     scriptPath: "${CLAUDE_PLUGIN_ROOT}/skills/brainstorm/workflow.js",  // workflow.js sits next to this SKILL.md
     args: { topic, target, lenses, mid_pct: P, rounds: N, cross_model,
             models: { strong: "<resolved>", mid: "<resolved>", light: "<resolved>" } }
   })
   ```
   Tell the user they can watch live with `/workflows`. It runs in the background and
   returns `{ topic, report, stats }` when done.

5. **Persist + present** (when it completes):
   - Compute `<slug>` from the topic (lowercase, non-alphanumerics → `-`, trimmed, ≤50 chars)
     and `<date>` via `date +%Y%m%d`.
   - `Write` the returned `report` markdown to `--out` (or `BRAINSTORM-<slug>-<date>.md`
     in the cwd). Prepend a one-line header with the topic and the `stats` summary.
   - In chat, print: the **Bottom line** + the **Ranked recommendations** table from the
     report, the **variety/stats** line (STRONG/MID tier split, effort spread, refute panel,
     any cross-model fallback), and a link to the saved file.

## Cost / when to use

This fans out dozens of agents (≈ lenses + ideas×3 + panel, per round). Use it for
real "give me vetted options" / "optimize this" moments — not quick questions. Scale
down with `--rounds 1` and a small idea cap for a cheap pass; scale up with more
`--rounds` or a `+Nk` budget for a deep one.
