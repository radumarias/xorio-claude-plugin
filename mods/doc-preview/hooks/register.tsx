import { atom, read, update } from 'claude-code'
import type {
  ElementTable,
  EngineInterface,
  Register,
  RenderChildren,
  RenderElement,
  RenderSurface,
  SelectOption,
  Timer,
} from 'claude-code'

import type { DiagramRender, DocView, GeneratedDoc, PaneSize, Renderers, ReplyDiagram } from '../types'
import {
  MAX_SVG,
  PANE,
  asciiSource,
  baseName,
  countOf,
  diagramKind,
  diagramTitle,
  displayPath,
  errorText,
  expandPath,
  firstLine,
  formatFor,
  formatSize,
  hashText,
  imageBox,
  isMermaidFile,
  isPreviewable,
  isTextChart,
  mermaidSources,
  newestFirst,
  parentDir,
  pngSize,
  previewHtml,
  renderKey,
  rendererError,
  splitDoc,
  stripAnsi,
  tableAsList,
  tableLines,
  textChart,
} from './docs'
import type { InlineFormat, Run, TableLine } from './docs'

type Engine = EngineInterface
/** What the pane can show a document for: a file or a reply's diagram. */
type DocTarget = Exclude<DocView, { kind: 'picker' }>
/** A loaded doc, or why not; `mtimeMs` is the file's time as read, which the poll compares with. */
type Loaded =
  | { title: string; source: string; isMermaid: boolean; path?: string; size?: number; mtimeMs?: number }
  | { error: string; mtimeMs?: number }
type Shown = Exclude<Loaded, { error: string }>
/** A block of the shown doc, prepared once per doc, width, surface and format. */
type DrawnBlock =
  | { kind: 'prose'; text: string }
  | { kind: 'table'; lines: TableLine[] | null; list: string }
  | { kind: 'mermaid'; source: string; title: string; type: string; isText: boolean; chart: string | null; key: string | null }
type Listing = { entries: SelectOption[]; total: number } | { error: string }
type RenderJob = { format: InlineFormat; source: string }
/** What both pane views draw with: the surface's elements, the room, and the state they read. */
type PaneContext = {
  el: ElementTable
  surface: RenderSurface
  columns: number
  offset: number
  cwd: string
  home: string | undefined
  recent: SelectOption[]
  asked: PaneSize
  found: Renderers | null
  done: Record<string, DiagramRender>
  problem: string | null
}

const view = atom({ plugin: 'doc-preview', key: 'view' } as const, null)
const generated = atom({ plugin: 'doc-preview', key: 'generated' } as const, [])
const diagrams = atom({ plugin: 'doc-preview', key: 'diagrams' } as const, [])
const seenAt = atom({ plugin: 'doc-preview', key: 'seenAt' } as const, 0)
const renders = atom({ plugin: 'doc-preview', key: 'renders' } as const, {})
const renderers = atom({ plugin: 'doc-preview', key: 'renderers' } as const, null)
const notice = atom({ plugin: 'doc-preview', key: 'notice' } as const, null)
const sizing = atom({ plugin: 'doc-preview', key: 'size' } as const, { columns: null, isFull: false })

const PLUGIN = 'doc-preview'
/** The command xorio ships (`commands/preview.md`); this mod answers it. */
const COMMAND = 'xorio:preview'
/** Registered only when xorio's command is missing, so the mod still has an entry point. */
const FALLBACK_COMMAND = 'preview'
const MAX_RECENT = 20
const MAX_RENDERS = 40
const MAX_ENTRIES = 300
/** Renders running at once across all passes: each mmdc run starts a headless browser. */
const RENDER_CONCURRENCY = 3
const POLL_MS = 2000
/** `w` and `n` move the pane's width by this many columns, between these bounds. */
const WIDTH_STEP = 20
const MIN_WIDTH = 40
/** Widening stops short of the screen's edge by this many columns; full screen asks for all of it. */
const MIN_TRANSCRIPT = 30
const FULL_FALLBACK = 1000
/** Theme colors for inline code and link text in drawn tables. */
const CODE_COLOR = 'permission'
const LINK_COLOR = 'suggestion'
const BROWSER_HINT = 'press b to see it drawn in the browser.'
const PICK: SelectOption = { value: '', label: 'choose…' }
const SKIPPED_DIRS = new Set(['.git', 'node_modules'])

/** Diagrams waiting to render, the keys being rendered, and the workers draining the queue. */
const queue: RenderJob[] = []
const rendering = new Set<string>()
let workers = 0
/** The render keys the shown doc needs: never pruned from `renders` while it is shown. */
let needed = new Set<string>()
/** The terminal's size and the pane's body width as the pane last drew; what resizing starts from. */
let screen: { columns: number; rows: number } | undefined
let paneColumns: number | undefined
/** Checks the shown file for outside edits; runs only while a file is shown. */
let poll: Timer | null = null
/** The shown doc's load, shared by every caller (even ones arriving mid-load); the key changes with `rev`. */
let loaded: { key: string; doc: Promise<Loaded> } | null = null
/** The shown doc laid out for one width, surface and format: all a scroll's redraw has to reuse. */
let layout: { key: string; blocks: DrawnBlock[]; diagramCount: number } | null = null
/** SVG markup by file, for the svg renders `renders` still holds. */
const svgs = new Map<string, string>()
/** The picker's folder listing, kept across redraws until the picker opens again. */
let listing: { dir: string; result: Listing } | null = null

