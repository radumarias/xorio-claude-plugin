export const meta = {
  name: 'brainstorm-mythos',
  description: 'All-Fable multi-agent brainstorm + adversarial vetting (every agent on Fable with ultrathink max thinking): Map -> Ideate -> Refute -> Debate -> Synthesize',
  phases: [
    { title: 'Map', detail: 'grounded model of the problem', model: 'fable' },
    { title: 'Ideate', detail: 'parallel idea agents across diverse lenses (all Fable, ultrathink)', model: 'fable' },
    { title: 'Refute', detail: 'adversarial verification, 3-validator Fable panel per idea, default-refuted', model: 'fable' },
    { title: 'Debate', detail: 'proponent / skeptic / hybridizer / completeness-critic', model: 'fable' },
    { title: 'Synthesize', detail: 'ranked, vetted report', model: 'fable' },
  ],
}

// ---------------------------------------------------------------------------
// Inputs (from the Workflow `args` object; see SKILL.md for how they're parsed)
// ---------------------------------------------------------------------------
// `args` should be a JSON object, but tolerate a JSON-encoded string (a common
// caller mistake — the Workflow docs warn a stringified value breaks args.*).
let A = args
if (typeof A === 'string') { try { A = JSON.parse(A) } catch (e) { A = {} } }
if (!A || typeof A !== 'object') A = {}
const TOPIC = (A.topic || '').toString().trim()
if (!TOPIC) throw new Error('brainstorm-mythos: args.topic is required (the question/problem to brainstorm).')
const TARGET = (A.target || '').toString().trim()        // path/glob/diff to ground on, or ''
const GROUNDING = (A.grounding || '').toString().trim()  // optional pre-resolved context from the caller
const ROUNDS = Math.max(1, Math.min(8, Number(A.rounds) || 2))
const CAP = Math.max(1, Math.min(40, Number(A.cap) || 12))   // max fresh ideas refuted per round
const HARD_ROUNDS = 8                                        // backstop for the budget-extension loop

// ---------------------------------------------------------------------------
// Model policy: EVERY agent runs on Fable with max thinking. `ultrathink` on
// the first line of every prompt sets the maximum thinking level; model is
// passed explicitly on every call — never inherited, never substituted.
// ---------------------------------------------------------------------------
const FABLE = { model: 'fable' }
const ULTRA = 'ultrathink\n\n'
const BASE = 'Be concrete and specific; prefer precise, reasoned claims over vague ones, and quantify impact whenever possible. '
let nAgents = 0
const launched = () => { nAgents++ }

// Refute panel = 3 Fable validators per idea; diversity comes from DISTINCT
// adversarial lenses in fresh isolated contexts (not model families).
const VERIFY_THRESHOLD = 2  // an idea survives iff >= 2 of 3 validators rate it real

// Three adversarial lenses, one per validator slot.
const REF_LENSES = [
  { k: 'feasibility', p: 'FEASIBILITY: can this actually be built/done given the constraints and unknowns? What blocks it? Does it violate a hard constraint or fail the success metric?' },
  { k: 'magnitude', p: 'MAGNITUDE / IMPACT: would the benefit actually be meaningful, or marginal/placebo? Quantify. If the gain is negligible against the success metric, say so plainly.' },
  { k: 'tradeoffs', p: 'TRADEOFFS & HIDDEN COSTS: complexity, maintenance, fragility, new risks, second-order effects, who pays the cost. Do the downsides outweigh the benefit?' },
]

const TOPIC_BLOCK =
  '\nBRAINSTORM TOPIC / PROBLEM:\n' + TOPIC + '\n' +
  (TARGET ? '\nGROUNDING TARGET (you MAY read these files / this diff to ground your reasoning): ' + TARGET + '\n' : '') +
  (GROUNDING ? '\nCALLER-PROVIDED CONTEXT:\n' + GROUNDING + '\n' : '')

