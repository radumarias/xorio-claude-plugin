// Pure helpers: no `$`, so the tests exercise them directly.

import type { Renderers } from '../types'

export const PANE = 'doc-preview'
/** `Svg` takes at most 131072 characters. */
export const MAX_SVG = 131072

const MARKDOWN_FILE = /\.(md|markdown|mdx)$/i
const MERMAID_FILE = /\.(mmd|mermaid)$/i
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})\s*$/
const ESCAPED_PIPE = /\\\|/g
const LINE_BREAK = /<br\s*\/?>/i

export const isMermaidFile = (path: string): boolean => MERMAID_FILE.test(path)
export const isPreviewable = (path: string): boolean =>
  MARKDOWN_FILE.test(path) || MERMAID_FILE.test(path)

export type InlineFormat = 'ascii' | 'svg' | 'png'
type Align = 'left' | 'center' | 'right'
export type Table = { header: string[]; align: Align[]; rows: string[][] }
/** A document in drawing order. A table keeps its Markdown (`source`) for surfaces that draw tables themselves. */
type Block =
  | { kind: 'prose'; text: string }
  | { kind: 'table'; table: Table; source: string }
  | { kind: 'mermaid'; source: string }

export const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Windows (`\r\n`) and old Mac (`\r`) line endings as `\n`. */
const toLf = (text: string): string => text.replace(/\r\n?/g, '\n')

/** `1 diagram`, `2 diagrams`. */
export const countOf = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

/** `fresh` then `old`, each id once (its first, so newest, entry), at most `max`. */
export function newestFirst<T>(fresh: readonly T[], old: readonly T[], idOf: (item: T) => string, max: number): T[] {
  const byId = new Map<string, T>()
  for (const item of [...fresh, ...old]) if (!byId.has(idOf(item))) byId.set(idOf(item), item)

  return [...byId.values()].slice(0, max)
}

const closes = (line: string, marker: string): boolean => {
  const fence = FENCE_CLOSE.exec(line)?.[1]
  return fence !== undefined && fence[0] === marker[0] && fence.length >= marker.length
}

/**
 * Splits a document into prose, GFM tables and ```mermaid blocks, in order,
 * in one pass. Fenced code stays prose (tables and mermaid inside it too); an
 * unclosed mermaid fence is shown as written.
 */
export function splitDoc(text: string, isMermaid: boolean): Block[] {
  const lf = toLf(text)
  if (isMermaid) return lf.trim() === '' ? [] : [{ kind: 'mermaid', source: lf.trim() }]
  const lines = lf.split('\n')
  const blocks: Block[] = []
  let prose: string[] = []
  const flush = () => {
    if (prose.join('').trim() !== '') blocks.push({ kind: 'prose', text: prose.join('\n') })
    prose = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const open = FENCE_OPEN.exec(line)
    if (open) {
      const marker = open[1] ?? '```'
      let end = i + 1
      while (end < lines.length && !closes(lines[end] ?? '', marker)) end++
      if (end < lines.length && (open[2] ?? '').toLowerCase() === 'mermaid') {
        flush()
        blocks.push({ kind: 'mermaid', source: lines.slice(i + 1, end).join('\n') })
      } else {
        prose.push(...lines.slice(i, end + 1))
      }
      i = end
      continue
    }
    const table = tableAt(lines, i)
    if (table === null) {
      prose.push(line)
      continue
    }
    flush()
    blocks.push(table.block)
    i = table.end - 1
  }
  flush()

  return blocks
}

export const mermaidSources = (text: string, isMermaid: boolean): string[] =>
  splitDoc(text, isMermaid).flatMap(b => (b.kind === 'mermaid' ? [b.source] : []))

const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

const splitRow = (line: string): string[] => {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1)
  return row.split(/(?<!\\)\|/).map(cell => cell.trim())
}

const alignOf = (cell: string): Align => {
  const c = cell.trim()
  if (c.startsWith(':') && c.endsWith(':')) return 'center'
  return c.endsWith(':') ? 'right' : 'left'
}

/** The GFM table starting at `lines[i]` (a header row, then a delimiter row), and the line after it. */
function tableAt(lines: string[], i: number): { block: Block; end: number } | null {
  const line = lines[i] ?? ''
  const delimiter = lines[i + 1] ?? ''
  if (!line.includes('|') || !delimiter.includes('|') || !TABLE_DELIMITER.test(delimiter)) return null
  const header = splitRow(line)
  const align = splitRow(delimiter).map(alignOf)
  if (align.length !== header.length) return null
  let end = i + 2
  while (end < lines.length && (lines[end] ?? '').includes('|') && (lines[end] ?? '').trim() !== '') end++
  const rows = lines
    .slice(i + 2, end)
    .map(splitRow)
    .map(row => header.map((_, c) => row[c] ?? ''))

  return { block: { kind: 'table', table: { header, align, rows }, source: lines.slice(i, end).join('\n') }, end }
}

