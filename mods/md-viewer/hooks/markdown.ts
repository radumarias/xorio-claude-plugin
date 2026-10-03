// Cuts a Markdown document into what the pane can draw: `Markdown` elements
// of at most 10,000 characters each, grouped into pages that keep one drawn
// tree under the engine's 100,000-character bound. Cuts fall between blocks,
// never inside a code fence; a block too big for one element is split by
// lines, a fence closed and reopened and a table's header repeated.

import { dirname, fromFileHref, isMarkdownPath, resolve, toFileHref } from './paths'

/** One `Markdown` element: its text, and the `file:` links the viewer follows. */
export type Chunk = { text: string; links: string[] }

/** What the pane draws at once. */
export type Page = Chunk[]

/** The `Markdown` element's own bound. */
export const MARKDOWN_MAX = 10_000
/** Leaves room under `MARKDOWN_MAX` for re-appended link definitions. */
export const CHUNK_CHARS = 8_000
/** Keeps one page's serialized tree well under the 100,000-character bound. */
export const PAGE_CHARS = 60_000

// Every control character but tab and newline, which `Markdown` refuses.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g
const FENCE = /^ {0,3}(`{3,}|~{3,})/
const FRONTMATTER = /^---\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/
const DEFINITION = /^ {0,3}\[([^\]]+)\]:[ \t]*\S/
const TABLE_RULE = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/
const INLINE_LINK = /\]\(([^()\s]+)((?:[ \t]+"[^"]*")?)\)/g
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/

/** Line endings to `\n`, a leading BOM and refused control characters gone. */
export const clean = (text: string): string =>
  text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').replace(CONTROL, '')

/** YAML front matter drawn as a `yaml` code block instead of a stray rule. */
export const showFrontmatter = (text: string): string =>
  text.replace(FRONTMATTER, (_, yaml: string) => `\`\`\`yaml\n${yaml}\n\`\`\`\n`)

/** The fence still open after `line`, given the one open before it. */
function fenceAfter(line: string, open: string | undefined): string | undefined {
  const match = FENCE.exec(line)
  if (!match) return open
  const mark = match[1] ?? ''
  const rest = line.slice(match[0].length)
  if (open === undefined) return mark.startsWith('`') && rest.includes('`') ? undefined : mark
  const closes = mark[0] === open[0] && mark.length >= open.length && rest.trim() === ''

  return closes ? undefined : open
}

/**
 * Blocks separated by blank lines outside fences. A block whose first line is
 * indented continues the one before (a list item's next paragraph), so a cut
 * never strands it as an indented code block.
 */
export function blocks(text: string): string[] {
  const out: string[] = []
  let current: string[] = []
  let blanks = 0
  let fence: string | undefined
  for (const line of text.split('\n')) {
    if (fence === undefined && line.trim() === '') {
      blanks += 1
      continue
    }
    if (blanks > 0 && current.length > 0) {
      if (/^[ \t]/.test(line)) current.push(...Array<string>(blanks).fill(''))
      else {
        out.push(current.join('\n'))
        current = []
      }
    }
    blanks = 0
    current.push(line)
    fence = fenceAfter(line, fence)
  }
  if (current.length > 0) out.push(current.join('\n'))

  return out
}

/** A line longer than `room` cut into pieces of `room`. */
function hardWrap(line: string, room: number): string[] {
  if (line.length <= room) return [line]
  const pieces: string[] = []
  for (let at = 0; at < line.length; at += room) pieces.push(line.slice(at, at + room))

  return pieces
}

/** One block over `max` split by lines: a fence reopened, a table's head kept. */
export function splitBlock(block: string, max: number): string[] {
  const lines = block.split('\n')
  const first = lines[0] ?? ''
  const fence = FENCE.exec(first)?.[1]
  const isTable = fence === undefined && lines.length > 1 && first.includes('|') && TABLE_RULE.test(lines[1] ?? '')
  const head = fence !== undefined ? [first] : isTable ? lines.slice(0, 2) : []
  const tail = fence !== undefined ? [fence] : []
  let body = lines.slice(head.length)
  if (fence !== undefined && body.length > 0 && fenceAfter(body[body.length - 1] ?? '', fence) === undefined) {
    body = body.slice(0, -1)
  }
  const frame = [...head, ...tail].reduce((sum, line) => sum + line.length + 1, 0)
  const room = Math.max(1, max - frame - 1)

  const pieces: string[] = []
  let piece: string[] = []
  let size = 0
  const flush = (): void => {
    if (piece.length > 0) pieces.push([...head, ...piece, ...tail].join('\n'))
    piece = []
    size = 0
  }
  for (const line of body) {
    for (const part of hardWrap(line, room)) {
      if (size + part.length + 1 > room) flush()
      piece.push(part)
      size += part.length + 1
    }
  }
  flush()

  return pieces
}