// ---------------------------------------------------------------------------
// Lens sets. `generic` fits any topic; `optimization` is a perf preset. A
// caller may also pass a custom array of lens prompt strings via args.lenses.
// ---------------------------------------------------------------------------
const GENERIC_LENSES = [
  { k: 'first-principles', p: 'Strip the problem to fundamentals and question every assumption in the framing. What is the irreducible core, and what becomes possible if a commonly-assumed constraint were removed?' },
  { k: 'eliminate-work', p: "Don't do it faster — don't do it at all. What can be removed, precomputed, cached, made lazy, batched, or avoided entirely? Attack the existence of the work, not its speed." },
  { k: 'decouple-parallelize', p: 'Restructure: decoupling, pipelining, parallelism, async, splitting responsibilities, changing where/when work happens. What ordering or boundary change unlocks a better approach?' },
  { k: 'radical-redesign', p: 'Propose a bold, from-scratch alternative — a different architecture, tool, or paradigm — even if it is a big change. Describe what it replaces and why it could be far better.' },
  { k: 'cheaper-substitute', p: 'Swap a component/algorithm/tool/dependency for a simpler, cheaper, or more robust one. What approximations or "good enough" substitutes buy most of the value for a fraction of the cost?' },
  { k: 'skeptic-measurement', p: 'Be the skeptic: what do we actually know vs assume? Which directions are likely dead ends? Define the metric of success and the cheapest experiments/measurements that would tell us which ideas are worth pursuing.' },
]
const OPTIMIZATION_LENSES = [
  { k: 'algorithmic', p: 'Algorithmic & data-structure lens: complexity, the actual hot path, better algorithms/data structures, avoiding redundant computation. Which change moves the dominant cost?' },
  { k: 'memory', p: 'Memory lens: allocations, copies, data layout, cache locality, working-set size, reuse/pooling. Where is memory traffic the bottleneck and how to cut it?' },
  { k: 'io-syscalls', p: 'I/O & syscall lens: number and size of I/O ops, network/disk round-trips, batching, buffering, fewer/cheaper syscalls. What I/O can be removed, batched, or overlapped?' },
  { k: 'concurrency', p: 'Concurrency & parallelism lens: parallelize the hot path, overlap latency, remove contention/locks, pick the right concurrency model. What is serialized that need not be?' },
  { k: 'overhead-startup', p: 'Overhead lens: process/init/cold-start/load-time/framework overhead paid per operation. How to amortize, pool, warm, or avoid that fixed cost?' },
  { k: 'skeptic-measurement', p: 'Measurement-rigor lens: which proposed levers are NOISE vs real? Define the irreducible floor. Propose the exact profiling/benchmark commands that would localize the true bottleneck before optimizing.' },
]
let IDEA_LENSES
if (Array.isArray(A.lenses) && A.lenses.length) {
  IDEA_LENSES = A.lenses.map((x, i) => (x && typeof x === 'object' && x.p) ? x : { k: 'custom' + (i + 1), p: String(x) })
} else if (A.lenses === 'optimization') {
  IDEA_LENSES = OPTIMIZATION_LENSES
} else {
  IDEA_LENSES = GENERIC_LENSES
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const MAP_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    restatement: { type: 'string', description: 'crisp restatement of the real problem/goal' },
    components: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: { name: { type: 'string' }, description: { type: 'string' } },
      required: ['name', 'description'] } },
    constraints: { type: 'array', items: { type: 'string' }, description: 'hard constraints / invariants an idea must not violate' },
    success_metric: { type: 'string', description: 'how we judge whether an idea is good' },
    unknowns: { type: 'array', items: { type: 'string' }, description: 'what we do not yet know that would change the answer' },
    notes: { type: 'string' },
  }, required: ['restatement', 'components', 'constraints', 'success_metric', 'unknowns', 'notes'],
}
const IDEAS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    ideas: { type: 'array', items: { type: 'object', additionalProperties: false,
      properties: {
        title: { type: 'string', description: 'short distinctive name' },
        mechanism: { type: 'string', description: 'what it changes and WHY it helps the goal' },
        expected_gain: { type: 'string', description: 'estimated benefit + reasoning; "unknown — needs validation" allowed' },
        effort: { type: 'string', enum: ['trivial', 'low', 'medium', 'high'] },
        risk: { type: 'string', description: 'main risk to correctness / feasibility / constraints' },
        feasibility: { type: 'string', description: 'how feasible against the stated constraints' },
      }, required: ['title', 'mechanism', 'expected_gain', 'effort', 'risk', 'feasibility'] } },
  }, required: ['ideas'],
}
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    real: { type: 'boolean', description: 'true ONLY if the idea yields a genuine, worthwhile benefit that survives this lens AND the constraints' },
    expected_gain: { type: 'string' },
    confidence: { type: 'number', description: '0..1' },
    why: { type: 'string' },
    killers: { type: 'array', items: { type: 'string' }, description: 'fatal problems found (empty if none)' },
  }, required: ['real', 'expected_gain', 'confidence', 'why', 'killers'],
}