// ── showing things ──────────────────────────────────────────────────────────

const markSeen = ($: Engine) => update($, seenAt, () => Date.now())

const docKey = (v: DocTarget): string => (v.kind === 'file' ? `file:${v.path}:${v.rev}` : `diagram:${v.id}`)

const titleOf = (v: DocView | null): string =>
  v === null || v.kind === 'picker'
    ? 'Preview · pick a file'
    : v.kind === 'file'
      ? `Preview · ${baseName(v.path)}`
      : 'Preview · diagram'

/**
 * Opens or retitles the pane at the size asked for: the whole screen, a
 * width (`rows` matters only inline above the prompt, `columns` only docked),
 * or, with neither, the engine's default share.
 */
async function openPane($: Engine, shown: DocView | null): Promise<void> {
  const asked = await read($, sizing)
  // Right after a reload the screen is unknown until the pane draws: full then asks for
  // more than any screen has, which the engine clamps to what it can spare.
  const request = asked.isFull
    ? { columns: screen?.columns ?? FULL_FALLBACK, rows: screen?.rows ?? FULL_FALLBACK }
    : asked.columns !== null
      ? { columns: asked.columns }
      : {}
  await $.ui.open({ id: PANE, title: titleOf(shown), focus: true, ...request })
}

/** `w` (+1) and `n` (-1): one step wider or narrower than the pane is now; leaves full screen. */
async function resize($: Engine, direction: 1 | -1): Promise<void> {
  const widest = screen === undefined ? Number.MAX_SAFE_INTEGER : Math.max(MIN_WIDTH, screen.columns - MIN_TRANSCRIPT)
  await update($, sizing, asked => {
    const from = asked.columns ?? paneColumns ?? MIN_WIDTH
    return { columns: Math.min(widest, Math.max(MIN_WIDTH, from + direction * WIDTH_STEP)), isFull: false }
  })
  await openPane($, await read($, view))
}

/** `z`: the whole screen, and back to the width before. */
async function toggleFull($: Engine): Promise<void> {
  await update($, sizing, asked => ({ ...asked, isFull: !asked.isFull }))
  await openPane($, await read($, view))
}

async function showTarget($: Engine, target: DocTarget): Promise<void> {
  const current = await read($, view)
  const next: DocTarget =
    target.kind === 'file' && current?.kind === 'file' && current.path === target.path
      ? { ...target, rev: current.rev + 1 }
      : target
  await Promise.all([update($, view, () => next), update($, notice, () => null), markSeen($)])
  await openPane($, next)
  if (next.kind === 'file') ensurePolling($)
  ensureRenders($)
}

async function showPicker($: Engine, dir?: string): Promise<void> {
  listing = null
  loaded = null
  layout = null
  const next: DocView = { kind: 'picker', dir: dir ?? '' }
  await Promise.all([update($, view, () => next), update($, notice, () => null)])
  await openPane($, next)
}

/** A picked value: `dir:<path>`, `file:<path>` or `diagram:<id>`. */
async function showItem($: Engine, value: string): Promise<void> {
  const [kind, rest] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)]
  if (kind === 'dir') await showPicker($, rest)
  else if (kind === 'file') await showTarget($, { kind: 'file', path: rest, rev: 0 })
  else if (kind === 'diagram') await showTarget($, { kind: 'diagram', id: rest })
}

/** Shows the file again from disk: a new `rev` makes the pane load it afresh. */
async function refresh($: Engine): Promise<void> {
  await update($, view, current => (current?.kind === 'file' ? { ...current, rev: current.rev + 1 } : current))
  ensureRenders($)
}

/** `/xorio:preview [path]`: the picker without a path, else the doc, or why not. */
async function runPreview($: Engine, args: string): Promise<{ text?: string }> {
  const arg = args.trim()
  if (arg === '') {
    await showPicker($)
    return {}
  }
  const problem = await openPath($, arg)

  return problem === undefined ? {} : { text: problem }
}

/** What a typed path or `/xorio:preview <path>` names: a doc, a folder to browse, or why not. */
async function openPath($: Engine, input: string): Promise<string | undefined> {
  const [cwd, home] = await Promise.all([$.session.cwd(), $.env.get('HOME')])
  const path = expandPath(input, cwd, home)
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (stat === undefined) return `Not found: ${input}`
  if (stat.kind === 'dir') {
    await showPicker($, path)
    return undefined
  }
  if (!isPreviewable(path)) {
    return `Not a Markdown or Mermaid file (.md .markdown .mdx .mmd .mermaid): ${input}`
  }
  await showTarget($, { kind: 'file', path, rev: 0 })

  return undefined
}

