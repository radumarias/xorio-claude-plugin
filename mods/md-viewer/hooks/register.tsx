// md-viewer: `/md` opens a pane that renders a Markdown file the way Claude
// Code draws a plan or a reply (headings, lists, tables, code fences, links),
// with a file picker, a jump to the newest plan, live reload while the file
// changes, and a toggle between the right half and the full screen.

import { atom, read, update } from 'claude-code'
import type { Atom, EngineInterface, Register } from 'claude-code'

import type { MdDoc, MdEntry, MdListing, MdPlaces } from '../types'
import { countLines, formatSize, paginate, type Chunk, type Page } from './markdown'
import { basename, dirname, expandHome, fromFileHref, isMarkdownPath, join, resolve, tildify } from './paths'

type Engine = EngineInterface
/** What the pane is sized against: the terminal's cells, when known. */
type Screen = { columns?: number; rows?: number }

const PANE = 'md-viewer'
const TITLE = 'Markdown'
const COMMAND = 'md'
/** How often the shown file is checked for changes. */
const FOLLOW_MS = 1_500
const RECENT_MAX = 8
/** Picker rows drawn at once; the filter narrows the rest. */
const ROWS_MAX = 200
/** More than any screen has: the dock (or inline block) takes all the layout spares. */
const ALL_THE_ROOM = 1_000
const MIN_COLUMNS = 40
const MIN_ROWS = 12
const SKIPPED = new Set(['.git', 'node_modules'])

const mode = atom({ plugin: 'md-viewer', key: 'mode' } as const, 'pick')
const doc = atom({ plugin: 'md-viewer', key: 'doc' } as const, null)
const page = atom({ plugin: 'md-viewer', key: 'page' } as const, 0)
const listing = atom({ plugin: 'md-viewer', key: 'listing' } as const, { dir: '', entries: [] })
const filter = atom({ plugin: 'md-viewer', key: 'filter' } as const, '')
const notice = atom({ plugin: 'md-viewer', key: 'notice' } as const, '')
const isExpanded = atom({ plugin: 'md-viewer', key: 'isExpanded' } as const, false)
const recent = atom({ plugin: 'md-viewer', key: 'recent' } as const, [])
const places = atom({ plugin: 'md-viewer', key: 'places' } as const, { cwd: '', home: '', plans: '' })

const reason = (error: unknown): string =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error'

// The pages of the shown file, kept while its text stays the same: a cache
// of what `doc` already holds, so a reload losing it costs one re-cut.
let cut: { path: string; text: string; pages: Page[] } | undefined
function pagesOf(shown: MdDoc): Page[] {
  if (cut?.path !== shown.path || cut.text !== shown.text) {
    cut = { path: shown.path, text: shown.text, pages: paginate(shown.text, shown.path) }
  }

  return cut.pages
}

/** Half the screen, or all the room there is; unknown sizes left to the surface. */
function paneSize(isWide: boolean, screen: Screen = {}): Screen {
  if (isWide) return { columns: ALL_THE_ROOM, rows: ALL_THE_ROOM }
  const size: Screen = {}
  if (screen.columns) size.columns = Math.max(MIN_COLUMNS, Math.floor(screen.columns / 2))
  if (screen.rows) size.rows = Math.max(MIN_ROWS, Math.floor(screen.rows / 2))

  return size
}

async function findPlaces($: Engine): Promise<MdPlaces> {
  const cwd = await $.session.cwd()
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE')) || ''
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) || (home === '' ? '' : join(home, '.claude'))

  return { cwd, home, plans: config === '' ? '' : join(config, 'plans') }
}

async function scrollToTop($: Engine): Promise<void> {
  await $.ui.scroll({ in: PANE, to: 'start' }).catch(() => undefined)
}

/** A folder's subfolders and Markdown files; links followed, `.git` and `node_modules` left out. */
async function listMarkdown($: Engine, dir: string, isNewestFirst: boolean): Promise<MdListing> {
  let found
  try {
    found = await $.fs.list(dir)
  } catch (error) {
    return { dir, entries: [], error: reason(error) }
  }
  const entries: MdEntry[] = []
  for (const entry of found) {
    if (SKIPPED.has(entry.name)) continue
    let { kind, size, mtimeMs } = entry
    if (kind === 'other' && entry.isLink) {
      const target = await $.fs.stat(join(dir, entry.name)).catch(() => undefined)
      if (target === undefined) continue
      ;({ kind, size, mtimeMs } = target)
    }
    if (kind === 'dir' || (kind === 'file' && isMarkdownPath(entry.name))) {
      entries.push({ name: entry.name, isDir: kind === 'dir', size, mtimeMs })
    }
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    if (isNewestFirst && !a.isDir && b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs

    return a.name.localeCompare(b.name)
  })

  return { dir, entries }
}

