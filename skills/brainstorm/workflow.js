export const meta = {
  name: 'brainstorm',
  description: 'Multi-agent brainstorm + adversarial vetting for any topic (mixed STRONG/MID tiers, mixed effort, optional cross-model Codex): Map -> Ideate -> Refute -> Debate -> Synthesize',
  phases: [
    { title: 'Map', detail: 'grounded model of the problem' },
    { title: 'Ideate', detail: 'parallel idea agents across diverse lenses (randomized model/effort)' },
    { title: 'Refute', detail: 'adversarial verification, tiered 3-validator panel per idea, default-refuted' },
    { title: 'Debate', detail: 'proponent / skeptic / hybridizer / completeness-critic' },
    { title: 'Synthesize', detail: 'ranked, vetted report' },
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
if (!TOPIC) throw new Error('brainstorm: args.topic is required (the question/problem to brainstorm).')
const TARGET = (A.target || '').toString().trim()        // path/glob/diff to ground on, or ''
const GROUNDING = (A.grounding || '').toString().trim()  // optional pre-resolved context from the caller
const MID_PCT = Math.max(0, Math.min(100, Number(A.mid_pct != null ? A.mid_pct : A.sonnet_pct) || 20)) // sonnet_pct = legacy alias
const ROUNDS = Math.max(1, Math.min(8, Number(A.rounds) || 2))
const CAP = Math.max(1, Math.min(40, Number(A.cap) || 12))   // max fresh ideas refuted per round
const CROSS_MODEL = !!A.cross_model                          // route 3rd refute validator through Codex/GPT
const HARD_ROUNDS = 8                                        // backstop for the budget-extension loop

// Model TIERS, resolved by the caller at run start (see SKILL.md "Model tiers")
// and passed via args.models = { strong, mid, light }. Names are never
// hardcoded here: a missing mapping degrades to inherit-the-session-model.
const MODELS = (A.models && typeof A.models === 'object') ? A.models : {}
const STRONG = MODELS.strong || null  // most capable available (judgment, synthesis)
const MID = MODELS.mid || null        // one tier below (mechanical/structured work)
const mopt = (m) => (m ? { model: m } : {})  // omit model => inherit session model

// ---------------------------------------------------------------------------
// Deterministic per-agent variety. Workflows forbid Math.random/Date (they
// break resume), so variety is derived from the agent's seed via a pure
// xorshift32. ~MID_PCT% on the MID tier, rest STRONG. Effort is conveyed
// through prompt intensity (agent() has NO effort param — only model is a
// real knob).
// ---------------------------------------------------------------------------
let nMid = 0, nStrong = 0, nCodex = 0
const effTally = { high: 0, xhigh: 0, ultracode: 0, max: 0 }
function pick(seed) {
  let h = (seed + 0x9e3779b9) >>> 0
  h ^= h << 13; h >>>= 0
  h ^= h >>> 17
  h ^= h << 5; h >>>= 0
  const tier = (h % 100) < MID_PCT ? 'mid' : 'strong'
  const model = tier === 'mid' ? MID : STRONG
  const effort = ['high', 'xhigh', 'ultracode', 'max'][(h >>> 3) % 4]
  if (tier === 'mid') nMid++; else nStrong++
  effTally[effort]++
  return { tier, model, effort }
}
// Effort-only variant: the Refute panel fixes model by tier, so its slots need
// a varied effort WITHOUT tallying a model that wouldn't actually be dispatched.
function pickEffort(seed) {
  let h = (seed + 0x9e3779b9) >>> 0
  h ^= h << 13; h >>>= 0
  h ^= h >>> 17
  h ^= h << 5; h >>>= 0
  const effort = ['high', 'xhigh', 'ultracode', 'max'][(h >>> 3) % 4]
  effTally[effort]++
  return effort
}
function tank(effort) {
  const base = 'Be concrete and specific; prefer precise, reasoned claims over vague ones, and quantify impact whenever possible. '
  if (effort === 'max') return 'Reason at MAX effort — the deepest, most exhaustive reasoning you can muster. ' + base
  if (effort === 'ultracode') return 'Reason at ULTRACODE (xhigh) effort — exhaustive and adversarial, leave no stone unturned. ' + base
  if (effort === 'xhigh') return 'Reason at XHIGH effort — very high reasoning intensity. ' + base
  return 'Reason at HIGH effort — strong, careful reasoning. ' + base
}
// Refute panel = a TIERED set of validators (mirrors /review-pr). Fixed tier
// per slot for reliable adversarial model-diversity (not randomized).
//   default:       STRONG / STRONG / MID   (within-family diversity)
//   --cross-model: STRONG / MID / Codex    (cross-FAMILY: catches shared blind spots)
const REFUTE_TIERS = CROSS_MODEL
  ? ['strong', 'mid', 'codex']
  : ['strong', 'strong', 'mid']
const VERIFY_THRESHOLD = 2  // an idea survives iff >= 2 of 3 validators rate it real

// Three adversarial lenses, one per validator slot (zipped with REFUTE_TIERS).
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
// Phase: Map — one STRONG/max agent builds the grounded model before ideation
// ---------------------------------------------------------------------------
phase('Map')
const map = await agent(
  tank('max') + TOPIC_BLOCK +
  '\n\nTASK: Build the most precise, grounded model of this problem BEFORE any ideation. ' +
  (TARGET ? 'First READ the grounding target above to ground yourself in reality. ' : '') +
  'Restate the real goal, decompose the problem into components, list the HARD constraints/invariants an idea must not violate, define the success metric we will judge ideas by, and list the key unknowns. Be concrete and honest about what is and is not known.',
  { ...mopt(STRONG), schema: MAP_SCHEMA, label: 'map [strong/max]', phase: 'Map' })

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

  // ---- Ideate (one randomized-model/effort agent per lens) ----
  phase('Ideate')
  const ideaResults = await parallel(IDEA_LENSES.map((l, i) => {
    const v = pick(round * 1000 + 10 + i)
    return () => agent(
      tank(v.effort) + CTX +
      '\nYOUR LENS — ' + l.k + ': ' + l.p +
      '\n\nTASK: From THIS lens only, emit as many concrete, distinct ideas as you can (aim 4-8) for the topic above. ' +
      'For each: a short title, the precise mechanism (what it changes and WHY it helps), expected gain/impact (quantify if possible), rough effort, the main risk, and feasibility against the constraints. ' +
      (round > 1 ? 'AVOID repeating these already-proposed titles: ' + [...seen].slice(0, 60).join('; ') + '. Push for genuinely new angles. ' : '') +
      'Bold/radical ideas welcome if you label the risk honestly.',
      { ...mopt(v.model), schema: IDEAS_SCHEMA, label: 'idea:' + l.k + ' r' + round + ' [' + v.tier + '/' + v.effort + ']', phase: 'Ideate' })
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

  // ---- Refute (tiered 3-validator panel per idea, default-refuted) ----
  phase('Refute')
  const judged = await parallel(fresh.map((idea, ci) => () =>
    parallel(REFUTE_TIERS.map((slotTier, ri) => {
      const rl = REF_LENSES[ri % REF_LENSES.length]
      const eff = pickEffort(round * 1000 + 100 + ci * 3 + ri)  // effort varies; model tier is fixed by the slot
      if (slotTier === 'codex') {
        nCodex++
        return () => agent(codexRefutePrompt(idea, rl), {
          schema: VERDICT_SCHEMA, label: 'refute:' + rl.k + ' r' + round + ' [codex/gpt]', phase: 'Refute',
        })
      }
      const slotModel = slotTier === 'mid' ? MID : STRONG
      if (slotTier === 'mid') nMid++; else nStrong++
      return () => agent(
        tank(eff) + CTX + '\nIDEA UNDER REVIEW:\n' + JSON.stringify(idea) +
        '\n\nYou are an ADVERSARIAL reviewer with the ' + rl.k + ' lens. ' + rl.p +
        '\nDefault to real=false unless the idea clearly survives YOUR lens with a genuine, worthwhile benefit against the success metric and constraints. Be harsh, specific, and concrete about killers.',
        { ...mopt(slotModel), schema: VERDICT_SCHEMA, label: 'refute:' + rl.k + ' r' + round + ' [' + slotTier + '/' + eff + ']', phase: 'Refute' })
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

// The Codex (cross-model) validator: a workflow agent that shells out to the
// Codex CLI to get an INDEPENDENT GPT verdict, then returns the verdict schema.
// Graceful fallback if Codex is unavailable/unauthenticated.
function codexRefutePrompt(idea, rl) {
  const reviewPrompt =
    'CROSS-MODEL ADVERSARIAL REVIEW (' + rl.k + ' lens).' + TOPIC_BLOCK +
    '\nIDEA UNDER REVIEW:\n' + JSON.stringify(idea) +
    '\n\n' + rl.p +
    ' Decide whether the idea yields a genuine, worthwhile benefit that survives this lens AND the stated constraints. Default to NOT real unless it clearly survives. List concrete killers. End with a confidence 0..1.'
  return (
    'You are coordinating a CROSS-MODEL adversarial check: obtain an INDEPENDENT verdict from a different model family (OpenAI GPT, via the Codex CLI), then return it in the required schema.\n\n' +
    'STEP 1 — Run Codex non-interactively, read-only, to a unique temp file, then read it back:\n' +
    '  out=$(mktemp /tmp/codex-bs-XXXXXX.txt)\n' +
    '  codex exec -s read-only -o "$out" ' + (TARGET ? '-C <repo-dir-containing-the-target> ' : '') + '"<REVIEW PROMPT>"\n' +
    '  cat "$out"\n' +
    'Use a short timeout mindset; if it hangs or errors, move to FALLBACK.\n\n' +
    'REVIEW PROMPT to pass to Codex (verbatim intent):\n"""\n' + reviewPrompt + '\n"""\n\n' +
    'STEP 2 — Base your answer PRIMARILY on Codex/GPT\'s output (that independent signal is the whole point). Return the verdict schema: real (bool), expected_gain (string), confidence (0..1), why (string — cite GPT\'s reasoning), killers (string[]).\n' +
    'FALLBACK: if the codex CLI errors, is not authenticated, or returns nothing, set a LOW confidence, put "cross-model unavailable — fell back to local judgment" in `why`, and give your own honest adversarial verdict (default real=false unless it clearly survives).'
  )
}

// ---------------------------------------------------------------------------
// Phase: Debate — a panel reacts to the survivors (randomized model/effort)
// ---------------------------------------------------------------------------
phase('Debate')
const ROLES = [
  { k: 'proponent', p: 'PROPONENT: argue for the highest-value survivors; combine compatible ones into a concrete recommended bundle; sketch how each would be implemented and validated.' },
  { k: 'skeptic', p: 'SKEPTIC: push back hard — which survivors are still over-claimed? What is the realistic TOTAL achievable benefit, and where should we just STOP and not bother?' },
  { k: 'hybridizer', p: 'HYBRIDIZER: find non-obvious combinations and second-order ideas the lenses missed (stacking compatible ideas; novel hybrids). Propose 2-3 NEW hybrid ideas with estimates.' },
  { k: 'completeness-critic', p: 'COMPLETENESS CRITIC: what whole modality/approach did everyone miss? Name what was unexplored, whether it is worth pursuing, and what cheap check would confirm it.' },
]
const survForDebate = survivors.map(s => ({ idea: s.idea, realCount: s.realCount, verdicts: s.verdicts }))
const debate = await parallel(ROLES.map((r, i) => {
  const v = pick(900 + i)
  return () => agent(
    tank(v.effort) + CTX +
    '\nSURVIVING IDEAS (passed adversarial vetting):\n' + JSON.stringify(survForDebate) +
    '\n\nALL DISTINCT IDEAS (titles only, incl. rejected):\n' + JSON.stringify(allIdeasDeduped.map(it => it.title)) +
    '\n\nYOUR ROLE — ' + r.k + ': ' + r.p + '\n\nWrite a focused, concrete contribution (not generic). Reference ideas by title. Quantify where possible.',
    { ...mopt(v.model), label: 'debate:' + r.k + ' [' + v.tier + '/' + v.effort + ']', phase: 'Debate' })
}))

// ---- variety + cross-model accounting ----
const tot = nMid + nStrong
const pctMid = tot ? Math.round(nMid * 100 / tot) : 0
log('Variety (all vetting agents): ' + nMid + ' mid / ' + nStrong + ' strong (~' + pctMid + '% mid); ' +
    'effort high=' + effTally.high + ' xhigh=' + effTally.xhigh + ' ultracode=' + effTally.ultracode + ' max=' + effTally.max + '. ' +
    'Map+Synthesize forced strong/max. Refute panel tiered: ' + REFUTE_TIERS.join('/') +
    ' (tiers resolved as strong=' + (STRONG || 'inherit') + ', mid=' + (MID || 'inherit') + ')' +
    (CROSS_MODEL ? ' (' + nCodex + ' cross-model Codex/GPT validators dispatched).' : '.'))

// ---------------------------------------------------------------------------
// Phase: Synthesize — one STRONG/max agent writes the final ranked report
// ---------------------------------------------------------------------------
phase('Synthesize')
const report = await agent(
  tank('max') + TOPIC_BLOCK +
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
  { ...mopt(STRONG), label: 'synthesize [strong/max]', phase: 'Synthesize' })

return {
  topic: TOPIC,
  report,
  stats: {
    rounds: roundsLog,
    raw_ideas: rawCount,
    distinct_ideas: allIdeasDeduped.length,
    survivors: survivors.length,
    rejected: rejected.length,
    mid: nMid, strong: nStrong, pct_mid: pctMid,
    models: { strong: STRONG || 'inherit', mid: MID || 'inherit' },
    effort: effTally,
    refute_panel: REFUTE_TIERS.join('/'),
    cross_model: CROSS_MODEL, codex_validators: nCodex,
  },
}