// ── loading and rendering ───────────────────────────────────────────────────

async function load($: Engine, v: DocTarget): Promise<Loaded> {
  if (v.kind === 'diagram') {
    const diagram = (await read($, diagrams)).find(d => d.id === v.id)
    return diagram === undefined
      ? { error: 'That diagram is no longer in the recent list.' }
      : { title: diagram.title, source: diagram.source, isMermaid: true }
  }
  // The time is taken before the read: an edit landing in between shows as a change on the next poll.
  let mtimeMs: number | undefined
  try {
    const stat = await $.fs.stat(v.path)
    mtimeMs = stat.mtimeMs
    const source = await $.fs.read(v.path)
    return { title: baseName(v.path), source, isMermaid: isMermaidFile(v.path), path: v.path, size: stat.size, mtimeMs }
  } catch (err) {
    return { error: `Can't read ${v.path}: ${errorText(err)}`, mtimeMs }
  }
}

function loadShown($: Engine, v: DocTarget): { key: string; doc: Promise<Loaded> } {
  const key = docKey(v)
  if (loaded?.key !== key) loaded = { key, doc: load($, v) }

  return loaded
}

/** The shown doc's blocks for one width, surface and format, made once and reused by every scroll's redraw. */
function layoutOf(key: string, doc: Shown, columns: number, surface: RenderSurface, format: InlineFormat | null) {
  const layoutKey = `${key}|${columns}|${surface}|${format}`
  if (layout?.key === layoutKey) return layout
  // The terminal's Markdown draws a table at its full width and the terminal wraps the
  // overflow, breaking its borders: there tables are drawn here, fitted to the pane.
  const blocks = splitDoc(doc.source, doc.isMermaid).map((block): DrawnBlock => {
    if (block.kind === 'prose') return block
    if (block.kind === 'table') {
      if (surface !== 'terminal') return { kind: 'prose', text: block.source }
      const lines = tableLines(block.table, columns)
      return { kind: 'table', lines, list: lines === null ? tableAsList(block.table) : '' }
    }
    const { source } = block
    return {
      kind: 'mermaid',
      source,
      title: diagramTitle(source),
      type: diagramKind(source),
      isText: isTextChart(source),
      chart: textChart(source, columns - 4),
      key: format === null ? null : renderKey(source, format),
    }
  })
  layout = { key: layoutKey, blocks, diagramCount: blocks.filter(b => b.kind === 'mermaid').length }

  return layout
}

/** Reads the shown doc's SVG files once each, and forgets the ones `renders` no longer holds. */
async function loadSvgs($: Engine, files: string[], live: Set<string>): Promise<void> {
  for (const file of svgs.keys()) if (!live.has(file)) svgs.delete(file)
  const missing = [...new Set(files)].filter(file => !svgs.has(file))
  if (missing.length === 0) return
  const texts = await Promise.all(missing.map(file => $.fs.read(file).catch(() => '')))
  missing.forEach((file, i) => svgs.set(file, texts[i] ?? ''))
}

async function cacheDir($: Engine): Promise<string> {
  const [xdg, local, home] = await Promise.all([
    $.env.get('XDG_CACHE_HOME'),
    $.env.get('LOCALAPPDATA'),
    $.env.get('HOME'),
  ])

  // `||`, not `??`: a variable set but empty names no folder.
  return `${xdg || local || `${home || '/tmp'}/.cache`}/claude-doc-preview`
}

const failed = (tool: string, ran: { exitCode: number; stdout: string; stderr: string }): DiagramRender => ({
  format: 'error',
  message: firstLine(ran.stderr || ran.stdout) || `${tool} exited ${ran.exitCode}`,
})

async function renderDiagram($: Engine, source: string, format: InlineFormat): Promise<DiagramRender> {
  try {
    if (format === 'ascii') {
      const ran = await $.process.run(['mermaid-ascii'], { stdin: asciiSource(source), timeoutMs: 20_000 })
      return ran.exitCode === 0 ? { format: 'ascii', text: stripAnsi(ran.stdout).trimEnd() } : failed('mermaid-ascii', ran)
    }
    const dir = await cacheDir($)
    const id = hashText(source)
    const output = `${dir}/${id}.${format}`
    // Named by content, so an output an earlier session made is reused rather than drawn again.
    if (!(await $.fs.exists(output))) {
      const input = `${dir}/${id}.${format}.mmd`
      await $.fs.write(input, source)
      const scale = format === 'png' ? ['-s', '2'] : []
      const ran = await $.process.run(
        ['mmdc', '-q', '-i', input, '-o', output, '-b', 'white', ...scale],
        { timeoutMs: 90_000 },
      )
      if (ran.exitCode !== 0) return failed('mmdc', ran)
    }
    if (format === 'svg') {
      const stat = await $.fs.stat(output)
      return stat.size > MAX_SVG
        ? { format: 'error', message: `Too large to draw inline: ${BROWSER_HINT}` }
        : { format: 'svg', file: output }
    }
    const { base64 } = await $.fs.read(output, { as: 'bytes' })
    const size = pngSize(base64)

    return size === null
      ? { format: 'error', message: 'mmdc wrote no PNG.' }
      : { format: 'png', file: output, ...size }
  } catch (err) {
    return { format: 'error', message: errorText(err) }
  }
}