/** A table as nested list items: the first cell names the item, the rest are `header: cell`. */
export function tableAsList(table: Table): string {
  const unescape = (cell: string) => cell.replace(ESCAPED_PIPE, '|').replace(new RegExp(LINE_BREAK, 'gi'), ' ')
  return table.rows
    .flatMap(row => {
      const [first = '', ...rest] = row
      const fields = rest.flatMap((cell, c) => {
        const name = table.header[c + 1] ?? ''
        return cell === '' ? [] : [`  - ${name === '' ? '' : `${unescape(name)}: `}${unescape(cell)}`]
      })
      return [`- **${unescape(first) || '—'}**`, ...fields]
    })
    .join('\n')
}

/** A styled stretch of text in a drawn table: a cell's inline Markdown, or a border. */
export type Run = { text: string; code?: true; bold?: true; italic?: true; link?: true; dim?: true }
export type TableLine = Run[]

const INLINE =
  /`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)(.+?)\*(?!\w)|(?<![\w_])_(?!\s)(.+?)_(?!\w)|!?\[([^\]]*)\]\([^)]*\)/g

/** A cell's inline Markdown as runs: code, bold, italic and link text, the rest plain. */
export function inlineRuns(text: string, base: Omit<Run, 'text'> = {}): Run[] {
  const runs: Run[] = []
  let at = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index > at) runs.push({ ...base, text: text.slice(at, m.index) })
    const [, code, bold1, bold2, italic1, italic2, link] = m
    if (code !== undefined) runs.push({ ...base, text: code, code: true })
    else if (bold1 !== undefined || bold2 !== undefined) runs.push({ ...base, text: bold1 ?? bold2 ?? '', bold: true })
    else if (italic1 !== undefined || italic2 !== undefined) runs.push({ ...base, text: italic1 ?? italic2 ?? '', italic: true })
    else runs.push({ ...base, text: link ?? '', link: true })
    at = m.index + m[0].length
  }
  if (at < text.length) runs.push({ ...base, text: text.slice(at) })

  return runs.filter(run => run.text !== '')
}

const widthOf = (text: string): number => [...text].length
const runsWidth = (runs: readonly Run[]): number => runs.reduce((sum, run) => sum + widthOf(run.text), 0)
const sameStyle = (a: Run, b: Run) =>
  a.code === b.code && a.bold === b.bold && a.italic === b.italic && a.link === b.link && a.dim === b.dim

/** A cell's lines (`<br>` breaks, `\|` unescaped), each as runs. */
const cellLines = (cell: string, base: Omit<Run, 'text'>): Run[][] =>
  cell
    .replace(ESCAPED_PIPE, '|')
    .split(LINE_BREAK)
    .map(line => inlineRuns(line.trim(), base))

/** Word-wraps runs to `width`, breaking a word only when it is wider than a line. */
export function wrapRuns(runs: readonly Run[], width: number): Run[][] {
  const lines: Run[][] = [[]]
  let used = 0
  const newLine = () => {
    lines.push([])
    used = 0
  }
  const put = (run: Run) => {
    const line = lines[lines.length - 1] ?? []
    const last = line[line.length - 1]
    if (last !== undefined && sameStyle(last, run)) last.text += run.text
    else line.push({ ...run })
    used += widthOf(run.text)
  }
  for (const run of runs) {
    for (const token of run.text.split(/(\s+)/)) {
      if (token === '') continue
      if (/^\s+$/.test(token)) {
        if (used > 0 && used < width) put({ ...run, text: ' ' })
        continue
      }
      let chars = [...token]
      while (chars.length > 0) {
        if (chars.length <= width - used) {
          put({ ...run, text: chars.join('') })
          break
        }
        if (used > 0) {
          newLine()
          continue
        }
        put({ ...run, text: chars.slice(0, width).join('') })
        chars = chars.slice(width)
        if (chars.length > 0) newLine()
      }
    }
  }
  for (const line of lines) {
    const last = line[line.length - 1]
    if (last !== undefined) last.text = last.text.trimEnd()
  }

  return lines.map(line => line.filter(run => run.text !== ''))
}

/**
 * Column widths that fit `available` cells: columns at their natural width
 * when they all fit, else the widest ones capped at one level (they wrap) so
 * the narrow ones keep theirs. Null when even the minimums don't fit.
 */
export function layoutColumns(natural: number[], minimum: number[], available: number): number[] | null {
  const sum = (widths: number[]) => widths.reduce((total, w) => total + w, 0)
  if (sum(natural) <= available) return natural
  if (sum(minimum) > available) return null
  const capped = (level: number) => natural.map((w, c) => Math.max(minimum[c] ?? 1, Math.min(w, level)))
  let level = 1
  while (sum(capped(level + 1)) <= available) level++
  const widths = capped(level)
  // Hand the cells left over to the capped columns, one each, left to right.
  for (let c = 0; c < widths.length && sum(widths) < available; c++) {
    if ((natural[c] ?? 0) > (widths[c] ?? 0)) widths[c] = (widths[c] ?? 0) + 1
  }

  return widths
}

const pad = (runs: Run[], width: number, align: Align): Run[] => {
  const room = Math.max(0, width - runsWidth(runs))
  const left = align === 'right' ? room : align === 'center' ? Math.floor(room / 2) : 0
  const space = (n: number): Run[] => (n > 0 ? [{ text: ' '.repeat(n) }] : [])

  return [...space(left), ...runs, ...space(room - left)]
}

/** The narrowest a column may wrap to: its longest word (up to a cap), or less when that won't fit. */
const MIN_COLUMN = 6
const WORD_CAP = 24

/**
 * A table drawn as boxed text lines that fit `columns` cells: cells wrap
 * inside their column, `<br>` breaks a line, the header is bold, and a rule
 * separates the rows once any of them wraps. Null when it cannot fit.
 */
export function tableLines(table: Table, columns: number): TableLine[] | null {
  const count = table.header.length
  const cells = [table.header, ...table.rows].map((row, r) =>
    row.map(cell => cellLines(cell, r === 0 ? { bold: true } : {})),
  )
  const natural = table.header.map((_, c) =>
    Math.max(1, ...cells.map(row => Math.max(0, ...(row[c] ?? []).map(runsWidth)))),
  )
  const longestWord = table.header.map((_, c) =>
    Math.max(
      1,
      ...cells.flatMap(row => (row[c] ?? []).flatMap(line => line.flatMap(run => run.text.split(/\s+/).map(widthOf)))),
    ),
  )
  const available = columns - (3 * count + 1)
  const widths =
    layoutColumns(natural, natural.map((w, c) => Math.min(w, Math.max(MIN_COLUMN, Math.min(longestWord[c] ?? 1, WORD_CAP)))), available) ??
    layoutColumns(natural, natural.map(w => Math.min(w, MIN_COLUMN)), available)
  if (widths === null) return null

  const border = (left: string, joint: string, right: string): TableLine => [
    { text: `${left}${widths.map(w => '─'.repeat(w + 2)).join(joint)}${right}`, dim: true },
  ]
  const bar: Run = { text: '│', dim: true }
  const drawRow = (row: Run[][][]): TableLine[] => {
    const wrapped = row.map((lines, c) => lines.flatMap(line => wrapRuns(line, widths[c] ?? 1)))
    const height = Math.max(1, ...wrapped.map(lines => lines.length))
    return Array.from({ length: height }, (_, l) => [
      bar,
      ...wrapped.flatMap((lines, c) => [
        { text: ' ' },
        ...pad(lines[l] ?? [], widths[c] ?? 1, table.align[c] ?? 'left'),
        { text: ' ' },
        bar,
      ]),
    ])
  }
  const [header = [], ...body] = cells
  const drawnBody = body.map(drawRow)
  const hasWrapped = drawnBody.some(lines => lines.length > 1)

  return [
    border('┌', '┬', '┐'),
    ...drawRow(header),
    border('├', '┼', '┤'),
    ...drawnBody.flatMap((lines, r) => (hasWrapped && r > 0 ? [border('├', '┼', '┤'), ...lines] : lines)),
    border('└', '┴', '┘'),
  ]
}

/** Resolves what the person typed: quotes, `file://`, `~`, relative to `cwd`, `.` and `..`. */
export function expandPath(input: string, cwd: string, home: string | undefined): string {
  let path = input.trim().replace(/^(['"])(.*)\1$/, '$2')
  if (path.startsWith('file://')) path = decodeURIComponent(path.slice('file://'.length))
  if (home !== undefined && (path === '~' || path.startsWith('~/'))) path = home + path.slice(1)
  if (/^[A-Za-z]:[\\/]/.test(path)) return path

  return normalize(path.startsWith('/') ? path : `${cwd}/${path}`)
}

function normalize(path: string): string {
  const isAbsolute = path.startsWith('/')
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part !== '..') parts.push(part)
    else if (parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
    else if (!isAbsolute) parts.push('..')
  }

  return (isAbsolute ? '/' : '') + parts.join('/')
}

export const parentDir = (path: string): string => normalize(`${path}/..`)
export const baseName = (path: string): string => path.split('/').pop() || path

/** Short form for display: relative under `cwd`, `~/` under `home`, else as is. */
export function displayPath(path: string, cwd: string, home: string | undefined): string {
  if (path === cwd) return '.'
  if (path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1)
  if (home !== undefined && path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`

  return path
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** A short, stable hash (cyrb53) for cache keys and file names. */
export function hashText(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** A diagram's frontmatter title, its kind, and its lines trimmed, with blanks and `%%` comments dropped. */
function diagramParts(raw: string): { title: string | undefined; kind: string; lines: string[] } {
  const source = toLf(raw)
  const frontmatter = /^\s*---\n([\s\S]*?)\n---\s*\n/.exec(source)
  const title = /^\s*title:\s*(.+)$/m.exec(frontmatter?.[1] ?? '')?.[1]?.trim()
  const body = frontmatter ? source.slice(frontmatter[0].length) : source
  const lines = body
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('%%'))

  return { title, kind: lines[0]?.split(/\s+/)[0] ?? 'diagram', lines }
}

/** The diagram type: the first word of its first line (`flowchart`, `pie`, `stateDiagram-v2`). */
export const diagramKind = (source: string): string => diagramParts(source).kind

/** `flowchart`, `sequenceDiagram: Login`, ...: the diagram type plus its title, if any. */
export function diagramTitle(source: string): string {
  const { title, kind } = diagramParts(source)
  const label = title ? `${kind}: ${title}` : kind

  return label.length > 48 ? `${label.slice(0, 47)}…` : label
}

/** Text padded, or cut with an ellipsis, to exactly `width` cells. */
const fit = (text: string, width: number): string => {
  const chars = [...text]
  return chars.length > width
    ? `${chars.slice(0, Math.max(0, width - 1)).join('')}…`
    : text + ' '.repeat(width - chars.length)
}

/**
 * How the terminal draws the kinds mermaid-ascii can't take as written
 * (it draws flowcharts, sequence and ER diagrams): as plain text here, which
 * needs no renderer, or rewritten as a flowchart first. Every other kind goes
 * to mermaid-ascii as is.
 */
const TEXT_CHARTS: Record<string, (source: string, width: number) => string | null> = {
  pie: pieChart,
  gantt: ganttChart,
}
const AS_FLOWCHART: Record<string, (source: string) => string | null> = {
  stateDiagram: stateToFlowchart,
  'stateDiagram-v2': stateToFlowchart,
  classDiagram: classToFlowchart,
  'classDiagram-v2': classToFlowchart,
}

/** Whether the kind is drawn as text here (pie, gantt), never by mermaid-ascii. */
export const isTextChart = (source: string): boolean => diagramKind(source) in TEXT_CHARTS

/** A pie or gantt chart as text; null for other kinds and for syntax the parsers don't follow. */
export const textChart = (source: string, width: number): string | null =>
  TEXT_CHARTS[diagramKind(source)]?.(source, width) ?? null

/** What mermaid-ascii is given: the source, or a state or class diagram rewritten as a flowchart. */
export const asciiSource = (source: string): string => AS_FLOWCHART[diagramKind(source)]?.(source) ?? source

/** A pie chart as labelled bars scaled to the largest slice, each with its value and share. */
export function pieChart(source: string, width: number): string | null {
  const parts = diagramParts(source)
  let title = parts.title
  const slices: { label: string; value: number }[] = []
  for (const line of parts.lines) {
    const head = /^pie\b(?:\s+showData)?(?:\s+title\s+(.+))?$/.exec(line)
    const named = /^title\s+(.+)$/.exec(line)
    const slice = /^"([^"]*)"\s*:\s*(\d*\.?\d+)$/.exec(line)
    if (head) title = head[1]?.trim() ?? title
    else if (named) title = named[1]?.trim() ?? title
    else if (slice) slices.push({ label: slice[1] ?? '', value: Number(slice[2]) })
    else if (line !== 'showData') return null
  }
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  const largest = Math.max(0, ...slices.map(s => s.value))
  if (slices.length === 0 || largest <= 0) return null

  const labelWidth = Math.min(Math.max(...slices.map(s => widthOf(s.label))), Math.max(8, Math.floor(width / 3)))
  const values = slices.map(s => String(s.value))
  const valueWidth = Math.max(...values.map(v => v.length))
  // label, 2 spaces, bar, 1 space, value, 2 spaces, a share like "100.0%"
  const barWidth = Math.max(4, width - labelWidth - valueWidth - 11)
  const rows = slices.map((s, i) => {
    const length = Math.max(s.value > 0 ? 1 : 0, Math.round((s.value / largest) * barWidth))
    const share = `${((s.value / total) * 100).toFixed(1)}%`
    return `${fit(s.label, labelWidth)}  ${'█'.repeat(length).padEnd(barWidth)} ${(values[i] ?? '').padStart(valueWidth)}  ${share.padStart(6)}`
  })

  return [...(title ? [title, ''] : []), ...rows].join('\n')
}

const DAY_MS = 86_400_000
const GANTT_TAGS = new Set(['done', 'active', 'crit', 'milestone'])
const GANTT_SETTINGS =
  /^(title|dateFormat|axisFormat|tickInterval|excludes|includes|todayMarker|weekday|inclusiveEndDates|topAxis)\b\s*(.*)$/

const parseDay = (text: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim())
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS : null
}
const formatDay = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10)
const parseLength = (text: string): number | null => {
  const m = /^(\d*\.?\d+)\s*([dwh])$/.exec(text.trim())
  if (!m) return null
  const n = Number(m[1])
  return m[2] === 'w' ? n * 7 : m[2] === 'h' ? n / 24 : n
}
const startOf = (text: string, ends: Map<string, number>): number | null => {
  const after = /^after\s+(.+)$/.exec(text)
  if (!after) return parseDay(text)
  const days = (after[1] ?? '').split(/\s+/).map(id => ends.get(id))
  return days.every(day => day !== undefined) ? Math.max(...(days as number[])) : null
}

/**
 * A gantt chart as a day-scale timeline: tasks under their sections, a bar
 * each (`▒` done, `◆` milestone). Dates must be `YYYY-MM-DD`; a task's
 * `:[tags,][id,][start,]end` follows Mermaid's forms (start a date or
 * `after id`, end a date or a length in d, w or h).
 */
export function ganttChart(source: string, width: number): string | null {
  const parts = diagramParts(source)
  let title = parts.title
  let section: string | undefined
  const tasks: { section: string | undefined; name: string; start: number; end: number; tags: Set<string> }[] = []
  const ends = new Map<string, number>()
  for (const line of parts.lines.slice(1)) {
    const setting = GANTT_SETTINGS.exec(line)
    if (setting) {
      if (setting[1] === 'title') title = setting[2]?.trim() || title
      if (setting[1] === 'dateFormat' && setting[2]?.trim() !== 'YYYY-MM-DD') return null
      continue
    }
    const header = /^section\s+(.+)$/.exec(line)
    if (header) {
      section = header[1]?.trim()
      continue
    }
    const task = /^(.+?)\s*:\s*(.+)$/.exec(line)
    if (!task) return null
    const items = (task[2] ?? '').split(',').map(item => item.trim()).filter(item => item !== '')
    const tags = new Set<string>()
    while (items.length > 0 && GANTT_TAGS.has(items[0] ?? '')) tags.add(items.shift() ?? '')
    if (items.length === 0 || items.length > 3) return null
    const [id, startText, endText] =
      items.length === 3 ? items : items.length === 2 ? [undefined, ...items] : [undefined, undefined, ...items]
    const start = startText === undefined ? tasks[tasks.length - 1]?.end : startOf(startText, ends)
    if (start === undefined || start === null || endText === undefined) return null
    const length = parseLength(endText)
    const end = parseDay(endText) ?? (length === null ? null : start + length)
    if (end === null || end < start) return null
    tasks.push({ section, name: task[1]?.trim() ?? '', start, end, tags })
    if (id !== undefined) ends.set(id, end)
  }
  if (tasks.length === 0) return null

  const first = Math.min(...tasks.map(t => t.start))
  const last = Math.max(...tasks.map(t => t.end))
  const nameWidth = Math.min(Math.max(...tasks.map(t => widthOf(t.name))) + 2, Math.max(10, Math.floor(width / 3)))
  const chartWidth = Math.max(10, width - nameWidth - 1)
  const scale = chartWidth / Math.max(1, last - first)
  const [from, to] = [formatDay(first), formatDay(last)]
  const axis = ' '.repeat(nameWidth + 1) + (chartWidth >= from.length + to.length + 1 ? from + to.padStart(chartWidth - from.length) : from)
  const out = [...(title ? [title, ''] : []), axis]
  let shown: string | undefined | null = null
  for (const t of tasks) {
    if (t.section !== shown) {
      if (t.section !== undefined) out.push(t.section)
      shown = t.section
    }
    const left = Math.min(chartWidth - 1, Math.floor((t.start - first) * scale))
    const right = Math.max(left + 1, Math.min(chartWidth, Math.round((t.end - first) * scale)))
    const bar = t.tags.has('milestone') || t.end === t.start ? '◆' : (t.tags.has('done') ? '▒' : '█').repeat(right - left)
    out.push(`${fit(`  ${t.name}`, nameWidth)} ${' '.repeat(left)}${bar}`)
  }

  return out.join('\n')
}

/** Text safe inside a flowchart node or edge label: no brackets, braces, pipes or quotes. */
const flowText = (text: string): string =>
  text
    .replace(/[[\]{}()|"<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
const flowId = (name: string): string => name.replace(/~[^~]*~/g, '').replace(/\W/g, '_')
/** A `direction` line's flowchart direction (mermaid-ascii draws LR and TD), or null for another line. */
const flowDirection = (line: string): 'LR' | 'TD' | null => {
  const turn = /^direction\s+(LR|RL|TB|TD|BT)$/.exec(line)?.[1]
  if (turn === undefined) return null
  return turn === 'LR' || turn === 'RL' ? 'LR' : 'TD'
}
const flowEdge = (from: string, to: string, label: string): string =>
  label === '' ? `  ${from} --> ${to}` : `  ${from} -->|${label}| ${to}`
const flowchart = (direction: string, labels: Map<string, string>, edges: string[]): string =>
  [`flowchart ${direction}`, ...[...labels].map(([id, label]) => `  ${id}[${flowText(label) || id}]`), ...edges].join('\n')

/**
 * A state diagram as a flowchart: states become boxes (`[*]` a start or end
 * box), transitions become edges with their labels. Null for composite
 * states, forks, choices and concurrency, which a flat flowchart can't hold.
 */
export function stateToFlowchart(source: string): string | null {
  const labels = new Map<string, string>()
  const edges: string[] = []
  let direction = 'LR'
  let inNote = false
  const state = (name: string, side: 'from' | 'to'): string => {
    if (name === '[*]') {
      const id = side === 'from' ? 'START' : 'END'
      labels.set(id, side === 'from' ? 'start' : 'end')
      return id
    }
    const id = flowId(name)
    if (!labels.has(id)) labels.set(id, name)
    return id
  }
  for (const line of diagramParts(source).lines.slice(1)) {
    if (inNote) {
      if (/^end note$/i.test(line)) inNote = false
      continue
    }
    if (/^note\b/i.test(line)) {
      inNote = !line.includes(':')
      continue
    }
    const turn = flowDirection(line)
    if (turn !== null) {
      direction = turn
      continue
    }
    if (/[{}]|<<|^--$/.test(line)) return null
    const named = /^state\s+"([^"]+)"\s+as\s+([\w.-]+)$/.exec(line)
    const edge = /^(\[\*\]|[\w.-]+)\s*-->\s*(\[\*\]|[\w.-]+)\s*(?::\s*(.+))?$/.exec(line)
    const described = /^([\w.-]+)\s*:\s*(.+)$/.exec(line)
    if (named) labels.set(flowId(named[2] ?? ''), named[1] ?? '')
    else if (edge) edges.push(flowEdge(state(edge[1] ?? '', 'from'), state(edge[2] ?? '', 'to'), flowText(edge[3] ?? '')))
    else if (described) labels.set(flowId(described[1] ?? ''), described[2] ?? '')
    else if (/^[\w.-]+$/.test(line)) state(line, 'from')
    else return null
  }

  return edges.length === 0 ? null : flowchart(direction, labels, edges)
}

/** Class relationship arrows: whether the edge points from right to left, and its label when the line has none. */
const RELATIONS: Record<string, { isReversed: boolean; label: string }> = {
  '<|--': { isReversed: true, label: 'extends' },
  '--|>': { isReversed: false, label: 'extends' },
  '<|..': { isReversed: true, label: 'implements' },
  '..|>': { isReversed: false, label: 'implements' },
  '*--': { isReversed: false, label: 'has' },
  '--*': { isReversed: true, label: 'has' },
  'o--': { isReversed: false, label: 'has' },
  '--o': { isReversed: true, label: 'has' },
  '<--': { isReversed: true, label: '' },
  '-->': { isReversed: false, label: '' },
  '<..': { isReversed: true, label: '' },
  '..>': { isReversed: false, label: '' },
  '--': { isReversed: false, label: '' },
  '..': { isReversed: false, label: '' },
}
const RELATION =
  /^([\w~]+)\s*(?:"[^"]*"\s*)?(<\|--|--\|>|<\|\.\.|\.\.\|>|\*--|--\*|o--|--o|<--|-->|<\.\.|\.\.>|--|\.\.)\s*(?:"[^"]*"\s*)?([\w~]+)\s*(?::\s*(.+))?$/
const CLASS_IGNORED = /^(note|cssClass|style|classDef|click|link|callback|<<|namespace\b|}$)/

/**
 * A class diagram as a flowchart: classes become boxes and relationships
 * edges (inheritance as `extends`, composition and aggregation as `has`
 * unless labelled). Members are dropped: a flowchart box holds one line.
 */
export function classToFlowchart(source: string): string | null {
  const labels = new Map<string, string>()
  const edges: string[] = []
  let direction = 'LR'
  let inBody = false
  const klass = (name: string): string => {
    const id = flowId(name)
    if (!labels.has(id)) labels.set(id, name.replace(/~[^~]*~/g, ''))
    return id
  }
  for (const line of diagramParts(source).lines.slice(1)) {
    if (inBody) {
      if (line.startsWith('}')) inBody = false
      continue
    }
    const turn = flowDirection(line)
    const declared = /^class\s+([\w~]+)(?:\s*\[[^\]]*\])?\s*(\{)?\s*$/.exec(line)
    const relation = RELATION.exec(line)
    const member = /^([\w~]+)\s*:\s*.+$/.exec(line)
    if (turn !== null) direction = turn
    else if (declared) {
      klass(declared[1] ?? '')
      inBody = declared[2] !== undefined
    } else if (relation) {
      const [left, right] = [klass(relation[1] ?? ''), klass(relation[3] ?? '')]
      const kind = RELATIONS[relation[2] ?? ''] ?? { isReversed: false, label: '' }
      const [from, to] = kind.isReversed ? [right, left] : [left, right]
      edges.push(flowEdge(from, to, flowText(relation[4] ?? '') || kind.label))
    } else if (member) klass(member[1] ?? '')
    else if (!CLASS_IGNORED.test(line)) return null
  }

  return labels.size === 0 ? null : flowchart(direction, labels, edges)
}

/** Drops ANSI escapes and every control character but tab and newline. */
export const stripAnsi = (text: string): string =>
  text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '')

/** A tool's output as its first non-blank line, ANSI stripped. */
export const firstLine = (text: string): string =>
  stripAnsi(text).split('\n').map(line => line.trim()).find(line => line !== '') ?? ''

/**
 * A renderer's failure as one readable line: a logrus `msg="…"` unwrapped,
 * and mermaid-ascii's "unsupported graph type" said as which kind it can't draw.
 */
export function rendererError(output: string, kind: string): string {
  const line = firstLine(output)
  const message = /msg="((?:[^"\\]|\\.)*)"/.exec(line)?.[1]?.replace(/\\"/g, '"') ?? line

  return /unsupported graph type/i.test(message) ? `mermaid-ascii can't draw ${kind} diagrams` : message
}

/** Width and height from a base64 PNG's IHDR chunk; null when it is no PNG. */
export function pngSize(base64: string): { width: number; height: number } | null {
  let bytes: number[]
  try {
    bytes = [...atob(base64.slice(0, 32))].map(c => c.charCodeAt(0))
  } catch {
    return null
  }
  const at = (i: number) => bytes[i] ?? 0
  const isPng = at(0) === 137 && at(1) === 80 && at(2) === 78 && at(3) === 71
  if (!isPng || bytes.length < 24) return null
  const u32 = (i: number) => ((at(i) << 24) | (at(i + 1) << 16) | (at(i + 2) << 8) | at(i + 3)) >>> 0

  return { width: u32(16), height: u32(20) }
}

/** Terminal cells for a picture: about 16 px a column at mmdc's scale 2, cells twice as tall as wide. */
export function imageBox(
  size: { width: number; height: number },
  maxColumns: number,
): { columns: number; rows: number } {
  const columns = Math.max(8, Math.min(maxColumns, 255, Math.round(size.width / 16)))
  const rows = Math.round((columns * size.height) / Math.max(1, size.width) / 2)

  return { columns, rows: Math.max(2, Math.min(255, rows)) }
}

/** Which inline format a surface gets, or null to show the diagram's source. */
export function formatFor(surface: string, renderers: Renderers | null): InlineFormat | null {
  if (renderers === null) return null
  if (surface === 'terminal') {
    if (renderers.isKitty && renderers.mmdc) return 'png'

    return renderers.ascii ? 'ascii' : null
  }
  if (renderers.mmdc) return 'svg'

  return renderers.ascii ? 'ascii' : null
}

/**
 * A render's cache key: a hash of what the renderer is given (for ASCII the
 * flowchart a state or class diagram becomes), so a converter change makes
 * new keys by itself.
 */
export const renderKey = (source: string, format: InlineFormat): string =>
  `${hashText(format === 'ascii' ? asciiSource(source) : source)}.${format}`

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)

/** JSON safe to embed in a <script>: no `</script>`, no line separators. */
const scriptJson = (value: unknown): string =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')

/**
 * A standalone page that renders the document in the browser: Markdown through
 * marked + DOMPurify, ```mermaid blocks and .mmd files through mermaid.js, all
 * from jsDelivr. A strict CSP and Mermaid's strict security level keep the
 * document's own HTML from running script.
 */
export function previewHtml(doc: {
  title: string
  source: string
  isMermaid: boolean
  baseDir?: string
}): string {
  const base =
    doc.baseDir === undefined
      ? ''
      : `<base href="${escapeHtml(`file://${encodeURI(`${doc.baseDir}/`)}`)}">`

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src * data: file:; font-src data:">
${base}
<title>${escapeHtml(doc.title)}</title>
<style>
  :root { color-scheme: light dark; --fg: #1f2328; --muted: #59636e; --bg: #ffffff; --code: #f6f8fa; --line: #d1d9e0; --link: #0969da; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e6edf3; --muted: #9198a1; --bg: #0d1117; --code: #151b23; --line: #3d444d; --link: #4493f8; }
  }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  main { max-width: 900px; margin: 0 auto; padding: 32px 16px 64px; }
  header { color: var(--muted); font-size: 13px; border-bottom: 1px solid var(--line); padding-bottom: 8px; margin-bottom: 24px; }
  a { color: var(--link); }
  h1, h2 { border-bottom: 1px solid var(--line); padding-bottom: .3em; }
  code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 85%; }
  code { background: var(--code); padding: .2em .4em; border-radius: 6px; }
  pre { background: var(--code); padding: 16px; border-radius: 6px; overflow: auto; }
  pre code { background: none; padding: 0; font-size: 100%; }
  pre.mermaid { background: #ffffff; text-align: center; }
  table { border-collapse: collapse; display: block; overflow: auto; }
  th, td { border: 1px solid var(--line); padding: 6px 13px; }
  blockquote { margin: 0; padding: 0 1em; color: var(--muted); border-left: .25em solid var(--line); }
  img { max-width: 100%; }
</style>
<script src="https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js" integrity="sha384-948ahk4ZmxYVYOc+rxN1H2gM1EJ2Duhp7uHtZ4WSLkV4Vtx5MUqnV+l7u9B+jFv+" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/dompurify@3.4.16/dist/purify.min.js" integrity="sha384-a7SzOxErzJ3ZpQz0zJ32d67dSitNzPcbfybc/ykU9KJhMgZkwqfSxlhhdJRS+XGL" crossorigin="anonymous"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js" integrity="sha384-EOXBFmc3gx5mb+vn0vPvvGqACToJD24hhacX5Yx+8NUUQrHIle/Qi5Bg9o3zKwW2" crossorigin="anonymous"></script>
</head>
<body>
<main>
<header>${escapeHtml(doc.title)}</header>
<article id="doc"></article>
</main>
<script>
(async () => {
  const source = ${scriptJson(doc.source)};
  const isMermaid = ${doc.isMermaid ? 'true' : 'false'};
  const article = document.getElementById('doc');
  const raw = () => {
    const pre = document.createElement('pre');
    pre.textContent = source;
    article.replaceChildren(pre);
  };
  if (isMermaid) {
    const pre = document.createElement('pre');
    pre.className = 'mermaid';
    pre.textContent = source;
    article.replaceChildren(pre);
  } else if (window.marked && window.DOMPurify) {
    const escape = text => text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    marked.use({
      gfm: true,
      renderer: {
        code(token) {
          const lang = (token.lang || '').trim().split(/\\s+/)[0].toLowerCase();
          return lang === 'mermaid' ? '<pre class="mermaid">' + escape(token.text) + '</pre>' : false;
        },
      },
    });
    article.innerHTML = DOMPurify.sanitize(marked.parse(source));
  } else {
    raw();
    return;
  }
  if (!window.mermaid) return;
  try {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
    await mermaid.run({ querySelector: 'pre.mermaid' });
  } catch (err) {
    console.error(err);
  }
})();
</script>
</body>
</html>
`
}
