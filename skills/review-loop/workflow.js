export const meta = {
  name: 'review-loop',
  description: 'Simplify, then loop (parallel finders → dedup → adversarial verify → fix), stop when N rounds dry or MAX_ROUNDS hit',
  phases: [
    { title: 'Simplify' },
    { title: 'Review' },
    { title: 'Verify' },
    { title: 'Fix' },
    { title: 'Re-review' },
    { title: 'Critic' },
  ],
}

// ─── args contract (set by SKILL.md before launching) ──────────────────────
// {
//   scope:            "origin/main..HEAD" | "since 2026-05-28" | "HEAD~3..HEAD"
//                     | "working-tree" | "staged" | "unstaged" | "#123"
//   scope_label:      human-readable e.g. "8 commits ahead of origin/main"
//   has_pr:           boolean — include /review in finder panel
//   touches_security: boolean — include /security-review in finder panel
//   with_toolkit:     boolean — include /pr-review-toolkit:review-pr
//   skip_simplify:    boolean
//   strict:           boolean — 4-lens verify, 3/4 majority, +1 round
//   ultra:            boolean — force every agent onto the STRONG tier (overrides session effort)
//   models:           { strong: "<alias>" } — tier→model mapping resolved by the
//                     caller at run start (names are never hardcoded here)
//   max_rounds:       number (small=2, medium=3, large=5, +1 if strict)
//   dry_target:       number (default 2)
//   commit_per_area:  boolean (default true)
// }

if (!args || typeof args !== 'object') {
  throw new Error(`review-loop: args missing or not an object — got ${typeof args}`)
}
if (!args.scope || typeof args.scope !== 'string') {
  throw new Error(`review-loop: args.scope is required (string), got ${JSON.stringify(args.scope)}. Full args: ${JSON.stringify(args)}`)
}

const SCOPE = args.scope
const SCOPE_LABEL = args.scope_label || args.scope
const HAS_PR = !!args.has_pr
const TOUCHES_SECURITY = !!args.touches_security
const WITH_TOOLKIT = !!args.with_toolkit
const SKIP_SIMPLIFY = !!args.skip_simplify
const STRICT = !!args.strict
const ULTRA = !!args.ultra
const MAX_ROUNDS = args.max_rounds ?? 3
const DRY_TARGET = args.dry_target ?? 2
const COMMIT_PER_AREA = args.commit_per_area !== false

log(`args received: ${JSON.stringify({ scope: SCOPE, scope_label: SCOPE_LABEL, has_pr: HAS_PR, touches_security: TOUCHES_SECURITY, with_toolkit: WITH_TOOLKIT, strict: STRICT, ultra: ULTRA, max_rounds: MAX_ROUNDS })}`)

// When --ultra, force the caller-resolved STRONG tier on every agent call
// (args.models.strong — see SKILL.md "Model tiers"). Otherwise — or if the
// caller didn't resolve a mapping — inherit the session model.
const STRONG = (args.models && args.models.strong) || null
const modelOpts = ULTRA && STRONG ? { model: STRONG } : {}