/** Runs work nobody awaits, so a failure lands in the debug log and nowhere else. */
function inBackground($: Engine, work: Promise<void>): void {
  work.catch((err: unknown) => $.ui.log(`doc-preview: ${errorText(err)}`, { to: 'debug' }))
}

const ensureRenders = ($: Engine): void => inBackground($, renderShown($))

/**
 * Queues the shown doc's diagrams that have no render yet, in the format of
 * each surface the session draws on; the pane redraws as each lands. Pie and
 * gantt charts are drawn as text instead, never by mermaid-ascii.
 */
async function renderShown($: Engine): Promise<void> {
  const [v, found, surfaces, done] = await Promise.all([
    read($, view),
    read($, renderers),
    $.session.surfaces(),
    read($, renders),
  ])
  if (v === null || v.kind === 'picker') return
  const formats = new Set(surfaces.map(surface => formatFor(surface, found)).filter(f => f !== null))
  if (formats.size === 0) return
  const doc = await loadShown($, v).doc
  if ('error' in doc) return

  const sources = mermaidSources(doc.source, doc.isMermaid)
  const jobs = [...formats].flatMap(format =>
    sources.filter(source => !(format === 'ascii' && isTextChart(source))).map(source => ({ format, source })),
  )
  needed = new Set(jobs.map(job => renderKey(job.source, job.format)))
  // The queue holds only the shown doc's jobs: a doc no longer shown doesn't keep the
  // workers busy, and a job is queued once however often the doc reloads.
  queue.splice(0, queue.length, ...jobs.filter(job => done[renderKey(job.source, job.format)] === undefined))
  while (workers < RENDER_CONCURRENCY && queue.length > 0) {
    workers += 1
    inBackground(
      $,
      drainQueue($).finally(() => {
        workers -= 1
      }),
    )
  }
}

async function drainQueue($: Engine): Promise<void> {
  for (let job = queue.shift(); job !== undefined; job = queue.shift()) await renderJob($, job)
}

/**
 * Renders one diagram unless another worker is on it or has finished it: the
 * key is claimed before the current renders are read, so it is drawn once.
 */
async function renderJob($: Engine, { format, source }: RenderJob): Promise<void> {
  const key = renderKey(source, format)
  if (rendering.has(key)) return
  rendering.add(key)
  try {
    if ((await read($, renders))[key] !== undefined) return
    const result = await renderDiagram($, source, format)
    await update($, renders, all => pruneRenders({ ...withoutKey(all, key), [key]: result }))
  } finally {
    rendering.delete(key)
  }
}

const withoutKey = <T,>(all: Record<string, T>, key: string): Record<string, T> =>
  Object.fromEntries(Object.entries(all).filter(([k]) => k !== key))

/** Every render the shown doc needs, then the newest others, up to the cap. */
function pruneRenders(all: Record<string, DiagramRender>): Record<string, DiagramRender> {
  const entries = Object.entries(all)
  let spare = entries.length - Math.max(MAX_RENDERS, needed.size)
  if (spare <= 0) return all

  return Object.fromEntries(entries.filter(([key]) => needed.has(key) || spare-- <= 0))
}

async function canRun($: Engine, argv: string[]): Promise<boolean> {
  try {
    return (await $.process.run(argv, { timeoutMs: 30_000 })).exitCode === 0
  } catch {
    return false
  }
}

async function detectRenderers($: Engine): Promise<void> {
  const [ascii, mmdc, term, program, kittyWindow, ghostty] = await Promise.all([
    canRun($, ['mermaid-ascii', '--help']),
    canRun($, ['mmdc', '--version']),
    $.env.get('TERM'),
    $.env.get('TERM_PROGRAM'),
    $.env.get('KITTY_WINDOW_ID'),
    $.env.get('GHOSTTY_RESOURCES_DIR'),
  ])
  const isKitty =
    /kitty|ghostty/i.test(term ?? '') ||
    /kitty|ghostty/i.test(program ?? '') ||
    kittyWindow !== undefined ||
    ghostty !== undefined
  const found: Renderers = { ascii, mmdc, isKitty }
  await update($, renderers, () => found)
  ensureRenders($)
}

/** Registers `/preview` when neither xorio's `/xorio:preview` nor another `/preview` is installed. */
async function registerFallback($: Engine): Promise<void> {
  const commands = await $.command.list()
  if (commands.some(command => command.name === COMMAND || command.name === FALLBACK_COMMAND)) return
  await $.command.register({
    name: FALLBACK_COMMAND,
    description: 'Preview a Markdown or Mermaid file; no path opens a file picker',
    argumentHint: '[path]',
    immediate: true,
  })
}