/** Shows `dir` in the picker; plans newest first. */
async function browse($: Engine, dir: string): Promise<void> {
  const { plans } = await read($, places)
  const listed = await listMarkdown($, dir, dir === plans)
  await update($, listing, () => listed)
  await update($, filter, () => '')
  await update($, mode, () => 'pick')
  await scrollToTop($)
}

async function remember($: Engine, path: string): Promise<void> {
  const list = await update($, recent, old => [path, ...old.filter(one => one !== path)].slice(0, RECENT_MAX))
  await $.store.set('recent', list)
}

/** Opens `path`: a file into the viewer, a folder into the picker. Answers why not, or nothing. */
async function open($: Engine, path: string): Promise<string | undefined> {
  const { home } = await read($, places)
  try {
    const stat = await $.fs.stat(path)
    if (stat.kind === 'dir') {
      await browse($, path)
    } else {
      const text = await $.fs.read(path)
      await update($, doc, () => ({ path, text, size: stat.size, mtimeMs: stat.mtimeMs }))
      await update($, page, () => 0)
      await update($, mode, () => 'read')
      await remember($, path)
      await scrollToTop($)
    }
    await update($, notice, () => '')

    return undefined
  } catch (error) {
    return `Cannot open ${tildify(path, home)}: ${reason(error)}`
  }
}

/** `open` from a press: a failure is shown in the pane. */
async function go($: Engine, path: string): Promise<void> {
  const failed = await open($, path)
  if (failed !== undefined) await update($, notice, () => failed)
}

async function openNewestPlan($: Engine, where: MdPlaces): Promise<string | undefined> {
  if (where.plans === '') return 'No plans folder: neither HOME nor CLAUDE_CONFIG_DIR is set.'
  const { entries } = await listMarkdown($, where.plans, true)
  const newest = entries.find(entry => !entry.isDir)
  if (newest === undefined) return `No plans yet in ${tildify(where.plans, where.home)}.`

  return open($, join(where.plans, newest.name))
}

async function showPane($: Engine, screen?: Screen) {
  const isWide = await read($, isExpanded)

  return $.ui.open({ id: PANE, title: TITLE, focus: true, ...paneSize(isWide, screen) })
}

async function toggleExpanded($: Engine, screen?: Screen): Promise<void> {
  const isWide = await update($, isExpanded, was => !was)
  await $.ui.open({ id: PANE, title: TITLE, ...paneSize(isWide, screen) })
}

async function turnPage($: Engine, by: number, count: number): Promise<void> {
  await update($, page, at => Math.min(count - 1, Math.max(0, at + by)))
  await scrollToTop($)
}

/** The filter's Enter: a path opens as typed, a word opens its first match. */
async function submitFilter($: Engine, text: string): Promise<void> {
  const typed = text.trim()
  if (typed === '') return
  const [where, list] = await Promise.all([read($, places), read($, listing)])
  if (/[\\/]/.test(typed) || typed.startsWith('~') || typed.startsWith('.')) {
    await go($, resolve(list.dir || where.cwd, expandHome(typed, where.home)))

    return
  }
  const first = matching(list.entries, typed)[0]
  if (first === undefined) await update($, notice, () => `Nothing here matches "${typed}".`)
  else await go($, join(list.dir, first.name))
}

function matching(entries: readonly MdEntry[], query: string): MdEntry[] {
  const needle = query.trim().toLowerCase()
  const isPath = /[\\/]/.test(needle) || needle.startsWith('~')

  return needle === '' || isPath ? [...entries] : entries.filter(entry => entry.name.toLowerCase().includes(needle))
}