/** The document in pieces of at most `max`, cut between blocks. */
export function chunks(text: string, max: number = CHUNK_CHARS): string[] {
  const out: string[] = []
  let current = ''
  for (const block of blocks(text)) {
    for (const part of block.length > max ? splitBlock(block, max) : [block]) {
      if (current !== '' && current.length + 2 + part.length > max) {
        out.push(current)
        current = ''
      }
      current = current === '' ? part : `${current}\n\n${part}`
    }
  }
  if (current !== '') out.push(current)

  return out
}

/** Calls `visit` on each line outside a code fence, with its index. */
function eachLineOutsideFences(lines: string[], visit: (line: string, at: number) => void): void {
  let fence: string | undefined
  lines.forEach((line, at) => {
    const inside = fence !== undefined
    fence = fenceAfter(line, fence)
    if (!inside && fence === undefined) visit(line, at)
  })
}

/** Reference-link definitions (`[label]: url`) by lower-cased label. */
export function definitions(text: string): Map<string, string> {
  const found = new Map<string, string>()
  eachLineOutsideFences(text.split('\n'), line => {
    const label = DEFINITION.exec(line)?.[1]?.toLowerCase()
    if (label !== undefined && !found.has(label)) found.set(label, line.trim())
  })

  return found
}

/**
 * Each chunk with the definitions its reference links use but another chunk
 * holds, so `[text][label]` still resolves once the document is cut.
 */
function withDefinitions(parts: string[], defined: Map<string, string>): string[] {
  if (parts.length < 2 || defined.size === 0) return parts

  return parts.map(part => {
    const lower = part.toLowerCase()
    const missing = [...defined]
      .filter(([label]) => lower.includes(`[${label}]`) && !lower.includes(`[${label}]:`))
      .map(([, line]) => line)
    const joined = missing.length > 0 ? `${part}\n\n${missing.join('\n')}` : part

    return joined.length <= MARKDOWN_MAX ? joined : part
  })
}

/**
 * Relative links to Markdown files rewritten to `file:` URLs against the
 * document's folder, and listed, so a press on one opens it in the viewer.
 */
export function linkify(text: string, docPath: string): Chunk {
  const dir = dirname(docPath)
  const links = new Set<string>()
  const lines = text.split('\n')
  eachLineOutsideFences(lines, (line, at) => {
    lines[at] = line.replace(INLINE_LINK, (whole, target: string, title: string) => {
      if (SCHEME.test(target)) {
        const path = fromFileHref(target)
        if (path !== undefined && isMarkdownPath(path)) links.add(target)

        return whole
      }
      const [path = '', hash] = target.split('#', 2)
      if (target.startsWith('//') || !isMarkdownPath(path)) return whole
      let decoded = path
      try {
        decoded = decodeURIComponent(path)
      } catch {
        // a stray `%` stays as written
      }
      const href = `${toFileHref(resolve(dir, decoded))}${hash === undefined ? '' : `#${hash}`}`
      links.add(href)

      return `](${href}${title})`
    })
  })
  const linked = lines.join('\n')

  return linked.length <= MARKDOWN_MAX
    ? { text: linked, links: [...links] }
    : { text, links: [...links].filter(link => text.includes(link)) }
}

/** The whole document as pages of chunks, ready to draw; never empty. */
export function paginate(text: string, docPath: string): Page[] {
  const source = showFrontmatter(clean(text))
  if (source.trim() === '') return [[{ text: '*This file is empty.*', links: [] }]]

  const pages: Page[] = []
  let page: Page = []
  let size = 0
  for (const part of withDefinitions(chunks(source), definitions(source))) {
    if (page.length > 0 && size + part.length > PAGE_CHARS) {
      pages.push(page)
      page = []
      size = 0
    }
    page.push(linkify(part, docPath))
    size += part.length
  }
  if (page.length > 0) pages.push(page)

  return pages
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export const countLines = (text: string): number =>
  text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