/** Whether `/preview` is this mod's fallback, not the person's own command or another plugin's. */
async function ownsFallback($: Engine): Promise<boolean> {
  const commands = await $.command.list()
  return commands.some(
    command => command.name === FALLBACK_COMMAND && command.source === 'plugin' && (command.plugin ?? PLUGIN) === PLUGIN,
  )
}

function ensurePolling($: Engine): void {
  if (poll === null) poll = $.clock.every(POLL_MS, () => inBackground($, pollShownFile($)))
}

/**
 * Picks up edits made outside Claude Code while the pane shows a file, by
 * comparing the file's time with the time it was read at; stops once no
 * file is shown.
 */
async function pollShownFile($: Engine): Promise<void> {
  const [v, panes] = await Promise.all([read($, view), $.ui.panes()])
  if (v?.kind !== 'file' || !panes.some(pane => pane.id === PANE)) {
    poll?.cancel()
    poll = null
    return
  }
  const shown = loaded
  if (shown?.key !== docKey(v)) return // a reload is under way
  const [doc, stat] = await Promise.all([shown.doc, $.fs.stat(v.path).catch(() => undefined)])
  if (stat !== undefined && stat.mtimeMs !== doc.mtimeMs) await refresh($)
}

// ── the browser ─────────────────────────────────────────────────────────────

async function openExternal($: Engine, file: string): Promise<boolean> {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const isMac = !isWindows && (await $.fs.exists('/System/Library/CoreServices'))
  const argv = isWindows
    ? ['explorer', file]
    : isMac
      ? ['open', file]
      : // Backgrounded so the browser can't hold the call; a missing xdg-open still fails it.
        ['sh', '-c', 'command -v xdg-open >/dev/null || exit 1; xdg-open "$1" >/dev/null 2>&1 &', 'sh', file]
  try {
    const ran = await $.process.run(argv, { timeoutMs: 15_000 })
    return isWindows || ran.exitCode === 0
  } catch {
    return false
  }
}

async function openInBrowser($: Engine, v: DocTarget): Promise<void> {
  const doc = await load($, v)
  if ('error' in doc) {
    $.ui.toast(doc.error)
    return
  }
  const html = previewHtml({
    title: doc.path ?? doc.title,
    source: doc.source,
    isMermaid: doc.isMermaid,
    baseDir: doc.path === undefined ? undefined : parentDir(doc.path),
  })
  const slug = doc.title.replace(/[^\w.-]+/g, '-').slice(0, 40)
  const file = `${await cacheDir($)}/${slug}-${hashText(doc.source)}.html`
  await $.fs.write(file, html)
  const isOpened = await openExternal($, file)
  $.ui.toast(isOpened ? `Opened ${doc.title} in the browser` : `Couldn't start a browser; the page is at ${file}`)
}

// ── what Claude generates ───────────────────────────────────────────────────

async function recordGenerated($: Engine, path: string): Promise<void> {
  const [, v] = await Promise.all([
    update($, generated, list => newestFirst([{ path, at: Date.now() }], list, d => d.path, MAX_RECENT)),
    read($, view),
  ])
  if (v?.kind === 'file' && v.path === path) await refresh($)
}

async function recordDiagrams($: Engine, sources: string[]): Promise<void> {
  const at = Date.now()
  const found = sources.map((source): ReplyDiagram => ({ id: hashText(source), source, title: diagramTitle(source), at }))
  await update($, diagrams, list => newestFirst(found, list, d => d.id, MAX_RECENT))
}

const textBlocks = (content: unknown): string[] => {
  if (typeof content === 'string') return [content]
  if (!Array.isArray(content)) return []
  return content.flatMap(block => {
    const b = block as { type?: unknown; text?: unknown }
    return b.type === 'text' && typeof b.text === 'string' ? [b.text] : []
  })
}

/** The docs and diagrams from this session, newest first, as Select options. */
function recentOptions(
  docs: readonly GeneratedDoc[],
  replies: readonly ReplyDiagram[],
  cwd: string,
  home: string | undefined,
): SelectOption[] {
  const items = [
    ...docs.map(d => ({ at: d.at, value: `file:${d.path}`, label: displayPath(d.path, cwd, home) })),
    ...replies.map(d => ({ at: d.at, value: `diagram:${d.id}`, label: `◇ ${d.title} (reply, ${clock(d.at)})` })),
  ]

  return items.sort((a, b) => b.at - a.at).map(({ value, label }) => ({ value, label }))
}