/** Re-reads the shown file when it changed on disk, keeping the page. */
async function followFile($: Engine): Promise<void> {
  const shown = await read($, doc)
  if (shown === null) return
  const panes = await $.ui.panes()
  if (!panes.some(pane => pane.id === PANE && pane.isShown)) return
  const stat = await $.fs.stat(shown.path).catch(() => undefined)
  if (stat === undefined || (stat.mtimeMs === shown.mtimeMs && stat.size === shown.size)) return
  const text = await $.fs.read(shown.path).catch(() => undefined)
  if (text === undefined) return
  await update($, doc, now =>
    now?.path === shown.path ? { ...now, text, size: stat.size, mtimeMs: stat.mtimeMs } : now,
  )
}

type Args = { path: string; isPlan: boolean; size?: 'full' | 'half' }

function parseArgs(raw: string): Args {
  const args: Args = { path: '', isPlan: false }
  const rest: string[] = []
  for (const word of raw.trim().split(/\s+/)) {
    if (word === '--plan') args.isPlan = true
    else if (word === '--full') args.size = 'full'
    else if (word === '--half') args.size = 'half'
    else if (word !== '') rest.push(word)
  }
  args.path = rest.join(' ').replace(/^(["'])(.*)\1$/, '$2')

  return args
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({
      name: COMMAND,
      description: 'Render a Markdown file in a side pane: file picker, newest plan, full-screen toggle',
      argumentHint: '[file | folder | --plan] [--full | --half]',
    })
    const kept = await $.store.get('recent')
    if (Array.isArray(kept)) {
      await update($, recent, () => kept.filter((one): one is string => typeof one === 'string').slice(0, RECENT_MAX))
    }
    $.clock.every(FOLLOW_MS, () => void followFile($).catch(() => undefined))

    return started
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const args = parseArgs(e.args)
    const where = await findPlaces($)
    await update($, places, () => where)
    if (args.size !== undefined) await update($, isExpanded, () => args.size === 'full')

    const failed = args.isPlan
      ? await openNewestPlan($, where)
      : args.path !== ''
        ? await open($, resolve(where.cwd, expandHome(args.path, where.home)))
        : undefined
    const isBare = !args.isPlan && args.path === ''
    if (failed !== undefined || (isBare && (await read($, doc)) === null)) {
      const { dir } = await read($, listing)
      await browse($, dir || where.cwd)
      await update($, notice, () => failed ?? '')
    }

    const placed = await showPane($, e.presentation.isFullscreen ? { columns: e.presentation.columns } : undefined)
    if (!placed.isPlaced) return { text: `The Markdown pane is waiting for room: ${placed.reason}` }
    if (failed !== undefined) return { text: failed }
    const shown = await read($, doc)
    if ((await read($, mode)) === 'read' && shown !== null) {
      return { text: `Showing ${tildify(shown.path, where.home)} in the Markdown pane.` }
    }

    return { text: 'Pick a Markdown file in the pane.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = table
    const Input = 'Input' in table ? table.Input : undefined
    // Only the terminal measures the whole screen; elsewhere the surface sizes the pane.
    const screen: Screen | undefined = e.surface === 'terminal' ? e.viewport : undefined
    const width = Math.max(1, e.props.bodyColumns)
    const [view, isWide, note, where, shown] = await Promise.all([
      read($, mode),
      read($, isExpanded),
      read($, notice),
      read($, places),
      read($, doc),
    ])
    const isReading = view === 'read' && shown !== null
    const hotkey = (key: string) => (isReading ? { hotkey: key } : {})

    const toolbar = (
      <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
        {isReading ? (
          <Button key="pick" label="Open…" {...hotkey('o')} onPress={() => browse($, dirname(shown.path))} />
        ) : (
          shown !== null && <Button key="back" label="Back to file" onPress={() => update($, mode, () => 'read')} />
        )}
        <Button
          key="size"
          label={isWide ? 'Half screen' : 'Full screen'}
          {...hotkey('f')}
          onPress={() => toggleExpanded($, screen)}
        />
        {isReading && <Button key="reload" label="Reload" {...hotkey('r')} onPress={() => go($, shown.path)} />}
        <Button key="close" label="Close" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
      </Box>
    )
    const rule = (
      <Text dimColor wrap="truncate">
        {'─'.repeat(width)}
      </Text>
    )
    const warning = note !== '' && <Text color="red">{note}</Text>

    if (isReading) {
      const pages = pagesOf(shown)
      const at = Math.min(await read($, page), pages.length - 1)
      const chunks: Chunk[] = pages[at] ?? []
      const paging = pages.length > 1 ? ` · page ${at + 1} of ${pages.length}` : ''

      return (
        <Box flexDirection="column">
          <Text bold wrap="truncate-end">
            {basename(shown.path)}
          </Text>
          <Text dimColor wrap="truncate-start">
            {`${tildify(dirname(shown.path), where.home)} · ${formatSize(shown.size)} · ${countLines(shown.text)} lines${paging} · live`}
          </Text>
          {toolbar}
          {e.surface === 'terminal' && (
            <Text dimColor wrap="truncate-end">
              {e.props.isFocused
                ? `o open · f ${isWide ? 'half' : 'full'} screen · r reload${pages.length > 1 ? ' · n/p page' : ''} · Esc to prompt`
                : 'ctrl+x tab focuses this pane'}
            </Text>
          )}
          {warning}
          {rule}
          {chunks.map((chunk, index) => (
            <Markdown
              key={`md:${index}`}
              text={chunk.text}
              {...(chunk.links.length > 0
                ? {
                    pressableLinks: chunk.links.slice(0, 256),
                    onLinkPress: (link: { href: string }) => {
                      const path = fromFileHref(link.href)
                      if (path !== undefined) void go($, path)
                    },
                  }
                : {})}
            />
          ))}
          {pages.length > 1 && rule}
          {pages.length > 1 && (
            <Box flexDirection="row" columnGap={1}>
              <Button key="prev" label="‹ Prev" hotkey="p" onPress={() => turnPage($, -1, pages.length)} />
              <Text dimColor>{`Page ${at + 1} of ${pages.length}`}</Text>
              <Button key="next" label="Next ›" hotkey="n" onPress={() => turnPage($, 1, pages.length)} />
            </Box>
          )}
        </Box>
      )
    }

    const [list, query, recents] = await Promise.all([read($, listing), read($, filter), read($, recent)])
    const rows = matching(list.entries, query)
    const parent = dirname(list.dir)

    return (
      <Box flexDirection="column">
        <Text bold>Open a Markdown file</Text>
        {toolbar}
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {list.dir !== '' && parent !== list.dir && (
            <Button key="place:up" label="↑ Up" onPress={() => go($, parent)} />
          )}
          {where.cwd !== '' && <Button key="place:project" label="Project" onPress={() => go($, where.cwd)} />}
          {where.plans !== '' && <Button key="place:plans" label="Plans" onPress={() => go($, where.plans)} />}
          {where.home !== '' && <Button key="place:home" label="Home" onPress={() => go($, where.home)} />}
        </Box>
        {Input !== undefined && (
          <Input
            key="filter"
            label="Find "
            placeholder="filter, or type a path and press Enter"
            submitLabel="open"
            value={query}
            autoFocus
            onInput={value => void update($, filter, () => value)}
            onSubmit={value => void submitFilter($, value)}
          />
        )}
        {warning}
        {query === '' && recents.length > 0 && <Text dimColor>Recent</Text>}
        {query === '' &&
          recents.map((path, index) => (
            <Button
              key={`recent:${index}`}
              plain
              label={`↺ ${tildify(path, where.home)}`}
              onPress={() => go($, path)}
            />
          ))}
        {rule}
        <Text dimColor wrap="truncate-start">
          {tildify(list.dir, where.home)}
        </Text>
        {list.error !== undefined && <Text color="red">{`Cannot list this folder: ${list.error}`}</Text>}
        {list.error === undefined && list.entries.length === 0 && (
          <Text dimColor>No Markdown files or folders here.</Text>
        )}
        {list.entries.length > 0 && rows.length === 0 && (
          <Text dimColor>{`Nothing matches "${query}". Enter opens it as a path.`}</Text>
        )}
        {rows.slice(0, ROWS_MAX).map((entry, index) => (
          <Button
            key={`entry:${index}`}
            plain
            label={entry.isDir ? `▸ ${entry.name}/` : `≡ ${entry.name}  ${formatSize(entry.size)}`}
            onPress={() => go($, join(list.dir, entry.name))}
          />
        ))}
        {rows.length > ROWS_MAX && <Text dimColor>{`… ${rows.length - ROWS_MAX} more: narrow the filter.`}</Text>}
      </Box>
    )
  })
}