// Finder prompts must be SELF-CONTAINED — describing the review work in-line.
// Do NOT tell the agent to invoke a slash command: agents bound to a structured-output
// schema can only emit one StructuredOutput call, so a freeform skill invocation would
// either swallow the structured call or vice-versa, returning empty findings.
const FINDERS = [
  {
    label: 'code-review',
    always: true,
    prompt: scope => (
      `Code-review the git diff for range \`${scope}\`. Run \`git diff ${scope}\` to read the changes. ` +
      `Look for: correctness bugs (off-by-one, nil/None, missing await, wrong-variable copy-paste, error swallowed in catch), ` +
      `cross-file breakage (new precondition, changed return shape, broken caller), language pitfalls (Rust borrowck/Send-Sync misuse, async cancellation, ` +
      `JS falsy-zero, Python late-binding closure), and dropped invariants (removed guard, narrowed validation, deleted test that was covering a real case). ` +
      `Each finding must name a concrete failure mode (inputs/state → wrong output/crash). Skip pure style/preference. ` +
      `Return up to 12 findings, ranked most-severe first.`
    ),
  },
  {
    label: 'security-review',
    when: TOUCHES_SECURITY,
    prompt: scope => (
      `Security-review the git diff for range \`${scope}\`. Run \`git diff ${scope}\` to read the changes. ` +
      `Focus ONLY on newly-introduced vulnerabilities with concrete exploit paths: auth/authz bypass, injection (SQL, command, path-traversal), ` +
      `deserialization, broken crypto/signature checks, leaked secrets in logs, missing JWT exp/aud/iss validation, weak constant-time comparisons, ` +
      `CORS misconfiguration, SSRF with host/protocol control. Each finding needs: file, line, severity, exploit scenario, recommendation. ` +
      `Do NOT report: DoS, theoretical races, memory safety in Rust, log-spoofing concerns, lack of hardening. ` +
      `Be high-confidence — better to miss a theoretical issue than flood with false positives. Return up to 8 findings.`
    ),
  },
  {
    label: 'pr-review',
    when: HAS_PR,
    prompt: scope => (
      `Behavioral review of the diff for range \`${scope}\`. Run \`git diff ${scope}\`. ` +
      `Hunt specifically for what an experienced reviewer would catch on a PR: silent failures (catch blocks that swallow errors), ` +
      `inadequate fallbacks, comment rot (comments that no longer match the code), missing test coverage for new branches, ` +
      `type-design weaknesses (invariants expressible at type level but encoded at runtime). ` +
      `Each finding needs concrete evidence. Skip overlap with code-review's territory. Return up to 8 findings.`
    ),
  },
  {
    label: 'pr-toolkit',
    when: WITH_TOOLKIT,
    prompt: scope => (
      `Comprehensive review of the diff for range \`${scope}\`. Run \`git diff ${scope}\`. ` +
      `Cover all reviewer angles: bugs, security, comments/docs accuracy, test coverage gaps, error-handling silent failures, type-design issues, ` +
      `style/maintainability. Cast wide net but require evidence per finding. Return up to 15 findings, ranked.`
    ),
  },
].filter(f => f.always || f.when)

const LENSES = STRICT
  ? ['correctness', 'security', 'maintainability', 'edge-cases']
  : ['correctness', 'security', 'maintainability']
const VERIFY_THRESHOLD = STRICT ? 3 : 2  // votes-not-refuted needed to survive

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          title: { type: 'string' },
          evidence: { type: 'string' },
          suggested_fix: { type: 'string' },
        },
        required: ['file', 'title', 'evidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['findings'],
  additionalProperties: false,
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    refuted: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['refuted', 'reason'],
  additionalProperties: false,
}

const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['gaps'],
  additionalProperties: false,
}

const findingKey = f => `${f.file}:${f.line ?? '?'}:${(f.title || '').slice(0, 80)}`

log(`scope: ${SCOPE_LABEL}`)
log(`finders: ${FINDERS.map(f => f.label).join(', ')}`)
log(`verify: ${LENSES.length} lenses, ≥${VERIFY_THRESHOLD} not-refuted to survive`)
log(`stop: ${DRY_TARGET} dry rounds or MAX_ROUNDS=${MAX_ROUNDS}`)
if (ULTRA) log(`--ultra: forcing the STRONG tier on every agent (resolved: ${STRONG || 'unresolved — inheriting session model'})`)

// ─── Phase 1: simplify ───────────────────────────────────────────────────
if (!SKIP_SIMPLIFY) {
  phase('Simplify')
  await agent(
    `Run /simplify on the diff (${SCOPE}). Apply only the verified cleanups (reuse, simplification, efficiency, altitude) — do NOT hunt for bugs. ` +
    `${COMMIT_PER_AREA ? 'Commit per logical area with conventional-commit messages.' : 'Do not commit — leave changes staged.'} ` +
    `Return a one-paragraph summary of what was changed and what was skipped.`,
    { label: 'simplify', phase: 'Simplify', ...modelOpts }
  )
} else {
  log('skipping /simplify (--skip-simplify)')
}

// ─── Phase 2: loop ───────────────────────────────────────────────────────
const seen = new Set()
const suppressed = []
const roundsLog = []
let dry = 0