const clock = (at: number): string => {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

async function freshItems($: Engine): Promise<{ docs: GeneratedDoc[]; replies: ReplyDiagram[] }> {
  const [seen, docs, replies] = await Promise.all([read($, seenAt), read($, generated), read($, diagrams)])
  return { docs: docs.filter(d => d.at > seen), replies: replies.filter(d => d.at > seen) }
}

/** The newest doc or diagram Claude produced since the person last looked. */
async function newestFresh($: Engine): Promise<DocTarget | null> {
  const { docs, replies } = await freshItems($)
  const doc = docs[0]
  const reply = replies[0]
  if (doc !== undefined && (reply === undefined || doc.at >= reply.at)) {
    return { kind: 'file', path: doc.path, rev: 0 }
  }
  return reply === undefined ? null : { kind: 'diagram', id: reply.id }
}

// ── the pane ────────────────────────────────────────────────────────────────

/** The folder's subfolders and previewable files as picker options, listed once per opening. */
async function listFolder($: Engine, dir: string): Promise<Listing> {
  if (listing?.dir === dir) return listing.result
  const result = await $.fs.list(dir).then(
    async entries => {
      // A link is listed as `other`: follow it to tell a folder from a file.
      const kinds = await Promise.all(
        entries.map(async entry => {
          const path = `${dir === '/' ? '' : dir}/${entry.name}`
          const kind = entry.isLink ? ((await $.fs.stat(path).catch(() => undefined))?.kind ?? 'other') : entry.kind
          return { name: entry.name, path, kind }
        }),
      )
      const sorted = kinds.sort((a, b) => a.name.localeCompare(b.name))
      const options: SelectOption[] = [
        { value: `dir:${parentDir(dir)}`, label: '../' },
        ...sorted
          .filter(entry => entry.kind === 'dir' && !SKIPPED_DIRS.has(entry.name))
          .map(entry => ({ value: `dir:${entry.path}`, label: `${entry.name}/` })),
        ...sorted
          .filter(entry => entry.kind === 'file' && isPreviewable(entry.name))
          .map(entry => ({ value: `file:${entry.path}`, label: entry.name })),
      ]
      return { entries: options.slice(0, MAX_ENTRIES), total: options.length }
    },
    (err: unknown) => ({ error: errorText(err) }),
  )
  listing = { dir, result }

  return result
}

async function renderPicker($: Engine, ctx: PaneContext, dir: string): Promise<RenderElement> {
  const { el, cwd, home, recent, problem } = ctx
  const { Box, Button, Text } = el
  const Select = 'Select' in el ? el.Select : undefined
  const Input = 'Input' in el ? el.Input : undefined
  const folder = await listFolder($, dir)

  return (
    <Box flexDirection="column" rowGap={1}>
      <Text bold>Preview a Markdown or Mermaid file</Text>
      {problem !== null && <Text color="yellow">{problem}</Text>}
      {Input !== undefined ? (
        <Input
          key="path"
          label="Path"
          placeholder="relative to the project, absolute, or ~/…"
          submitLabel="open"
          autoFocus
          onSubmit={async value => {
            const why = await openPath($, value)
            await update($, notice, () => why ?? null)
          }}
        />
      ) : (
        <Text dimColor>{'Type /xorio:preview <path> to open a file.'}</Text>
      )}
      {Select !== undefined && recent.length > 0 && (
        <Select key="recent" label="Recent" options={[PICK, ...recent]} value="" onSelect={value => showItem($, value)} />
      )}
      {Select !== undefined && 'entries' in folder && (
        <Select
          key="browse"
          label={`Browse ${displayPath(dir, cwd, home)}`}
          options={[PICK, ...folder.entries]}
          value=""
          onSelect={value => showItem($, value)}
        />
      )}
      {'error' in folder && <Text color="red">{`Can't list ${dir}: ${folder.error}`}</Text>}
      {'total' in folder && folder.total > MAX_ENTRIES && <Text dimColor>{`Showing the first ${MAX_ENTRIES} entries.`}</Text>}
      <Box>
        <Button key="close" label="Close" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
      </Box>
    </Box>
  )
}

async function renderDoc($: Engine, ctx: PaneContext, v: DocTarget): Promise<RenderElement> {
  const { el, surface, columns, cwd, home, recent, asked, found, done } = ctx
  const { Box, Button, Code, Markdown, Text } = el
  const Select = 'Select' in el ? el.Select : undefined
  const shown = loadShown($, v)
  const doc = await shown.doc
  const current = v.kind === 'file' ? `file:${v.path}` : `diagram:${v.id}`
  const options = recent.some(o => o.value === current)
    ? recent
    : [{ value: current, label: 'path' in doc && doc.path ? displayPath(doc.path, cwd, home) : 'this diagram' }, ...recent]
  const actions = [
    { key: 'browser', hotkey: 'b', label: 'browser', press: () => openInBrowser($, v) },
    { key: 'wider', hotkey: 'w', label: 'wider', press: () => resize($, 1) },
    { key: 'narrower', hotkey: 'n', label: 'narrower', press: () => resize($, -1) },
    { key: 'full', hotkey: 'z', label: asked.isFull ? 'exit full' : 'full', press: () => toggleFull($) },
    ...(v.kind === 'file' ? [{ key: 'reload', hotkey: 'r', label: 'reload', press: () => refresh($) }] : []),
    {
      key: 'pick',
      hotkey: 'f',
      label: 'files',
      press: () => showPicker($, v.kind === 'file' ? parentDir(v.path) : undefined),
    },
    { key: 'close', hotkey: 'q', label: 'close', press: () => $.ui.close({ id: PANE }) },
  ]
  // A plain Button draws `k: label`, two columns apart; the bar wraps onto as many rows as that takes.
  let barRows = 1
  let used = 0
  for (const a of actions) {
    const width = a.hotkey.length + 2 + a.label.length
    if (used > 0 && used + 2 + width > columns) {
      barRows += 1
      used = width
    } else {
      used += (used > 0 ? 2 : 0) + width
    }
  }
  // On the terminal the bar is pinned to the window's top rows: each scroll redraws
  // with the new offset, and an absolute Box paints over the rows beneath it.
  const isPinned = surface === 'terminal'
  const pin = isPinned
    ? ({ position: 'absolute', top: ctx.offset, left: 0, backgroundColor: 'inverseText' } as const)
    : {}
  const toolbar = (
    <Box key="toolbar" flexDirection="row" flexWrap="wrap" columnGap={2} width={columns} height={barRows} overflow="hidden" {...pin}>
      {actions.map(a => (
        <Button
          key={a.key}
          label={a.label}
          hotkey={a.hotkey}
          plain
          {...(a.key === 'close' ? { role: 'dismiss' as const } : {})}
          onPress={a.press}
        />
      ))}
    </Box>
  )
  /** The page under the bar: pinned, the bar overlays the first rows, so the page starts below them. */
  const page = (...children: RenderChildren[]) => (
    <Box flexDirection="column">
      <Box flexDirection="column" rowGap={1} marginTop={isPinned ? barRows : 0}>
        {!isPinned && toolbar}
        {Select !== undefined && options.length > 1 && (
          <Select key="recent" label="Doc" options={options} value={current} onSelect={value => showItem($, value)} />
        )}
        {children}
      </Box>
      {isPinned && toolbar}
    </Box>
  )
  if ('error' in doc) return page(<Text color="red">{doc.error}</Text>)

  const format = formatFor(surface, found)
  const { blocks, diagramCount } = layoutOf(shown.key, doc, columns, surface, format)
  const renderOf = (key: string | null) => (key === null ? undefined : done[key])
  await loadSvgs(
    $,
    blocks.flatMap(b => {
      const r = b.kind === 'mermaid' ? renderOf(b.key) : undefined
      return r?.format === 'svg' ? [r.file] : []
    }),
    new Set(Object.values(done).flatMap(r => (r.format === 'svg' ? [r.file] : []))),
  )
  const where = doc.path === undefined ? 'from a reply' : displayPath(doc.path, cwd, home)
  const meta = [where, doc.size === undefined ? '' : formatSize(doc.size), diagramCount > 0 ? countOf(diagramCount, 'diagram') : '']
    .filter(Boolean)
    .join(' · ')

  // An image beats a text chart, which beats mermaid-ascii's drawing, which beats the source.
  const diagram = (d: Extract<DrawnBlock, { kind: 'mermaid' }>) => {
    const r = renderOf(d.key)
    const svg = r?.format === 'svg' ? (svgs.get(r.file) ?? '') : ''
    // A render is on its way only in a format this diagram goes to: never mermaid-ascii for a text chart.
    const isRendered = format !== null && !(format === 'ascii' && d.isText)
    let body: RenderElement = <Code source={d.source} language="mermaid" />
    let note: RenderElement | null = null
    if (r?.format === 'png' && 'Image' in el) {
      const box = imageBox(r, columns - 4)
      body = <el.Image source={{ file: r.file, format: 'png' }} columns={box.columns} rows={box.rows} alt="Mermaid diagram" />
    } else if (svg !== '' && 'Svg' in el) {
      body = <el.Svg source={svg} alt="Mermaid diagram" />
    } else if (d.chart !== null) {
      body = <Code source={d.chart} language="text" wrap="truncate-end" />
    } else if (r?.format === 'ascii') {
      body = <Code source={r.text} language="text" wrap="truncate-end" />
    } else if (r?.format === 'error') {
      note = <Text color="yellow" wrap="wrap">{`${rendererError(r.message, d.type)}; ${BROWSER_HINT}`}</Text>
    } else if (isRendered && r === undefined) {
      note = <Text dimColor>Drawing…</Text>
    } else if (d.isText) {
      note = <Text color="yellow" wrap="wrap">{`Couldn't read this ${d.type} chart; ${BROWSER_HINT}`}</Text>
    }

    return (
      <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} width={columns}>
        <Text dimColor>{`◇ ${d.title}`}</Text>
        {body}
        {note}
      </Box>
    )
  }

  return page(
    <Text dimColor wrap="truncate-start">{meta}</Text>,
    diagramCount > 0 && format === null && (
      <Text dimColor>
        {'Diagrams show as source here. Press b for the browser, or install mermaid-ascii (terminal) or mmdc to draw them inline.'}
      </Text>
    ),
    blocks.map(block => {
      if (block.kind === 'prose') return <Markdown text={block.text} />
      if (block.kind === 'mermaid') return diagram(block)
      if (block.lines === null) return <Markdown text={block.list} />
      return (
        <Box flexDirection="column">
          {block.lines.map(line => (
            <Text wrap="truncate-end">
              {line.map(run => (
                <Text {...runStyle(run)}>{run.text}</Text>
              ))}
            </Text>
          ))}
        </Box>
      )
    }),
  )
}