const ideaKey = (it) => (it.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// ---------------------------------------------------------------------------
// Phase: Map — one Fable/ultrathink agent builds the grounded model
// ---------------------------------------------------------------------------
phase('Map')
launched()
const map = await agent(
  ULTRA + BASE + TOPIC_BLOCK +
  '\n\nTASK: Build the most precise, grounded model of this problem BEFORE any ideation. ' +
  (TARGET ? 'First READ the grounding target above to ground yourself in reality. ' : '') +
  'Restate the real goal, decompose the problem into components, list the HARD constraints/invariants an idea must not violate, define the success metric we will judge ideas by, and list the key unknowns. Be concrete and honest about what is and is not known.',
  { ...FABLE, schema: MAP_SCHEMA, label: 'map [fable/ultrathink]', phase: 'Map' })

const CTX = TOPIC_BLOCK + '\n\nGROUNDED MODEL (from a prior agent):\n' + JSON.stringify(map) + '\n'

// ---------------------------------------------------------------------------
// Phases: Ideate -> Refute, repeated `ROUNDS` times (+ optional budget extension)
// ---------------------------------------------------------------------------
const seen = new Set()           // normalized titles seen across all rounds
const allIdeasDeduped = []       // every distinct idea (for synthesis inputs)
const survivors = []             // [{idea, verdicts, realCount}]
const rejected = []              // [{idea, verdicts}]
let rawCount = 0
const roundsLog = []

for (let round = 1; round <= HARD_ROUNDS; round++) {
  const overBase = round > ROUNDS
  if (overBase) {
    const canBudget = budget && budget.total && budget.remaining() > 80000
    if (!canBudget) break
    log('Budget extension → round ' + round + ' (~' + Math.round(budget.remaining() / 1000) + 'k tokens left).')
  }

  // ---- Ideate (one Fable/ultrathink agent per lens) ----
  phase('Ideate')
  const ideaResults = await parallel(IDEA_LENSES.map((l) => {
    launched()
    return () => agent(
      ULTRA + BASE + CTX +
      '\nYOUR LENS — ' + l.k + ': ' + l.p +
      '\n\nTASK: From THIS lens only, emit as many concrete, distinct ideas as you can (aim 4-8) for the topic above. ' +
      'For each: a short title, the precise mechanism (what it changes and WHY it helps), expected gain/impact (quantify if possible), rough effort, the main risk, and feasibility against the constraints. ' +
      (round > 1 ? 'AVOID repeating these already-proposed titles: ' + [...seen].slice(0, 60).join('; ') + '. Push for genuinely new angles. ' : '') +
      'Bold/radical ideas welcome if you label the risk honestly.',
      { ...FABLE, schema: IDEAS_SCHEMA, label: 'idea:' + l.k + ' r' + round + ' [fable/ultrathink]', phase: 'Ideate' })
  }))

  let fresh = []
  for (const r of ideaResults.filter(Boolean)) for (const it of (r.ideas || [])) {
    rawCount++
    const k = ideaKey(it)
    if (k && !seen.has(k)) { seen.add(k); fresh.push(it); allIdeasDeduped.push(it) }
  }
  if (fresh.length === 0) { log('Round ' + round + ': no fresh ideas — stopping early.'); break }
  if (fresh.length > CAP) {
    log('Round ' + round + ': ' + fresh.length + ' fresh ideas → refuting first ' + CAP + ' (rest kept for synthesis inputs).')
    fresh = fresh.slice(0, CAP)
  } else {
    log('Round ' + round + ': ' + fresh.length + ' fresh ideas after dedup.')
  }

  // ---- Refute (3-validator Fable panel per idea, default-refuted) ----
  phase('Refute')
  const judged = await parallel(fresh.map((idea) => () =>
    parallel(REF_LENSES.map((rl) => {
      launched()
      return () => agent(
        ULTRA + BASE + CTX + '\nIDEA UNDER REVIEW:\n' + JSON.stringify(idea) +
        '\n\nYou are an ADVERSARIAL reviewer with the ' + rl.k + ' lens. ' + rl.p +
        '\nDefault to real=false unless the idea clearly survives YOUR lens with a genuine, worthwhile benefit against the success metric and constraints. Be harsh, specific, and concrete about killers.',
        { ...FABLE, schema: VERDICT_SCHEMA, label: 'refute:' + rl.k + ' r' + round + ' [fable/ultrathink]', phase: 'Refute' })
    })).then(vs => {
      const vv = vs.filter(Boolean)
      const realCount = vv.filter(x => x.real).length
      return { idea, verdicts: vv, realCount, survives: realCount >= VERIFY_THRESHOLD }
    })))

  let survThisRound = 0
  for (const j of judged) {
    if (j.survives) { survivors.push(j); survThisRound++ }
    else rejected.push({ idea: j.idea, verdicts: j.verdicts })
  }
  roundsLog.push({ round, fresh: fresh.length, survived: survThisRound })
  log('Round ' + round + ': ' + survThisRound + '/' + judged.length + ' survived adversarial vetting (cumulative survivors: ' + survivors.length + ').')
}

// ---------------------------------------------------------------------------
// Phase: Debate — a Fable/ultrathink panel reacts to the survivors
// ---------------------------------------------------------------------------
phase('Debate')
const ROLES = [
  { k: 'proponent', p: 'PROPONENT: argue for the highest-value survivors; combine compatible ones into a concrete recommended bundle; sketch how each would be implemented and validated.' },
  { k: 'skeptic', p: 'SKEPTIC: push back hard — which survivors are still over-claimed? What is the realistic TOTAL achievable benefit, and where should we just STOP and not bother?' },
  { k: 'hybridizer', p: 'HYBRIDIZER: find non-obvious combinations and second-order ideas the lenses missed (stacking compatible ideas; novel hybrids). Propose 2-3 NEW hybrid ideas with estimates.' },
  { k: 'completeness-critic', p: 'COMPLETENESS CRITIC: what whole modality/approach did everyone miss? Name what was unexplored, whether it is worth pursuing, and what cheap check would confirm it.' },
]
const survForDebate = survivors.map(s => ({ idea: s.idea, realCount: s.realCount, verdicts: s.verdicts }))
const debate = await parallel(ROLES.map((r) => {
  launched()
  return () => agent(
    ULTRA + BASE + CTX +
    '\nSURVIVING IDEAS (passed adversarial vetting):\n' + JSON.stringify(survForDebate) +
    '\n\nALL DISTINCT IDEAS (titles only, incl. rejected):\n' + JSON.stringify(allIdeasDeduped.map(it => it.title)) +
    '\n\nYOUR ROLE — ' + r.k + ': ' + r.p + '\n\nWrite a focused, concrete contribution (not generic). Reference ideas by title. Quantify where possible.',
    { ...FABLE, label: 'debate:' + r.k + ' [fable/ultrathink]', phase: 'Debate' })
}))

log('Model policy: ' + nAgents + ' agents dispatched, all model=fable with ultrathink (max thinking). Refute panel: 3x fable, lens-diverse (' + REF_LENSES.map(l => l.k).join('/') + ').')

// ---------------------------------------------------------------------------
// Phase: Synthesize — one Fable/ultrathink agent writes the final ranked report
// ---------------------------------------------------------------------------
phase('Synthesize')
launched()
const report = await agent(
  ULTRA + BASE + TOPIC_BLOCK +
  '\n\nGROUNDED MODEL:\n' + JSON.stringify(map) +
  '\n\nSURVIVORS + ADVERSARIAL VERDICTS:\n' + JSON.stringify(survivors) +
  '\n\nREJECTED IDEAS (title + killers):\n' + JSON.stringify(rejected.map(r => ({ title: r.idea.title, killers: r.verdicts.flatMap(v => v.killers || []).slice(0, 4) }))) +
  '\n\nDEBATE PANEL:\n' + debate.filter(Boolean).map((d, i) => '### ' + (ROLES[i] ? ROLES[i].k : 'panelist') + '\n' + d).join('\n\n') +
  '\n\nTASK: Produce the FINAL report as GitHub-flavored markdown for a human. Sections:\n' +
  '1. **Bottom line** (2-4 sentences): the best 1-3 things to actually do, and the realistic expected payoff.\n' +
  '2. **Ranked recommendations** — a markdown table: idea | expected gain | effort | risk | confidence | verdict (DO / OPTIONAL / SKIP). Rank by (expected gain × confidence) / (effort + risk). For every DO/OPTIONAL give a concrete how-to (steps / sketch / commands).\n' +
  '3. **Promising combinations** — 1-3 ways to combine ideas into a stronger plan (the "build a few of them out" path).\n' +
  '4. **Rejected & why** (brief, so we do not revisit them).\n' +
  '5. **Validate first** — the cheapest experiments/measurements to confirm the top picks before committing.\n' +
  'Be specific and quantitative. Do not hedge with generic advice. It is fine — often correct — to conclude that only 1-2 ideas are worth it. ' +
  'If no ideas survived vetting, say so plainly and explain what to reconsider.',
  { ...FABLE, label: 'synthesize [fable/ultrathink]', phase: 'Synthesize' })

return {
  topic: TOPIC,
  report,
  stats: {
    rounds: roundsLog,
    raw_ideas: rawCount,
    distinct_ideas: allIdeasDeduped.length,
    survivors: survivors.length,
    rejected: rejected.length,
    agents: nAgents,
    model: 'fable',
    thinking: 'ultrathink (max) on every agent',
    refute_panel: REF_LENSES.map(l => l.k).join('/'),
  },
}