for (let round = 1; round <= MAX_ROUNDS && dry < DRY_TARGET; round++) {
  const phaseName = round === 1 ? 'Review' : 'Re-review'
  phase(phaseName)
  log(`── round ${round} ──`)

  const raw = await parallel(FINDERS.map(f => () =>
    agent(
      f.prompt(SCOPE) + ` Report findings only — do NOT apply fixes. Return as the StructuredOutput call when done.`,
      { label: `${f.label}:r${round}`, phase: phaseName, schema: FINDINGS_SCHEMA, ...modelOpts }
    )
  ))

  const allFindings = raw.filter(Boolean).flatMap(r => r.findings || [])
  const fresh = allFindings.filter(f => !seen.has(findingKey(f)))
  log(`round ${round}: ${allFindings.length} raw, ${fresh.length} fresh (after dedup vs seen)`)

  if (!fresh.length) {
    dry++
    roundsLog.push({ round, raw: allFindings.length, fresh: 0, verified: 0, fixed: 0, dry_streak: dry })
    continue
  }
  fresh.forEach(f => seen.add(findingKey(f)))

  // Adversarial verify — each finding judged by N lenses, default refuted on uncertainty.
  phase('Verify')
  const judged = await parallel(fresh.map(f => () =>
    parallel(LENSES.map(lens => () =>
      agent(
        `You are a skeptical ${lens} reviewer. Try to refute this finding. ` +
        `Default to refuted=true if uncertain — we want to reject false positives. ` +
        `Finding:\n${JSON.stringify(f, null, 2)}\n\nReturn {refuted: bool, reason: string}.`,
        { label: `verify:${lens}:${findingKey(f).slice(0, 40)}`, phase: 'Verify', schema: VERDICT_SCHEMA, ...modelOpts }
      )
    )).then(votes => {
      const v = votes.filter(Boolean)
      const survives = v.filter(x => !x.refuted).length >= VERIFY_THRESHOLD
      return { f, survives, votes: v }
    })
  ))

  const verified = judged.filter(j => j.survives).map(j => j.f)
  const rejected = judged.filter(j => !j.survives)
  rejected.forEach(r => suppressed.push({
    finding: r.f,
    votes: r.votes.map(v => ({ refuted: v.refuted, reason: v.reason })),
  }))
  log(`round ${round}: ${verified.length} verified, ${rejected.length} suppressed as false positive`)

  if (!verified.length) {
    dry++
    roundsLog.push({ round, raw: allFindings.length, fresh: fresh.length, verified: 0, fixed: 0, dry_streak: dry })
    continue
  }
  dry = 0

  phase('Fix')
  await agent(
    `Apply fixes for these ${verified.length} verified findings on the current branch. ` +
    `For each: read the file, make the minimum change that addresses the finding, run a quick check (cargo check / type-check / lint) where applicable. ` +
    `${COMMIT_PER_AREA ? 'Commit per logical area with conventional-commit messages.' : 'Stage but do not commit.'} ` +
    `If a fix would require changes well outside the diff scope, skip it and note the skip in your return value.\n\n` +
    `Findings:\n${JSON.stringify(verified, null, 2)}`,
    { label: `fix:r${round}`, phase: 'Fix', ...modelOpts }
  )

  roundsLog.push({ round, raw: allFindings.length, fresh: fresh.length, verified: verified.length, fixed: verified.length, dry_streak: 0 })
}

// ─── Phase 3: completeness critic ────────────────────────────────────────
phase('Critic')
const fixedSummary = roundsLog.map(r => `r${r.round}: raw=${r.raw} fresh=${r.fresh} verified=${r.verified}`).join('; ')
const critic = await agent(
  `You are a completeness critic for a code review pass. Range: \`${SCOPE}\`. ` +
  `Reviewers ran for ${roundsLog.length} rounds. Per-round: ${fixedSummary}. ` +
  `${seen.size} unique findings surfaced, ${suppressed.length} suppressed as false positives. ` +
  `Spend AT MOST ~5 tool calls (git diff --stat, a couple of targeted greps). Do NOT do open-ended exploration. ` +
  `Identify concrete coverage gaps: a file in the diff that no finding touched, a reviewer angle that didn't run, a claim from a finding that wasn't verified. ` +
  `If everything looks adequately covered, return {gaps: []} — that's a valid answer. Max 5 gaps. No padding.`,
  { label: 'critic', phase: 'Critic', schema: CRITIC_SCHEMA, ...modelOpts }
)

const converged = dry >= DRY_TARGET
return {
  scope: SCOPE_LABEL,
  converged,
  stopped_reason: converged ? `${dry} consecutive dry rounds` : `hit MAX_ROUNDS=${MAX_ROUNDS}`,
  rounds: roundsLog,
  total_verified: seen.size - suppressed.length,
  total_suppressed: suppressed.length,
  suppressed_sample: suppressed.slice(0, 5),
  completeness_gaps: critic?.gaps || [],
}