/** The Text props a drawn table's run carries: only the styles it sets. */
const runStyle = (run: Run) => ({
  ...(run.bold ? { bold: true } : {}),
  ...(run.italic ? { italic: true } : {}),
  ...(run.dim ? { dimColor: true } : {}),
  ...(run.code ? { color: CODE_COLOR } : {}),
  ...(run.link ? { color: LINK_COLOR, underline: true } : {}),
})

// ── the module ──────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    inBackground($, registerFallback($))
    if (e.isInteractive) {
      inBackground($, detectRenderers($))
      // After a reload a file may still be shown; the poll stops on its first tick if not.
      ensurePolling($)
    }

    return started
  })

  // Answered here without `next`, so xorio's command file never reaches the model.
  // A `/preview` this mod didn't register (the person's own, say) runs untouched.
  on('command.run', { command: [COMMAND, FALLBACK_COMMAND] }, async ($, e, next) =>
    e.command === FALLBACK_COMMAND && !(await ownsFallback($)) ? next(e) : runPreview($, e.args),
  )

  // Bookkeeping runs beside the tool's result, never in front of it.
  on('tool.call', { tool: ['Write', 'Edit'] }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && ran.isError !== true && isPreviewable(e.file_path)) {
      inBackground($, recordGenerated($, e.file_path))
    }
    return ran
  }).catch(($, e, next) => next(e))

  // A response row is always stored, so the diagrams are recorded before passing it on.
  on('session.append', { door: 'response' }, async ($, e, next) => {
    if (e.agentId === undefined && e.message.type === 'assistant') {
      const texts = textBlocks(e.message.content).filter(text => text.includes('mermaid'))
      const sources = texts.flatMap(text => mermaidSources(text, false))
      if (sources.length > 0) await recordDiagrams($, sources)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  // The band above the prompt: what Claude just wrote, one key from a preview.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { docs, replies } = await freshItems($)
    if (docs.length === 0 && replies.length === 0) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const [cwd, home] = await Promise.all([$.session.cwd(), $.env.get('HOME')])
    const names = docs.slice(0, 2).map(d => displayPath(d.path, cwd, home))
    const more = docs.length > 2 ? [`+${docs.length - 2} more`] : []
    const drawn = replies.length > 0 ? [countOf(replies.length, 'diagram')] : []
    const summary = [...names, ...more, ...drawn].join(', ')
    const press = (act: (target: DocTarget) => Promise<void>) => async () => {
      const target = await newestFresh($)
      if (target !== null) await act(target)
    }

    return (
      <Box flexDirection="row" columnGap={1}>
        <Text dimColor>Preview:</Text>
        <Box flexShrink={1}>
          <Text bold wrap="truncate-end">{summary}</Text>
        </Box>
        <Button key="preview" label="Open" hotkey="p" variant="primary" onPress={press(target => showTarget($, target))} />
        <Button
          key="browser"
          label="Browser"
          hotkey="b"
          onPress={press(async target => {
            await markSeen($)
            await openInBrowser($, target)
          })}
        />
        <Button key="dismiss" label="Dismiss" hotkey="x" role="dismiss" onPress={() => markSeen($)} />
      </Box>
    )
  })

  // The pane: a doc (Markdown, tables and diagrams) or the file picker. Everything it
  // reads is read in one round trip: it redraws on every scroll step.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.viewport !== undefined) screen = { columns: e.viewport.columns, rows: e.viewport.rows }
    paneColumns = e.props.bodyColumns
    const [v, cwd, home, docs, replies, asked, found, done, problem] = await Promise.all([
      read($, view),
      $.session.cwd(),
      $.env.get('HOME'),
      read($, generated),
      read($, diagrams),
      read($, sizing),
      read($, renderers),
      read($, renders),
      read($, notice),
    ])
    const ctx: PaneContext = {
      el: $.ui.resolve(e),
      surface: e.surface,
      columns: e.props.bodyColumns,
      offset: e.props.scroll.offset,
      cwd,
      home,
      recent: recentOptions(docs, replies, cwd, home),
      asked,
      found,
      done,
      problem,
    }

    return v === null || v.kind === 'picker' ? renderPicker($, ctx, v?.dir || cwd) : renderDoc($, ctx, v)
  })
}
